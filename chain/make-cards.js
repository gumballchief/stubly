"use strict";

/**
 * Generate the public agent cards for a chain.
 *
 * A card is the metadataURI of an agent's ERC-8004 identity token — the thing
 * another agent fetches before deciding whether to hire this one. It is chain-
 * tagged, so a card minted against testnet must keep saying testnet forever;
 * rewriting one in place changes the meaning of a token already minted against
 * it. Each chain therefore gets its own folder.
 *
 * Cards are derived from the catalog, so they cannot drift from what is actually
 * for sale — the previous set was hand-written and had no such guarantee.
 *
 *   node chain/make-cards.js --chain 5042 --out agents/mainnet a b c
 *   node chain/make-cards.js --check          verify existing cards match the catalog
 */

const fs = require("fs");
const path = require("path");
const CATALOG = require("../worker/catalog");

const CHAINS = {
  5042002: { slug: "arc-testnet", dir: "agents", param: "" },
  5042: { slug: "arc", dir: "agents/mainnet", param: "mainnet" },
};

/* Some cards say more than the catalog knows, and it is deliberate. launch-kit
   hires other agents; five agents read the chain rather than a prompt. That is
   exactly what something reading a card before hiring wants to know, so it is not
   drift and has to survive regeneration. Everything else is "service". */
const EXTRA_CAPABILITIES = {
  "launch-kit": ["subcontracting"],
};

const AGENT_TYPES = {
  "launch-kit": "orchestrator",
  "wallet-report": "onchain-analysis",
  "token-report": "onchain-analysis",
  "tx-explain": "onchain-analysis",
  "chain-pulse": "onchain-analysis",
  "agent-lookup": "onchain-analysis",
};

function arg(name, fallback) {
  const i = process.argv.indexOf("--" + name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function card(key, chainId) {
  const a = CATALOG[key];
  const chain = CHAINS[chainId];
  if (!a) throw new Error(key + " is not in the catalog");
  if (!chain) throw new Error("chain " + chainId + " has no card mapping — add one to CHAINS");
  /* Links carry the chain so a card found on its own still lands the buyer on the
     right one. Testnet keeps the bare URL it was originally minted with. */
  const suffix = chain.param ? "&chain=" + chain.param : "";
  return {
    name: a.title,
    description: a.blurb,
    agent_type: AGENT_TYPES[key] || "service",
    capabilities: [key, ...(EXTRA_CAPABILITIES[key] || [])],
    version: "1.0.0",
    pricing: { amount: String(a.priceUsdc), currency: "USDC", per: "job" },
    settlement: { standard: "ERC-8183", chain: chain.slug, chainId },
    endpoint: "https://stubly.org/hire?agent=" + key + suffix,
    provider: "Stubly",
  };
}

function main() {
  const chainId = Number(arg("chain", 5042002));
  const chain = CHAINS[chainId];
  if (!chain) throw new Error("unknown chain " + chainId);
  const outDir = path.join(__dirname, "..", "site", arg("out", chain.dir));
  const named = process.argv.slice(2).filter((a, i, all) => !a.startsWith("--") && !all[i - 1]?.startsWith("--"));
  const roster = named.length ? named : Object.keys(CATALOG);

  if (process.argv.includes("--check")) {
    let drift = 0;
    for (const key of roster) {
      const f = path.join(outDir, key + ".json");
      if (!fs.existsSync(f)) { console.log(key + ": no card"); drift++; continue; }
      const on = fs.readFileSync(f, "utf8").trim();
      const want = JSON.stringify(card(key, chainId), null, 2);
      if (on !== want) { console.log(key + ": card does not match the catalog"); drift++; }
    }
    console.log(drift ? "\n" + drift + " card(s) out of date" : "\nall cards match the catalog");
    process.exit(drift ? 1 : 0);
  }

  fs.mkdirSync(outDir, { recursive: true });
  for (const key of roster) {
    fs.writeFileSync(path.join(outDir, key + ".json"), JSON.stringify(card(key, chainId), null, 2) + "\n");
    console.log("wrote " + path.relative(process.cwd(), path.join(outDir, key + ".json")));
  }
  console.log("\n" + roster.length + " card(s) for chain " + chainId + " (" + chain.slug + ")");
}

module.exports = { card, CHAINS };
if (require.main === module) {
  try { main(); } catch (e) { console.error("FAILED:", e.message); process.exit(1); }
}
