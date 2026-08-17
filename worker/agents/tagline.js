"use strict";

/** Agent — Tagline. Input: { product } */

const { writer } = require("./_writer");

module.exports = writer({
  key: "tagline",
  title: "Tagline",
  field: "product",
  maxTokens: 1200,
  brief: () => "Write ten taglines for what is described below, across four registers: plain, bold, wry, and technical. Keep each under nine words. Then rank the top three and say what each one commits you to. Reject any that would suit a competitor equally well and say so.",
});
