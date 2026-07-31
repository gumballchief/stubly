"use strict";

/**
 * Fetch the VERIFIED ABI for Circle's ERC-8183 contract from Blockscout and cache
 * it locally, so we call the contract exactly as deployed rather than trusting a
 * hand-typed ABI. Falls back to the minimal quickstart ABI (config.js) offline.
 * The cache file is gitignored — it's derived data, refetched in minutes if stale.
 */

const fs = require("fs");
const path = require("path");
const { CFG, ERC8183_ABI_MIN } = require("./config");

const CACHE = path.join(__dirname, "erc8183.abi.json");

async function erc8183Abi() {
  if (fs.existsSync(CACHE)) return JSON.parse(fs.readFileSync(CACHE, "utf8"));
  try {
    const res = await fetch(`${CFG.EXPLORER_API}/smart-contracts/${CFG.ERC8183}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`explorer ${res.status}`);
    const data = await res.json();
    if (Array.isArray(data.abi) && data.abi.length) {
      fs.writeFileSync(CACHE, JSON.stringify(data.abi, null, 2));
      return data.abi;
    }
    throw new Error("contract not verified on explorer");
  } catch (e) {
    console.warn(`(abi) using minimal fallback ABI — ${e.message}`);
    return ERC8183_ABI_MIN;
  }
}

module.exports = { erc8183Abi };
