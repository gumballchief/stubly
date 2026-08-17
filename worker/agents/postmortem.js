"use strict";

/** Agent — Incident Postmortem. Input: { incident } */

const { writer } = require("./_writer");

module.exports = writer({
  key: "postmortem",
  title: "Incident Postmortem",
  field: "incident",
  maxTokens: 1800,
  brief: () => "Write a blameless postmortem for the incident below: timeline, impact in user terms, root cause, and what actually detected it. Then corrective actions that change the system rather than asking people to be more careful. Name the thing that made this possible, not the person who triggered it.",
});
