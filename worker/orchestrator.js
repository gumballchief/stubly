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
const { CFG, provider, loadWallet, JOB_STATUS, assertChain } = require("../chain/config");
const jobsLib = require("../chain/jobs");
const CATALOG = require("./catalog");
const { publishDeliverable, publishJudgeRecord } = require("./publish");
const { judge } = require("./judge");
const { maybeSweep } = require("./sweep");
const { startSupport, supportStatus, notifyTeam } = require("./support");
const desk = require("./desk");

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
/* "agent-failed" is deliberately NOT in this list any more. It used to be a dead
   end that left a funded escrow sitting there forever. Picking those up again
   refunds the buyer, so anything stranded by the old behaviour heals itself. */
const DONE_PHASES = ["ignored-not-ours", "settled", "chain-completed", "chain-rejected", "chain-expired", "agent-failed-refunded", "refunded"];
const nowSec = () => Math.floor(Date.now() / 1000);

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); } catch { return { lastBlock: 0, jobs: {} }; }
}
function saveState(s) { fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2)); }

/* One copy of the state for the whole process. Each pass used to reload it from
   disk and write it back whole, which was fine while the pass was the only thing
   touching orders. The help desk works on orders too now, and a reload would
   quietly throw away whatever it recorded in the meantime. */
const STATE = loadState();

/* One order, one worker at a time. The settlement pass and the help desk both work
   on orders; without this they could run the same agent twice, or refund an order
   while its delivery is being signed. */
const jobLocks = new Map();
function withJobLock(jobId, fn) {
  const key = String(jobId);
  const run = (jobLocks.get(key) || Promise.resolve()).then(() => fn());
  const tail = run.then(() => {}, () => {});
  jobLocks.set(key, tail);
  tail.then(() => { if (jobLocks.get(key) === tail) jobLocks.delete(key); });
  return run;
}
const jobBusy = (jobId) => jobLocks.has(String(jobId));

