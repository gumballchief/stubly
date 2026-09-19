"use strict";

/**
 * Switch Stubly to Robinhood Chain in one run, from your own terminal.
 *
 *   npm run mainnet:flip                    do it (asks you to type FLIP first)
 *   npm run mainnet:flip -- --dry-run       show every step, change nothing
 *   npm run mainnet:flip -- --worker        only move the worker (steps 7 and 8), for a flip that
 *                                           stopped after the site went live
 *
 * This is a move, not a first launch: stubly.org already opens its mainnet slot, which pointed at
 * Arc. Nothing starts until `npm run mainnet:check` passes: Stubly's escrow and the identity registry
 * on chain, USDG real, both wallets funded (USDG and ETH for gas), every agent card present.
 *
 * What it does after you type FLIP:
 *   2. asks the mainnet wallet password once (hidden) and proves it opens both wallets
 *   3. checks no Arc order is half done (any that is refunds its buyer after the deadline anyway)
 *   4. puts Robinhood Chain's settings on Vercel and removes the old Arc token's settings
 *   5. merges the robinhood branch into master, pushes, deploys: the site opens Robinhood Chain
 *   6. registers every agent's ERC-8004 identity there (a little ETH gas), redeploys with the ids
 *   7. moves the worker (automatically with RENDER_API_KEY + RENDER_SERVICE_ID set, otherwise it
 *      tells you the exact values to paste and waits)
 *   8. checks the live worker, and tells you how to place the first real order
 *
 * The password lives only in this process's memory. It reaches Vercel through the
 * CLI's standard input (never a PowerShell pipe) and the registry script through its
 * environment. It is never printed or written to disk.
 */

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { spawnSync } = require("child_process");
const { Wallet, JsonRpcProvider, Contract } = require("ethers");
const { runChecks, rpc } = require("./mainnet-check");
const { askHidden, copyToClipboard } = require("./make-mainnet-wallets");

const ROOT = path.join(__dirname, "..");
const SITE = "https://stubly.org";
const BRANCH = "robinhood";
const CHAIN_AGENTS = ["wallet-report", "token-report", "tx-explain", "contract-check", "chain-pulse"];
/* gas-estimate prices Arc gas in USDC, which means nothing on a chain whose gas is ETH. */
const ALWAYS_OFF = ["gas-estimate"];
const DRY = process.argv.includes("--dry-run");

const say = (s = "") => console.log(s);
const step = (n, title) => say(`\n── ${n}. ${title}`);

function ask(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl.question(question, (a) => { rl.close(); resolve(a.trim()); });
  });
}

/* One place every side effect goes through, so --dry-run is honest: it prints exactly
   what would run and runs nothing. `input` goes to standard input and is never shown. */
function run(cmd, args, { input, env, quiet = false, allowFail = false } = {}) {
  const shown = `${cmd} ${args.join(" ")}`;
  if (DRY) { say(`   would run: ${shown}${input !== undefined ? "  (value from memory, not shown)" : ""}`); return { status: 0, stdout: "" }; }
  if (!quiet) say(`   $ ${shown}`);
  const r = spawnSync(cmd, args, {
    cwd: ROOT, input, env: { ...process.env, ...env }, encoding: "utf8",
    /* npx is a .cmd file on Windows and needs a shell; nothing handed to it contains a
       space. git and node run directly, so a commit message stays one argument. */
    shell: process.platform === "win32" && cmd === "npx",
    stdio: quiet ? "pipe" : [input === undefined ? "inherit" : "pipe", "inherit", "inherit"],
    windowsHide: true, maxBuffer: 64 * 1024 * 1024,
  });
  if (r.error) throw new Error(`${shown} could not start: ${r.error.message}`);
  if (r.status !== 0 && !allowFail) {
    throw new Error(`${shown} failed${quiet ? `:\n${String(r.stderr || r.stdout || "").trim().slice(-1200)}` : " (see the output above)"}`);
  }
  return r;
}

