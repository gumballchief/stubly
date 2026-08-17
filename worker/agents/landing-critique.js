"use strict";

/**
 * Agent — Landing Page Critique.
 * Input:  { url }
 * Output: what a first-time visitor actually gets in five seconds.
 *
 * This one fetches the page rather than asking a model to imagine it. A critique
 * of a page nobody read is worthless, and quietly guessing would be the kind of
 * thing this marketplace exists to make impossible.
 */

const { generate } = require("../llm");
const { fence, UNTRUSTED_NOTICE } = require("../untrusted");

function normalise(raw) {
  let u = String(raw || "").trim();
  if (!u) throw new Error("give a page address");
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  try { return new URL(u).toString(); } catch { throw new Error("that does not look like a web address"); }
}

/** Strip a page down to the words a visitor actually sees. */
function visibleText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const grab = (html, re, limit = 12) => {
  const out = [];
  for (const m of html.matchAll(re)) {
    const t = m[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    if (t) out.push(t);
    if (out.length >= limit) break;
  }
  return out;
};

async function run(input) {
  const url = normalise(input.url);

  let res, html;
  try {
    res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(20_000) });
    html = (await res.text()).slice(0, 400_000);
  } catch (e) {
    throw new Error(e.name === "TimeoutError" ? "the page did not respond in 20 seconds" : `could not fetch the page: ${e.message}`);
  }
  if (!res.ok) throw new Error(`the page returned HTTP ${res.status}`);

  const headings = grab(html, /<h[12][^>]*>([\s\S]*?)<\/h[12]>/gi, 10);
  const buttons = grab(html, /<(?:button|a)[^>]*class="[^"]*btn[^"]*"[^>]*>([\s\S]*?)<\/(?:button|a)>/gi, 10);
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").trim();
  const body = visibleText(html).slice(0, 6000);

  const { text, model } = await generate([
    "You are critiquing a landing page as a first-time visitor with five seconds and no context.",
    "",
    "Cover, in this order: whether the page says what this is within the first screen, whether",
    "the next step is obvious, what creates doubt or friction, and what is missing that a buyer",
    "needs. Order every finding by what most costs conversions. Quote the page's own wording when",
    "you criticise it and give a concrete replacement — never say 'improve the copy'.",
    "",
    "End with the single change worth making first.",
    "",
    "Reply with markdown only, starting with a single `# ` heading. No preamble.",
    "",
    UNTRUSTED_NOTICE,
    fence([
      `URL: ${url}`,
      `Title tag: ${title || "(none)"}`,
      `Headings: ${headings.join(" | ") || "(none found)"}`,
      `Buttons and links styled as buttons: ${buttons.join(" | ") || "(none found)"}`,
      "",
      "Visible page text:",
      body,
    ].join("\n")),
  ].join("\n"), { maxOutputTokens: 2000 });

  const critique = String(text || "").trim();
  if (critique.length < 200) throw new Error("the model returned too little to be worth delivering");

  const content = `${/^#\s/m.test(critique) ? critique : `# Landing page critique\n\n${critique}`}

---
*Read from the live page at ${res.url} (HTTP ${res.status}, ${body.length} characters of visible text). Critique by model: ${model}.*
`;
  return { content, contentType: "text/markdown" };
}

module.exports = { key: "landing-critique", title: "Landing Page Critique", run };
