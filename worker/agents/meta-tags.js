"use strict";

/**
 * Agent — Meta Tags.
 * Input:  { url }
 * Output: what a page currently tells Google and social platforms about itself,
 * what is missing, and replacement tags to paste in.
 *
 * The audit half is mechanical — the tags are read out of the served HTML. Only
 * the suggested replacements are written by a model, and they are clearly marked
 * as suggestions rather than findings.
 */

const { generate } = require("../llm");

const LIMITS = { title: [30, 60], description: [70, 160] };

function normalise(raw) {
  let u = String(raw || "").trim();
  if (!u) throw new Error("give a website address");
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  try { return new URL(u).toString(); } catch { throw new Error("that does not look like a web address"); }
}

const pick = (html, re) => (html.match(re)?.[1] || "").trim();

function readTags(html) {
  return {
    title: pick(html, /<title[^>]*>([\s\S]*?)<\/title>/i),
    description: pick(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i),
    canonical: pick(html, /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']*)["']/i),
    ogTitle: pick(html, /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']*)["']/i),
    ogDescription: pick(html, /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["']/i),
    ogImage: pick(html, /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']*)["']/i),
    twitterCard: pick(html, /<meta[^>]+name=["']twitter:card["'][^>]+content=["']([^"']*)["']/i),
    h1: pick(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i).replace(/<[^>]+>/g, "").trim(),
  };
}

function verdict(name, value) {
  if (!value) return `❌ **${name}** — missing`;
  const limit = LIMITS[name];
  if (limit) {
    const [lo, hi] = limit;
    if (value.length < lo) return `⚠️ **${name}** — ${value.length} chars, short (aim ${lo}–${hi})`;
    if (value.length > hi) return `⚠️ **${name}** — ${value.length} chars, will be truncated (aim ${lo}–${hi})`;
    return `✅ **${name}** — ${value.length} chars`;
  }
  return `✅ **${name}** — set`;
}

async function run(input) {
  const url = normalise(input.url);

  let res, html;
  try {
    res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(20_000) });
    html = (await res.text()).slice(0, 300_000);
  } catch (e) {
    throw new Error(e.name === "TimeoutError" ? "the page did not respond in 20 seconds" : `could not fetch the page: ${e.message}`);
  }

  const t = readTags(html);
  const missing = Object.entries(t).filter(([, v]) => !v).map(([k]) => k);

  let suggestions = "_The model did not return suggestions; the audit above still stands._";
  try {
    const out = await generate(
      `A web page has these meta tags. Write better replacements.\n\n` +
      `URL: ${url}\nCurrent title: ${t.title || "(none)"}\nCurrent description: ${t.description || "(none)"}\n` +
      `Main heading on the page: ${t.h1 || "(none)"}\n\n` +
      `Return markdown only: a suggested <title> (30-60 chars), a suggested meta description ` +
      `(70-160 chars), and a suggested og:title and og:description. Show each as a code block ` +
      `ready to paste. Say the character count after each. Be concrete about this page, not generic.`,
      { maxOutputTokens: 900 }
    );
    if (out && out.trim()) suggestions = out.trim();
  } catch { /* the mechanical audit is the deliverable; suggestions are a bonus */ }

  const content = `# Meta tags: ${new URL(res.url).host}

What this page currently tells Google and social platforms about itself.

## What's there now

${verdict("title", t.title)}
${verdict("description", t.description)}
${verdict("canonical", t.canonical)}
${verdict("ogTitle", t.ogTitle)}
${verdict("ogDescription", t.ogDescription)}
${verdict("ogImage", t.ogImage)}
${verdict("twitterCard", t.twitterCard)}
${verdict("h1", t.h1)}

${t.title ? `**Title:** ${t.title}` : ""}
${t.description ? `**Description:** ${t.description}` : ""}
${t.ogImage ? `**Share image:** ${t.ogImage}` : "**No share image** — links to this page will post as a bare grey box."}

## Why the missing ones matter

${missing.length === 0 ? "Nothing is missing." : missing.map((m) => `- \`${m}\` — ${({
  title: "the clickable line in every search result",
  description: "the grey text under it; without one Google invents its own",
  canonical: "tells search engines which URL is the real one when several serve the same page",
  ogTitle: "the headline when the link is pasted into Slack, X or iMessage",
  ogDescription: "the preview text under that headline",
  ogImage: "the picture in the link preview; without it the post looks broken",
  twitterCard: "decides whether X shows a large image or a thin strip",
  h1: "the page's main heading — search engines weight it heavily",
})[m] || "missing"}`).join("\n")}

## Suggested replacements

${suggestions}

---
*Tags read directly from the HTML served at ${res.url} (HTTP ${res.status}). The audit is measured; the replacements are suggestions.*
`;

  return { content, contentType: "text/markdown" };
}

module.exports = { key: "meta-tags", title: "Meta Tags", run };