async function getJson(url, init, tries = 5) {
  for (let i = 1; ; i++) {
    try {
      const r = await fetch(url, { ...init, signal: AbortSignal.timeout(30_000) });
      return { status: r.status, body: await r.json().catch(() => ({})) };
    } catch (e) {
      if (i >= tries) throw new Error(`${url} did not answer: ${e.message}`);
      await new Promise((res) => setTimeout(res, 10_000));
    }
  }
}

/* Orders on the chain Stubly is leaving (Arc mainnet) that are paid and not yet settled. Once the site and
   the worker move, nothing of ours finishes them. The escrow still refunds any of them to its buyer after
   the deadline (claimRefund is open to anyone), so this is about not walking out mid-order, not lost money.
   Orders last 10 minutes and Arc mints about two blocks a second, so the last 20,000 blocks cover it. */
const ARC = { CHAIN_ID: 5042, RPC_URL: "https://rpc.mainnet.arc.io", STATE: "escrow-mainnet.json" };
async function arcOrdersOpen(providerWallet) {
  const { ERC8183_ABI_MIN } = require("./config");
  const escrow = JSON.parse(fs.readFileSync(path.join(__dirname, ARC.STATE), "utf8")).escrow;
  const prov = new JsonRpcProvider(ARC.RPC_URL, ARC.CHAIN_ID, { staticNetwork: true });
  const jobs = new Contract(escrow, ERC8183_ABI_MIN, prov);
  const latest = await prov.getBlockNumber();
  const ids = new Set();
  for (let start = latest - 20_000; start <= latest; start += 5000) { // this RPC caps a log query at 5,000 blocks
    const logs = await jobs.queryFilter(jobs.filters.JobCreated(null, null, providerWallet), start, Math.min(start + 4999, latest));
    for (const l of logs) ids.add(l.args.jobId.toString());
  }
  let open = 0;
  for (const id of ids) {
    const j = await jobs.getJob(id);
    if ([1, 2].includes(Number(j.status ?? j[7]))) open++;
  }
  return open;
}

async function waitForArcOrders(providerWallet) {
  for (let i = 0; ; i++) {
    let open = 0;
    try { open = DRY ? 0 : await arcOrdersOpen(providerWallet); } catch (e) {
      say(`   could not read Arc's orders (${String(e.shortMessage || e.message).slice(0, 80)})`);
      say("   Any order still open there refunds its buyer after its 10-minute deadline, so nothing can be lost.");
      if ((await ask("   Type CONTINUE to go on without the check: ")) !== "CONTINUE") throw new Error("stopped: nothing was changed");
      return;
    }
    if (!open) { say("   no Arc orders are in progress"); return; }
    if (i >= 50) throw new Error(`${open} Arc orders are still in progress after 25 minutes. Run this again later`);
    process.stdout.write(`\r   ${open} Arc order(s) still in progress, checking again in 30 seconds `);
    await new Promise((r) => setTimeout(r, 30_000));
  }
}

async function openWallets(values) {
  const password = await askHidden("Mainnet wallet password (hidden): ");
  for (const [name, expected] of [["provider_mainnet", values.PROVIDER_WALLET], ["evaluator_mainnet", values.EVALUATOR_WALLET]]) {
    const json = fs.readFileSync(path.join(__dirname, `${name}.keystore.json`), "utf8");
    let w;
    try { w = await Wallet.fromEncryptedJson(json, password); }
    catch { throw new Error(`that password does not open ${name}`); }
    if (w.address.toLowerCase() !== String(expected).toLowerCase()) throw new Error(`${name} is ${w.address}, not the wallet the check used`);
  }
  say("   password opens both wallets");
  return password;
}

const b64 = (name) => Buffer.from(fs.readFileSync(path.join(__dirname, `${name}.keystore.json`), "utf8"), "utf8").toString("base64");

function vercelEnv(name, value, { sensitive = false } = {}) {
  run("npx", ["vercel", "env", "add", name, "production", "--force", "--yes", sensitive ? "--sensitive" : "--no-sensitive"],
    { input: value, quiet: true });
  if (!DRY) say(`   Vercel ${name} set${sensitive ? " (sensitive)" : ""}`);
}

