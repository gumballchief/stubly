"use strict";

/** Agent — Survey Questions. Input: { goal } */

const { writer } = require("./_writer");

module.exports = writer({
  key: "survey-questions",
  title: "Survey Questions",
  field: "goal",
  maxTokens: 1600,
  brief: () => "Write survey questions to learn what is described below. Avoid leading and double-barrelled questions. Order them so earlier questions do not bias later ones. Mark each as behavioural or attitudinal, and note which answers will be unreliable because people misremember.",
});
