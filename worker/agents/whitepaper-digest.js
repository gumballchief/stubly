"use strict";

/** Agent — Whitepaper Digest. Input: { text } */

const { writer } = require("./_writer");

module.exports = writer({
  key: "whitepaper-digest",
  title: "Whitepaper Digest",
  field: "text",
  maxTokens: 2000,
  brief: () => "Digest the document below: what it claims, what mechanism it proposes, and what it actually demonstrates versus asserts. Separate the technical contribution from the marketing. List the questions a careful reader would still have, and anything conspicuously not addressed.",
});
