"use strict";

/** Agent — Technical Spec. Input: { feature } */

const { writer } = require("./_writer");

module.exports = writer({
  key: "tech-spec",
  title: "Technical Spec",
  field: "feature",
  maxTokens: 2000,
  brief: () => "Write a technical spec for the feature below: the problem, the goals and explicit non-goals, the proposed approach, the alternatives rejected and why, the failure modes, and how success is measured. Put the problem before the solution and keep the non-goals honest.",
});
