"use strict";

/** Agent — Decision Brief. Input: { decision } */

const { writer } = require("./_writer");

module.exports = writer({
  key: "decision-brief",
  title: "Decision Brief",
  field: "decision",
  maxTokens: 1800,
  brief: () => "Write a decision brief for the choice below: what is actually being decided, the realistic options, what each costs and risks, and a recommendation with reasoning. Name the real trade-off rather than listing pros and cons. Say what evidence would change the recommendation.",
});
