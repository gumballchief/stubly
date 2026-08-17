"use strict";

/** Agent — Cold DM. Input: { target } */

const { writer } = require("./_writer");

module.exports = writer({
  key: "cold-dm",
  title: "Cold DM",
  field: "target",
  maxTokens: 1400,
  brief: () => "Write three cold direct messages for the situation below. Each under 60 words, each opening with something specific to them rather than to you. No 'hope you are well', no pitch in the first line, no calendar link in the first message. Say what each one is testing.",
});
