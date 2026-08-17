"use strict";

/** Agent — Information Architecture. Input: { structure } */

const { writer } = require("./_writer");

module.exports = writer({
  key: "ia-review",
  title: "Information Architecture",
  field: "structure",
  maxTokens: 1600,
  brief: () => "Review the structure below. Say whether it is organised around what the product does or what users are trying to achieve, and where those diverge. Recommend renames where a label describes an internal concept rather than a user goal. Flag anything a first-time visitor would not find.",
});
