"use strict";

/** Agent — Regex Builder. Input: { pattern } */

const { writer } = require("./_writer");

module.exports = writer({
  key: "regex-builder",
  title: "Regex Builder",
  field: "pattern",
  maxTokens: 1400,
  brief: (v) => `Build a regular expression that matches what is described below. Give the expression in a code block, then a table breaking down every part of it in plain English, then at least four strings it matches and four it does not. Flag any catastrophic backtracking risk. If the description is ambiguous, pick the strictest sensible reading and say which reading you took.`,
});
