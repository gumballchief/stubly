"use strict";

/** Agent — Blog Outline. Input: { topic } */

const { writer } = require("./_writer");

module.exports = writer({
  key: "blog-outline",
  title: "Blog Outline",
  field: "topic",
  maxTokens: 1600,
  brief: () => "Outline an article on the topic below. Give the working title, a one-line promise the piece has to keep, then each section with the single point it must land and the evidence or example it needs. Add three candidate openings and say which you would use. Mark any section where you would need a real number you do not have.",
});
