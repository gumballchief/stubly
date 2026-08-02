"use strict";

/**
 * The judge — the single source of truth for how a deliverable is accepted or
 * rejected. Nothing else in the codebase may decide a verdict.
 *
 * Design note: this judge is DETERMINISTIC and MECHANICAL. It does not call a
 * language model, which means the deliverable is never interpreted as
 * instructions — an agent cannot talk its way into getting paid. The trade-off
 * is honest and stated publicly: these rules check that work was delivered in
 * the right shape, not that it is good. Quality disputes are what the expiry
 * refund and (later) client-side rejection exist for.
 *
 * Every verdict produces a canonical record whose sha256 digest is written
 * on-chain in the settling transaction, using the `reason` field ERC-8183
 * already provides. No companion contract needed: the commitment rides in the
 * same transaction that moves the money.
 */

const { createHash } = require("node:crypto");

const VERSION = "judge-v1";

/** The published rules. Changing any of these requires a new VERSION. */
const RULES = [
  {
    id: "delivered",
    text: "A deliverable exists and is not empty.",
    test: (content) => Boolean(content && content.trim().length),
  },
  {
    id: "min-length",
    text: "The deliverable is at least 200 characters.",
    test: (content) => content.length >= 200,
  },
  {
    id: "structured",
    text: "The deliverable is markdown with at least one heading.",
    test: (content) => /^#\s/m.test(content),
  },
  {
    id: "max-length",
    text: "The deliverable is under 400,000 characters.",
    test: (content) => content.length <= 400_000,
  },
];

/** Run the rules. Returns the verdict plus which rules passed. */
function evaluate(content) {
  const text = typeof content === "string" ? content : "";
  const checks = RULES.map((r) => ({ id: r.id, passed: Boolean(r.test(text)) }));
  const failed = checks.filter((c) => !c.passed);
  return {
    verdict: failed.length === 0 ? "approved" : "rejected",
    checks,
    failedRule: failed[0]?.id || null,
  };
}

const sha256 = (s) => createHash("sha256").update(s, "utf8").digest("hex");

/**
 * A canonical, replayable record of one judgement. Keys are sorted so the
 * digest is stable regardless of insertion order.
 */
function record({ jobId, agent, content, result, judgedAt }) {
  const r = {
    jobId: String(jobId),
    agent: agent || null,
    configVersion: VERSION,
    judge: "deterministic-rules",
    rules: RULES.map((x) => ({ id: x.id, text: x.text })),
    checks: result.checks,
    deliverableSha256: sha256(content || ""),
    deliverableLength: (content || "").length,
    verdict: result.verdict,
    failedRule: result.failedRule,
    judgedAt: judgedAt || new Date().toISOString(),
  };
  const canonical = JSON.stringify(r, Object.keys(r).sort());
  return { record: r, digest: "0x" + sha256(canonical) };
}

/** Recompute a digest from a stored record — this is what verification runs. */
function digestOf(storedRecord) {
  const canonical = JSON.stringify(storedRecord, Object.keys(storedRecord).sort());
  return "0x" + sha256(canonical);
}

/** Judge a deliverable and produce everything needed to settle and publish. */
function judge(jobId, agent, content) {
  const result = evaluate(content);
  const { record: rec, digest } = record({ jobId, agent, content, result });
  return { verdict: result.verdict, ok: result.verdict === "approved", record: rec, digest };
}

module.exports = { VERSION, RULES, evaluate, judge, record, digestOf, sha256 };
