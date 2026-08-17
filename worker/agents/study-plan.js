"use strict";

/** Agent — Study Plan. Input: { goal } */

const { writer } = require("./_writer");

module.exports = writer({
  key: "study-plan",
  title: "Study Plan",
  field: "goal",
  maxTokens: 1800,
  brief: () => "Build a study plan for the goal below. Organise it around things the learner builds rather than material they consume. For each stage: what to build, what it teaches, and the test of whether they actually got it. Say what to deliberately skip at first and when to come back to it.",
});
