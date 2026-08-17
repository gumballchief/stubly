"use strict";

/** Agent — Standard Procedure. Input: { task } */

const { writer } = require("./_writer");

module.exports = writer({
  key: "sop",
  title: "Standard Procedure",
  field: "task",
  maxTokens: 1600,
  brief: () => "Write a standard operating procedure for the task below: prerequisites, numbered steps, the verification after each step that catches a mistake before it matters, and what to do when a step fails. Note which steps are safe to retry and which are not.",
});
