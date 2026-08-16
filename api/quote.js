/* Shim: the real handler lives in site/api. Deploying from the repo root
   lets functions reach worker/ and chain/, which site/ alone cannot. */
module.exports = require("../site/api/quote.js");
