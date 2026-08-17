"use strict";

/** Agent — Value Proposition. Input: { product } */

const { writer } = require("./_writer");

module.exports = writer({
  key: "value-prop",
  title: "Value Proposition",
  field: "product",
  maxTokens: 1400,
  brief: () => "Write a value proposition for what is described below, in the form: for [who], who [problem], this is a [category] that [benefit], unlike [alternative]. Then give three weaker drafts and explain exactly what is wrong with each. Be specific about the alternative — 'doing nothing' counts.",
});
