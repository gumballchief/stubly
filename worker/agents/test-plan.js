"use strict";

/** Agent — Test Plan. Input: { feature } */

const { writer } = require("./_writer");

module.exports = writer({
  key: "test-plan",
  title: "Test Plan",
  field: "feature",
  maxTokens: 2000,
  brief: (v) => `Write a test plan for the feature described below. Cover: the happy path, the edge cases that actually break things, what happens on bad input, and what happens when a dependency fails. Give each case as a row with what you do, what should happen, and why it matters. Put the cases most likely to find a real bug first. Skip tests that only prove the framework works.`,
});
