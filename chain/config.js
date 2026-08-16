"use strict";

/**
 * Single source of truth for chain constants and shared helpers.
 * Addresses are Circle's public deployments on Arc testnet — constants, not secrets.
 * Anything that could differ per machine (RPC choice, keystore password) comes from .env.
 */

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { JsonRpcProvider, Wallet, NonceManager } = require("ethers");
const fs = require("fs");
const path = require("path");

const CFG = {
  RPC_URL: process.env.RPC_URL || "https://rpc.testnet.arc.io",
  CHAIN_ID: Number(process.env.CHAIN_ID || 5042002),
  ERC8183: process.env.ERC8183_ADDRESS || "0x0747EEf0706327138c69792bF28Cd525089e4583",
  USDC: process.env.USDC_ADDRESS || "0x3600000000000000000000000000000000000000",
  EXPLORER_API: process.env.EXPLORER_API || "https://testnet.arcscan.app/api/v2",
  EXPLORER: "https://testnet.arcscan.app",
};

// Minimal ABI from Circle's ERC-8183 quickstart. The verified on-chain ABI
// (fetched by abi.js) supersedes this at runtime; this is the offline fallback.
const ERC8183_ABI_MIN = [
  "function createJob(address provider, address evaluator, uint256 expiredAt, string description, address hook) returns (uint256)",
  "function setBudget(uint256 jobId, uint256 amount, bytes optParams)",
  "function fund(uint256 jobId, bytes optParams)",
  "function submit(uint256 jobId, bytes32 deliverable, bytes optParams)",
  "function complete(uint256 jobId, bytes32 reason, bytes optParams)",
  "function reject(uint256 jobId, bytes32 reason, bytes optParams)",
  "event JobCreated(uint256 indexed jobId, address indexed client, address indexed provider, address evaluator, uint256 expiredAt, address hook)",
];

const ERC20_ABI = [
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function approve(address spender, uint256 value) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function transfer(address to, uint256 value) returns (bool)",
];

const JOB_STATUS = ["Open", "Funded", "Submitted", "Completed", "Rejected", "Expired"];

function provider() {
  return new JsonRpcProvider(CFG.RPC_URL, CFG.CHAIN_ID, { staticNetwork: true });
}

/**
 * Load an encrypted keystore created by make-wallets.js. Testnet convenience only.
 * The signer is wrapped in a NonceManager: the load-balanced public RPC can serve
 * a stale nonce right after a confirmation, which surfaces as malformed
 * "could not coalesce" errors — local nonce tracking sidesteps that entirely.
 */
function loadWallet(name, prov) {
  const pw = process.env.KEYSTORE_PASSWORD;
  if (!pw) throw new Error("KEYSTORE_PASSWORD not set in .env");

  /* Locally the keystore is a file. On a host it can't be — the keystores are
     gitignored, so nothing that deploys from the repo will find one. Fall back
     to the same encrypted JSON handed in as base64, which keeps the "encrypted
     keystore, never a bare key" rule intact wherever this runs. */
  const file = path.join(__dirname, `${name}.keystore.json`);
  const b64 = process.env[`${name.toUpperCase()}_KEYSTORE_B64`];
  let json;
  if (fs.existsSync(file)) json = fs.readFileSync(file, "utf8");
  else if (b64) json = Buffer.from(b64, "base64").toString("utf8");
  else throw new Error(`no keystore for "${name}" — run: npm run wallets, or set ${name.toUpperCase()}_KEYSTORE_B64`);

  const w = Wallet.fromEncryptedJsonSync(json, pw);
  if (!prov) return w;
  const managed = new NonceManager(w.connect(prov));
  managed.address = w.address; // convenience for balance checks and job params
  return managed;
}

module.exports = { CFG, ERC8183_ABI_MIN, ERC20_ABI, JOB_STATUS, provider, loadWallet };
