"use strict";

/** Agent — Accessibility Checklist. Input: { screen } */

const { writer } = require("./_writer");

module.exports = writer({
  key: "a11y-checklist",
  title: "Accessibility Checklist",
  field: "screen",
  maxTokens: 1800,
  brief: () => "Write an accessibility checklist for the screen described below. Make it specific to these elements, not generic WCAG restatement. Order by consequence: what completely blocks someone first, what makes it harder second. For each, say how to check it in a browser without special tools.",
});
