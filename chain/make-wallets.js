"use strict";

/**
 * Generate the three TESTNET hot wallets this project needs and save each as an
 * ENCRYPTED keystore (same scrypt format as gold/protocol/airdrop/make-keystore.js):
 *
 *   client.keystore.json     — plays the buyer in e2e tests
 *   provider.keystore.json   — the house-agent / orchestrator wallet (sets budget, submits work)
 *   evaluator.keystore.json  — approves or rejects deliverables
 *
 * Keys are generated fresh in memory and never printed or written in plaintext.
 * Encryption password comes from KEYSTORE_PASSWORD in .env — acceptable for testnet
 * wallets holding faucet money only. Mainnet keys must use the interactive flow.
 * Existing keystores are never overwritten.
 */

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { Wallet } = require("ethers");
const fs = require("fs");
const path = require("path");

const NAMES = ["client", "provider", "evaluator"];

async function main() {
  const pw = process.env.KEYSTORE_PASSWORD;
  if (!pw || pw.length < 12) throw new Error("set KEYSTORE_PASSWORD (12+ chars) in .env first");

  for (const name of NAMES) {
    const file = path.join(__dirname, `${name}.keystore.json`);
    if (fs.existsSync(file)) { console.log(`${name}: already exists, skipping (${file})`); continue; }
    const w = Wallet.createRandom();
    fs.writeFileSync(file, await w.encrypt(pw), { mode: 0o600 });
    console.log(`${name}: ${w.address}`);
  }
  console.log("\nFund these at https://faucet.circle.com (20 USDC per address per 2h).");
  console.log("Gas on Arc is USDC, so the faucet covers both payment and gas.");
}

main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
