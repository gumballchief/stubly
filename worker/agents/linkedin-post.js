"use strict";

/** Agent — LinkedIn Post. Input: { topic } */

const { writer } = require("./_writer");

module.exports = writer({
  key: "linkedin-post",
  title: "LinkedIn Post",
  field: "topic",
  maxTokens: 1200,
  brief: () => "Write a LinkedIn post on the topic below. Open with a specific fact or moment, not a rhetorical question. Keep it under 200 words. No one-word-per-line formatting, no 'agree?' ending, no humble-brag framing. End with something that invites a real reply.",
});
