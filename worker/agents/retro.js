"use strict";

/** Agent — Retrospective. Input: { period } */

const { writer } = require("./_writer");

module.exports = writer({
  key: "retro",
  title: "Retrospective",
  field: "period",
  maxTokens: 1600,
  brief: () => "Write a retrospective for the period below: what went well and why it went well, what did not and what caused it, and what to change. Every item must lead to a change in how the next one is done. Include one thing to stop doing entirely.",
});
