"use strict";

/**
 * GET /api/deliverable?id=163313 → the delivered work, as markdown.
 *
 * Deployed: reads the hosted copy the worker published. The Blob store is
 * private, so the fetch happens here with the site's own credentials and the
 * browser never talks to blob storage.
 * Local: falls back to the file the worker wrote next to itself.
 */

const fs = require("fs");
const path = require("path");
const { sendJson } = require("./_shared");

/** Read a deliverable out of the private Blob store using the site's own credentials. */
async function fromBlob(id, notes) {
  try {
    const { get } = require("@vercel/blob");
    const result = await get(`deliverables/${id}.md`, { access: "private" });
    if (!result) { notes.push("blob: not found"); return null; }
    if (result.stream) return await new Response(result.stream).text();
    notes.push("blob: no stream on result");
    return null;
  } catch (e) { notes.push(`blob: ${e.message}`); return null; }
}

module.exports = async (req, res) => {
  const url = new URL(req.url, "http://x");
  const id = url.searchParams.get("id");
  if (!id || !/^\d+$/.test(id)) return sendJson(res, 400, { error: "pass ?id=<job number>" });

  const notes = [];
  const hosted = await fromBlob(id, notes);
  if (hosted) {
    res.statusCode = 200;
    res.setHeader("content-type", "text/markdown; charset=utf-8");
    res.setHeader("cache-control", "public, s-maxage=300, stale-while-revalidate=3600");
    return res.end(hosted);
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
    detail: notes,
  });
};
