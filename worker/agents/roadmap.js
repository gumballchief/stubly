"use strict";

/** Agent — Roadmap Draft. Input: { goals } */

const { writer } = require("./_writer");

module.exports = writer({
  key: "roadmap",
  title: "Roadmap Draft",
  field: "goals",
  maxTokens: 1800,
  brief: () => "Draft a roadmap from the goals below. Sequence so each stage ships something usable on its own. Make dependencies explicit — what genuinely cannot start before something else finishes. Mark the one stage most likely to slip and what would absorb the slip.",
});
