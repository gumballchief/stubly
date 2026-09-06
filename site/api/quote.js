"use strict";

/**
 * POST /api/quote  { jobId }  →  price the job on-chain, immediately.
 *
 * Quoting used to wait for the settlement worker's next poll, which meant the
 * buyer stared at a spinner for anything from ten seconds to a quarter of an
 * hour depending on whether that worker happened to be running. But setting a
 * price needs no agent and no model — it is one transaction with a number this
 * repo already knows. So the site does it itself the moment the order lands,
 * and the worker is left to do the part that actually takes thinking.
 *
 * This endpoint is open, and safe to be open: it will only ever write the
 * catalog price, only onto a job that names our provider wallet, only while
 * that job is still unpriced. There is nothing a caller can steer.
 */

const { Contract, parseUnits } = require("ethers");
const { CFG, CATALOG, JOB_STATUS, provider, jobsContract, sendJson } = require("./_shared");
const { loadWallet } = require("../../chain/config");

const SET_BUDGET_ABI = ["function setBudget(uint256 jobId, uint256 amount, bytes optParams)"];

async function readBody(req) {
  let raw = "";
  for await (const c of req) { raw += c; if (raw.length > 4000) throw new Error("too long"); }
  return JSON.parse(raw || "{}");
}

/* Decrypting a keystore runs scrypt on purpose, so it is slow. Hold the result
   for the life of the warm function rather than paying it on every order.

   loadWallet is the one place that knows how to find this key: the encrypted
   file on a machine that has it, the base64 env var on Vercel where there is no
   filesystem. Reading the env var directly here meant quoting worked in
   production and refused everywhere else, so nothing could be run end to end
   locally without deploying it first. */
let _signer = null;
async function providerSigner() {
  /* loadWallet with no provider hands back a plain Wallet. That matters: given
     one it returns a NonceManager, which keeps its own idea of the next nonce —
     and this key is also used by /api/settle and the worker, so a second cached
     counter produces "nonce has already been used" the moment two of them are
     in flight. Let the RPC assign nonces and there is nothing to disagree with. */
  if (!_signer) _signer = loadWallet("provider").connect(provider());
  return _signer;
}

/* One function, two doors. Vercel's Hobby plan allows 12 serverless functions and
   the shelf already fills all 12, so /api/plan is rewritten onto this file (see
   the repo-root vercel.json) instead of shipping a thirteenth. The planner is
   still its own module and knows nothing about quoting — this only decides which
   one answers, before any quoting work starts. */
module.exports = async (req, res) => {
  if (new URL(req.url, "http://x").searchParams.get("_route") === "plan") {
    return require("./plan.js")(req, res);
  }

  if (req.method !== "POST") return sendJson(res, 405, { error: "POST only" });
  try {
    const { jobId } = await readBody(req);
    if (!/^\d+$/.test(String(jobId || ""))) return sendJson(res, 400, { error: "numeric jobId required" });

    const jobs = jobsContract();
    const j = await jobs.getJob(BigInt(jobId));

    if (j.client === "0x0000000000000000000000000000000000000000") return sendJson(res, 404, { error: "no such job" });
    // Only ever quote our own shelf.
    if (j.provider.toLowerCase() !== CFG.PROVIDER_WALLET.toLowerCase()) {
      return sendJson(res, 200, { ok: false, reason: "not one of ours" });
    }
    if (await jobs.jobHasBudget(BigInt(jobId))) {
      return sendJson(res, 200, { ok: true, already: true, jobId: String(jobId) });
    }
    if (JOB_STATUS[Number(j.status)] !== "Open") {
      return sendJson(res, 200, { ok: false, reason: `job is ${JOB_STATUS[Number(j.status)]}` });
    }

    let spec = null;
    try { spec = JSON.parse(j.description); } catch { /* free-text, not ours */ }
    const agent = spec?.agent;
    // The price comes from the catalog. Nothing in the job description sets it.
    const price = agent && CATALOG[agent]?.priceUsdc;
    if (!price) return sendJson(res, 200, { ok: false, reason: "unknown agent" });

    const signer = await providerSigner();
    const c = new Contract(CFG.ERC8183, SET_BUDGET_ABI, signer);
    const amount = parseUnits(String(price), 6);

    await c.setBudget.staticCall(jobId, amount, "0x"); // fail before spending gas
    const tx = await c.setBudget(jobId, amount, "0x");
    await tx.wait(1);

    return sendJson(res, 200, { ok: true, jobId: String(jobId), priceUsdc: price, tx: tx.hash });
  } catch (e) {
    // The worker's next pass is the backstop, so a failure here is not fatal.
    return sendJson(res, 200, { ok: false, reason: e.shortMessage || e.message });
  }
};
