"use strict";

/** Agent — Wireframe Description. Input: { screen } */

const { writer } = require("./_writer");

module.exports = writer({
  key: "wireframe",
  title: "Wireframe Description",
  field: "screen",
  maxTokens: 1800,
  brief: () => "Describe a wireframe for the screen below, block by block from top to bottom. For each block: what it contains, why it sits there, and what it must not push below the fold. State the single thing the screen exists to make happen and check every block earns its place against it.",
});
