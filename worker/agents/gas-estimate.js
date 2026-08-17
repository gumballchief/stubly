"use strict";

/** Agent — Gas Estimator. Input: { action } */

const { writer } = require("./_writer");

module.exports = writer({
  key: "gas-estimate",
  title: "Gas Estimator",
  field: "action",
  maxTokens: 1600,
  brief: () => "Estimate the on-chain cost of the action below on Arc, where USDC is the gas token so fees are already in dollars. Break down each transaction involved, give a rough total, and say what would make it more expensive. Note where an estimate is a guess rather than a measurement.",
});
