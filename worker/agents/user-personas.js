"use strict";

/** Agent — User Personas. Input: { product } */

const { writer } = require("./_writer");

module.exports = writer({
  key: "user-personas",
  title: "User Personas",
  field: "product",
  maxTokens: 1800,
  brief: (v) => `Write three user personas for the product described below. Each one gets: who they are and what their day looks like, the specific problem that makes them look for something like this, what would make them bounce in the first minute, and the sentence that would make them stay. Make them different enough to disagree with each other. No demographics padding, no "tech-savvy millennial".`,
});
