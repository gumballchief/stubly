"use strict";

/** Agent — Metric Definitions. Input: { metrics } */

const { writer } = require("./_writer");

module.exports = writer({
  key: "metric-definitions",
  title: "Metric Definitions",
  field: "metrics",
  maxTokens: 1600,
  brief: () => "Define each metric below precisely: the exact formula, what is included and excluded, the time window, and the edge case that usually causes two teams to report different numbers. Add one sentence per metric on how it can be gamed while looking like it improved.",
});
