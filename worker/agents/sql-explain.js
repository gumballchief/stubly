"use strict";

/** Agent — SQL Explainer. Input: { query } */

const { writer } = require("./_writer");

module.exports = writer({
  key: "sql-explain",
  title: "SQL Explainer",
  field: "query",
  maxTokens: 1600,
  brief: (v) => `Explain the SQL below in plain English: what it returns, table by table how it gets there, and what each join or filter is doing. Then flag anything risky - a missing index likely to make it slow, an accidental cross join, a NULL comparison that will not behave, or an UPDATE/DELETE without a WHERE. If it is destructive, say so at the top in bold.`,
});
