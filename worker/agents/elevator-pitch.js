"use strict";

/** Agent — Elevator Pitch. Input: { idea } */

const { writer } = require("./_writer");

module.exports = writer({
  key: "elevator-pitch",
  title: "Elevator Pitch",
  field: "idea",
  maxTokens: 1400,
  brief: () => "Write three pitches for the idea below: ten seconds, thirty seconds, and sixty seconds. Each must end on something the listener can respond to. The ten-second one must survive being interrupted. Avoid category words nobody outside the industry uses.",
});
