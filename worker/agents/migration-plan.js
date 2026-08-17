"use strict";

/** Agent — Migration Plan. Input: { migration } */

const { writer } = require("./_writer");

module.exports = writer({
  key: "migration-plan",
  title: "Migration Plan",
  field: "migration",
  maxTokens: 1800,
  brief: () => "Write a migration plan for what is described below. Cover: what breaks if this goes wrong, the order of operations, how to verify each step actually worked, and the rollback — written before the rollout, with the exact trigger for using it. Flag every step that is hard to reverse.",
});
