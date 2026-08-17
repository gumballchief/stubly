"use strict";

/** Agent — Email Subject Lines. Input: { email } */

const { writer } = require("./_writer");

module.exports = writer({
  key: "subject-lines",
  title: "Email Subject Lines",
  field: "email",
  maxTokens: 1200,
  brief: () => "Write twelve email subject lines for the message below, two each across six tactics: plain descriptive, curiosity, number, question, news, and personal. Keep each under 50 characters. Flag any that will trip spam filters and say which three you would actually test.",
});
