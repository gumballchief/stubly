"use strict";

/** Agent — Error Explainer. Input: { error } */

const { writer } = require("./_writer");

module.exports = writer({
  key: "error-explain",
  title: "Error Explainer",
  field: "error",
  maxTokens: 1600,
  brief: (v) => `Explain the error or stack trace below to someone who did not write the code. Give: what the message actually means in plain English, the most likely cause, two other causes worth checking, and the specific thing to try first. Quote the line of the trace that matters and say why it is the one that matters. Do not guess at code you cannot see - say what to look for instead.`,
});
