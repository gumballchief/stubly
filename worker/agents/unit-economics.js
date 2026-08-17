"use strict";

/** Agent — Unit Economics. Input: { business } */

const { writer } = require("./_writer");

module.exports = writer({
  key: "unit-economics",
  title: "Unit Economics",
  field: "business",
  maxTokens: 1600,
  brief: () => "Work out the unit economics of the business below: revenue per unit, the costs that scale with it, contribution margin, and what has to be true for it to work. List every assumption you had to make in one place so a wrong one is easy to spot. Say which single number matters most.",
});
