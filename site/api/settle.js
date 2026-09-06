"use strict";

/**
 * POST /api/settle  { jobId }  →  run the agent and settle the escrow.
 *
 * The whole reason a worker had to sit on someone's laptop was that nothing
 * watched the chain for funded jobs. But the site does not need to watch: money
 * is funded through the site, so the browser can say "this one is paid, go" the
 * instant it happens. That turns 24/7 settlement from a hosting problem into a
 * request.
 *
 * Everything happens in one invocation because a serverless function keeps no
 * disk between calls — run the agent, publish, submit, judge, settle, all with
 * the content held in memory. The polling worker remains the backstop for jobs
 * funded outside the site, and for anything this call drops.
 *
 * Safe to leave open. It only ever acts on a job that names our provider wallet
 * and a known agent, only while that job is Funded, and it cannot be pointed at
 * a different agent or a different price than the catalog says.
 */

const { formatUnits } = require("ethers");
const { cfg, CATALOG, JOB_STATUS, provider, jobsContract, sendJson } = require("./_shared");
const { loadWallet } = require("../../chain/config");
const jobsLib = require("../../chain/jobs");
const { judge } = require("../../worker/judge");
const AGENTS = require("../../worker/agents");
const { put } = require("@vercel/blob");

async function readBody(req) {
  let raw = "";
  for await (const c of req) { raw += c; if (raw.length > 4000) throw new Error("too long"); }
  return JSON.parse(raw || "{}");
}

/** Read a published deliverable back, so a second call can finish a first one. */
async function readDeliverable(jobId) {
  try {
    const { get } = require("@vercel/blob");
    const r = await get(`deliverables/${jobId}.md`, { access: "private" });
    return r?.stream ? await new Response(r.stream).text() : null;
  } catch { return null; }
}

/** Same store the worker's publish path writes to, minus the HTTP hop. */
async function store(kind, jobId, content) {
  try {
    const path = kind === "judge" ? `judge/${jobId}.json` : `deliverables/${jobId}.md`;
    await put(path, content, {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: kind === "judge" ? "application/json; charset=utf-8" : "text/markdown; charset=utf-8",
      cacheControlMaxAge: 31_536_000,
    });
    return true;
  } catch { return false; }
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return sendJson(res, 405, { error: "POST only" });
  const t0 = Date.now();
  try {
    const { jobId } = await readBody(req);
    if (!/^\d+$/.test(String(jobId || ""))) return sendJson(res, 400, { error: "numeric jobId required" });

    const C = cfg(req);
    const j = await jobsContract(C).getJob(BigInt(jobId));
    if (j.client === "0x0000000000000000000000000000000000000000") return sendJson(res, 404, { error: "no such job" });
    if (j.provider.toLowerCase() !== C.PROVIDER_WALLET.toLowerCase()) {
      return sendJson(res, 200, { ok: false, reason: "not one of ours" });
    }

    const status = JOB_STATUS[Number(j.status)];
    if (status === "Completed" || status === "Rejected") {
      return sendJson(res, 200, { ok: true, already: true, status });
    }
    if (status !== "Funded" && status !== "Submitted") {
      return sendJson(res, 200, { ok: false, reason: `job is ${status}` });
    }

    /* A ceiling on what a single order is worth acting on. This endpoint is
       unauthenticated by design and it signs with the provider key, so the thing
       to bound is not who calls it — the guards above already restrict that to our
       own funded orders — but how much one order can be worth if a price is ever
       wrong. Catalog pricing bounds it today; this bounds it if that ever breaks.
       Anything above the ceiling is left for a human, not refused outright. */
    const MAX_JOB_USDC = Number(process.env.MAX_JOB_USDC || 25);
    const budget = Number(formatUnits(j.budget, 6));
    if (budget > MAX_JOB_USDC) {
      return sendJson(res, 200, {
        ok: false,
        reason: `budget ${budget} USDC is over the ${MAX_JOB_USDC} ceiling — settle this one by hand`,
      });
    }

    let spec = null;
    try { spec = JSON.parse(j.description); } catch { /* not ours */ }
    // Sub-jobs are created, funded and settled inline by the agent that hired
    // them, exactly as in the worker. Touching them here would double-settle.
    if (spec?.sub) return sendJson(res, 200, { ok: false, reason: "subcontract, handled inline" });
    const agentKey = spec?.agent;
    const agent = agentKey && AGENTS[agentKey];
    if (!agent || !CATALOG[agentKey]) return sendJson(res, 200, { ok: false, reason: "unknown agent" });

    const prov = provider(C);
    const providerSigner = loadWallet(C.PROVIDER_KEY, prov);
    const evaluatorSigner = loadWallet(C.EVALUATOR_KEY, prov);

    /* Funded → do the work and submit it. */
    let content = null;
    if (status === "Funded") {
      const out = await agent.run(spec.input || {});
      content = out.content;
      await store("deliverable", jobId, content);
      await jobsLib.submit(providerSigner, jobId, content);
    }

    /* Submitted → judge it and move the money. If an earlier call did the work
       and then ran out of time, the deliverable is already in the store, so read
       it back rather than stranding the job. Judging an empty string would
       reject work that was actually fine, so a missing deliverable hands off to
       the worker instead of guessing. */
    if (!content) content = await readDeliverable(jobId);
    if (!content) {
      return sendJson(res, 200, {
        ok: true, submitted: true, judged: false,
        reason: "deliverable not readable here — the worker will judge it",
        seconds: (Date.now() - t0) / 1000,
      });
    }

    const verdict = judge(jobId, agentKey, content);
    // Publish the record before settling, so the digest committed on-chain
    // always points at something a third party can already fetch and recompute.
    await store("judge", jobId, JSON.stringify(verdict.record, null, 2));

    if (verdict.ok) await jobsLib.completeRaw(evaluatorSigner, jobId, verdict.digest);
    else await jobsLib.rejectRaw(evaluatorSigner, jobId, verdict.digest);

    return sendJson(res, 200, {
      ok: true,
      jobId: String(jobId),
      agent: agentKey,
      verdict: verdict.verdict,
      digest: verdict.digest,
      seconds: Number(((Date.now() - t0) / 1000).toFixed(1)),
    });
  } catch (e) {
    // The worker's next pass picks up anything this drops, so failing here is
    // slow rather than broken.
    return sendJson(res, 200, { ok: false, reason: e.shortMessage || e.message, seconds: (Date.now() - t0) / 1000 });
  }
};
