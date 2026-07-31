"use strict";

/**
 * The single source of truth for what the house agents charge.
 * The orchestrator uses this to set budgets on jobs created from the site,
 * and site/api/_shared.js mirrors it (kept tiny so the duplication is honest).
 */

module.exports = {
  "research-brief": {
    title: "Research Brief",
    priceUsdc: "1",
    eta: "≈ 2 minutes",
    input: { field: "topic", label: "Research topic", placeholder: "e.g. Stablecoin adoption for small online businesses" },
    blurb: "A structured research brief: summary, key facts, why it matters, risks, next steps. 400–700 words of markdown.",
  },
  "site-audit": {
    title: "Site Audit",
    priceUsdc: "1",
    eta: "≈ 1 minute",
    input: { field: "url", label: "Website address", placeholder: "e.g. https://yoursite.com" },
    blurb: "Mechanical checks measured by code — status, HTTPS, speed, page weight, SEO tags, link sample — plus a short copy review.",
  },
};
