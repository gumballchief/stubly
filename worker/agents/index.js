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
  require("./a11y-checklist"),
  require("./ab-test"),
  require("./ad-copy"),
  require("./adr"),
  require("./agent-lookup"),
  require("./api-docs"),
  require("./blog-outline"),
  require("./bug-report"),
  require("./case-study"),
  require("./chain-pulse"),
  require("./changelog-writer"),
  require("./chart-suggestion"),
  require("./ci-config"),
  require("./code-review-checklist"),
  require("./cold-dm"),
  require("./cold-email"),
  require("./commit-message"),
  require("./competitor-matrix"),
  require("./contract-check"),
  require("./contract-summary"),
  require("./copy-pack"),
  require("./csv-schema"),
  require("./data-extract"),
  require("./decision-brief"),
  require("./deck-outline"),
  require("./doc-digest"),
  require("./dockerfile"),
  require("./elevator-pitch"),
  require("./eli5"),
  require("./empty-states"),
  require("./env-audit"),
  require("./error-explain"),
  require("./error-messages"),
  require("./faq-writer"),
  require("./flashcards"),
  require("./gas-estimate"),
  require("./gitignore"),
  require("./glossary"),
  require("./grammar-fix"),
  require("./headers-check"),
  require("./ia-review"),
  require("./interview-questions"),
  require("./job-description"),
  require("./landing-critique"),
  require("./launch-kit"),
  require("./linkedin-post"),
  require("./meeting-agenda"),
  require("./meta-tags"),
  require("./metric-definitions"),
  require("./microcopy"),
  require("./migration-plan"),
  require("./name-check"),
  require("./negotiation-prep"),
  require("./newsletter"),
  require("./okrs"),
  require("./onboarding-checklist"),
  require("./outreach-sequence"),
  require("./pitch-critic"),
  require("./postmortem"),
  require("./pr-description"),
  require("./press-release"),
  require("./pricing-review"),
  require("./product-description"),
  require("./quiz"),
  require("./readme-writer"),
  require("./refactor-plan"),
  require("./regex-builder"),
  require("./research-brief"),
  require("./retro"),
  require("./risk-register"),
  require("./roadmap"),
  require("./runbook"),
  require("./seo-keywords"),
  require("./show-notes"),
  require("./simplify"),
  require("./site-audit"),
  require("./sop"),
  require("./sql-explain"),
  require("./study-plan"),
  require("./subject-lines"),
  require("./survey-questions"),
  require("./swot"),
  require("./tagline"),
  require("./tech-spec"),
  require("./test-plan"),
  require("./thread-writer"),
  require("./token-report"),
  require("./tokenomics-review"),
  require("./tone-rewrite"),
  require("./translate"),
  require("./tx-explain"),
  require("./unit-economics"),
  require("./user-journey"),
  require("./user-personas"),
  require("./value-prop"),
  require("./vendor-comparison"),
  require("./wallet-report"),
  require("./whitepaper-digest"),
  require("./wireframe"),
  require("./youtube-description"),
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
