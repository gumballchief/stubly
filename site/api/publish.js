"use strict";

/**
 * POST /api/publish  { jobId, content, secret, kind?, chainId? }
 *
 * The worker holds the wallet keys; this site holds the Blob credentials
 * (Vercel injects BLOB_READ_WRITE_TOKEN at runtime and never exposes it to the
 * CLI). So the worker posts finished work here with a shared secret and this
 * endpoint stores it — neither side needs the other's credentials.
 *
 * kind "refund" is different on purpose: it is written once and never
 * overwritten. The help desk claims a refund here BEFORE it sends one, so the
 * same finished order can never be paid back twice, even across worker restarts.
 *
 * chainId says whose order this is. Reports and judge records for any chain but
 * testnet live under that chain's id (blobPath in _shared.js), so two chains' order
 * number N never share a file. Left out, it means testnet, as it always has.
 */

const { blobPath, sendJson } = require("./_shared");
const { put } = require("@vercel/blob");

const MAX_BYTES = 400_000;
const KINDS = {
  deliverable: (id, chainId) => ({ path: blobPath("deliverable", id, chainId), type: "text/markdown; charset=utf-8", overwrite: true }),
  judge: (id, chainId) => ({ path: blobPath("judge", id, chainId), type: "application/json; charset=utf-8", overwrite: true }),
  // The help desk putting back a lost report: same place, but never over a report that is there.
  rebuild: (id, chainId) => ({ path: blobPath("deliverable", id, chainId), type: "text/markdown; charset=utf-8", overwrite: false }),
  refund: (id, chainId) => ({ path: `refunds/${chainId}/${id}.json`, type: "application/json; charset=utf-8", overwrite: false }),
};

async function readBody(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > MAX_BYTES * 2) throw new Error("payload too large");
  }
  return JSON.parse(raw || "{}");
}

module.exports = async (req, res) => {
  try {
    if (req.method !== "POST") return sendJson(res, 405, { error: "POST only" });

    const secret = process.env.PUBLISH_SECRET;
    if (!secret) return sendJson(res, 500, { error: "publishing not configured" });

    const body = await readBody(req);
    if (body.secret !== secret) return sendJson(res, 403, { error: "bad secret" });

    const jobId = String(body.jobId || "");
    const content = String(body.content || "");
    const kind = typeof body.kind === "string" && Object.hasOwn(KINDS, body.kind) ? body.kind : "deliverable";
    const chainId = String(body.chainId || "5042002");
    if (!/^\d+$/.test(jobId) || !/^\d+$/.test(chainId)) return sendJson(res, 400, { error: "jobId and chainId must be numeric" });
    if (!content || content.length > MAX_BYTES) return sendJson(res, 400, { error: "content missing or too large" });

    // The SDK authenticates itself on Vercel (OIDC) — no token to manage here.
    // The store is private, so /api/deliverable fetches these server-side rather
    // than the browser hitting blob storage directly.
    const target = KINDS[kind](jobId, chainId);
    const blob = await put(target.path, content, {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: target.overwrite,
      contentType: target.type,
      cacheControlMaxAge: 31_536_000,
    });

    return sendJson(res, 200, { published: true, url: blob.url, pathname: blob.pathname });
  } catch (e) {
    // A write-once record that is already there is an answer, not a failure: that refund was claimed before.
    if (/already exists/i.test(e.message)) return sendJson(res, 409, { published: false, exists: true, error: "already recorded" });
    sendJson(res, 200, { published: false, error: e.message });
  }
};
