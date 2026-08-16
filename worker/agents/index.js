"use strict";

/**
 * The agent roster, required statically.
 *
 * This was a dynamic require over the catalog keys, which reads nicely but is
 * invisible to a bundler — deployed as a serverless function, not one agent
 * module would have been included. Listing them explicitly makes the roster
 * survive bundling; the assertion underneath keeps the old guarantee that it
 * cannot drift from the catalog.
 */

const CATALOG = require("../../site/api/_catalog.json");

const MODULES = [
  require("./agent-lookup"),
  require("./chain-pulse"),
  require("./contract-check"),
  require("./copy-pack"),
  require("./data-extract"),
  require("./doc-digest"),
  require("./launch-kit"),
  require("./name-check"),
  require("./pitch-critic"),
  require("./readme-writer"),
  require("./research-brief"),
  require("./site-audit"),
  require("./thread-writer"),
  require("./token-report"),
  require("./translate"),
  require("./tx-explain"),
  require("./wallet-report"),
];

const AGENTS = Object.fromEntries(MODULES.map((a) => [a.key, a]));

const missing = Object.keys(CATALOG).filter((k) => !AGENTS[k]);
const extra = Object.keys(AGENTS).filter((k) => !CATALOG[k]);
if (missing.length || extra.length) {
  throw new Error(
    `agent roster drifted from the catalog — missing: [${missing}] extra: [${extra}]`
  );
}

module.exports = AGENTS;
