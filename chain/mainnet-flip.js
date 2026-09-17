"use strict";

/**
 * Switch Stubly to Arc mainnet in one run, from your own terminal.
 *
 *   npm run mainnet:flip                    do it (asks you to type FLIP first)
 *   npm run mainnet:flip -- --dry-run       show every step, change nothing
 *   npm run mainnet:flip -- --make-default  after your first real order settles:
 *                                           make mainnet what stubly.org opens by default
 *   npm run mainnet:flip -- --worker        only move the worker to mainnet (steps 6 and 7),
 *                                           for a flip that stopped after the site went live
 *
 * It follows launch/MAINNET-FLIP.md in order and stops at the first thing that is not
 * right. Nothing starts until `npm run mainnet:check` passes: Circle's escrow and identity
 * registry on chain, USDC real, both wallets funded, every agent card present.
 *
 * What it does after you type FLIP:
 *   1. asks the mainnet wallet password once (hidden) and proves it opens both wallets
 *   2. commits the mainnet branch, merges it into master, pushes, deploys the site
 *      (mainnet still switched off, so this is safe) and checks every agent card is live
 *   3. registers every agent's ERC-8004 identity on mainnet (costs a little gas)
 *   4. puts the mainnet settings on Vercel, closes testnet to new orders, redeploys
 *   5. waits for testnet orders to finish, then moves the worker to mainnet
 *      (automatically with RENDER_API_KEY + RENDER_SERVICE_ID set, otherwise it tells
 *      you the exact values to paste and waits)
 *   6. checks the live site and worker, and tells you how to place the first real order
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
const BRANCH = "mainnet-launch";
const CHAIN_AGENTS = ["wallet-report", "token-report", "tx-explain", "contract-check", "chain-pulse"];
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

/* Testnet orders still paid and unsettled. The worker leaves testnet when it moves, so it waits for these
   rather than a fixed time: none open means nothing is left behind. */
