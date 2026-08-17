"use strict";

/** Agent — API Docs. Input: { endpoint } */

const { writer } = require("./_writer");

module.exports = writer({
  key: "api-docs",
  title: "API Docs",
  field: "endpoint",
  maxTokens: 1800,
  brief: () => "Document the endpoint described below: what it does, the request shape with every field explained, a success response, and the error responses including what causes each. Add one worked example with real-looking values, and a note on the mistake a first-time caller is most likely to make.",
});
