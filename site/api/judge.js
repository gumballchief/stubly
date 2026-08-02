"use strict";

/**
 * GET /api/judge            → the published judge rules and version
 * GET /api/judge?id=163313  → that job's full judgement record, its recomputed
 *                             digest, and whether it matches what is on-chain
 *
 * This is the whole audit trail. A third party fetches this, recomputes the
 * digest from the record themselves, and compares it to the `reason` field in
 * the settling transaction. Nothing has to be taken on trust.
 */

const { createHash } = require("node:crypto");
const { sendJson } = require("./_shared");

/* Mirror of worker/judge.js — the published rules. */
const VERSION = "judge-v1";
const RULES = [
  { id: "delivered", text: "A deliverable exists and is not empty." },
  { id: "min-length", text: "The deliverable is at least 200 characters." },
  { id: "structured", text: "The deliverable is markdown with at least one heading." },
  { id: "max-length", text: "The deliverable is under 400,000 characters." },
];

const sha256 = (s) => createHash("sha256").update(s, "utf8").digest("hex");
const digestOf = (rec) => "0x" + sha256(JSON.stringify(rec, Object.keys(rec).sort()));

async function fromBlob(id) {
  try {
    const { get } = require("@vercel/blob");
    const r = await get(`judge/${id}.json`, { access: "private" });
    if (!r?.stream) return null;
    return JSON.parse(await new Response(r.stream).text());
  } catch { return null; }
}

module.exports = async (req, res) => {
  const url = new URL(req.url, "http://x");
  const id = url.searchParams.get("id");

  if (!id) {
    return sendJson(res, 200, {
      version: VERSION,
      judge: "deterministic-rules",
      note:
        "Stubly's judge is mechanical, not a language model. It checks that work was delivered in the agreed shape — it does not score quality. Because no model reads the deliverable, a deliverable cannot instruct the judge. Every verdict is recorded, hashed, and the digest is written on-chain in the same transaction that settles the escrow.",
      rules: RULES,
      verify:
        "GET /api/judge?id=<jobId> returns the record. Recompute sha256 over the record with its keys sorted, prefix 0x, and compare to the `reason` field of the settling transaction on Arcscan.",
    });
  }

  if (!/^\d+$/.test(id)) return sendJson(res, 400, { error: "id must be a job number" });

  const record = await fromBlob(id);
  if (!record) {
    return sendJson(res, 404, {
      found: false,
      note: "No published judgement for this job yet. Jobs judged before judge-v1 shipped have no record.",
    });
  }

  sendJson(res, 200, {
    found: true,
    jobId: id,
    record,
    digest: digestOf(record),
    howToVerify: [
      "1. Take the `record` object exactly as returned here.",
      "2. JSON.stringify it with its keys sorted alphabetically.",
      "3. sha256 that string, prefix with 0x — you should get `digest`.",
      "4. Open the settling transaction on Arcscan and read the `reason` argument of complete() or reject(). It must equal `digest`.",
    ],
  });
};
