"use strict";

/** Agent — Press Release. Input: { announcement } */

const { writer } = require("./_writer");

module.exports = writer({
  key: "press-release",
  title: "Press Release",
  field: "announcement",
  maxTokens: 1600,
  brief: () => "Write a press release for the announcement below. Standard shape: headline, dateline, a first paragraph that works alone if nothing else is read, supporting detail, one quote that says something specific rather than expressing excitement, and boilerplate. Flag anything you had to leave as a placeholder.",
});
