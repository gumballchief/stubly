"use strict";

/** Agent — Empty State Copy. Input: { screen } */

const { writer } = require("./_writer");

module.exports = writer({
  key: "empty-states",
  title: "Empty State Copy",
  field: "screen",
  maxTokens: 1200,
  brief: () => "Write empty state copy for the screen below: a heading, one line of explanation, and the action to take. Explain why it is empty and what will fill it. No apologies, no 'nothing here yet' alone. Give a second version for when it is empty because something failed.",
});
