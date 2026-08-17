"use strict";

/** Agent — Code Review Checklist. Input: { change } */

const { writer } = require("./_writer");

module.exports = writer({
  key: "code-review-checklist",
  title: "Code Review Checklist",
  field: "change",
  maxTokens: 1600,
  brief: () => "Write a code review checklist for the change described below. Make it specific to this change, not generic. Order by consequence: what could lose data or money first, what breaks users second, style last. For each item say what to look at, not just what to check.",
});
