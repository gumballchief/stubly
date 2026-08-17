"use strict";

/** Agent — Dockerfile. Input: { app } */

const { writer } = require("./_writer");

module.exports = writer({
  key: "dockerfile",
  title: "Dockerfile",
  field: "app",
  maxTokens: 1600,
  brief: () => "Write a Dockerfile for the application described below. Use a small base, order layers so dependency installs cache properly, run as a non-root user, and keep secrets out of the image. Annotate each instruction with why it is there. Note anything you assumed about the project layout.",
});
