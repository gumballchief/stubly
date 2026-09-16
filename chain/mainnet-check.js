"use strict";

/**
 * Is Stubly ready to switch to Arc mainnet? Read-only: it signs nothing, sets nothing,
 * deploys nothing. Run it any time:
 *
 *   npm run mainnet:check
 *
 * It asks the chain itself, not documentation, because the question that matters is
 * whether the contracts are really there and really the ones the code expects.
 * Addresses come from MAINNET_* env vars when set; otherwise it tries the addresses
 * Circle used on testnet, since both registries were deployed at fixed addresses.
 */

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const fs = require("fs");
const path = require("path");
const { Interface } = require("ethers");
const { ERC8183_ABI_MIN } = require("./config");

const EIP1967_IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
const ROOT = path.join(__dirname, "..");

function mainnetValues(env = process.env) {
  const addrOf = (name) => {
    try { return "0x" + JSON.parse(fs.readFileSync(path.join(__dirname, `${name}.keystore.json`), "utf8")).address.replace(/^0x/i, ""); }
    catch { return ""; }
  };
  return {
    CHAIN_ID: 5042,
    RPC_URL: env.MAINNET_RPC_URL || "https://rpc.mainnet.arc.io",
    PUBLIC_RPC_URL: env.MAINNET_PUBLIC_RPC_URL || "https://rpc.mainnet.arc.io",
    EXPLORER: env.MAINNET_EXPLORER || "https://explorer.arc.io",
    ERC8183: env.MAINNET_ERC8183 || "0x0747EEf0706327138c69792bF28Cd525089e4583",
    IDENTITY_REGISTRY: env.MAINNET_IDENTITY_REGISTRY || "0x8004A818BFB912233c491871b3d84c89A494BD9e",
    USDC: env.MAINNET_USDC || "0x3600000000000000000000000000000000000000",
    PROVIDER_WALLET: env.MAINNET_PROVIDER_WALLET || addrOf("provider_mainnet"),
    EVALUATOR_WALLET: env.MAINNET_EVALUATOR_WALLET || addrOf("evaluator_mainnet"),
  };
}

async function rpc(url, method, params) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(20_000),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message || "rpc error");
  return j.result;
}

const hasCode = (code) => typeof code === "string" && code !== "0x" && code.length > 2;
const usdcOf = async (V, who) => {
  const data = "0x70a08231" + who.slice(2).toLowerCase().padStart(64, "0");
  return Number(BigInt(await rpc(V.RPC_URL, "eth_call", [{ to: V.USDC, data }, "latest"]))) / 1e6;
};

async function explorerAnswers(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(15_000), headers: { "user-agent": "stubly-mainnet-check" } });
    const text = await r.text();
    JSON.parse(text);
    return r.ok;
  } catch { return false; }
}

/**
 * Every check returns { name, ok, blocking, detail }. blocking = the switch cannot
 * happen until it passes. Non-blocking failures are things the flip works around.
 */
