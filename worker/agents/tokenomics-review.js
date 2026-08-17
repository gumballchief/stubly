"use strict";

/** Agent — Tokenomics Review. Input: { tokenomics } */

const { writer } = require("./_writer");

module.exports = writer({
  key: "tokenomics-review",
  title: "Tokenomics Review",
  field: "tokenomics",
  maxTokens: 1800,
  brief: () => "Review the token design below: where value actually comes from, who pays and who receives, and whether the incentives survive people acting selfishly. Say plainly whether the design needs constant new buyers to work. Do not offer investment advice — analyse the mechanism only.",
});
