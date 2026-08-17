"use strict";

/** Agent — Contract Summary. Input: { contract } */

const { writer } = require("./_writer");

module.exports = writer({
  key: "contract-summary",
  title: "Contract Summary",
  field: "contract",
  maxTokens: 1800,
  brief: () => "Summarise the smart contract below in plain English: what it does, who can call what, and where money can move. Then list the powers the owner or admin retains, because that is what people actually need to know. Flag anything that could lock or drain funds.",
});
