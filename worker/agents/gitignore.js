"use strict";

/** Agent — Gitignore. Input: { stack } */

const { writer } = require("./_writer");

module.exports = writer({
  key: "gitignore",
  title: "Gitignore",
  field: "stack",
  maxTokens: 1400,
  brief: () => "Write a .gitignore for the stack below, grouped by category with a comment on each group. Include the entries people forget until something leaks — local env files, keystores, editor folders, OS junk, build output, coverage. Call out any entry that is commonly and wrongly committed.",
});
