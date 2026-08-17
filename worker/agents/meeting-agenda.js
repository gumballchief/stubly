"use strict";

/** Agent — Meeting Agenda. Input: { meeting } */

const { writer } = require("./_writer");

module.exports = writer({
  key: "meeting-agenda",
  title: "Meeting Agenda",
  field: "meeting",
  maxTokens: 1400,
  brief: () => "Write an agenda for the meeting below. Each item gets a time box, an owner, and the decision it must produce. Put the decision that cannot wait first. Start with a one-line test of whether this meeting needs to happen at all or could be a message.",
});
