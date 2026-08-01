"use strict";

/**
 * POST /api/publish  { jobId, content, secret }
 *
 * The worker holds the wallet keys; this site holds the Blob credentials
 * (Vercel injects BLOB_READ_WRITE_TOKEN at runtime and never exposes it to the
 * CLI). So the worker posts finished work here with a shared secret and this
 * endpoint stores it — neither side needs the other's credentials.
 */

const { sendJson } = require("./_shared");
const { put } = require("@vercel/blob");

const MAX_BYTES = 400_000;

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
    if (!/^\d+$/.test(jobId)) return sendJson(res, 400, { error: "jobId must be numeric" });
    if (!content || content.length > MAX_BYTES) return sendJson(res, 400, { error: "content missing or too large" });

    // The SDK authenticates itself on Vercel (OIDC) — no token to manage here.
    // The store is private, so /api/deliverable fetches these server-side rather
    // than the browser hitting blob storage directly.
    const blob = await put(`deliverables/${jobId}.md`, content, {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "text/markdown; charset=utf-8",
      cacheControlMaxAge: 31_536_000,
    });

    return sendJson(res, 200, { published: true, url: blob.url, pathname: blob.pathname });
  } catch (e) {
    sendJson(res, 200, { published: false, error: e.message });
  }
};