async function testnetOrdersOpen() {
  const { CHAINS } = require(path.join(ROOT, "site/api/_shared.js"));
  const { ERC8183_ABI_MIN } = require("./config");
  const T = CHAINS.testnet;
  /* Circle's public testnet RPC, not RPC_URL: a keyed provider's free plan (dRPC) refuses log queries outright. */
  const prov = new JsonRpcProvider("https://rpc.testnet.arc.io", T.CHAIN_ID, { staticNetwork: true });
  const jobs = new Contract(T.ERC8183, ERC8183_ABI_MIN, prov);
  const latest = await prov.getBlockNumber();
  const ids = new Set();
  for (let start = latest - 20_000; start <= latest; start += 5000) {
    const logs = await jobs.queryFilter(jobs.filters.JobCreated(null, null, T.PROVIDER_WALLET), start, Math.min(start + 4999, latest));
    for (const l of logs) ids.add(l.args.jobId.toString());
  }
  let open = 0;
  for (const id of ids) {
    const j = await jobs.getJob(id);
    if ([1, 2].includes(Number(j.status ?? j[7]))) open++;
  }
  return open;
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

/* The worker blueprint pins the chain. After the switch it must pin mainnet, or a later
   push would put the worker back on testnet. Secrets stay sync:false (dashboard only). */
function renderYamlForMainnet(text, v) {
  /* render.yaml is checked out with Windows line endings. Every pattern below matches on \n, so on the
     CRLF copy none of them matched and the pin silently changed nothing. Match on LF, then restore. */
  const crlf = text.includes("\r\n");
  text = text.replace(/\r\n/g, "\n");
  const set = (k, val) => {
    const re = new RegExp(`(- key: ${k}\\n\\s+value: )"[^"]*"`);
    return re.test(text) ? (text = text.replace(re, `$1"${val}"`)) : text;
  };
  set("CHAIN_ID", "5042");
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

async function makeDefault() {
  step(1, "Make mainnet the default on stubly.org");
  const answer = DRY ? "YES" : await ask("Has your first real mainnet order settled (paid, delivered, completed)? Type YES: ");
  if (answer !== "YES") throw new Error("not switching the default until a real order has settled");
  vercelEnv("DEFAULT_CHAIN", "mainnet");
  run("npx", ["vercel", "deploy", "--prod", "--yes"]);
  if (!DRY) {
    const c = await getJson(`${SITE}/api/catalog`);
    if (c.body?.chainId !== 5042) throw new Error(`stubly.org still opens chain ${c.body?.chainId}`);
    say("   stubly.org now opens Arc mainnet by default");
  }
}

async function flip() {
  step(1, "Check everything is ready");
  const { values: V, block, explorerOpen, checks } = await runChecks();
  for (const c of checks) say(`   ${c.ok ? "✓" : c.blocking ? "✗" : "!"} ${c.name}: ${c.detail}`);
  const waiting = checks.filter((c) => !c.ok && c.blocking);
  if (waiting.length && !DRY) throw new Error(`not ready, waiting on: ${waiting.map((c) => c.name).join("; ")}`);
  if (waiting.length) say("   (dry run: continuing past the missing items to show the rest)");

  const rosterOff = explorerOpen ? [] : CHAIN_AGENTS;
  const plan = {
    MAINNET_RPC_URL: V.RPC_URL,
    MAINNET_PUBLIC_RPC_URL: V.PUBLIC_RPC_URL,
    MAINNET_ERC8183: V.ERC8183,
    MAINNET_USDC: V.USDC,
    MAINNET_IDENTITY_REGISTRY: V.IDENTITY_REGISTRY,
    MAINNET_EXPLORER: V.EXPLORER,
    MAINNET_EXPLORER_API: `${V.EXPLORER}/api`,
    MAINNET_PROVIDER_WALLET: V.PROVIDER_WALLET,
    MAINNET_EVALUATOR_WALLET: V.EVALUATOR_WALLET,
    /* No Stubly mainnet order can be older than this run, so history reads start here. */
    MAINNET_START_BLOCK: String(block),
  };

  const { MAINNET_ROSTER: ROSTER } = require(path.join(ROOT, "site/api/_shared.js"));
  say(`\nThis will: deploy the mainnet code, register ${ROSTER.length} agent identities on Arc mainnet, put the mainnet`);
  say("settings on Vercel, close testnet to new orders, and move the worker to mainnet.");
  if (rosterOff.length) say(`The explorer refuses server requests right now, so these agents stay off the mainnet shop: ${rosterOff.join(", ")}.`);
  const go = DRY ? "FLIP" : await ask("\nType FLIP to go ahead: ");
  if (go !== "FLIP") throw new Error("stopped: nothing was changed");

  step(2, "Open the mainnet wallets");
  const password = DRY ? "dry-run" : await openWallets(V);

  step(3, "Ship the mainnet code with mainnet still switched off");
  run("git", ["checkout", BRANCH]);
  run("git", ["add", "-A"]);
  run("git", ["commit", "-m", "Ready for Arc mainnet: chain-aware money path, full agent shop, profile, log fallback"], { allowFail: true });
  run("git", ["checkout", "master"]);
  run("git", ["pull", "--ff-only", "origin", "master"]);
  run("git", ["merge", "--no-ff", BRANCH, "-m", "Merge mainnet-launch"]);
  run("git", ["push", "origin", "master"]);
  run("npx", ["vercel", "deploy", "--prod", "--yes"]);
  if (!DRY) {
    const { MAINNET_ROSTER } = require(path.join(ROOT, "site/api/_shared.js"));
    const missing = [];
    for (const k of MAINNET_ROSTER) {
      const r = await fetch(`${SITE}/agents/mainnet/${k}.json`, { signal: AbortSignal.timeout(20_000) }).catch(() => null);
      if (!r || !r.ok) missing.push(k);
    }
    if (missing.length) throw new Error(`these mainnet cards are not live on stubly.org yet: ${missing.join(", ")}`);
    say(`   all ${MAINNET_ROSTER.length} agent cards are live`);
  }

  step(4, "Register the agents' identities on Arc mainnet");
  const chainEnv = {
    CHAIN_ID: "5042", RPC_URL: V.RPC_URL, ERC8183_ADDRESS: V.ERC8183, USDC_ADDRESS: V.USDC,
    IDENTITY_REGISTRY: V.IDENTITY_REGISTRY, EXPLORER: V.EXPLORER, EXPLORER_API: `${V.EXPLORER}/api/v2`,
    KEYSTORE_PASSWORD_MAINNET: password,
  };
  run("node", ["chain/registry.js"], { env: chainEnv });
  run("node", ["chain/registry.js", "--register"], { env: chainEnv });
  run("git", ["add", "site/agents/ids.5042.json"]);
  run("git", ["commit", "-m", "Arc mainnet agent identities"], { allowFail: true });
  run("git", ["push", "origin", "master"]);

  step(5, "Put the mainnet settings on Vercel and close testnet to new orders");
  for (const [k, v] of Object.entries(plan)) vercelEnv(k, v);
  if (rosterOff.length) vercelEnv("MAINNET_ROSTER_OFF", rosterOff.join(","));
  vercelEnv("PROVIDER_MAINNET_KEYSTORE_B64", DRY ? "" : b64("provider_mainnet"), { sensitive: true });
  vercelEnv("EVALUATOR_MAINNET_KEYSTORE_B64", DRY ? "" : b64("evaluator_mainnet"), { sensitive: true });
  vercelEnv("KEYSTORE_PASSWORD_MAINNET", password, { sensitive: true });
  vercelEnv("TESTNET_ORDERS", "closed");
  run("npx", ["vercel", "deploy", "--prod", "--yes"]);
  if (!DRY) {
    const cat = await getJson(`${SITE}/api/catalog?chain=mainnet`);
    const agents = Object.values(cat.body?.agents || {});
    if (cat.body?.chainId !== 5042) throw new Error(`the site does not serve mainnet yet (chainId ${cat.body?.chainId})`);
    const noId = agents.filter((a) => !a.agentId).length;
    say(`   stubly.org serves mainnet: ${agents.length} agents, ${agents.length - noId} with identities`);
    if (noId) throw new Error(`${noId} mainnet agents have no identity yet`);
  }

  await moveWorker({ V, block, rosterOff, password });

  say("\nStubly is on Arc mainnet. stubly.org still opens testnet by default until you prove one real order:");
  say(`  1. Buy one: ${SITE}/hire?agent=research-brief&chain=mainnet (1 USDC, from your own wallet)`);
  say("  2. When it shows Completed, run: npm run mainnet:flip -- --make-default");
}

async function moveWorker({ V, block, rosterOff, password, waitForOrders = false }) {
  step(6, "Let testnet's last orders finish, then move the worker");
  if (waitForOrders) {
    for (let i = 0; ; i++) {
      let open = 0;
      try { open = DRY ? 0 : await testnetOrdersOpen(); } catch (e) {
        /* Not a reason to stop: testnet stopped taking orders when the site moved, and every order has a 10-minute deadline. */
        say(`   could not read testnet orders (${String(e.shortMessage || e.message).slice(0, 80)}); testnet stopped taking orders when the site moved, so none can still be running`);
        break;
      }
      if (!open) { say("   no testnet orders are still in progress"); break; }
      if (i >= 50) throw new Error(`${open} testnet orders are still in progress after 25 minutes. Run this again later`);
      process.stdout.write(`\r   ${open} testnet order(s) still in progress, checking again in 30 seconds `);
      await new Promise((r) => setTimeout(r, 30_000));
    }
  } else {
    say("   Orders have a 10-minute deadline. Waiting 20 minutes so none is left behind.");
    if (!DRY) {
      for (let m = 20; m > 0; m--) { process.stdout.write(`\r   ${m} min left `); await new Promise((r) => setTimeout(r, 60_000)); }
      say("\r   done waiting        ");
    }
  }
  const workerVars = {
    CHAIN_ID: "5042", RPC_URL: V.RPC_URL, ERC8183_ADDRESS: V.ERC8183, USDC_ADDRESS: V.USDC,
    IDENTITY_REGISTRY: V.IDENTITY_REGISTRY, EXPLORER: V.EXPLORER, EXPLORER_API: `${V.EXPLORER}/api/v2`,
    START_BLOCK: String(block),
    KEYSTORE_PASSWORD_MAINNET: password,
    PROVIDER_MAINNET_KEYSTORE_B64: DRY ? "" : b64("provider_mainnet"),
    EVALUATOR_MAINNET_KEYSTORE_B64: DRY ? "" : b64("evaluator_mainnet"),
    /* The worker checks the same shelf the site does, so the agents taken off it must be off here too. */
    ...(rosterOff.length ? { MAINNET_ROSTER_OFF: rosterOff.join(",") } : {}),
  };
  const removeFromWorker = ["KEYSTORE_PASSWORD", "PROVIDER_KEYSTORE_B64", "EVALUATOR_KEYSTORE_B64", "TESTNET_ORDERS"];
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
  if (DRY) say("   would pin render.yaml to mainnet (chain 5042, the mainnet escrow and registry)");
  else fs.writeFileSync(yamlPath, nextYaml);
  run("git", ["add", "render.yaml"]);
  run("git", ["commit", "-m", "Worker runs on Arc mainnet"], { allowFail: true });
  run("git", ["push", "origin", "master"]);

  step(7, "Check the live worker");
  if (!DRY) {
    const workerUrl = process.env.WORKER_URL || "https://stubly-worker.onrender.com";
    let seen = null;
    for (let i = 0; i < 30 && seen !== 5042; i++) {
      await new Promise((r) => setTimeout(r, 20_000));
      const h = await getJson(workerUrl).catch(() => null);
      seen = h?.body?.chainId ?? null;
      process.stdout.write(`\r   worker reports chain ${seen ?? "(restarting)"}   `);
    }
    say("");
    if (seen !== 5042) throw new Error("the worker has not come up on mainnet after 10 minutes; check its Render logs");
    say("   worker is on Arc mainnet");
  }
}

/* For a flip that stopped after step 5: the site is already on mainnet, only the worker is left. */
async function workerOnly() {
  step(1, "Check the site is already on mainnet");
  const { values: V, block: now, explorerOpen, checks } = await runChecks({ needFunds: false });
  for (const c of checks) say(`   ${c.ok ? "✓" : c.blocking ? "✗" : "!"} ${c.name}: ${c.detail}`);
  const waiting = checks.filter((c) => !c.ok && c.blocking);
  if (waiting.length && !DRY) throw new Error(`not ready, waiting on: ${waiting.map((c) => c.name).join("; ")}`);
  const cat = await getJson(`${SITE}/api/catalog?chain=mainnet`);
  if (cat.body?.chainId !== 5042 && !DRY) throw new Error("stubly.org does not serve mainnet yet: run the full npm run mainnet:flip");
  say(`   stubly.org serves mainnet: ${Object.keys(cat.body?.agents || {}).length} agents`);
  /* The worker reads orders from this block on. Stubly's escrow cannot hold an order older than itself. */
  let block = now;
  try { block = JSON.parse(fs.readFileSync(path.join(__dirname, "escrow-mainnet.json"), "utf8")).escrowBlock || now; } catch { /* Circle's escrow: start now */ }
  const rosterOff = explorerOpen ? [] : CHAIN_AGENTS;

  const go = DRY ? "MOVE" : await ask("\nType MOVE to move the worker to mainnet: ");
  if (go !== "MOVE") throw new Error("stopped: nothing was changed");
  step(2, "Open the mainnet wallets");
  const password = DRY ? "dry-run" : await openWallets(V);
  await moveWorker({ V, block, rosterOff, password, waitForOrders: true });
  say("\nThe worker is on Arc mainnet. Place one real order to prove it:");
  say(`  ${SITE}/hire?agent=research-brief&chain=mainnet (1 USDC, from your own wallet)`);
}

if (require.main === module) {
  if (!DRY && !process.stdin.isTTY) {
    console.error("Run this in its own terminal window; it asks for a password.");
    process.exit(1);
  }
  (process.argv.includes("--make-default") ? makeDefault() : process.argv.includes("--worker") ? workerOnly() : flip())
    .then(() => process.exit(0))
    .catch((e) => { console.error(`\nSTOPPED: ${e.message}`); process.exit(1); });
}

module.exports = { renderYamlForMainnet };
