"use strict";

/** Agent — SWOT Analysis. Input: { subject } */

const { writer } = require("./_writer");

module.exports = writer({
  key: "swot",
  title: "SWOT Analysis",
  field: "subject",
  maxTokens: 1600,
  brief: () => "Write a SWOT for the subject below. Each entry must be specific enough to act on. Weaknesses must include the uncomfortable one. Threats must be named, not hedged. Finish with the single strength most worth doubling down on and the single weakness most worth fixing first.",
});
