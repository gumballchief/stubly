"use strict";

/** Agent — Simplify Text. Input: { text } */

const { writer } = require("./_writer");

module.exports = writer({
  key: "simplify",
  title: "Simplify Text",
  field: "text",
  maxTokens: 1600,
  brief: () => "Rewrite the text below to be clearly understood on one read, at roughly half the length. Keep every fact. Then list what you removed and why removing it was safe. Flag anything you could not simplify without losing meaning, and say what that thing is.",
});
