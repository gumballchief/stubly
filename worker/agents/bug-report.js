"use strict";

/** Agent — Bug Report. Input: { bug } */

const { writer } = require("./_writer");

module.exports = writer({
  key: "bug-report",
  title: "Bug Report",
  field: "bug",
  maxTokens: 1600,
  brief: () => "Turn the description below into a bug report: what happened, what should have happened, exact reproduction steps, and the environment. Keep observation and speculation clearly apart. Note what evidence is missing and how to capture it before anyone starts guessing at fixes.",
});
