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
 *   node chain/registry.js --register            register every agent this chain sells
 *   node chain/registry.js --register a b c      register only these
 *
 * On any chain but testnet "every agent this chain sells" is MAINNET_ROSTER, and a
 * key off that roster is refused before anything is minted.
 */

const { Contract, keccak256 } = require("ethers");
const fs = require("fs");
const path = require("path");
const { CFG, provider, loadWallet } = require("./config");
const jobsLib = require("./jobs");
const CATALOG = require("../worker/catalog");
const { MAINNET_ROSTER, sells } = require("../site/api/_shared");

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
const CARD_DIR = path.join(__dirname, "..", "site", CFG.CARD_PATH);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  /* Off testnet the registry address is never defaulted, and a register() sent to an
     address with no code mines "successfully" and mints nothing. */
  if (!REGISTRY.identity) {
    throw new Error("IDENTITY_REGISTRY is not set for chain " + CFG.CHAIN_ID + " — refusing to guess where identities live");
  }
  const code = await prov.send("eth_getCode", [REGISTRY.identity, "latest"]);
  if (!code || code === "0x") {
    throw new Error("no contract code at the identity registry " + REGISTRY.identity + " on chain " + live);
  }
}

/**
 * A card is what an identity says for good: its metadataURI can never be re-pointed.
 * So before anything mints, every card has to be in this chain's folder, name this
 * chain, and already be live at the exact URL that goes on-chain. One bad card stops
 * the whole run, so nothing half-registers.
 */
async function assertCards(keys) {
  const bad = [];
  for (const key of keys) {
    let local = null;
    try { local = JSON.parse(fs.readFileSync(path.join(CARD_DIR, key + ".json"), "utf8")); } catch { /* reported below */ }
    if (Number(local?.settlement?.chainId) !== CFG.CHAIN_ID) {
      bad.push(key + ": no card for chain " + CFG.CHAIN_ID + " in site/" + CFG.CARD_PATH);
      continue;
    }
    const url = CARD_BASE + "/" + key + ".json";
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      const live = r.ok ? await r.json() : null;
      if (Number(live?.settlement?.chainId) !== CFG.CHAIN_ID) {
        bad.push(key + ": " + url + (r.ok ? " does not name chain " + CFG.CHAIN_ID : " returned HTTP " + r.status) + " (deploy the cards first)");
      }
    } catch (e) {
      bad.push(key + ": " + url + " could not be read (" + e.message + ")");
    }
  }
  if (bad.length) throw new Error("refusing to mint anything:\n  " + bad.join("\n  "));
}

/**
 * Which agents this run covers. Only the agents named on the command line, when any are
 * named. Otherwise what this chain sells: the whole catalog on testnet, MAINNET_ROSTER
 * anywhere else. Minting all hundred where gas costs real money, for agents that chain does
 * not sell, is not a decision to make by default. Registering a key the chain does not sell
 * is refused outright, before a wallet is even opened.
 */
function pickRoster(argv, chainId = CFG.CHAIN_ID) {
  const doRegister = argv.includes("--register");
  const named = argv.slice(2).filter((a) => !a.startsWith("--"));
  const roster = named.length ? named : Number(chainId) === 5042002 ? Object.keys(CATALOG) : [...MAINNET_ROSTER];
  if (doRegister) {
    const notSold = roster.filter((k) => CATALOG[k] && !sells(chainId, k));
    if (notSold.length) {
      throw new Error("not sold on chain " + chainId + ", refusing to register: " + notSold.join(", "));
    }
  }
  return { doRegister, roster };
}

/**
 * Mint one identity, at most once, even across crashes and re-runs.
 *
 * register() has no dedup, so the one thing this must never do is send it twice for the
 * same agent. Sending through withRetry did exactly that: a flaky RPC answer after the
 * transaction was already out made it send a fresh register() on the next nonce, and a
 * crash between the mint and the file write made the re-run do the same.
 *
 * So the transaction is signed here, and its hash, nonce and raw bytes are written to the
 * ids file as pending BEFORE it is broadcast. Everything after that works only with that
 * one transaction: re-broadcasting the same bytes and waiting for the same hash can never
 * mint twice, because one nonce can only ever be used once. A re-run finishes a pending
 * entry instead of minting. The only case it cannot settle on its own, a pending
 * transaction that is nowhere to be found while its nonce has been used, stops for a
 * person rather than guessing: minting again there could be the double mint.
 */
