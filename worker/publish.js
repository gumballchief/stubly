"use strict";

/**
 * Publish a deliverable so the live site can serve it.
 *
 * The orchestrator runs on a machine with the keys; the site runs on Vercel.
 * With BLOB_READ_WRITE_TOKEN set, deliverables are uploaded to Vercel Blob at a
 * predictable path and the site serves the hosted copy. Without a token this is
 * a no-op and the local file remains the only copy (fine for local runs).
 *
 * Uses the Blob REST API directly — no SDK, no build step.
 */

const BLOB_API = "https://blob.vercel-storage.com";

async function publishDeliverable(jobId, content) {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return { published: false, reason: "no BLOB_READ_WRITE_TOKEN — local copy only" };

  const res = await fetch(`${BLOB_API}/deliverables/${jobId}.md`, {
    method: "PUT",
    headers: {
      authorization: `Bearer ${token}`,
      "x-api-version": "7",
      "x-content-type": "text/markdown; charset=utf-8",
      "x-add-random-suffix": "0",          // stable, guessable URL per job
      "x-cache-control-max-age": "31536000",
    },
    body: content,
    signal: AbortSignal.timeout(30_000),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { published: false, reason: `blob ${res.status}: ${data?.error?.message || "upload failed"}` };
  return { published: true, url: data.url };
}

module.exports = { publishDeliverable };
