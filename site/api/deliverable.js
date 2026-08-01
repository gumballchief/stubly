"use strict";

/**
 * GET /api/deliverable?id=163313 → the delivered work, as markdown.
 *
 * Deployed: proxies the hosted copy the orchestrator pushed to Vercel Blob.
 * Local: falls back to the file the orchestrator wrote next to the worker.
 * Says so honestly rather than 404-ing blind when neither exists.
 */

const fs = require("fs");
const path = require("path");
const { sendJson } = require("./_shared");

module.exports = async (req, res) => {
  const url = new URL(req.url, "http://x");
  const id = url.searchParams.get("id");
  if (!id || !/^\d+$/.test(id)) return sendJson(res, 400, { error: "pass ?id=<job number>" });

  const base = process.env.BLOB_PUBLIC_BASE; // e.g. https://<store>.public.blob.vercel-storage.com
  if (base) {
    try {
      const r = await fetch(`${base.replace(/\/$/, "")}/deliverables/${id}.md`, { signal: AbortSignal.timeout(10_000) });
      if (r.ok) {
        res.statusCode = 200;
        res.setHeader("content-type", "text/markdown; charset=utf-8");
        res.setHeader("cache-control", "public, s-maxage=300, stale-while-revalidate=3600");
        return res.end(await r.text());
      }
    } catch { /* fall through to local */ }
  }

  const file = path.join(__dirname, "..", "..", "deliverables", `${id}.md`);
  if (fs.existsSync(file)) {
    res.statusCode = 200;
    res.setHeader("content-type", "text/markdown; charset=utf-8");
    res.setHeader("cache-control", "public, s-maxage=60");
    return res.end(fs.readFileSync(file, "utf8"));
  }

  return sendJson(res, 404, {
    live: false,
    error: "deliverable not published yet — the work order settles on-chain first, the file follows within a minute",
  });
};
