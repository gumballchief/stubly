"use strict";

/**
 * Is Stubly ready to switch to Robinhood Chain? Read-only: it signs nothing, sets nothing,
 * deploys nothing. Run it any time:
 *
 *   npm run mainnet:check
 *
 * It asks the chain itself, not documentation, because the question that matters is
 * whether the contracts are really there and really the ones the code expects.
 * Addresses come from MAINNET_* env vars when set. Otherwise the escrow is Stubly's own
 * deployment (chain/escrow-robinhood.json, from npm run escrow:deploy) and nothing else: nobody else
 * runs a job escrow on Robinhood Chain. The identity registry is the ERC-8004 team's mainnet address.
 * Gas there is ETH, so wallets are checked for ETH as well as USDG.
 */

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const fs = require("fs");
const path = require("path");
const { Interface } = require("ethers");
const { ERC8183_ABI_MIN } = require("./config");

const EIP1967_IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
const ROOT = path.join(__dirname, "..");

/* Stubly's own escrow, once npm run escrow:deploy has finished: Circle's ERC-8183 code with no admin. */
function ownEscrow() {
  try {
    const s = JSON.parse(fs.readFileSync(path.join(__dirname, "escrow-robinhood.json"), "utf8"));
    return s.finishedAt && /^0x[0-9a-fA-F]{40}$/.test(s.escrow || "") ? s : null;
  } catch { return null; }
}

function mainnetValues(env = process.env) {
  const addrOf = (name) => {
    try { return "0x" + JSON.parse(fs.readFileSync(path.join(__dirname, `${name}.keystore.json`), "utf8")).address.replace(/^0x/i, ""); }
    catch { return ""; }
  };
  return {
    CHAIN_ID: 4663,
    RPC_URL: env.MAINNET_RPC_URL || "https://rpc.mainnet.chain.robinhood.com",
    PUBLIC_RPC_URL: env.MAINNET_PUBLIC_RPC_URL || "https://rpc.mainnet.chain.robinhood.com",
    EXPLORER: env.MAINNET_EXPLORER || "https://robinhoodchain.blockscout.com",
    ERC8183: env.MAINNET_ERC8183 || ownEscrow()?.escrow || "",
    /* The ERC-8004 team deploys to one address on every mainnet and another on every testnet. This is
       the mainnet one, live on Robinhood Chain with the same implementation and owner as the testnet registry. */
    IDENTITY_REGISTRY: env.MAINNET_IDENTITY_REGISTRY || "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
    /* The dollar token buyers pay in. On Robinhood Chain that is USDG (Paxos, 6 decimals); the key keeps
       its old name because the whole codebase reads it as "the payment token". */
    USDC: env.MAINNET_USDC || "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
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

const ethOf = async (V, who) => Number(BigInt(await rpc(V.RPC_URL, "eth_getBalance", [who, "latest"]))) / 1e18;
/* Registering 100 identities plus weeks of quotes and submits, at Robinhood Chain's gas price. */
const PROVIDER_MIN_ETH = 0.003;
const EVALUATOR_MIN_ETH = 0.001;

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
    add("Robinhood Chain RPC answers", id === V.CHAIN_ID, true, `${V.RPC_URL} says chain ${id}, block ${block}`);
  } catch (e) {
    add("Robinhood Chain RPC answers", false, true, `${V.RPC_URL}: ${e.message}`);
    return { values: V, block, checks: out };
  }

  const escrowCode = await rpc(V.RPC_URL, "eth_getCode", [V.ERC8183, "latest"]).catch(() => "0x");
  add("ERC-8183 escrow is deployed", hasCode(escrowCode), true,
    hasCode(escrowCode) ? `code at ${V.ERC8183}` : `no escrow yet: run npm run escrow:deploy`);

  /* Stubly's own escrow is only safe to use with nobody able to change it. Its deployer must hold no role;
     npm run escrow:deploy also checked that no one else was ever granted one. */
  const own = ownEscrow();
  if (own && hasCode(escrowCode) && own.escrow.toLowerCase() === V.ERC8183.toLowerCase()) {
    try {
      const roles = new Interface(["function hasRole(bytes32,address) view returns (bool)"]);
      const holds = async (role) => BigInt(await rpc(V.RPC_URL, "eth_call", [{ to: V.ERC8183, data: roles.encodeFunctionData("hasRole", [role, own.deployer]) }, "latest"])) !== 0n;
      const adminRole = require("ethers").keccak256(Buffer.from("ADMIN_ROLE"));
      const still = (await holds("0x" + "00".repeat(32))) || (await holds(adminRole));
      add("Stubly's escrow has no admin", !still, true,
        still ? `deployer ${own.deployer} still holds a role: run npm run escrow:deploy again to finish` : "nobody can upgrade it, charge a fee or add a hook");
    } catch (e) {
      add("Stubly's escrow has no admin", false, true, e.message);
    }
  }

  const idCode = await rpc(V.RPC_URL, "eth_getCode", [V.IDENTITY_REGISTRY, "latest"]).catch(() => "0x");
  add("ERC-8004 identity registry is deployed", hasCode(idCode), true,
    hasCode(idCode) ? `code at ${V.IDENTITY_REGISTRY}` : `no contract at ${V.IDENTITY_REGISTRY} yet (set MAINNET_IDENTITY_REGISTRY if it lives elsewhere)`);

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
    add("USDG is real and uses 6 decimals", decimals === 6 && symbol === "USDG", true, `${V.USDC}: ${symbol}, ${decimals} decimals`);
  } catch (e) {
    add("USDG is real and uses 6 decimals", false, true, e.message);
  }

  add("Mainnet wallets exist", Boolean(V.PROVIDER_WALLET && V.EVALUATOR_WALLET), true,
    V.PROVIDER_WALLET && V.EVALUATOR_WALLET ? `provider ${V.PROVIDER_WALLET}, evaluator ${V.EVALUATOR_WALLET}` : "run npm run wallets:mainnet first");

  if (V.PROVIDER_WALLET && V.EVALUATOR_WALLET) {
    /* USDG is the float (sub-orders, refunds). Gas is ETH, and a wallet with no ETH cannot settle or refund anything. */
    const p = await usdcOf(V, V.PROVIDER_WALLET).catch(() => 0);
    const [pEth, eEth] = await Promise.all([ethOf(V, V.PROVIDER_WALLET), ethOf(V, V.EVALUATOR_WALLET)]).catch(() => [0, 0]);
    add("Provider wallet has 4 USDG", p >= 4, needFunds, `holds ${p.toFixed(2)} USDG; send at least ${Math.max(0, 4 - p).toFixed(2)} more to ${V.PROVIDER_WALLET}`);
    add(`Provider wallet has ${PROVIDER_MIN_ETH} ETH for gas`, pEth >= PROVIDER_MIN_ETH, needFunds, `holds ${pEth.toFixed(5)} ETH on Robinhood Chain (${V.PROVIDER_WALLET})`);
    add(`Evaluator wallet has ${EVALUATOR_MIN_ETH} ETH for gas`, eEth >= EVALUATOR_MIN_ETH, needFunds, `holds ${eEth.toFixed(5)} ETH on Robinhood Chain (${V.EVALUATOR_WALLET})`);
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
