"use strict";

/**
 * Fetch the VERIFIED ABI for Circle's ERC-8183 contract from Blockscout and cache
 * it locally, so we call the contract exactly as deployed rather than trusting a
 * hand-typed ABI. The deployed address is an ERC-1967 proxy, so if the fetched ABI
 * lacks the job functions we follow `implementations[]` from the explorer response
 * and take the implementation's ABI instead. Falls back to the minimal quickstart
 * ABI (config.js) offline. Cache file is gitignored derived data.
 *
 * The cache is keyed by chain id and escrow address. One cache file for every chain
 * meant a mainnet run quietly reused testnet's ABI, and if Circle's mainnet build
 * differs in so much as getJob's field order, every order's status would be misread.
 */

const fs = require("fs");
const path = require("path");
const { CFG, ERC8183_ABI_MIN } = require("./config");

const TESTNET_ID = 5042002;
const TESTNET_ESCROW = "0x0747eef0706327138c69792bf28cd525089e4583";
const TESTNET_CACHE = path.join(__dirname, "erc8183.abi.json");
/* Testnet keeps the file name it has always had. Other chains cache under
   node_modules/.cache, the usual home for derived files, which git already ignores. */
const OTHER_CACHE_DIR = path.join(__dirname, "..", "node_modules", ".cache", "stubly");

const verified = new Map(); // "chainId:address" → a verified ABI, for the life of the process

function cacheFile(C) {
  const addr = String(C.ERC8183 || "").toLowerCase();
  if (Number(C.CHAIN_ID) === TESTNET_ID && addr === TESTNET_ESCROW) return TESTNET_CACHE;
  return path.join(OTHER_CACHE_DIR, `erc8183.${Number(C.CHAIN_ID)}.${addr}.abi.json`);
}

/* The worker's config names Blockscout's REST root (/api/v2); the site's names the
   Etherscan-style /api it uses for getLogs. Both describe the same explorer. */
function blockscoutApi(C) {
  const api = String(C.EXPLORER_API || "").replace(/\/+$/, "");
  if (!api) return "";
  return /\/v2$/.test(api) ? api : `${api}/v2`;
}

function hasJobFns(abi) {
  return Array.isArray(abi) && abi.some((e) => e.type === "function" && e.name === "createJob");
}

async function fetchContract(api, addr) {
  const res = await fetch(`${api}/smart-contracts/${addr}`, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`explorer ${res.status} for ${addr}`);
  return res.json();
}

/* Caching is a convenience, never a reason to throw a good ABI away. On a read-only filesystem
   (Vercel) the write used to throw inside the try below and turn every successful fetch into the
   fallback. */
function remember(C, abi) {
  verified.set(`${Number(C.CHAIN_ID)}:${String(C.ERC8183).toLowerCase()}`, abi);
  try {
    const file = cacheFile(C);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(abi, null, 2));
  } catch { /* not cached, still used */ }
  return abi;
}

/** C is the chain the contract lives on; callers that never see a request get the worker's own. */
async function erc8183Abi(C = CFG) {
  const key = `${Number(C.CHAIN_ID)}:${String(C.ERC8183 || "").toLowerCase()}`;
  if (verified.has(key)) return verified.get(key);

  const file = cacheFile(C);
  if (fs.existsSync(file)) {
    const cached = JSON.parse(fs.readFileSync(file, "utf8"));
    if (hasJobFns(cached)) return cached;
    try { fs.unlinkSync(file); } catch { /* stale proxy ABI we can't delete; refetch anyway */ }
  }
  try {
    const api = blockscoutApi(C);
    if (!api || !C.ERC8183) throw new Error(`no explorer or escrow configured for chain ${C.CHAIN_ID}`);
    const proxy = await fetchContract(api, C.ERC8183);
    if (hasJobFns(proxy.abi)) return remember(C, proxy.abi);
    const impls = proxy.implementations || [];
    for (const impl of impls) {
      const data = await fetchContract(api, impl.address || impl.address_hash);
      if (hasJobFns(data.abi)) return remember(C, data.abi);
    }
    throw new Error("no implementation with job functions found (proxy unverified?)");
  } catch (e) {
    // Not remembered: the next call tries the explorer again, so a blip at boot heals.
    console.warn(`(abi) using minimal fallback ABI — ${e.message}`);
    return ERC8183_ABI_MIN;
  }
}

module.exports = { erc8183Abi, cacheFile, blockscoutApi };
