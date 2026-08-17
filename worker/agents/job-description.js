"use strict";

/** Agent — Job Description. Input: { role } */

const { writer } = require("./_writer");

module.exports = writer({
  key: "job-description",
  title: "Job Description",
  field: "role",
  maxTokens: 1800,
  brief: () => "Write a job description for the role below: what the person will actually do in their first ninety days, what the job is genuinely like including the hard parts, what is required versus what is nice to have, and how to apply. No 'rockstar', no unpaid-test-project, no fake seniority.",
});
