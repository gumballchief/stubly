"use strict";

/**
 * Keyless health check for the hosted settlement worker.
 *
 * This replaces a scheduled job that used to restore both signing keystores
 * onto a GitHub runner and run a settlement pass. Render now polls every ten
 * seconds and never sleeps, so that pass was redundant — and it meant GitHub
 * held the provider key, the evaluator key and their decryption password.
 *
 * Nothing here signs anything. It reads public things and fails loudly if any
 * of them is wrong, so a silent outage produces an email instead of a customer
 * who paid and got nothing.
 *
 *   node worker/health-check.js            # WORKER_URL and SITE_URL from env
 *
 * Checks the chain named by CHAIN_ID (testnet unless set). Off testnet it needs
 * PROVIDER_WALLET and EVALUATOR_WALLET: testnet's are never assumed.
 */

const { Contract, JsonRpcProvider, Interface, zeroPadValue, formatUnits } = require("ethers");
const { CFG } = require("../chain/config");
const { sells } = require("../site/api/_shared");

/* Defaulting to testnet's provider made the stranded-buyer scan filter mainnet's escrow for
   a wallet that never trades there, find nothing, and report all clear. */
const PROVIDER_WALLET = process.env.PROVIDER_WALLET || (CFG.TESTNET ? "0x15b9F8a8658E10DaD42ec08CEf158Ca1392a8944" : "");
const EVALUATOR_WALLET = process.env.EVALUATOR_WALLET || (CFG.TESTNET ? "0x6F5A2E61DA4C779c6b4119F3BfEC8ec53Db488C7" : "");
const WORKER_URL = process.env.WORKER_URL || "";
const SITE_URL = process.env.SITE_URL || "https://stubly.org";
const CHAIN_KEY = CFG.TESTNET ? "testnet" : "mainnet";

/* A pass every 10s means anything past a couple of minutes is a stall, not a blip. */
const STALE_PASS_SECONDS = 180;
/* A single pass past this is wedged, not working. */
const BUSY_LIMIT_SECONDS = 900;
/* Gas on Robinhood Chain is ETH. An evaluator out of gas silently stops every settlement and every
   escrow refund; a provider out of gas cannot quote, deliver or fund a sub-order. */
const PROVIDER_MIN_ETH = Number(process.env.PROVIDER_MIN_ETH || 0.0005);
const EVALUATOR_MIN_ETH = Number(process.env.EVALUATOR_MIN_ETH || 0.0002);

const problems = [];
const note = (s) => console.log(s);

async function checkWorker() {
  if (!WORKER_URL) return note("worker:   skipped (WORKER_URL not set)");
  let body;
  try {
    const r = await fetch(WORKER_URL, { signal: AbortSignal.timeout(60_000) });
    if (!r.ok) return problems.push(`worker returned HTTP ${r.status}`);
    body = await r.json();
  } catch (e) {
    return problems.push(`worker unreachable: ${e.message}`);
  }
  if (body.ok !== true) problems.push(`worker reports not ok: ${JSON.stringify(body)}`);
  if (body.lastError) problems.push(`worker lastError: ${body.lastError}`);
  /* Reported, not failed on: a broken inbox is worth knowing about, not worth paging over
     the way a stalled payout is. */
  if (body.support) {
    const sp = body.support;
    note(`support:  ${sp.enabled ? "on" : "off"} · mode ${sp.mode} · new last check ${sp.newLastCheck ?? "?"} · answered ${sp.replied} · escalated ${sp.escalated} · ignored ${sp.ignored} · notify ${sp.notify}${sp.lastError ? " · last error: " + sp.lastError : ""}`);
  }
  if (Number(body.chainId) !== CFG.CHAIN_ID) {
    problems.push(`worker is on chain ${body.chainId}, expected ${CFG.CHAIN_ID}`);
  }
  /* Mid-pass is not stale. A pass that is running an agent legitimately takes
     minutes, so only an idle worker is judged on how long ago it last finished. */
  const since = Number(body.secondsSinceLastPass);
  const busy = Number(body.busySeconds);
  if (Number.isFinite(busy)) {
    if (busy > BUSY_LIMIT_SECONDS) problems.push(`worker stuck in one pass for ${busy}s (limit ${BUSY_LIMIT_SECONDS}s)`);
    else note(`worker:   ok · ${body.passes} passes · busy ${busy}s on the current one`);
  } else {
    if (Number.isFinite(since) && since > STALE_PASS_SECONDS) {
      problems.push(`worker last polled ${since}s ago (limit ${STALE_PASS_SECONDS}s)`);
    }
    note(`worker:   ok · ${body.passes} passes · last ${since}s ago`);
  }
}

/* Liveness is /api/catalog, not /api/stats.
   /api/stats scans every order from block zero and reads each one's status off
   the escrow, so a cold function on a cold RPC can legitimately take tens of
   seconds — it answers in well under a second once warm. Failing the whole check
   on that means paging a human because a cache was cold, which trains people to
   ignore the alert. Catalog does no chain reads, so it answers the actual
   question: are the site and its functions serving? Stats is reported when it
   comes back and skipped when it does not.

   Both ask for this chain by name. After the flip the site's default is mainnet, and
   a site whose mainnet is not configured quietly answers with testnet, so the chain it
   answered with is checked too. */
