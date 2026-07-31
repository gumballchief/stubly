"use strict";

/**
 * Single source of truth for the agent roster and prices lives in
 * site/api/_catalog.json (so the deployed site and this worker can never drift).
 * The orchestrator uses it to quote budgets; the site serves it via /api/catalog.
 */

module.exports = require("../site/api/_catalog.json");
