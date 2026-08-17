"use strict";

/** Agent — Glossary. Input: { field } */

const { writer } = require("./_writer");

module.exports = writer({
  key: "glossary",
  title: "Glossary",
  field: "field",
  maxTokens: 1800,
  brief: () => "Write a glossary for the field below. Define each term in plain English in under 35 words. Put commonly confused pairs next to each other and say what actually distinguishes them. Mark any term the industry uses inconsistently and say which meaning you are using.",
});
