"use strict";

/** Agent — Pricing Review. Input: { pricing } */

const { writer } = require("./_writer");

module.exports = writer({
  key: "pricing-review",
  title: "Pricing Review",
  field: "pricing",
  maxTokens: 1600,
  brief: () => "Review the pricing below: what the price signals about quality, where it likely leaves money on the table, and where it may block adoption. Suggest one alternative structure and say what it would change about who buys. Recommend one change to test first and how to tell whether it worked.",
});
