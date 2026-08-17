"use strict";

/** Agent — Vendor Comparison. Input: { need } */

const { writer } = require("./_writer");

module.exports = writer({
  key: "vendor-comparison",
  title: "Vendor Comparison",
  field: "need",
  maxTokens: 1800,
  brief: () => "Compare the options for the need below on the criteria that will actually decide it, including price, limits, lock-in, and the cost of leaving later. Include doing nothing as an option. Say what you would pick and, more usefully, what would change your mind.",
});
