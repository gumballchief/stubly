"use strict";

/** Agent — Explain Simply. Input: { concept } */

const { writer } = require("./_writer");

module.exports = writer({
  key: "eli5",
  title: "Explain Simply",
  field: "concept",
  maxTokens: 1400,
  brief: () => "Explain the concept below to a smart fifteen-year-old who knows nothing about the field. No jargon unless you define it in the same sentence. Use one concrete analogy and then say exactly where that analogy stops being true, because that is where people get confused later.",
});
