"use strict";

/** Agent — Cold Email. Input: { offer } */

const { writer } = require("./_writer");

module.exports = writer({
  key: "cold-email",
  title: "Cold Email",
  field: "offer",
  maxTokens: 1600,
  brief: (v) => `Write three cold outreach emails for the offer described below. Each one takes a different angle: one leads with a specific problem, one leads with a result someone got, one is two sentences long. For each give a subject line under 45 characters, the body under 120 words, and one line on who it is for. No flattery openings, no "I hope this finds you well", no fake urgency. Plain sentences a busy person will finish.`,
});
