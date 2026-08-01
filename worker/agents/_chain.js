"use strict";

/**
 * Shared read-only chain access for the Arc-native agents. Everything here is
 * free public data from the Blockscout explorer — no paid APIs, no keys.
 */

const EXPLORER_API = process.env.EXPLORER_API || "https://testnet.arcscan.app/api/v2";
const EXPLORER = "https://testnet.arcscan.app";

async function get(path, { timeout = 12_000 } = {}) {
  const r = await fetch(`${EXPLORER_API}${path}`, { signal: AbortSignal.timeout(timeout) });
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

module.exports = { get, isAddress, isTxHash, nat, amt, ago, short, EXPLORER, EXPLORER_API };
