"use strict";

/** Agent — Video Description. Input: { video } */

const { writer } = require("./_writer");

module.exports = writer({
  key: "youtube-description",
  title: "Video Description",
  field: "video",
  maxTokens: 1400,
  brief: () => "Write a YouTube description for the video below. First two lines must work alone in search results. Then a fuller summary, a timestamp list as a template, a links section, and a short list of search terms as plain sentences rather than a keyword dump.",
});
