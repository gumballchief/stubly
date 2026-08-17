"use strict";

/** Agent — Tone Rewrite. Input: { text } */

const { writer } = require("./_writer");

module.exports = writer({
  key: "tone-rewrite",
  title: "Tone Rewrite",
  field: "text",
  maxTokens: 1600,
  brief: () => "Rewrite the text below in four registers: plain, warm, formal, and blunt. Keep the meaning identical. After each, note in one line what that register gains and what it costs. Then say which fits the likely audience and why.",
});