/* Render: one variable at a time through its API when a key is available. Without one,
   the owner pastes the values in the dashboard and this waits. */
async function renderSet(vars, remove) {
  const key = process.env.RENDER_API_KEY, service = process.env.RENDER_SERVICE_ID;
  if (!key || !service) return false;
  const api = (p, init) => fetch(`https://api.render.com/v1/services/${service}${p}`, {
    ...init, headers: { authorization: `Bearer ${key}`, "content-type": "application/json", accept: "application/json" },
    signal: AbortSignal.timeout(30_000),
  });
  for (const [k, v] of Object.entries(vars)) {
    if (DRY) { say(`   would set Render ${k}`); continue; }
    const r = await api(`/env-vars/${encodeURIComponent(k)}`, { method: "PUT", body: JSON.stringify({ value: v }) });
    if (!r.ok) throw new Error(`Render refused ${k}: ${r.status} ${await r.text().catch(() => "")}`);
    say(`   Render ${k} set`);
  }
  for (const k of remove) {
    if (DRY) { say(`   would remove Render ${k}`); continue; }
    await api(`/env-vars/${encodeURIComponent(k)}`, { method: "DELETE" });
    say(`   Render ${k} removed`);
  }
  return true;
}

/* The worker blueprint pins the chain. After the move it must pin Robinhood Chain, or a later
   push would put the worker back on Arc. Secrets stay sync:false (dashboard only). */
