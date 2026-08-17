"use strict";

/** Agent — Newsletter Issue. Input: { topic } */

const { writer } = require("./_writer");

module.exports = writer({
  key: "newsletter",
  title: "Newsletter Issue",
  field: "topic",
  maxTokens: 1600,
  brief: () => "Write one newsletter issue about the subject below. Give a subject line under 50 characters, a preview line, an opening paragraph that earns the second paragraph, the body in short sections, and one clear call to action. Write like a person emailing a person. No 'in today's issue' throat-clearing.",
});
