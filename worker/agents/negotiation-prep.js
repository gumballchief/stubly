"use strict";

/** Agent — Negotiation Prep. Input: { situation } */

const { writer } = require("./_writer");

module.exports = writer({
  key: "negotiation-prep",
  title: "Negotiation Prep",
  field: "situation",
  maxTokens: 1800,
  brief: () => "Prepare for the negotiation below: what you actually need versus what you are asking for, what the other side likely wants, the trades available, and your walk-away point decided now rather than in the room. Include the three questions most likely to be asked and how to answer them.",
});
