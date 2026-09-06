"use strict";

/**
 * Keyless health check for the hosted settlement worker.
 *
 * This replaces a scheduled job that used to restore both signing keystores
 * onto a GitHub runner and run a settlement pass. Render now polls every ten
 * seconds and never sleeps, so that pass was redundant — and it meant GitHub
 * held the provider key, the evaluator key and their decryption password.
 *
 * Nothing here signs anything. It reads three public things and fails loudly if
 * any of them is wrong, so a silent outage produces an email instead of a
 * customer who paid and got nothing.
 *
 *   node worker/health-check.js            # WORKER_URL and SITE_URL from env
 */

const { Contract, JsonRpcProvider, Interface, zeroPadValue, formatUnits } = require("ethers");
const { CFG } = require("../chain/config");

const PROVIDER_WALLET = process.env.PROVIDER_WALLET || "0x15b9F8a8658E10DaD42ec08CEf158Ca1392a8944";
const WORKER_URL = process.env.WORKER_URL || "";
const SITE_URL = process.env.SITE_URL || "https://stubly.org";

/* A pass every 10s means anything past a couple of minutes is a stall, not a blip. */
const STALE_PASS_SECONDS = 180;

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
  if (Number(body.chainId) !== CFG.CHAIN_ID) {
    problems.push(`worker is on chain ${body.chainId}, expected ${CFG.CHAIN_ID}`);
  }
  const since = Number(body.secondsSinceLastPass);
  if (Number.isFinite(since) && since > STALE_PASS_SECONDS) {
    problems.push(`worker last polled ${since}s ago (limit ${STALE_PASS_SECONDS}s)`);
  }
  note(`worker:   ok · ${body.passes} passes · last ${since}s ago`);
}

async function checkSite() {
  try {
    const r = await fetch(`${SITE_URL}/api/stats`, { signal: AbortSignal.timeout(45_000) });
    const s = await r.json();
    if (!s.live) return problems.push(`site /api/stats says live=false: ${s.error || ""}`);
    note(`site:     ok · ${s.jobs} orders · ${s.settled} settled · ${s.hirers} buyers`);
  } catch (e) {
    problems.push(`site /api/stats unreachable: ${e.message}`);
  }
}

/* The condition that actually hurts someone: money in escrow, deadline gone,
   nothing delivered. That is a buyer who paid and got nothing. */
async function checkStrandedBuyers() {
  const prov = new JsonRpcProvider(CFG.RPC_URL, CFG.CHAIN_ID, { staticNetwork: true });
  const iface = new Interface([
    "event JobCreated(uint256 indexed jobId, address indexed client, address indexed provider, address evaluator, uint256 expiredAt, address hook)",
  ]);
  const url =
    `${CFG.EXPLORER_API.replace(/\/v2$/, "")}?module=logs&action=getLogs&fromBlock=0&toBlock=latest` +
    `&address=${CFG.ERC8183}&topic0=${iface.getEvent("JobCreated").topicHash}` +
    `&topic3=${zeroPadValue(PROVIDER_WALLET, 32)}&topic0_3_opr=and`;

  const r = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  const logs = (await r.json()).result;
  if (!Array.isArray(logs)) return note("stranded: skipped (explorer returned no log list)");

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
  await checkWorker();
  await checkSite();
  await checkStrandedBuyers().catch((e) => problems.push(`stranded check failed: ${e.message}`));

  if (problems.length) {
    console.error(`\nFAILING — ${problems.length} problem(s):`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log("\nall clear");
})();
