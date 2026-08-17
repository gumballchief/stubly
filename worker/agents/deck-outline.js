"use strict";

/** Agent — Pitch Deck Outline. Input: { pitch } */

const { writer } = require("./_writer");

module.exports = writer({
  key: "deck-outline",
  title: "Pitch Deck Outline",
  field: "pitch",
  maxTokens: 1800,
  brief: () => "Outline a pitch deck for what is described below. Give each slide a title, the single point it must land, and the evidence needed to make that point believable. Put the problem before the solution. Mark every slide where you would need a real number you do not have rather than inventing one.",
});
