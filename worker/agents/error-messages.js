"use strict";

/** Agent — Error Message Copy. Input: { errors } */

const { writer } = require("./_writer");

module.exports = writer({
  key: "error-messages",
  title: "Error Message Copy",
  field: "errors",
  maxTokens: 1600,
  brief: () => "Write error messages for the failures below. Each says what happened, why, and the next action, in under 25 words. Never blame the user. Give the user-facing text and, separately, what should be logged for whoever debugs it — those are different audiences.",
});
