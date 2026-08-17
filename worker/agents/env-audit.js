"use strict";

/** Agent — Env Var Audit. Input: { envlist } */

const { writer } = require("./_writer");

module.exports = writer({
  key: "env-audit",
  title: "Env Var Audit",
  field: "envlist",
  maxTokens: 1400,
  brief: () => "For the environment variable names below, classify each: genuine secret, public config, or a flag. Flag any that would be catastrophic if leaked, any that look like they might be exposed to a browser bundle, and any where a missing value should crash the app rather than silently default.",
});