async function checkSite() {
  try {
    const r = await fetch(`${SITE_URL}/api/catalog?chain=${CHAIN_KEY}`, { signal: AbortSignal.timeout(30_000) });
    if (!r.ok) return problems.push(`site /api/catalog returned HTTP ${r.status}`);
    const c = await r.json();
    if (Number(c.chainId) !== CFG.CHAIN_ID) {
      problems.push(`site answered ?chain=${CHAIN_KEY} with chain ${c.chainId}, expected ${CFG.CHAIN_ID} (is it configured on the site?)`);
    }
    const keys = Object.keys(c.agents || {});
    const offShelf = keys.filter((k) => !sells(CFG, k));
    if (offShelf.length) problems.push(`site lists agents this chain does not sell: ${offShelf.join(", ")}`);
    const registered = Object.values(c.agents || {}).filter((a) => a.agentId).length;
    if (!registered) problems.push("site is serving no registered agent identities");
    note(`site:     ok · ${keys.length} agents · ${registered} with an identity · chain ${c.chainId}`);
  } catch (e) {
    return problems.push(`site /api/catalog unreachable: ${e.message}`);
  }

  try {
    const r = await fetch(`${SITE_URL}/api/stats?chain=${CHAIN_KEY}`, { signal: AbortSignal.timeout(45_000) });
    const s = await r.json();
    if (s.live) note(`stats:    ${s.jobs} orders · ${s.settled} settled · ${s.hirers} buyers`);
    else note(`stats:    slow or unavailable this run (${s.error || "no reason given"}) — not treated as an outage`);
  } catch {
    note("stats:    slow this run — not treated as an outage");
  }
}

/* The wallets that sign every settlement and refund, read straight off the chain. */
async function checkBalances(prov) {
  const live = Number(BigInt(await prov.send("eth_chainId", [])));
  if (live !== CFG.CHAIN_ID) return problems.push(`RPC_URL is chain ${live}, expected ${CFG.CHAIN_ID}`);
  for (const [role, addr, min] of [["provider", PROVIDER_WALLET, PROVIDER_MIN_ETH], ["evaluator", EVALUATOR_WALLET, EVALUATOR_MIN_ETH]]) {
    if (!addr) continue;
    const eth = Number(formatUnits(await prov.getBalance(addr), 18)); // gas on Robinhood Chain is ETH
    if (eth < min) problems.push(`${role} wallet ${addr} holds ${eth.toFixed(5)} ETH, under the ${min} ETH it needs for gas`);
    else note(`${role.padEnd(9)} ${eth.toFixed(5)} ETH`);
  }
}

/* The condition that actually hurts someone: money in escrow, deadline gone,
   nothing delivered. That is a buyer who paid and got nothing. */
async function checkStrandedBuyers(prov) {
  if (!CFG.EXPLORER_API || !CFG.ERC8183) return problems.push(`stranded check impossible: EXPLORER_API or ERC8183_ADDRESS not set for chain ${CFG.CHAIN_ID}`);
  const iface = new Interface([
    "event JobCreated(uint256 indexed jobId, address indexed client, address indexed provider, address evaluator, uint256 expiredAt, address hook)",
  ]);
  let logs;
  try {
    const { getLogs } = require("../site/api/_logs");
    logs = await getLogs({ ...CFG, START_BLOCK: Number(process.env.START_BLOCK || 0) }, {
      address: CFG.ERC8183,
      topics: [iface.getEvent("JobCreated").topicHash, null, null, zeroPadValue(PROVIDER_WALLET, 32)],
      fromBlock: 0,
      timeoutMs: 60_000,
    });
  } catch (e) {
    return problems.push(`stranded check impossible: neither the explorer nor the RPC returned logs (${e.message})`);
  }

  const jobs = new Contract(CFG.ERC8183, [
    "function getJob(uint256) view returns (tuple(uint256 id, address client, address provider, address evaluator, string description, uint256 budget, uint256 expiredAt, uint8 status, address hook))",
  ], prov);

  const now = Math.floor(Date.now() / 1000);
  const stranded = [];
  for (const l of logs.slice(-60)) {
    const j = await jobs.getJob(BigInt(l.topics[1]));
    const funded = Number(j.status) === 1 || Number(j.status) === 2; // Funded | Submitted
    if (funded && Number(j.expiredAt) < now && j.budget > 0n) {
      stranded.push(`#${j.id} (${formatUnits(j.budget, 6)} USDC, buyer ${j.client})`);
    }
  }
  if (stranded.length) problems.push(`buyers paid and got nothing: ${stranded.join(", ")}`);
  else note("stranded: none — no funded order is past its deadline");
}

(async () => {
  note(`chain:    ${CFG.CHAIN_ID} (${CHAIN_KEY})`);
  await checkWorker();
  await checkSite();

  if (!PROVIDER_WALLET || !EVALUATOR_WALLET) {
    problems.push(`PROVIDER_WALLET and EVALUATOR_WALLET must be set to check chain ${CFG.CHAIN_ID}; testnet's are never assumed`);
  }
  if (!CFG.RPC_URL) {
    problems.push(`RPC_URL is not set for chain ${CFG.CHAIN_ID}`);
  } else {
    const prov = new JsonRpcProvider(CFG.RPC_URL, CFG.CHAIN_ID, { staticNetwork: true });
    await checkBalances(prov).catch((e) => problems.push(`balance check failed: ${e.message}`));
    if (PROVIDER_WALLET) await checkStrandedBuyers(prov).catch((e) => problems.push(`stranded check failed: ${e.message}`));
  }

  if (problems.length) {
    console.error(`\nFAILING — ${problems.length} problem(s):`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log("\nall clear");
})();
