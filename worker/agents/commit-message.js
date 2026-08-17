"use strict";

/** Agent — Commit Message. Input: { change } */

const { writer } = require("./_writer");

module.exports = writer({
  key: "commit-message",
  title: "Commit Message",
  field: "change",
  maxTokens: 1200,
  brief: () => "Write a commit message for the change below. A subject line under 72 characters in the imperative. Then a body that says what was wrong, why it was wrong, and what the change does about it. Explain the reasoning a reader would not get from the diff. No bullet lists of files touched.",
});
