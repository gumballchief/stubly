"use strict";

/**
 * Agent — Security Headers.
 * Input:  { url }
 * Output: which protective response headers a site sends and which it doesn't.
 *
 * Entirely mechanical: it reads the actual response headers and grades them
 * against what each one is for. No model opinion, nothing to argue with — the
 * header is either there or it isn't.
 */

const CHECKS = [
  ["strict-transport-security", "HSTS", "Forces HTTPS on every later visit, so a downgrade attack has nothing to downgrade."],
  ["content-security-policy", "CSP", "Limits where scripts may load from. The single strongest defence against injected JavaScript."],
  ["x-content-type-options", "No-sniff", "Stops the browser guessing a file's type and running an upload as script."],
  ["x-frame-options", "Frame policy", "Stops your page being embedded in someone else's, which is how clickjacking works."],
  ["referrer-policy", "Referrer policy", "Controls how much of your URL leaks to sites you link out to."],
  ["permissions-policy", "Permissions policy", "Declares which browser features (camera, geolocation) the page may use."],
];

function normalise(raw) {
  let u = String(raw || "").trim();
  if (!u) throw new Error("give a website address");
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  let parsed;
  try { parsed = new URL(u); } catch { throw new Error("that does not look like a web address"); }
  if (!/^https?:$/.test(parsed.protocol)) throw new Error("only http and https are supported");
  return parsed.toString();
}

async function run(input) {
  const url = normalise(input.url);

  let res;
  try {
    res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(20_000) });
  } catch (e) {
    throw new Error(e.name === "TimeoutError" ? "the site did not respond in 20 seconds" : `could not reach the site: ${e.message}`);
  }

  const found = [];
  const missing = [];
  for (const [header, name, why] of CHECKS) {
    const value = res.headers.get(header);
    if (value) found.push({ name, header, why, value: value.length > 120 ? `${value.slice(0, 120)}…` : value });
    else missing.push({ name, header, why });
  }

  const isHttps = new URL(res.url).protocol === "https:";
  const score = Math.round((found.length / CHECKS.length) * 100);

  const content = `# Security headers: ${new URL(res.url).host}

**${found.length} of ${CHECKS.length} present** · served over ${isHttps ? "HTTPS ✅" : "plain HTTP ❌"} · HTTP ${res.status}

A browser only enforces what a site asks it to enforce. These headers are those
requests. Missing ones are not a breach — they are defences left switched off.

## Present

${found.length
  ? found.map((f) => `### ✅ ${f.name}\n\`${f.header}: ${f.value}\`\n\n${f.why}`).join("\n\n")
  : "None of the checked headers are being sent."}

## Missing

${missing.length
  ? missing.map((m) => `### ❌ ${m.name}\n\`${m.header}\` is not set.\n\n${m.why}`).join("\n\n")
  : "Nothing missing — every header checked is present."}

## What to do first

${missing.length === 0
  ? "Nothing. This is a well-configured site."
  : missing.slice(0, 3).map((m, i) => `${i + 1}. Set \`${m.header}\`. ${m.why}`).join("\n")}

${!isHttps ? "\n**Serve this site over HTTPS before anything else.** Every header above is advice a plain-HTTP page cannot enforce.\n" : ""}

---
*Coverage score: ${score}%. Measured by reading the live response headers from ${res.url} — no model judgement involved.*
`;

  return { content, contentType: "text/markdown" };
}

module.exports = { key: "headers-check", title: "Security Headers", run };
