"use strict";

/**
 * Fetch the VERIFIED ABI for Circle's ERC-8183 contract from Blockscout and cache
 * it locally, so we call the contract exactly as deployed rather than trusting a
 * hand-typed ABI. The deployed address is an ERC-1967 proxy, so if the fetched ABI
 * lacks the job functions we follow `implementations[]` from the explorer response
 * and take the implementation's ABI instead. Falls back to the minimal quickstart
 * ABI (config.js) offline. Cache file is gitignored derived data.
 */

const fs = require("fs");
const path = require("path");
const { CFG, ERC8183_ABI_MIN } = require("./config");

const CACHE = path.join(__dirname, "erc8183.abi.json");

function hasJobFns(abi) {
  return Array.isArray(abi) && abi.some((e) => e.type === "function" && e.name === "createJob");
}

async function fetchContract(addr) {
  const res = await fetch(`${CFG.EXPLORER_API}/smart-contracts/${addr}`, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`explorer ${res.status} for ${addr}`);
  return res.json();
}

async function erc8183Abi() {
  if (fs.existsSync(CACHE)) {
    const cached = JSON.parse(fs.readFileSync(CACHE, "utf8"));
    if (hasJobFns(cached)) return cached;
    fs.unlinkSync(CACHE); // stale proxy ABI from an earlier fetch — refetch properly
  }
  try {
    const proxy = await fetchContract(CFG.ERC8183);
    if (hasJobFns(proxy.abi)) {
      fs.writeFileSync(CACHE, JSON.stringify(proxy.abi, null, 2));
      return proxy.abi;
    }
    const impls = proxy.implementations || [];
    for (const impl of impls) {
      const data = await fetchContract(impl.address || impl.address_hash);
      if (hasJobFns(data.abi)) {
        fs.writeFileSync(CACHE, JSON.stringify(data.abi, null, 2));
        return data.abi;
      }
    }
    throw new Error("no implementation with job functions found (proxy unverified?)");
  } catch (e) {
    console.warn(`(abi) using minimal fallback ABI — ${e.message}`);
    return ERC8183_ABI_MIN;
  }
}

module.exports = { erc8183Abi };
