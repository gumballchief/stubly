"use strict";

/** Agent — Chart Suggestion. Input: { data } */

const { writer } = require("./_writer");

module.exports = writer({
  key: "chart-suggestion",
  title: "Chart Suggestion",
  field: "data",
  maxTokens: 1400,
  brief: () => "For the data described below, recommend the chart type that answers the question honestly, and name two common choices that would mislead and why. Specify what each axis should be, whether zero must be included, and what the caption needs to say for the chart not to be misread.",
});
