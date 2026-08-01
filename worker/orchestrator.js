"use strict";

/**
 * The orchestrator — the machine that turns escrowed jobs into delivered work.
 * Keeper rules from gold/protocol: crash-safe state.json after every step,
 * staticCall before every send, idempotent (a job is never worked twice),
 * --once for a single pass, --dry to only report what it would do.
 *
 *   node worker/orchestrator.js --once [--dry]
 *   node worker/orchestrator.js            (loop mode, POLL_MS interval)
 *
 * Flow per job: JobCreated(provider=us) → wait until Funded → run the agent named
 * in the job description JSON → write deliverable to deliverables/<jobId>.md →
 * submit(keccak(content)) → evaluator wallet runs auto-checks → complete/reject.
 */

const fs = require("fs");
const path = require("path");
const { parseUnits } = require("ethers");
const { CFG, provider, loadWallet, JOB_STATUS } = require("../chain/config");
const jobsLib = require("../chain/jobs");
const CATALOG = require("./catalog");
const { publishDeliverable } = require("./publish");

// Every agent in the catalog must have a matching module in ./agents — deriving
// the roster from the catalog means the two can never drift apart.
const AGENTS = Object.fromEntries(
  Object.keys(CATALOG).map((k) => { const a = require(`./agents/${k}`); return [a.key, a]; })
);

const STATE_FILE = path.join(__dirname, "state.json");
const DELIVER_DIR = path.join(__dirname, "..", "deliverables");
const ONCE = process.argv.includes("--once");
const DRY = process.argv.includes("--dry");
const POLL_MS = Number(process.env.POLL_MS || 20_000);
const LOOKBACK_BLOCKS = 20_000;

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); } catch { return { lastBlock: 0, jobs: {} }; }
}
function saveState(s) { fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2)); }

async function findOurJobs(prov, jobs, providerAddr, state) {
  const latest = await jobsLib.withRetry(() => prov.getBlockNumber());
  const from = state.lastBlock > 0 ? state.lastBlock + 1 : Math.max(0, latest - LOOKBACK_BLOCKS);
  if (from > latest) return latest;
  const filter = jobs.filters.JobCreated(null, null, providerAddr);
  // getLogs in chunks the public RPC tolerates
  for (let start = from; start <= latest; start += 5000) {
    const end = Math.min(start + 4999, latest);
    const logs = await jobsLib.withRetry(() => jobs.queryFilter(filter, start, end));
    for (const log of logs) {
      const jobId = log.args.jobId.toString();
      if (!state.jobs[jobId]) {
        state.jobs[jobId] = { phase: "seen", tx: log.transactionHash };
        console.log(`[seen] job ${jobId} (${CFG.EXPLORER}/tx/${log.transactionHash})`);
      }
    }
  }
  return latest;
}

function parseSpec(description) {
  try {
    const spec = JSON.parse(description);
    if (spec && typeof spec === "object" && AGENTS[spec.agent]) return spec;
  } catch { /* not ours / free-text job */ }
  return null;
}