async function runChecks({ env = process.env, needFunds = true } = {}) {
  const V = mainnetValues(env);
  const out = [];
  const add = (name, ok, blocking, detail) => out.push({ name, ok: Boolean(ok), blocking, detail });

  let block = 0;
  try {
    const id = parseInt(await rpc(V.RPC_URL, "eth_chainId", []), 16);
    block = parseInt(await rpc(V.RPC_URL, "eth_blockNumber", []), 16);
    add("Arc mainnet RPC answers", id === 5042, true, `${V.RPC_URL} says chain ${id}, block ${block}`);
  } catch (e) {
    add("Arc mainnet RPC answers", false, true, `${V.RPC_URL}: ${e.message}`);
    return { values: V, block, checks: out };
  }

  const escrowCode = await rpc(V.RPC_URL, "eth_getCode", [V.ERC8183, "latest"]).catch(() => "0x");
  add("Circle's ERC-8183 escrow is deployed", hasCode(escrowCode), true,
    hasCode(escrowCode) ? `code at ${V.ERC8183}` : `no contract at ${V.ERC8183} yet (set MAINNET_ERC8183 if Circle used another address)`);

  const idCode = await rpc(V.RPC_URL, "eth_getCode", [V.IDENTITY_REGISTRY, "latest"]).catch(() => "0x");
  add("Circle's ERC-8004 identity registry is deployed", hasCode(idCode), true,
    hasCode(idCode) ? `code at ${V.IDENTITY_REGISTRY}` : `no contract at ${V.IDENTITY_REGISTRY} yet (set MAINNET_IDENTITY_REGISTRY if Circle used another address)`);

  /* The escrow is a proxy, so its real functions live in the implementation. Every
     function the worker and the site call must be in that code, or the fallback ABI in
     chain/config.js would be describing a different contract. */
  if (hasCode(escrowCode)) {
    try {
      const slot = await rpc(V.RPC_URL, "eth_getStorageAt", [V.ERC8183, EIP1967_IMPL_SLOT, "latest"]);
      const impl = "0x" + slot.slice(-40);
      const implCode = await rpc(V.RPC_URL, "eth_getCode", [impl, "latest"]);
      const target = hasCode(implCode) ? implCode : escrowCode;
      const iface = new Interface(ERC8183_ABI_MIN);
      const missing = iface.fragments.filter((f) => f.type === "function")
        .filter((f) => !target.toLowerCase().includes(iface.getFunction(f.name).selector.slice(2)))
        .map((f) => f.name);
      add("Escrow has every function Stubly calls", missing.length === 0, true,
        missing.length ? `missing: ${missing.join(", ")}` : `all ${iface.fragments.filter((f) => f.type === "function").length} functions found in ${hasCode(implCode) ? "implementation " + impl : "the contract"}`);
    } catch (e) {
      add("Escrow has every function Stubly calls", false, true, e.message);
    }
  }

  try {
    const [dec, sym] = await Promise.all([
      rpc(V.RPC_URL, "eth_call", [{ to: V.USDC, data: "0x313ce567" }, "latest"]),
      rpc(V.RPC_URL, "eth_call", [{ to: V.USDC, data: "0x95d89b41" }, "latest"]),
    ]);
    const decimals = Number(BigInt(dec));
    const symbol = new Interface(["function symbol() view returns (string)"]).decodeFunctionResult("symbol", sym)[0];
    add("USDC is real and uses 6 decimals", decimals === 6 && symbol === "USDC", true, `${V.USDC}: ${symbol}, ${decimals} decimals`);
  } catch (e) {
    add("USDC is real and uses 6 decimals", false, true, e.message);
  }

  add("Mainnet wallets exist", Boolean(V.PROVIDER_WALLET && V.EVALUATOR_WALLET), true,
    V.PROVIDER_WALLET && V.EVALUATOR_WALLET ? `provider ${V.PROVIDER_WALLET}, evaluator ${V.EVALUATOR_WALLET}` : "run npm run wallets:mainnet first");

  if (V.PROVIDER_WALLET && V.EVALUATOR_WALLET) {
    const [p, e] = await Promise.all([usdcOf(V, V.PROVIDER_WALLET), usdcOf(V, V.EVALUATOR_WALLET)]).catch(() => [0, 0]);
    add("Provider wallet has 3 USDC", p >= 3, needFunds, `holds ${p.toFixed(2)} USDC; send at least ${Math.max(0, 3 - p).toFixed(2)} more to ${V.PROVIDER_WALLET}`);
    add("Evaluator wallet has 1 USDC", e >= 1, needFunds, `holds ${e.toFixed(2)} USDC; send at least ${Math.max(0, 1 - e).toFixed(2)} more to ${V.EVALUATOR_WALLET}`);
  }

  const { MAINNET_ROSTER } = require(path.join(ROOT, "site/api/_shared.js"));
  const cardsMissing = MAINNET_ROSTER.filter((k) => !fs.existsSync(path.join(ROOT, "site/agents/mainnet", `${k}.json`)));
  add(`All ${MAINNET_ROSTER.length} mainnet agent cards exist`, cardsMissing.length === 0, true,
    cardsMissing.length ? `missing: ${cardsMissing.join(", ")}` : "site/agents/mainnet");

  /* Not blocking: log reads fall back to the RPC (site/api/_logs.js). But the five agents
     that read chain data through the explorer cannot work while it refuses servers. */
  const etherscanStyle = await explorerAnswers(`${V.EXPLORER}/api?module=block&action=eth_block_number`);
  const blockscoutV2 = await explorerAnswers(`${V.EXPLORER}/api/v2/stats`);
  add("Explorer API answers servers", etherscanStyle && blockscoutV2, false,
    etherscanStyle && blockscoutV2 ? "both /api and /api/v2" :
      "blocked (Cloudflare check). Order history uses the RPC instead, and the flip takes the 5 chain-reading agents off the shelf until it opens");

  return { values: V, block, explorerOpen: etherscanStyle && blockscoutV2, checks: out };
}

if (require.main === module) {
  runChecks().then(({ checks }) => {
    console.log("\nStubly mainnet readiness\n");
    for (const c of checks) console.log(`  ${c.ok ? "✓" : c.blocking ? "✗" : "!"} ${c.name}\n      ${c.detail}`);
    const waiting = checks.filter((c) => !c.ok && c.blocking);
    console.log(waiting.length
      ? `\nNot ready. Waiting on: ${waiting.map((c) => c.name).join("; ")}.`
      : "\nReady. Run: npm run mainnet:flip");
    process.exit(waiting.length ? 2 : 0);
  }).catch((e) => { console.error("check failed:", e.message); process.exit(1); });
}

module.exports = { runChecks, mainnetValues, rpc };
