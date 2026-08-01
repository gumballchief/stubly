"use strict";

/**
 * ERC-8004 identity for the house agents.
 *
 * Circle deployed the registries on Arc testnet; registering mints an identity
 * NFT per agent whose metadataURI points at that agent's public card
 * (https://stubly.org/agents/<key>.json). The token id becomes the agent's
 * permanent on-chain id — what the site shows as its verified badge and what
 * other agents look up before hiring one of ours.
 *
 *   node chain/registry.js            list what is registered
 *   node chain/registry.js --register register any agent missing an id
 */

const { Contract, EventLog } = require("ethers");
const fs = require("fs");
const path = require("path");
const { CFG, provider, loadWallet } = require("./config");
const jobsLib = require("./jobs");
const CATALOG = require("../worker/catalog");

const REGISTRY = {
  identity: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
  reputation: "0x8004B663056A597Dffe9eCcC1965A193B7388713",
  validation: "0x8004Cb1BF31DAf7788923b405b754f57acEB4272",
};

const IDENTITY_ABI = [
  "function register(string metadataURI) returns (uint256)",
  "function tokenURI(uint256 tokenId) view returns (string)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
];

const IDS_FILE = path.join(__dirname, "..", "site", "agents", "ids.json");
const CARD_BASE = "https://stubly.org/agents";

function loadIds() {
  try { return JSON.parse(fs.readFileSync(IDS_FILE, "utf8")); } catch { return {}; }
}

async function main() {
  const doRegister = process.argv.includes("--register");
  const prov = provider();
  const signer = loadWallet("provider", prov);
  const identity = new Contract(REGISTRY.identity, IDENTITY_ABI, signer);
  const ids = loadIds();

  for (const key of Object.keys(CATALOG)) {
    if (ids[key]?.agentId) { console.log(`${key}: already registered as agent #${ids[key].agentId}`); continue; }
    if (!doRegister) { console.log(`${key}: NOT registered (run with --register)`); continue; }

    const uri = `${CARD_BASE}/${key}.json`;
    console.log(`${key}: registering → ${uri}`);
    const rc = await jobsLib.withRetry(async () => {
      const tx = await identity.register(uri);
      return tx.wait(1);
    });

    let agentId = null;
    for (const log of rc.logs) {
      try {
        const parsed = identity.interface.parseLog(log);
        if (parsed?.name === "Transfer") { agentId = parsed.args.tokenId.toString(); break; }
      } catch { /* other contracts' logs */ }
    }
    if (!agentId) { console.log(`  ⚠ no Transfer event found — check ${CFG.EXPLORER}/tx/${rc.hash}`); continue; }

    ids[key] = { agentId, uri, tx: rc.hash, owner: signer.address };
    fs.writeFileSync(IDS_FILE, JSON.stringify(ids, null, 2));
    console.log(`  ✓ agent #${agentId} — ${CFG.EXPLORER}/tx/${rc.hash}`);
  }

  console.log(`\nidentity registry: ${CFG.EXPLORER}/address/${REGISTRY.identity}`);
}

module.exports = { REGISTRY, IDENTITY_ABI, loadIds };

if (require.main === module) {
  main().catch((e) => { console.error("FAILED:", e.shortMessage || e.message); process.exit(1); });
}
