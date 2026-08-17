"use strict";

/** Agent — CSV Schema. Input: { sample } */

const { writer } = require("./_writer");

module.exports = writer({
  key: "csv-schema",
  title: "CSV Schema",
  field: "sample",
  maxTokens: 1400,
  brief: () => "From the sample rows below, infer a schema: each column's name, type, whether it can be empty, and an example. Then flag the import hazards — dates without a stated format, numbers stored as text, inconsistent casing, values that would break a strict parser.",
});
