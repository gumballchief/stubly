"use strict";

/** Agent — Risk Register. Input: { project } */

const { writer } = require("./_writer");

module.exports = writer({
  key: "risk-register",
  title: "Risk Register",
  field: "project",
  maxTokens: 1800,
  brief: () => "Build a risk register for the project below. For each risk: what it is, how likely, how bad, the early warning sign that it is happening, and the mitigation. Sort by likelihood times damage. Include at least one risk that comes from the team rather than the technology.",
});
