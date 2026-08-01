"use strict";

/**
 * Agent — README Writer.
 * Input:  { repo }  (a public GitHub repo URL or owner/name)
 * Output: a drafted README based on what the repo actually contains — languages,
 * structure, package manifest, existing docs — not a generic template.
 */

const { generate } = require("../llm");

async function gh(path) {
  const r = await fetch(`https://api.github.com${path}`, {
    headers: { accept: "application/vnd.github+json", "user-agent": "StublyReadmeAgent/1.0" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!r.ok) return null;
  return r.json();
}

async function run(input) {
  let repo = String(input.repo || "").trim();
  repo = repo.replace(/^https?:\/\/(www\.)?github\.com\//i, "").replace(/\.git$/, "").replace(/\/$/, "");
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error("give a public GitHub repo as owner/name or its URL");

  const [meta, langs, tree] = await Promise.all([
    gh(`/repos/${repo}`),
    gh(`/repos/${repo}/languages`),
    gh(`/repos/${repo}/contents/`),
  ]);
  if (!meta) throw new Error(`repo ${repo} not found or not public`);

  const files = (Array.isArray(tree) ? tree : []).map((f) => `${f.name}${f.type === "dir" ? "/" : ""}`);
  let manifest = null;
  const manifestFile = (Array.isArray(tree) ? tree : []).find((f) => ["package.json", "pyproject.toml", "Cargo.toml", "go.mod"].includes(f.name));
  if (manifestFile?.download_url) {
    try { manifest = (await (await fetch(manifestFile.download_url, { signal: AbortSignal.timeout(10_000) })).text()).slice(0, 2000); } catch { /* optional */ }
  }

  const facts = `repo: ${repo}
description: ${meta.description || "none"}
languages: ${Object.keys(langs || {}).join(", ") || "unknown"}
stars: ${meta.stargazers_count} · forks: ${meta.forks_count}
license: ${meta.license?.spdx_id || "none declared"}
homepage: ${meta.homepage || "none"}
topics: ${(meta.topics || []).join(", ") || "none"}
root_files: ${files.join(", ")}
manifest_excerpt: ${manifest || "none found"}`;

  const { text, model } = await generate(
    `You are writing a README for a real repository, using ONLY the evidence below. Markdown sections: title, a one-sentence description, ## What it does, ## Install, ## Usage (infer the run commands from the manifest and file layout — if you cannot tell, say what to check instead of inventing commands), ## Project structure (brief, from the real file list), ## License. Be concrete and short. Never invent features, badges, or commands you cannot support from the evidence.\n\n${facts}`,
    { maxOutputTokens: 1536 }
  );

  const content = `${text}\n\n---\n*Drafted by the README Writer agent from the live repo (${repo}) · model: ${model}. Review before committing.*\n`;
  return { content, contentType: "text/markdown" };
}

module.exports = { key: "readme-writer", title: "README Writer", run };
