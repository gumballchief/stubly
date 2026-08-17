"use strict";

/** Agent — Case Study. Input: { story } */

const { writer } = require("./_writer");

module.exports = writer({
  key: "case-study",
  title: "Case Study",
  field: "story",
  maxTokens: 1600,
  brief: () => "Turn the story below into a case study: the situation, what was actually hard about it, what was done, and the result. Use concrete numbers wherever they are given. Where a number is missing, say what should be measured instead of inventing one. End with what someone else should take from it.",
});
