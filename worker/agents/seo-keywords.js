"use strict";

/** Agent — SEO Keywords. Input: { topic } */

const { writer } = require("./_writer");

module.exports = writer({
  key: "seo-keywords",
  title: "SEO Keywords",
  field: "topic",
  maxTokens: 1800,
  brief: (v) => `Build a keyword plan for the topic below. Group keywords by search intent - someone learning, someone comparing, someone ready to buy. For each group give the terms, what a page targeting them should actually answer, and roughly how hard it will be for a small site to rank. Be honest about which terms a new site should not bother with yet.`,
});
