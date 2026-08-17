"use strict";

/** Agent — Product Description. Input: { product } */

const { writer } = require("./_writer");

module.exports = writer({
  key: "product-description",
  title: "Product Description",
  field: "product",
  maxTokens: 1400,
  brief: () => "Write product copy for what is described below, at three lengths: a one-line version for a card, a short paragraph for a listing, and a fuller version for a product page. Lead with what it does for the buyer, not what it is built from. Give one specific detail in each that a competitor could not copy.",
});
