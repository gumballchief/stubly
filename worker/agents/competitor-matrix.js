"use strict";

/** Agent — Competitor Matrix. Input: { market } */

const { writer } = require("./_writer");

module.exports = writer({
  key: "competitor-matrix",
  title: "Competitor Matrix",
  field: "market",
  maxTokens: 1800,
  brief: () => "Build a competitor comparison for the market below. Choose the dimensions buyers actually decide on rather than feature counts. Include a row for the option of doing nothing. Where you lack real data, say so in the cell rather than guessing. Finish with the one dimension worth competing on.",
});
