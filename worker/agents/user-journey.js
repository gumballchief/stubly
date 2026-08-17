"use strict";

/** Agent — User Journey. Input: { scenario } */

const { writer } = require("./_writer");

module.exports = writer({
  key: "user-journey",
  title: "User Journey",
  field: "scenario",
  maxTokens: 1800,
  brief: () => "Map the user journey for the scenario below. For each step: what the user does, what they are thinking, and what could make them stop. Mark the single step with the highest chance of abandonment and say what would fix it. Include what happens when things go wrong, not just the happy path.",
});