function renderYamlForMainnet(text, v) {
  /* render.yaml is checked out with Windows line endings. Every pattern below matches on \n, so on the
     CRLF copy none of them matched and the pin silently changed nothing. Match on LF, then restore. */
  const crlf = text.includes("\r\n");
  text = text.replace(/\r\n/g, "\n");
  const set = (k, val) => {
    const re = new RegExp(`(- key: ${k}\\n\\s+value: )"[^"]*"`);
    return re.test(text) ? (text = text.replace(re, `$1"${val}"`)) : text;
  };
  set("CHAIN_ID", String(v.CHAIN_ID));
  set("ERC8183_ADDRESS", v.ERC8183);
  set("USDC_ADDRESS", v.USDC);
  set("EXPLORER_API", `${v.EXPLORER}/api/v2`);
  text = text.replace(/\s+- key: KEYSTORE_PASSWORD\n\s+sync: false/, "\n      - key: KEYSTORE_PASSWORD_MAINNET\n        sync: false");
  text = text.replace(/- key: PROVIDER_KEYSTORE_B64\n(\s+)sync: false/, "- key: PROVIDER_MAINNET_KEYSTORE_B64\n$1sync: false");
  text = text.replace(/- key: EVALUATOR_KEYSTORE_B64\n(\s+)sync: false/, "- key: EVALUATOR_MAINNET_KEYSTORE_B64\n$1sync: false");
  if (!/- key: IDENTITY_REGISTRY/.test(text)) {
    text = text.replace(/(- key: EXPLORER_API\n\s+value: "[^"]*")/, `$1\n      - key: IDENTITY_REGISTRY\n        value: "${v.IDENTITY_REGISTRY}"\n      - key: EXPLORER\n        value: "${v.EXPLORER}"`);
  }
  return crlf ? text.replace(/\n/g, "\r\n") : text;
}

async function flip() {
  step(1, "Check everything is ready");
  const { values: V, block, explorerOpen, checks } = await runChecks();
  for (const c of checks) say(`   ${c.ok ? "✓" : c.blocking ? "✗" : "!"} ${c.name}: ${c.detail}`);
  const waiting = checks.filter((c) => !c.ok && c.blocking);
  if (waiting.length && !DRY) throw new Error(`not ready, waiting on: ${waiting.map((c) => c.name).join("; ")}`);
  if (waiting.length) say("   (dry run: continuing past the missing items to show the rest)");

  const rosterOff = explorerOpen ? [...ALWAYS_OFF] : [...CHAIN_AGENTS, ...ALWAYS_OFF];
  /* Stubly's escrow cannot hold an order older than itself, so history reads start at its own block. */
  let startBlock = block;
  try { startBlock = JSON.parse(fs.readFileSync(path.join(__dirname, "escrow-robinhood.json"), "utf8")).escrowBlock || block; } catch { /* dry run before the deploy */ }
  const plan = {
    MAINNET_CHAIN_ID: String(V.CHAIN_ID),
    MAINNET_RPC_URL: V.RPC_URL,
    MAINNET_PUBLIC_RPC_URL: V.PUBLIC_RPC_URL,
    MAINNET_ERC8183: V.ERC8183,
    MAINNET_USDC: V.USDC,
    MAINNET_IDENTITY_REGISTRY: V.IDENTITY_REGISTRY,
    MAINNET_EXPLORER: V.EXPLORER,
    MAINNET_EXPLORER_API: `${V.EXPLORER}/api`,
    MAINNET_PROVIDER_WALLET: V.PROVIDER_WALLET,
    MAINNET_EVALUATOR_WALLET: V.EVALUATOR_WALLET,
    MAINNET_START_BLOCK: String(startBlock),
    MAINNET_ROSTER_OFF: rosterOff.join(","),
    DEFAULT_CHAIN: "mainnet",
  };

  const { MAINNET_ROSTER: ROSTER } = require(path.join(ROOT, "site/api/_shared.js"));
  say(`\nThis moves Stubly from Arc to Robinhood Chain: the site, ${ROSTER.length} agent identities and the worker.`);
  say(`These agents stay off the shop for now: ${rosterOff.join(", ")}.`);
  const go = DRY ? "FLIP" : await ask("\nType FLIP to go ahead: ");
  if (go !== "FLIP") throw new Error("stopped: nothing was changed");

  step(2, "Open the mainnet wallets");
  const password = DRY ? "dry-run" : await openWallets(V);

  step(3, "Make sure no Arc order is left half done");
  await waitForArcOrders(V.PROVIDER_WALLET);

  step(4, "Put Robinhood Chain's settings on Vercel");
  for (const [k, v] of Object.entries(plan)) vercelEnv(k, v);
  vercelEnv("PROVIDER_MAINNET_KEYSTORE_B64", DRY ? "" : b64("provider_mainnet"), { sensitive: true });
  vercelEnv("EVALUATOR_MAINNET_KEYSTORE_B64", DRY ? "" : b64("evaluator_mainnet"), { sensitive: true });
  vercelEnv("KEYSTORE_PASSWORD_MAINNET", password, { sensitive: true });
  /* The old Arc token must not come back through a leftover setting. */
  for (const k of ["MAINNET_PAY_TOKEN", "MAINNET_PAY_WALLET"]) {
    run("npx", ["vercel", "env", "rm", k, "production", "--yes"], { quiet: true, allowFail: true });
  }

  step(5, "Ship the site: one deploy, already on Robinhood Chain");
  run("git", ["checkout", BRANCH]);
  run("git", ["add", "-A"]);
  run("git", ["commit", "-m", "Stubly moves to Robinhood Chain: USDG escrow, ETH gas, new agent cards"], { allowFail: true });
  run("git", ["checkout", "master"]);
  run("git", ["pull", "--ff-only", "origin", "master"]);
  run("git", ["merge", "--no-ff", BRANCH, "-m", "Stubly moves to Robinhood Chain"]);
  run("git", ["push", "origin", "master"]);
  run("npx", ["vercel", "deploy", "--prod", "--yes"]);
  if (!DRY) {
    const cat = await getJson(`${SITE}/api/catalog`);
    if (cat.body?.chainId !== V.CHAIN_ID) throw new Error(`stubly.org opens chain ${cat.body?.chainId}, not ${V.CHAIN_ID}`);
    const missing = [];
    for (const k of ROSTER) {
      const r = await fetch(`${SITE}/agents/robinhood/${k}.json`, { signal: AbortSignal.timeout(20_000) }).catch(() => null);
      if (!r || !r.ok) missing.push(k);
    }
    if (missing.length) throw new Error(`these agent cards are not live on stubly.org yet: ${missing.join(", ")}`);
    say(`   stubly.org opens Robinhood Chain and all ${ROSTER.length} agent cards are live`);
  }

  step(6, "Register the agents' identities on Robinhood Chain");
  const chainEnv = {
    CHAIN_ID: String(V.CHAIN_ID), RPC_URL: V.RPC_URL, ERC8183_ADDRESS: V.ERC8183, USDC_ADDRESS: V.USDC,
    IDENTITY_REGISTRY: V.IDENTITY_REGISTRY, EXPLORER: V.EXPLORER, EXPLORER_API: `${V.EXPLORER}/api/v2`,
    KEYSTORE_PASSWORD_MAINNET: password,
  };
  run("node", ["chain/registry.js"], { env: chainEnv });
  run("node", ["chain/registry.js", "--register"], { env: chainEnv });
  run("git", ["add", `site/agents/ids.${V.CHAIN_ID}.json`]);
  run("git", ["commit", "-m", "Robinhood Chain agent identities [skip render]"], { allowFail: true });
  run("git", ["push", "origin", "master"]);
  run("npx", ["vercel", "deploy", "--prod", "--yes"]);
  if (!DRY) {
    const cat = await getJson(`${SITE}/api/catalog`);
    const agents = Object.values(cat.body?.agents || {});
    const noId = agents.filter((a) => !a.agentId).length;
    say(`   ${agents.length} agents on the shop, ${agents.length - noId} with identities`);
    if (noId) throw new Error(`${noId} agents have no identity yet: run this again, it picks up where it stopped`);
  }

  await moveWorker({ V, block: startBlock, rosterOff, password });

  say("\nStubly is on Robinhood Chain. Prove it with one real order from your own wallet:");
  say(`  ${SITE}/hire?agent=research-brief (1 USDG)`);
}

async function moveWorker({ V, block, rosterOff, password }) {
  step(7, "Move the worker to Robinhood Chain");
  const workerVars = {
    CHAIN_ID: String(V.CHAIN_ID), RPC_URL: V.RPC_URL, ERC8183_ADDRESS: V.ERC8183, USDC_ADDRESS: V.USDC,
    IDENTITY_REGISTRY: V.IDENTITY_REGISTRY, EXPLORER: V.EXPLORER, EXPLORER_API: `${V.EXPLORER}/api/v2`,
    START_BLOCK: String(block),
    KEYSTORE_PASSWORD_MAINNET: password,
    PROVIDER_MAINNET_KEYSTORE_B64: DRY ? "" : b64("provider_mainnet"),
    EVALUATOR_MAINNET_KEYSTORE_B64: DRY ? "" : b64("evaluator_mainnet"),
    /* The worker checks the same shelf the site does, so the agents taken off it must be off here too. */
    ...(rosterOff.length ? { MAINNET_ROSTER_OFF: rosterOff.join(",") } : {}),
  };
  /* Arc's pay-with-token settings point at a dead token; the new one is switched on separately. */
  const removeFromWorker = ["TOKENPAY", "TOKENPAY_TOKEN", "TOKENPAY_POOL", "TOKENPAY_START_BLOCK"];
  const viaApi = await renderSet(workerVars, removeFromWorker);
  if (!viaApi) {
    say("\n   Render dashboard > stubly-worker > Environment. Add or change these:");
    for (const k of Object.keys(workerVars)) {
      if (k === "KEYSTORE_PASSWORD_MAINNET") say(`     ${k}   (paste it from your password manager)`);
      else if (/B64$/.test(k)) say(`     ${k}   (this script copies it for you below)`);
      else say(`     ${k} = ${workerVars[k]}`);
    }
    say(`   And remove: ${removeFromWorker.join(", ")}`);
    if (!DRY) {
      /* The two long values go straight onto the clipboard one at a time, so nothing has to
         be copied out of this window and no second terminal is needed. */
      for (const k of ["PROVIDER_MAINNET_KEYSTORE_B64", "EVALUATOR_MAINNET_KEYSTORE_B64"]) {
        await ask(`\n   Press Enter to copy ${k}, then paste it into Render: `);
        copyToClipboard(workerVars[k]);
        say("   copied (still encrypted)");
      }
      await ask("\n   Press Enter once everything is saved in Render: ");
      say("   Now clear clipboard history: Win+V, then Clear all.");
    }
  }
  const yamlPath = path.join(ROOT, "render.yaml");
  const nextYaml = renderYamlForMainnet(fs.readFileSync(yamlPath, "utf8"), V);
  if (DRY) say("   would pin render.yaml to Robinhood Chain (chain 4663, the escrow and registry there)");
  else fs.writeFileSync(yamlPath, nextYaml);
  run("git", ["add", "render.yaml"]);
  run("git", ["commit", "-m", "Worker runs on Robinhood Chain"], { allowFail: true });
  run("git", ["push", "origin", "master"]);

  step(8, "Check the live worker");
  if (!DRY) {
    const workerUrl = process.env.WORKER_URL || "https://stubly-worker.onrender.com";
    let seen = null;
    for (let i = 0; i < 30 && seen !== V.CHAIN_ID; i++) {
      await new Promise((r) => setTimeout(r, 20_000));
      const h = await getJson(workerUrl).catch(() => null);
      seen = h?.body?.chainId ?? null;
      process.stdout.write(`\r   worker reports chain ${seen ?? "(restarting)"}   `);
    }
    say("");
    if (seen !== V.CHAIN_ID) throw new Error("the worker has not come up on mainnet after 10 minutes; check its Render logs");
    say("   worker is on Robinhood Chain");
  }
}

/* For a flip that stopped after step 5: the site is already on mainnet, only the worker is left. */
async function workerOnly() {
  step(1, "Check the site is already on Robinhood Chain");
  const { values: V, block: now, explorerOpen, checks } = await runChecks({ needFunds: false });
  for (const c of checks) say(`   ${c.ok ? "✓" : c.blocking ? "✗" : "!"} ${c.name}: ${c.detail}`);
  const waiting = checks.filter((c) => !c.ok && c.blocking);
  if (waiting.length && !DRY) throw new Error(`not ready, waiting on: ${waiting.map((c) => c.name).join("; ")}`);
  const cat = await getJson(`${SITE}/api/catalog?chain=mainnet`);
  if (cat.body?.chainId !== V.CHAIN_ID && !DRY) throw new Error("stubly.org does not serve mainnet yet: run the full npm run mainnet:flip");
  say(`   stubly.org serves mainnet: ${Object.keys(cat.body?.agents || {}).length} agents`);
  /* The worker reads orders from this block on. Stubly's escrow cannot hold an order older than itself. */
  let block = now;
  try { block = JSON.parse(fs.readFileSync(path.join(__dirname, "escrow-robinhood.json"), "utf8")).escrowBlock || now; } catch { /* Circle's escrow: start now */ }
  const rosterOff = explorerOpen ? [...ALWAYS_OFF] : [...CHAIN_AGENTS, ...ALWAYS_OFF];

  const go = DRY ? "MOVE" : await ask("\nType MOVE to move the worker to mainnet: ");
  if (go !== "MOVE") throw new Error("stopped: nothing was changed");
  step(2, "Open the mainnet wallets");
  const password = DRY ? "dry-run" : await openWallets(V);
  await waitForArcOrders(V.PROVIDER_WALLET);
  await moveWorker({ V, block, rosterOff, password });
  say("\nThe worker is on Robinhood Chain. Place one real order to prove it:");
  say(`  ${SITE}/hire?agent=research-brief&chain=mainnet (1 USDG, from your own wallet)`);
}

if (require.main === module) {
  if (!DRY && !process.stdin.isTTY) {
    console.error("Run this in its own terminal window; it asks for a password.");
    process.exit(1);
  }
  (process.argv.includes("--worker") ? workerOnly() : flip())
    .then(() => process.exit(0))
    .catch((e) => { console.error(`\nSTOPPED: ${e.message}`); process.exit(1); });
}

module.exports = { renderYamlForMainnet };
