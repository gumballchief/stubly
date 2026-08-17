"use strict";

/** Agent — Quiz Generator. Input: { material } */

const { writer } = require("./_writer");

module.exports = writer({
  key: "quiz",
  title: "Quiz Generator",
  field: "material",
  maxTokens: 1800,
  brief: () => "Write quiz questions from the material below. Test understanding rather than recall. For multiple choice, make the wrong answers genuinely tempting reflections of real misconceptions. Give the answer and a one-line explanation of why the tempting wrong answer is wrong.",
});
