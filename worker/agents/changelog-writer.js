"use strict";

/** Agent — Changelog Writer. Input: { changes } */

const { writer } = require("./_writer");

module.exports = writer({
  key: "changelog-writer",
  title: "Changelog Writer",
  field: "changes",
  maxTokens: 1600,
  brief: (v) => `Turn the raw notes or commit messages below into a changelog people will actually read. Group into Added, Changed, Fixed and Removed, dropping anything that is not user-visible. Write each entry from the reader position - what they can now do, not which function was refactored. If something is a breaking change, say so first and say what to do about it.`,
});
