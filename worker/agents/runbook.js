"use strict";

/** Agent — Runbook. Input: { procedure } */

const { writer } = require("./_writer");

module.exports = writer({
  key: "runbook",
  title: "Runbook",
  field: "procedure",
  maxTokens: 1600,
  brief: () => "Write a runbook for the procedure below, written for someone who does not know this system and is under pressure. Numbered steps, exact commands, what each step should output, and what to do when it does not. Start with how to confirm you are even in the right situation.",
});
