"use strict";

/**
 * GET /api/deliverable?id=163313 → the delivered work, as markdown.
 *
 * Deployed: reads the hosted copy the worker published. The Blob store is
 * private, so the fetch happens here with the site's own credentials and the
 * browser never talks to blob storage.
 * Local: falls back to the file the worker wrote next to itself.
 *
 * 404 means one thing only: the store answered and the report is not there. The
 * help desk rebuilds or refunds on a 404, so a store that could not be read is a
 * 503, and neither answer is ever cached.
 */

const fs = require("fs");
const path = require("path");
const { sendJson } = require("./_shared");

/** Read a deliverable out of the private Blob store using the site's own credentials. */
async function fromBlob(id) {
  try {
    const { get } = require("@vercel/blob");
    const result = await get(`deliverables/${id}.md`, { access: "private" });
    if (!result) return { missing: true };
    if (result.stream) return { text: await new Response(result.stream).text() };
    return { error: "no stream on result" };
  } catch (e) {
    return { error: e.message };
  }
}

function sendUncached(res, status, body) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(body));
}

module.exports = async (req, res) => {
  const url = new URL(req.url, "http://x");
  const id = url.searchParams.get("id");
  if (!id || !/^\d+$/.test(id)) return sendJson(res, 400, { error: "pass ?id=<job number>" });

  const hosted = await fromBlob(id);
  if (typeof hosted.text === "string") {
    res.statusCode = 200;
    res.setHeader("content-type", "text/markdown; charset=utf-8");
    res.setHeader("cache-control", "public, s-maxage=300, stale-while-revalidate=3600");
    return res.end(hosted.text);
  }

  const file = path.join(__dirname, "..", "..", "deliverables", `${id}.md`);
  if (fs.existsSync(file)) {
    res.statusCode = 200;
    res.setHeader("content-type", "text/markdown; charset=utf-8");
    res.setHeader("cache-control", "public, s-maxage=60");
    return res.end(fs.readFileSync(file, "utf8"));
  }

  if (hosted.missing) {
    return sendUncached(res, 404, {
      live: false,
      error: "deliverable not published yet — the work order settles on-chain first, the file follows within a minute",
    });
  }
  return sendUncached(res, 503, { live: false, error: "the report store could not be read just now — try again shortly" });
};
