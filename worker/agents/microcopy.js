"use strict";

/** Agent — Microcopy Review. Input: { copy } */

const { writer } = require("./_writer");

module.exports = writer({
  key: "microcopy",
  title: "Microcopy Review",
  field: "copy",
  maxTokens: 1400,
  brief: () => "Review the interface labels below. For each, say what it fails to tell the user and give a replacement that says what will actually happen when it is pressed. Flag any pair that could be confused with each other, and any label that hides an irreversible action.",
});
