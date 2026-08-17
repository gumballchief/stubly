"use strict";

/** Agent — FAQ Writer. Input: { product } */

const { writer } = require("./_writer");

module.exports = writer({
  key: "faq-writer",
  title: "FAQ Writer",
  field: "product",
  maxTokens: 1800,
  brief: () => "Write an FAQ for what is described below. Include the questions people genuinely ask before paying — what happens when it fails, who holds my money, can I get a refund, what if I do not like the result — not the flattering ones. Answer each in under 60 words, plainly, without marketing language.",
});