async function findOurJobs(prov, jobs, providerAddr, state) {
  const latest = await jobsLib.withRetry(() => prov.getBlockNumber());
  /* Never reach further back than the lookback window. Resuming from a stale
     lastBlock meant a worker that had been down for days replayed every block
     since it stopped — millions of them, 5,000 at a time — and could not see a
     live order until it finished. Anything older than this window is past its
     600-second deadline, and the help desk re-registers any older order someone
     asks about, so there is nothing to gain by walking it. */
  const from = Math.max(state.lastBlock > 0 ? state.lastBlock + 1 : 0, latest - LOOKBACK_BLOCKS, 0);
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

/**
 * Give an escrow back to its buyer, now.
 *
 * "The job will expire to refund" was wrong. Expiry is not a state the chain
 * reaches on its own: the buyer has to come back and claim it, and nothing ever
 * told them to. Orders #185730 and #185899 sat funded for a day and a half while
 * the money was there the whole time. The judge can reject instead, and Circle's
 * contract refunds the order's client on the spot, whatever the deadline.
 *
 * If the reject fails, the phase is left alone deliberately: a refund that did not
 * happen must never be recorded as one that did, and the next pass tries again.
 */
async function refundNow(jobId, ctx, why) {
  const st = ctx.state.jobs[jobId];
  console.log(`[refund] job ${jobId}: ${why} — rejecting so the buyer gets their money back now`);
  if (DRY) return;
  try {
    await jobsLib.reject(ctx.evaluatorSigner, jobId, `Refunded: ${why}`);
    st.phase = "refunded";
    st.refundReason = why;
    console.log("  buyer refunded");
  } catch (e) {
    st.error = `refund failed: ${e.shortMessage || e.message}`;
    console.log(`  ${st.error} — retrying next pass`);
  }
  saveState(ctx.state);
}

/* Judging lives in worker/judge.js — the single source of truth. */

async function processJob(jobId, ctx) {
  const { jobs, providerSigner, evaluatorSigner, state } = ctx;
  const j = await jobsLib.withRetry(() => jobs.getJob(jobId));
  const status = JOB_STATUS[Number(j.status ?? j[7])] || "?";
  const description = j.description ?? j[4];
  const expiredAt = Number(j.expiredAt ?? j[6]);
  const spec = parseSpec(description);
  const st = state.jobs[jobId] || (state.jobs[jobId] = { phase: "seen" });

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
    /* Refund first, work second. An order that can no longer be finished (the
       agent keeps failing, its delivery will not record, or it is well past its
       deadline) gets its money back before anything else is tried. This used to
       live only inside the agent-failure branch, so a refund that failed once was
       retried only after yet another agent run. The rules live in desk.js and are
       shared with the help desk, so the two can never disagree about an order. */
    const why = desk.refundReason({ status, now: nowSec(), expiredAt, attempts: st.attempts || 0, submitFails: st.submitFails || 0 });
    if (why) return refundNow(jobId, ctx, why);

    console.log(`[work] job ${jobId} → agent "${spec.agent}"`);
    if (DRY) { console.log("  (dry) would run agent and submit"); return; }

    const agent = AGENTS[spec.agent];
    let deliverable;
    try {
      deliverable = await agent.run(spec.input || {});
      // An empty report is a failure, not a delivery: submitting "" only gets it rejected later, unpaid and unrefunded.
      if (!deliverable || typeof deliverable.content !== "string" || !deliverable.content.trim()) {
        throw new Error("the agent returned an empty report");
      }
    } catch (e) {
      st.attempts = (st.attempts || 0) + 1;
      st.error = e.message;
      saveState(state);
      const giveUp = desk.refundReason({ status, now: nowSec(), expiredAt, attempts: st.attempts });
      if (giveUp) return refundNow(jobId, ctx, `${giveUp} (${e.message})`);
      console.log(`  agent failed (attempt ${st.attempts}/3): ${e.message} — will retry next pass`);
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

    try {
      await jobsLib.submit(providerSigner, jobId, deliverable.content);
    } catch (e) {
      /* A named revert means the order moved on (someone else delivered it), and
         the next pass reads the new status. Anything else is a delivery that did
         not record. That used to loop forever, re-running the agent each pass;
         now three of them and the order is refunded. */
      if (!e.revertName) {
        st.submitFails = (st.submitFails || 0) + 1;
        st.error = `submit failed: ${e.shortMessage || e.message}`;
        saveState(state);
      }
      throw e;
    }
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
       and try again than to reject work that might be perfectly good.

       But "try again" cannot mean forever. Once the deadline has passed and the
       report is confirmed gone (missing twice, not merely slow), nothing is coming
       back to judge, and the buyer is still out the money. Refund it. */
    let content = st.file && fs.existsSync(st.file) ? fs.readFileSync(st.file, "utf8") : "";
    if (!content) content = await fetchPublished(jobId);
    if (!content) {
      if (nowSec() > expiredAt && (await desk.reportReadable(jobId)) === false) {
        const why = desk.refundReason({ status, now: nowSec(), expiredAt, report: false });
        if (why) return refundNow(jobId, ctx, why);
      }
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

/** Everything that signs, built once per process: one nonce counter per key, and each keystore decrypted once.
    The contract object in it is rebuilt at the start of every pass (see pass()). */
async function makeContext() {
  const prov = provider();
  const providerSigner = loadWallet(CFG.PROVIDER_KEY, prov);
  const evaluatorSigner = loadWallet(CFG.EVALUATOR_KEY, prov);
  const { jobs } = await jobsLib.contracts(prov);
  return { prov, jobs, providerSigner, evaluatorSigner, state: STATE };
}

async function pass(ctx) {
  /* Each key's nonce counter starts fresh every pass, as it did when the signers were rebuilt
     per pass: /api/quote, /api/settle and Launch Kit sign with these keys from outside this
     counter. Done inside each key's write queue, so it never lands in the middle of a write. */
  for (const s of [ctx.providerSigner, ctx.evaluatorSigner]) await jobsLib.withKeyLock(s.address, async () => s.reset?.());

  /* The contract object is rebuilt every pass, as it was before the signers became long-lived. Its
     ABI comes from the explorer, and an explorer blip at boot hands back the offline fallback.
     Holding one contract for the life of the process would freeze that blip in; rebuilding lets
     the next pass pick the verified ABI up again. */
  ctx.jobs = (await jobsLib.contracts(ctx.prov)).jobs;

  const latest = await findOurJobs(ctx.prov, ctx.jobs, ctx.providerSigner.address, STATE);
  let worked = 0;
  let failed = 0;
  let lastJobError = null;
  for (const jobId of Object.keys(STATE.jobs)) {
    if (DONE_PHASES.includes(STATE.jobs[jobId].phase)) continue;
    // An order the help desk is working on right now is skipped, not waited on: the next pass picks it up.
    if (jobBusy(jobId)) continue;
    worked++;
    try {
      await withJobLock(jobId, () => processJob(jobId, ctx));
    } catch (e) {
      failed++;
      lastJobError = `job ${jobId}: ${e.shortMessage || e.message}`;
      console.log(`[err] ${lastJobError}`);
    }
  }
  STATE.lastBlock = latest;
  saveState(STATE);

  // Earnings do not sit on the signing wallet. No-op until SWEEP_TO is set.
  // The sweep signs from the provider key too, so it waits its turn behind any refund or delivery.
  try {
    const r = await jobsLib.withKeyLock(ctx.providerSigner.address, () => maybeSweep(ctx.providerSigner));
    if (r.swept) STATE.lastSweep = { at: new Date().toISOString(), amount: r.amount, tx: r.tx };
    saveState(STATE);
  } catch (e) {
    console.log(`[sweep] skipped: ${e.shortMessage || e.message}`);
  }
  return { worked, failed, lastJobError };
}

/** Hand the help desk what it needs to act on orders: the same signers, state, locks and code path as the pass. */
function attachDesk(ctx) {
  desk.attach({
    get jobs() { return ctx.jobs; }, // rebuilt every pass; the desk always reads the current one
    providerSigner: ctx.providerSigner,
    evaluatorSigner: ctx.evaluatorSigner,
    providerAddr: ctx.providerSigner.address,
    evaluatorAddr: ctx.evaluatorSigner.address,
    state: STATE,
    save: () => saveState(STATE),
    AGENTS,
    busy: jobBusy,
    withJobLock,
    // Work an order now instead of on the next pass. Same function as the pass, same lock.
    tryRun: (jobId) => {
      if (jobBusy(jobId)) return false;
      if (!STATE.jobs[jobId]) STATE.jobs[jobId] = { phase: "seen" };
      withJobLock(jobId, () => processJob(jobId, ctx))
        .then(() => saveState(STATE))
        .catch((e) => console.log(`[desk run] job ${jobId}: ${e.shortMessage || e.message}`));
      return true;
    },
    notify: notifyTeam,
  });
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
let passStartedAt = null;   // non-null only while a pass is actually in flight

/* A pass that is doing something is not a stalled pass.
   Health used to mean "finished a pass in the last 40 seconds". But a pass runs
   the agents inline — the model alone is allowed 240s, and every on-chain step
   waits for a confirmation — so the worker reported 503 exactly while it was
   busy, and the host health-check restarted it mid-job. The busier it got, the
   more often it happened. Health now means: either a pass is in flight and has
   not been running absurdly long, or one finished recently. A pass past the busy
   limit is a genuine wedge and still fails. */
const IDLE_LIMIT_MS = Math.max(POLL_MS * 6, 120_000);
const BUSY_LIMIT_MS = 15 * 60_000;

function serveHealth() {
  const port = Number(process.env.PORT || 0);
  if (!port) return;
  require("http")
    .createServer((req, res) => {
      /* The help desk chat on stubly.org shares this server: /chat and /status are its routes,
         everything else is health. This process also settles payouts, so nothing a request
         does is allowed to throw out of here and take it down. */
      try {
        if (desk.handleHttp(req, res)) return;
      } catch (e) {
        console.log(`[http] ${e.message}`);
        if (!res.headersSent) { res.writeHead(500, { "content-type": "application/json" }); res.end('{"error":"internal"}'); }
        return;
      }
      const now = Date.now();
      const age = lastPassAt ? Math.round((now - lastPassAt) / 1000) : null;
      const busyMs = passStartedAt ? now - passStartedAt : null;
      const healthy = passes === 0 ? true
        : busyMs !== null ? busyMs < BUSY_LIMIT_MS
        : age !== null && age * 1000 < IDLE_LIMIT_MS;
      res.writeHead(healthy ? 200 : 503, { "content-type": "application/json" });
      res.end(JSON.stringify({
        ok: healthy || passes === 0,
        chainId: CFG.CHAIN_ID,
        passes,
        secondsSinceLastPass: age,
        busySeconds: busyMs === null ? null : Math.round(busyMs / 1000),
        pollSeconds: POLL_MS / 1000,
        lastError: lastPassError,
        support: supportStatus(),
        desk: desk.deskStatus(),
      }));
    })
    .listen(port, () => console.log(`health endpoint on :${port}`));
}

async function main() {
  /* Before anything signs, prove the node is the chain we think it is. A worker
     settling against another chain's addresses is worse than one that is down. */
  await assertChain(provider());
  console.log(`orchestrator ${DRY ? "(dry) " : ""}watching provider jobs on chain ${CFG.CHAIN_ID}`);
  serveHealth();
  /* The support inbox runs beside the settlement loop, never inside it: a slow
     email must not hold up a payout, and a slow payout must not hold up an email. */
  if (!ONCE && !DRY) startSupport();
  let ctx = null;
  do {
    passStartedAt = Date.now();
    try {
      /* Built inside the loop, not before it: a missing keystore or a flaky RPC at
         boot should show up as a failed pass on the health page and heal on the
         next one, not crash the process into a restart loop. */
      if (!ctx) {
        ctx = await makeContext();
        if (!ONCE && !DRY) attachDesk(ctx);
      }
      const r = await pass(ctx);
      /* Per-order errors are caught so one bad order can't hold up the rest. But when every order
         fails, something shared is broken (an ABI, the RPC), and the health page has to say so
         instead of reporting a clean pass. */
      lastPassError = r && r.worked > 0 && r.failed === r.worked ? `every order failed this pass (last: ${r.lastJobError})` : null;
    } catch (e) {
      // One bad pass (a flaky RPC, usually) must not kill a hosted worker.
      lastPassError = e.shortMessage || e.message;
      console.log(`[pass failed] ${lastPassError}`);
    }
    passStartedAt = null;
    lastPassAt = Date.now();
    passes++;
    if (!ONCE) await new Promise((r) => setTimeout(r, POLL_MS));
  } while (!ONCE);
  console.log("pass complete");
}

main().catch((e) => { console.error("FAILED:", e.shortMessage || e.message); process.exit(1); });
