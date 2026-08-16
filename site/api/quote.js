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

const { Wallet, Contract, parseUnits } = require("ethers");
const { CFG, CATALOG, JOB_STATUS, provider, jobsContract, sendJson } = require("./_shared");

const SET_BUDGET_ABI = ["function setBudget(uint256 jobId, uint256 amount, bytes optParams)"];

async function readBody(req) {
  let raw = "";
  for await (const c of req) { raw += c; if (raw.length > 4000) throw new Error("too long"); }
  return JSON.parse(raw || "{}");
}

/* Decrypting a keystore runs scrypt on purpose, so it is slow. Hold the result
   for the life of the warm function rather than paying it on every order. */
let _signer = null;
async function providerSigner() {
  if (_signer) return _signer;
  const b64 = process.env.PROVIDER_KEYSTORE_B64;
  const pass = process.env.KEYSTORE_PASSWORD;
  if (!b64 || !pass) throw new Error("quoting is not configured");
  const json = Buffer.from(b64, "base64").toString("utf8");
  _signer = (await Wallet.fromEncryptedJson(json, pass)).connect(provider());
  return _signer;
}

module.exports = async (req, res) => {
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
