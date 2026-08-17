"use strict";

/** Agent — OKR Draft. Input: { goal } */

const { writer } = require("./_writer");

module.exports = writer({
  key: "okrs",
  title: "OKR Draft",
  field: "goal",
  maxTokens: 1600,
  brief: () => "Draft OKRs for the goal below: one objective and three key results that are measured rather than done. Then audit your own draft — mark any key result that is really a task, and any that could be hit while the objective fails. Rewrite the worst one.",
});
