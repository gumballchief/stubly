"use strict";

/** Agent — Pull Request Description. Input: { change } */

const { writer } = require("./_writer");

module.exports = writer({
  key: "pr-description",
  title: "Pull Request Description",
  field: "change",
  maxTokens: 1600,
  brief: () => "Write a pull request description for the change below: what it does, why it is needed, the part a reviewer should look at hardest and why, how it was verified, and what is deliberately not covered. Call out anything risky rather than burying it.",
});
