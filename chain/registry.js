"use strict";

/**
 * ERC-8004 identity for the house agents.
 *
 * Circle deployed the registries; registering mints an identity NFT per agent
 * whose metadataURI points at that agent's public card. The token id becomes the
 * agent's permanent on-chain id — what the site shows as its verified badge and
 * what other agents look up before hiring one of ours.
 *
 *   node chain/registry.js                       list what is registered
 *   node chain/registry.js --register            register every catalog agent
 *   node chain/registry.js --register a b c      register only these
 */

const { Contract } = require("ethers");
const fs = require("fs");
const path = require("path");
const { CFG, provider, loadWallet } = require("./config");
const jobsLib = require("./jobs");
const CATALOG = require("../worker/catalog");

const REGISTRY = {
  identity: CFG.IDENTITY_REGISTRY,
  reputation: CFG.REPUTATION_REGISTRY,
  validation: CFG.VALIDATION_REGISTRY,
};

const IDENTITY_ABI = [
  "function register(string metadataURI) returns (uint256)",
  "function tokenURI(uint256 tokenId) view returns (string)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
];

/* Identity ids belong to the chain they were minted on. Testnet keeps the original
   filename so everything already reading it carries on working; every other chain
   gets its own file beside it. */
const IDS_FILE = path.join(
  __dirname, "..", "site", "agents",
  CFG.CHAIN_ID === 5042002 ? "ids.json" : "ids." + CFG.CHAIN_ID + ".json"
);
const CARD_BASE = "https://stubly.org/" + CFG.CARD_PATH;

function loadIds() {
  try { return JSON.parse(fs.readFileSync(IDS_FILE, "utf8")); } catch { return {}; }
}

/**
 * Registering is irreversible and the registry has no dedup — call register()
 * twice and the agent is minted twice, with no way to burn the first. So before
 * any of that, prove the wallet, the file and the chain all agree.
 *
 * The failure this exists to stop: run against mainnet with the testnet ids file
 * still in place, and every agent reads as "already registered". Nothing mints,
 * the script exits 0, and the site then advertises testnet token ids as mainnet
 * identities. Silence and a wrong answer, which is worse than a crash.
 */
async function assertChainMatches(prov, ids) {
  /* Ask the node, not the provider. Ours is built with staticNetwork, so
     getNetwork() hands back the chain id we configured rather than the one we are
     actually talking to — which makes the check compare a value to itself and
     pass while pointed at the wrong chain. eth_chainId goes to the node. */
  const live = Number(BigInt(await prov.send("eth_chainId", [])));
  if (live !== CFG.CHAIN_ID) {
    throw new Error(
      "connected to chain " + live + " but configured for " + CFG.CHAIN_ID +
      " — check RPC_URL and CHAIN_ID before minting anything"
    );
  }
  const recorded = ids.__chain;
  if (recorded !== undefined && Number(recorded) !== CFG.CHAIN_ID) {
    throw new Error(
      path.basename(IDS_FILE) + " records chain " + recorded + ", but this run is chain " +
      CFG.CHAIN_ID + ". Refusing to mix identities from two chains in one file."
    );
  }
}

async function main() {
  const doRegister = process.argv.includes("--register");
  const prov = provider();
  const signer = loadWallet("provider", prov);
  const identity = new Contract(REGISTRY.identity, IDENTITY_ABI, signer);

  const ids = loadIds();
  await assertChainMatches(prov, ids);
  ids.__chain = CFG.CHAIN_ID;

  console.log("chain " + CFG.CHAIN_ID + " · registry " + REGISTRY.identity);
  console.log("ids file " + path.basename(IDS_FILE) + " · cards at " + CARD_BASE + "\n");

  /* Only the agents named on the command line, when any are named. Minting all
     hundred on a chain where gas costs real money, for agents nobody has hired
     yet, is not a decision to make by default. */
  const named = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const roster = named.length ? named : Object.keys(CATALOG);

  for (const key of roster) {
    if (!CATALOG[key]) { console.log(key + ": not in the catalog — skipped"); continue; }
    if (ids[key]?.agentId) { console.log(key + ": already registered as agent #" + ids[key].agentId); continue; }
    if (!doRegister) { console.log(key + ": NOT registered (run with --register)"); continue; }

    const uri = CARD_BASE + "/" + key + ".json";
    console.log(key + ": registering → " + uri);
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
    if (!agentId) { console.log("  ⚠ no Transfer event found — check " + CFG.EXPLORER + "/tx/" + rc.hash); continue; }

    ids[key] = { agentId, uri, tx: rc.hash, owner: signer.address };
    fs.writeFileSync(IDS_FILE, JSON.stringify(ids, null, 2));
    console.log("  ✓ agent #" + agentId + " — " + CFG.EXPLORER + "/tx/" + rc.hash);
  }

  console.log("\nidentity registry: " + CFG.EXPLORER + "/address/" + REGISTRY.identity);
}

module.exports = { REGISTRY, IDENTITY_ABI, loadIds, IDS_FILE };

if (require.main === module) {
  main().catch((e) => { console.error("FAILED:", e.shortMessage || e.message); process.exit(1); });
}
