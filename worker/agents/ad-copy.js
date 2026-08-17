"use strict";

/** Agent — Ad Copy. Input: { offer } */

const { writer } = require("./_writer");

module.exports = writer({
  key: "ad-copy",
  title: "Ad Copy",
  field: "offer",
  maxTokens: 1400,
  brief: () => "Write five ad variants for the offer below. Each uses a different hook: the problem, the number, the objection, the comparison, the curiosity gap. Give headline, body under 90 characters, and who it targets. Say which one you would spend first money on and why.",
});
