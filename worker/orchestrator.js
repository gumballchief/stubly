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
const { publishDeliverable, publishJudgeRecord } = require("./publish");
const { judge } = require("./judge");
const { maybeSweep } = require("./sweep");

// One roster, shared with the site's /api/settle. It is required statically in
// ./agents/index.js so it survives bundling, and asserts itself against the
// catalog on load so the two still cannot drift.
const AGENTS = require("./agents");

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

/** The hosted copy of a deliverable, for work this worker did not submit. */
async function fetchPublished(jobId) {
  const base = process.env.SITE_URL;
  if (!base) return "";
  try {
    const r = await fetch(`${base.replace(/\/$/, "")}/api/deliverable?id=${jobId}`, {
      signal: AbortSignal.timeout(20_000),
    });
    if (!r.ok) return "";
    const text = await r.text();
    // /api/deliverable answers with JSON when it has nothing to serve.
    return text.trim().startsWith("{") ? "" : text;
  } catch { return ""; }
}

function parseSpec(description) {
  try {
    const spec = JSON.parse(description);
    if (spec && typeof spec === "object" && AGENTS[spec.agent]) return spec;
  } catch { /* not ours / free-text job */ }
  return null;
}

/* Judging lives in worker/judge.js — the single source of truth. */

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
    /* The deliverable is not always ours to find locally. Since the site can
       submit a job too, this worker regularly meets work it did not do and has
       no file for — so fall back to the published copy.

       And if both come up empty, stop. Judging an unread deliverable is not a
       verdict, it is a guaranteed rejection: every rule fails against "" and
       the agent loses a payment it earned. Better to leave the job Submitted
       and try again than to reject work that might be perfectly good. */
    let content = st.file && fs.existsSync(st.file) ? fs.readFileSync(st.file, "utf8") : "";
    if (!content) content = await fetchPublished(jobId);
    if (!content) {
      console.log(`[judge] job ${jobId}: skipped — deliverable not readable yet, will retry`);
      return;
    }
    const j = judge(jobId, spec.agent, content);
    console.log(`[judge] job ${jobId}: ${j.verdict} (${j.record.failedRule || "all rules passed"}) digest ${j.digest.slice(0, 12)}…`);
    if (DRY) return;

    // Publish the record BEFORE settling, so the digest committed on-chain
    // always points at something a third party can already fetch and recompute.
    const pub = await publishJudgeRecord(jobId, j.record);
    if (!pub.published) console.log(`  (judge record not published: ${pub.reason})`);

    // The digest rides in ERC-8183's own `reason` field — the commitment lands
    // in the same transaction that moves the money. No companion contract.
    if (j.ok) await jobsLib.completeRaw(evaluatorSigner, jobId, j.digest);
    else await jobsLib.rejectRaw(evaluatorSigner, jobId, j.digest);

    st.phase = "settled"; st.verdict = j.verdict; st.digest = j.digest; saveState(state);
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

  // Earnings do not sit on the signing wallet. No-op until SWEEP_TO is set.
  try {
    const r = await maybeSweep(providerSigner);
    if (r.swept) state.lastSweep = { at: new Date().toISOString(), amount: r.amount, tx: r.tx };
    saveState(state);
  } catch (e) {
    console.log(`[sweep] skipped: ${e.shortMessage || e.message}`);
  }
}

/**
 * Free hosting tiers only keep a *web* service alive, and they idle it out
 * after a spell with no requests. So when PORT is set we answer HTTP as well as
 * poll: the endpoint reports what the loop is doing, and a ping every few
 * minutes is enough to stop the host putting us to sleep. Locally PORT is
 * unset and none of this exists.
 */
let lastPassAt = null;
let lastPassError = null;
let passes = 0;

function serveHealth() {
  const port = Number(process.env.PORT || 0);
  if (!port) return;
  require("http")
    .createServer((req, res) => {
      const age = lastPassAt ? Math.round((Date.now() - lastPassAt) / 1000) : null;
      const healthy = age !== null && age < (POLL_MS / 1000) * 4;
      res.writeHead(healthy || passes === 0 ? 200 : 503, { "content-type": "application/json" });
      res.end(JSON.stringify({
        ok: healthy || passes === 0,
        chainId: CFG.CHAIN_ID,
        passes,
        secondsSinceLastPass: age,
        pollSeconds: POLL_MS / 1000,
        lastError: lastPassError,
      }));
    })
    .listen(port, () => console.log(`health endpoint on :${port}`));
}

async function main() {
  console.log(`orchestrator ${DRY ? "(dry) " : ""}watching provider jobs on chain ${CFG.CHAIN_ID}`);
  serveHealth();
  do {
    try {
      await pass();
      lastPassError = null;
    } catch (e) {
      // One bad pass (a flaky RPC, usually) must not kill a hosted worker.
      lastPassError = e.shortMessage || e.message;
      console.log(`[pass failed] ${lastPassError}`);
    }
    lastPassAt = Date.now();
    passes++;
    if (!ONCE) await new Promise((r) => setTimeout(r, POLL_MS));
  } while (!ONCE);
  console.log("pass complete");
}

main().catch((e) => { console.error("FAILED:", e.shortMessage || e.message); process.exit(1); });