async function mintIdentity(key, uri, { identity, signer, prov, ids, save }) {
  const base = signer.signer || signer; // the Wallet inside the NonceManager
  const from = base.address;
  const link = (h) => (CFG.EXPLORER ? CFG.EXPLORER + "/tx/" + h : h);

  let p = ids[key]?.pending;
  let mined = false;
  if (p) {
    const known = await jobsLib.withRetry(() => prov.getTransaction(p.hash)).catch(() => null);
    const rc = known ? null : await jobsLib.withRetry(() => prov.getTransactionReceipt(p.hash)).catch(() => null);
    mined = !!rc;
    if (!known && !rc) {
      const used = await jobsLib.withRetry(() => prov.getTransactionCount(from, "latest"));
      if (used > p.nonce) {
        throw new Error(
          key + ": pending mint " + p.hash + " is not on chain, but nonce " + p.nonce + " has been used. " +
          "Check " + link(p.hash) + " by hand before anything else; the pending entry is left in place so nothing mints again."
        );
      }
    }
  } else {
    // A revert costs nothing yet: find it before a transaction exists.
    await jobsLib.withRetry(() => identity.register.staticCall(uri));
    const [nonce, fees, gas, req] = await Promise.all([
      jobsLib.withRetry(() => prov.getTransactionCount(from, "pending")),
      jobsLib.feeOverrides(prov),
      jobsLib.withRetry(() => identity.register.estimateGas(uri)),
      identity.register.populateTransaction(uri),
    ]);
    const raw = await base.signTransaction({ to: req.to, data: req.data, nonce, gasLimit: (gas * 12n) / 10n, chainId: Number(CFG.CHAIN_ID), ...fees });
    p = { hash: keccak256(raw), nonce, raw };
    ids[key] = { pending: p, uri, owner: from };
    save(); // on disk before it can exist on chain
  }

  // Same bytes every time: harmless if the node already has it, and it cannot become a second mint.
  if (!mined && !(await prov.getTransaction(p.hash).catch(() => null))) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try { await prov.broadcastTransaction(p.raw); break; } catch (e) {
        if (await prov.getTransaction(p.hash).catch(() => null)) break; // it got there after all
        if (attempt === 3) throw new Error(key + ": could not send " + p.hash + " (" + (e.shortMessage || e.message) + "). It is recorded as pending; run again to finish it.");
        await sleep(2000 * attempt);
      }
    }
  }

  let rc = null;
  try { rc = await prov.waitForTransaction(p.hash, 1, jobsLib.WAIT_MS); } catch { /* reported below */ }
  if (!rc) throw new Error(key + ": mint " + link(p.hash) + " is not confirmed yet. It is recorded as pending; run again to finish it.");
  if (rc.status !== 1) {
    delete ids[key]; // a reverted mint minted nothing, so this agent is free to try again
    save();
    throw new Error(key + ": mint " + link(p.hash) + " reverted, nothing was minted");
  }

  let agentId = null;
  for (const log of rc.logs) {
    if (String(log.address).toLowerCase() !== String(REGISTRY.identity).toLowerCase()) continue;
    try {
      const parsed = identity.interface.parseLog(log);
      if (parsed?.name === "Transfer" && String(parsed.args.to).toLowerCase() === from.toLowerCase()) {
        agentId = parsed.args.tokenId.toString();
        break;
      }
    } catch { /* not an identity event */ }
  }
  // Mined but unreadable: the pending entry stays, so a re-run stops here again instead of minting.
  if (!agentId) throw new Error(key + ": mint " + link(p.hash) + " confirmed but no Transfer to " + from + " was found. Check it by hand.");

  ids[key] = { agentId, uri, tx: p.hash, owner: from };
  save();
  return { agentId, hash: p.hash };
}

async function main() {
  const { doRegister, roster } = pickRoster(process.argv);
  const prov = provider();
  const signer = loadWallet(CFG.PROVIDER_KEY, prov);
  const identity = new Contract(REGISTRY.identity, IDENTITY_ABI, signer);

  const ids = loadIds();
  await assertChainMatches(prov, ids);
  ids.__chain = CFG.CHAIN_ID;

  console.log("chain " + CFG.CHAIN_ID + " · registry " + REGISTRY.identity);
  console.log("ids file " + path.basename(IDS_FILE) + " · cards at " + CARD_BASE + "\n");

  if (doRegister) await assertCards(roster.filter((k) => CATALOG[k] && !ids[k]?.agentId));

  for (const key of roster) {
    if (!CATALOG[key]) { console.log(key + ": not in the catalog — skipped"); continue; }
    if (ids[key]?.agentId) { console.log(key + ": already registered as agent #" + ids[key].agentId); continue; }
    if (!doRegister) {
      console.log(key + (ids[key]?.pending ? ": mint sent as " + ids[key].pending.hash + " but not recorded yet (run with --register to finish it)" : ": NOT registered (run with --register)"));
      continue;
    }

    const uri = CARD_BASE + "/" + key + ".json";
    console.log(key + (ids[key]?.pending ? ": finishing the mint already sent → " : ": registering → ") + uri);
    const { agentId, hash } = await mintIdentity(key, uri, {
      identity, signer, prov, ids, save: () => fs.writeFileSync(IDS_FILE, JSON.stringify(ids, null, 2)),
    });
    console.log("  ✓ agent #" + agentId + " — " + CFG.EXPLORER + "/tx/" + hash);
  }

  console.log("\nidentity registry: " + CFG.EXPLORER + "/address/" + REGISTRY.identity);
}

module.exports = { REGISTRY, IDENTITY_ABI, loadIds, IDS_FILE, pickRoster, mintIdentity };

if (require.main === module) {
  main().catch((e) => { console.error("FAILED:", e.shortMessage || e.message); process.exit(1); });
}
