"use strict";

/**
 * Publish a deliverable so the live site can serve it.
 *
 * The worker never holds Blob credentials — Vercel injects those into the site
 * at runtime only. Instead the worker POSTs finished work to the site's
 * /api/publish with a shared secret, and the site stores it.
 *
 * Without SITE_URL + PUBLISH_SECRET this is a no-op and the local file stays
 * the only copy, which is correct for purely local runs.
 */

/* { rebuild: true } is for the help desk putting back a lost report. It never overwrites:
   if a report is there after all, it stays, and the answer says so ({ exists: true }). */
async function publishDeliverable(jobId, content, { rebuild = false } = {}) {
  const base = process.env.SITE_URL;
  const secret = process.env.PUBLISH_SECRET;
  if (!base || !secret) return { published: false, reason: "SITE_URL/PUBLISH_SECRET not set — local copy only" };

  try {
    const r = await fetch(`${base.replace(/\/$/, "")}/api/publish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jobId: String(jobId), content, secret, ...(rebuild ? { kind: "rebuild" } : {}) }),
      signal: AbortSignal.timeout(30_000),
    });
    const data = await r.json().catch(() => ({}));
    if (r.status === 409 || data.exists) return { published: false, exists: true, reason: "a report is already there" };
    if (!r.ok || !data.published) return { published: false, reason: data.error || `site returned ${r.status}` };
    return { published: true, url: data.url };
  } catch (e) {
    return { published: false, reason: e.message };
  }
}

/** Publish the judge record so a third party can recompute its digest. */
async function publishJudgeRecord(jobId, record) {
  const base = process.env.SITE_URL;
  const secret = process.env.PUBLISH_SECRET;
  if (!base || !secret) return { published: false, reason: "SITE_URL/PUBLISH_SECRET not set" };
  try {
    const r = await fetch(`${base.replace(/\/$/, "")}/api/publish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jobId: String(jobId), kind: "judge", content: JSON.stringify(record, null, 2), secret }),
      signal: AbortSignal.timeout(30_000),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data.published) return { published: false, reason: data.error || `site returned ${r.status}` };
    return { published: true, url: data.url };
  } catch (e) {
    return { published: false, reason: e.message };
  }
}

/**
 * Claim the one refund-by-transfer a finished order may ever get. The site stores
 * it write-once, so a second claim for the same order fails. Any doubt counts as
 * not claimed: a refund that can't be recorded first is not sent.
 */
async function recordRefund(jobId, record) {
  const base = process.env.SITE_URL;
  const secret = process.env.PUBLISH_SECRET;
  if (!base || !secret) return { claimed: false, reason: "SITE_URL/PUBLISH_SECRET not set" };
  try {
    const r = await fetch(`${base.replace(/\/$/, "")}/api/publish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jobId: String(jobId), kind: "refund", chainId: String(record.chainId), content: JSON.stringify(record, null, 2), secret }),
      signal: AbortSignal.timeout(30_000),
    });
    const data = await r.json().catch(() => ({}));
    if (r.status === 409 || data.exists) return { claimed: false, already: true, reason: "already recorded" };
    if (!r.ok || !data.published) return { claimed: false, reason: data.error || `site returned ${r.status}` };
    return { claimed: true };
  } catch (e) {
    return { claimed: false, reason: e.message };
  }
}

module.exports = { publishDeliverable, publishJudgeRecord, recordRefund };
