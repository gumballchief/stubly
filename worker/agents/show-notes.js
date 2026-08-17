"use strict";

/** Agent — Podcast Show Notes. Input: { episode } */

const { writer } = require("./_writer");

module.exports = writer({
  key: "show-notes",
  title: "Podcast Show Notes",
  field: "episode",
  maxTokens: 1400,
  brief: () => "Write podcast show notes for the episode below: a two-sentence summary, five bullet takeaways with the actual insight rather than the topic, a timestamp template, and a list of everything mentioned that a listener would go looking for afterwards.",
});
