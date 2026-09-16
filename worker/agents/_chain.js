"use strict";

/**
 * Shared read-only chain access for the Arc-native agents. Everything here is
 * free public data from the Blockscout explorer — no paid APIs, no keys.
 *
 * Which chain is the order's, not the process's. /api/settle runs these agents on
 * Vercel for whichever chain the order was paid on, where the worker's env vars are
 * unset or name testnet, so reading env there sold a mainnet buyer a report about
 * testnet. Each run asks forChain(ctx.chain) for its order's explorer; only a run
 * given no chain (the worker, or a script) uses chain/config's.
 */

const { CFG } = require("../../chain/config");
const { blockscoutApi } = require("../../chain/abi");

const TESTNET_ID = 5042002;

/* What these agents call the chain in the report a buyer reads. Deriving it from
   the chain id means a deliverable can never claim to be about testnet while the job
   that paid for it settled on mainnet. CHAIN_LABEL only renames the worker's own chain. */
function labelFor(chainId) {
  if (process.env.CHAIN_LABEL && Number(chainId) === CFG.CHAIN_ID) return process.env.CHAIN_LABEL;
  return Number(chainId) === TESTNET_ID ? "Arc testnet" : "Arc";
}

async function fetchJson(api, path, { timeout = 12_000 } = {}) {
  const r = await fetch(`${api}${path}`, { signal: AbortSignal.timeout(timeout) });
  if (!r.ok) return null;
  return r.json().catch(() => null);
}

const isAddress = (s) => /^0x[a-fA-F0-9]{40}$/.test(String(s || "").trim());
const isTxHash = (s) => /^0x[a-fA-F0-9]{64}$/.test(String(s || "").trim());

/** 18-decimal native USDC → readable */
function nat(wei) {
  if (wei == null) return "0";
  return (Number(BigInt(wei)) / 1e18).toLocaleString("en-US", { maximumFractionDigits: 4 });
}

/** token amount with arbitrary decimals → readable */
function amt(value, decimals) {
  if (value == null) return "0";
  const d = Number(decimals || 0);
  return (Number(BigInt(value)) / 10 ** d).toLocaleString("en-US", { maximumFractionDigits: 4 });
}

function ago(iso) {
  if (!iso) return "unknown";
  const secs = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 3600) return `${Math.round(secs / 60)} min ago`;
  if (secs < 86_400) return `${Math.round(secs / 3600)} hr ago`;
  return `${Math.round(secs / 86_400)} days ago`;
}

const short = (a) => (a ? `${a.slice(0, 8)}…${a.slice(-6)}` : "—");

/**
 * Explorer access for one chain. chain is a config from chain/config.js (the worker)
 * or site/api/_shared.js (a request); both name EXPLORER and EXPLORER_API. A chain with
 * no explorer configured throws: better a failed order, which is refunded, than a
 * report that read testnet's explorer and called it this chain.
 */
function forChain(chain) {
  const c = chain || CFG;
  const api = blockscoutApi(c);
  if (!api || !c.EXPLORER) throw new Error(`the explorer for chain ${c.CHAIN_ID} is not configured`);
  const id = Number(c.CHAIN_ID);
  return {
    get: (path, opts) => fetchJson(api, path, opts),
    EXPLORER: String(c.EXPLORER).replace(/\/+$/, ""),
    EXPLORER_API: api,
    CHAIN_ID: id,
    TESTNET: id === TESTNET_ID,
    CHAIN_LABEL: labelFor(id),
    isAddress, isTxHash, nat, amt, ago, short,
  };
}

/* The worker's own chain, for anything that still reads these directly. Never throws at
   load: an unconfigured chain fails when an agent runs, not when the worker boots. */
const OWN_API = blockscoutApi(CFG);
const get = (path, opts) => fetchJson(OWN_API, path, opts);

module.exports = {
  forChain, get, isAddress, isTxHash, nat, amt, ago, short,
  EXPLORER: CFG.EXPLORER, EXPLORER_API: OWN_API, CHAIN_LABEL: labelFor(CFG.CHAIN_ID),
};
