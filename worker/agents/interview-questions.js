"use strict";

/** Agent — Interview Questions. Input: { role } */

const { writer } = require("./_writer");

module.exports = writer({
  key: "interview-questions",
  title: "Interview Questions",
  field: "role",
  maxTokens: 1800,
  brief: () => "Write interview questions for the role below. For each, say what it is really testing and what a strong answer versus a weak answer sounds like. Prefer questions about work they have actually done over hypotheticals. Include one question that surfaces how they behave when they were wrong.",
});
