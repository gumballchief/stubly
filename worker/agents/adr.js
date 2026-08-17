"use strict";

/** Agent — Architecture Decision Record. Input: { decision } */

const { writer } = require("./_writer");

module.exports = writer({
  key: "adr",
  title: "Architecture Decision Record",
  field: "decision",
  maxTokens: 1600,
  brief: () => "Write an architecture decision record for the decision below: the context and the forces at play, the options considered, the decision, and the consequences including the bad ones. Give each rejected option a fair hearing and say what would make you revisit it.",
});
