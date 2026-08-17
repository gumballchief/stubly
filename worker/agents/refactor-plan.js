"use strict";

/** Agent — Refactor Plan. Input: { code } */

const { writer } = require("./_writer");

module.exports = writer({
  key: "refactor-plan",
  title: "Refactor Plan",
  field: "code",
  maxTokens: 1600,
  brief: () => "Plan a refactor of what is described below. Break it into steps that each leave the system working and shippable on their own. For each, say what improves and what risk it carries. Include the point at which stopping early would still have been worth it.",
});
