"use strict";

/** Agent — Onboarding Checklist. Input: { role } */

const { writer } = require("./_writer");

module.exports = writer({
  key: "onboarding-checklist",
  title: "Onboarding Checklist",
  field: "role",
  maxTokens: 1600,
  brief: () => "Write an onboarding checklist for the person below, covering their first day, first week and first month. Order it so they ship something small and real on day one. Separate what someone must do for them from what they can do alone. Include the thing that is always forgotten until it blocks them.",
});
