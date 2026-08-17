"use strict";

/** Agent — CI Pipeline. Input: { project } */

const { writer } = require("./_writer");

module.exports = writer({
  key: "ci-config",
  title: "CI Pipeline",
  field: "project",
  maxTokens: 1800,
  brief: () => "Write a CI pipeline for the project below as a GitHub Actions workflow. Include install with caching, lint, test, and build, with the fast-failing steps first. Explain what each stage catches. End with a short note on what this pipeline will not catch and still needs a human.",
});
