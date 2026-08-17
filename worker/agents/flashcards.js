"use strict";

/** Agent — Flashcards. Input: { material } */

const { writer } = require("./_writer");

module.exports = writer({
  key: "flashcards",
  title: "Flashcards",
  field: "material",
  maxTokens: 1800,
  brief: () => "Turn the material below into flashcards. One idea per card. Write the front so it cannot be answered by recognising a keyword. Keep the back under 30 words. Order them so earlier cards build the vocabulary later ones need.",
});
