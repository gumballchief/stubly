"use strict";

/**
 * GET /api/deliverable?id=161321 → the delivered work, as markdown text.
 * Locally the orchestrator writes files into ../deliverables. In production the
 * store moves to hosted blobs at launch stage — until then we say so honestly.
 */

const fs = require("fs");
const path = require("path");
const { sendJson } = require("./_shared");

module.exports = async (req, res) => {
  const url = new URL(req.url, "http://x");
  const id = url.searchParams.get("id");
  if (!id || !/^\d+$/.test(id)) return sendJson(res, 400, { error: "pass ?id=<job number>" });

  const file = path.join(__dirname, "..", "..", "deliverables", `${id}.md`);
  if (!fs.existsSync(file)) {
    return sendJson(res, 404, { live: false, error: "deliverable not available from this server yet" });
  }
  res.statusCode = 200;
  res.setHeader("content-type", "text/markdown; charset=utf-8");
  res.setHeader("cache-control", "public, s-maxage=60");
  res.end(fs.readFileSync(file, "utf8"));
};
