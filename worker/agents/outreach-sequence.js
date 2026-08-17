"use strict";

/** Agent — Outreach Sequence. Input: { campaign } */

const { writer } = require("./_writer");

module.exports = writer({
  key: "outreach-sequence",
  title: "Outreach Sequence",
  field: "campaign",
  maxTokens: 1800,
  brief: () => "Write a four-message outreach sequence for the campaign below, with timing between each. Each message must add new information rather than repeat the last one. The final one closes the loop gracefully without guilt. Say what response would make you stop the sequence early.",
});