async function autoChecks(deliverable) {
  if (!deliverable || deliverable.content.length < 200) return { ok: false, reason: "deliverable-too-short" };
  if (/^#\s/m.test(deliverable.content) === false) return { ok: false, reason: "missing-markdown-structure" };
  return { ok: true, reason: "auto-checks-passed" };
}

async function processJob(jobId, ctx) {
  const { jobs, providerSigner, evaluatorSigner, state } = ctx;
  const j = await jobsLib.withRetry(() => jobs.getJob(jobId));
  const status = JOB_STATUS[Number(j.status ?? j[7])] || "?";
  const description = j.description ?? j[4];
  const spec = parseSpec(description);
  const st = state.jobs[jobId];

  // Sub-jobs are created, funded, delivered and settled inline by the agent that
  // hired them (see agents/launch-kit.js) — the main loop must not touch them.
  if (spec?.sub) { st.phase = "subcontract-handled-inline"; return; }

  if (!spec) { st.phase = "ignored-not-ours"; return; }

  if (status === "Open") {
    // Jobs created from the site arrive without a budget — quoting is our move.
    const hasBudget = await jobsLib.withRetry(() => jobs.jobHasBudget(jobId));
    if (!hasBudget && st.phase !== "quoted") {
      const price = CATALOG[spec.agent]?.priceUsdc;
      if (!price) { st.phase = "ignored-unknown-agent"; return; }
      console.log(`[quote] job ${jobId} → setBudget ${price} USDC`);
      if (DRY) return;
      const { usdc } = await jobsLib.contracts(providerSigner);
      const decimals = await jobsLib.withRetry(() => usdc.decimals());
      await jobsLib.setBudget(providerSigner, jobId, parseUnits(price, decimals));
      st.phase = "quoted"; saveState(state);
    }
    return; // now waiting for the client to fund
  }
  if (["Completed", "Rejected", "Expired"].includes(status)) { st.phase = `chain-${status.toLowerCase()}`; return; }

  if (status === "Funded" && st.phase !== "submitted") {
    console.log(`[work] job ${jobId} → agent "${spec.agent}"`);
    if (DRY) { console.log("  (dry) would run agent and submit"); return; }

    const agent = AGENTS[spec.agent];
    let deliverable;
    try {
      deliverable = await agent.run(spec.input || {});
    } catch (e) {
      st.attempts = (st.attempts || 0) + 1;
      st.error = e.message;
      if (st.attempts >= 3) {
        console.log(`  agent failed ${st.attempts}x: ${e.message} — giving up, job will expire to refund`);
        st.phase = "agent-failed";
      } else {
        console.log(`  agent failed (attempt ${st.attempts}/3): ${e.message} — will retry next pass`);
      }
      return;
    }

    fs.mkdirSync(DELIVER_DIR, { recursive: true });
    const file = path.join(DELIVER_DIR, `${jobId}.md`);
    fs.writeFileSync(file, deliverable.content);
    st.phase = "delivered-locally"; st.file = file; saveState(state);

    // Push a hosted copy so the deployed site can serve it to the buyer.
    const pub = await publishDeliverable(jobId, deliverable.content);
    if (pub.published) { st.url = pub.url; console.log(`  published: ${pub.url}`); }
    else console.log(`  (not published: ${pub.reason})`);
    saveState(state);

    await jobsLib.submit(providerSigner, jobId, deliverable.content);
    st.phase = "submitted"; st.hash = jobsLib.contentHash(deliverable.content); saveState(state);
    return;
  }

  if (status === "Submitted" && st.phase !== "settled") {
    const content = st.file && fs.existsSync(st.file) ? { content: fs.readFileSync(st.file, "utf8") } : null;
    const verdict = await autoChecks(content);
    console.log(`[judge] job ${jobId}: ${verdict.ok ? "complete" : "reject"} (${verdict.reason})`);
    if (DRY) return;
    if (verdict.ok) await jobsLib.complete(evaluatorSigner, jobId, verdict.reason);
    else await jobsLib.reject(evaluatorSigner, jobId, verdict.reason);
    st.phase = "settled"; st.verdict = verdict.reason; saveState(state);
  }
}

async function pass() {
  const prov = provider();
  const providerSigner = loadWallet("provider", prov);
  const evaluatorSigner = loadWallet("evaluator", prov);
  const { jobs } = await jobsLib.contracts(prov);
  const state = loadState();

  const latest = await findOurJobs(prov, jobs, providerSigner.address, state);
  const ctx = { jobs, providerSigner, evaluatorSigner, state }; // per-signer contract instances are made inside jobsLib
  for (const jobId of Object.keys(state.jobs)) {
    const phase = state.jobs[jobId].phase;
    if (["ignored-not-ours", "settled", "chain-completed", "chain-rejected", "chain-expired", "agent-failed"].includes(phase)) continue;
    try { await processJob(jobId, ctx); } catch (e) { console.log(`[err] job ${jobId}: ${e.shortMessage || e.message}`); }
  }
  state.lastBlock = latest;
  saveState(state);
}

async function main() {
  console.log(`orchestrator ${DRY ? "(dry) " : ""}watching provider jobs on chain ${CFG.CHAIN_ID}`);
  do {
    await pass();
    if (!ONCE) await new Promise((r) => setTimeout(r, POLL_MS));
  } while (!ONCE);
  console.log("pass complete");
}

main().catch((e) => { console.error("FAILED:", e.shortMessage || e.message); process.exit(1); });
