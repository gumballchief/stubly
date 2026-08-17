"use strict";

/** Agent — Proofread. Input: { text } */

const { writer } = require("./_writer");

module.exports = writer({
  key: "grammar-fix",
  title: "Proofread",
  field: "text",
  maxTokens: 1600,
  brief: () => "Proofread the text below. Give the corrected version first. Then list each change with the reason, keeping genuine errors separate from stylistic preferences so the author can accept one and reject the other. Do not change the author's voice.",
});
