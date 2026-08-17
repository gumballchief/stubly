"use strict";

/** Agent — A/B Test Design. Input: { test } */

const { writer } = require("./_writer");

module.exports = writer({
  key: "ab-test",
  title: "A/B Test Design",
  field: "test",
  maxTokens: 1800,
  brief: () => "Design an A/B test for the question below: the hypothesis, the single primary metric, the guardrail metrics, roughly how much traffic is needed, and the stopping rule set before the test starts. Then list the ways this test could produce a result that means nothing.",
});
