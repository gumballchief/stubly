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

const TESTNET_CHAIN_ID = 5042002;
const CHAIN_ID = Number(process.env.CHAIN_ID || TESTNET_CHAIN_ID);
const ON_TESTNET = CHAIN_ID === TESTNET_CHAIN_ID;

/* Testnet's addresses are settled public constants, so they may fill a gap. Any
   other chain gets nothing it did not configure: a worker started with CHAIN_ID=5042
   and a forgotten ERC8183_ADDRESS must refuse to sign (jobs.js checks for code at
   an empty or wrong address), not quietly aim real money at testnet's contract. */
const testnetDefault = (value) => (ON_TESTNET ? value : "");

const CFG = {
  RPC_URL: process.env.RPC_URL || testnetDefault("https://rpc.testnet.arc.io"),
  CHAIN_ID,
  TESTNET: ON_TESTNET,
  /* On Arc the dollar token is also the gas coin, so wallets keep a little of it back for fees. On
     Robinhood Chain gas is ETH: nothing is held back from USDG, and ETH is watched on its own. */
  GAS_IN_PAYMENT_TOKEN: CHAIN_ID === TESTNET_CHAIN_ID || CHAIN_ID === 5042,
  /* What customers are told they are paying with and where. One place, so a reply, a report and a
     prompt can never disagree about it. */
  CURRENCY: CHAIN_ID === TESTNET_CHAIN_ID || CHAIN_ID === 5042 ? "USDC" : "USDG",
  CHAIN_NAME: ON_TESTNET ? "Arc testnet" : CHAIN_ID === 5042 ? "Arc" : "Robinhood Chain",
  GAS_COIN: CHAIN_ID === TESTNET_CHAIN_ID || CHAIN_ID === 5042 ? "USDC" : "ETH",
  ERC8183: process.env.ERC8183_ADDRESS || testnetDefault("0x0747EEf0706327138c69792bF28Cd525089e4583"),
  USDC: process.env.USDC_ADDRESS || testnetDefault("0x3600000000000000000000000000000000000000"),
  EXPLORER_API: process.env.EXPLORER_API || testnetDefault("https://testnet.arcscan.app/api/v2"),
  EXPLORER: process.env.EXPLORER || testnetDefault("https://testnet.arcscan.app"),
  /* Which keystore each role signs with. Mainnet gets its own, because a key
     that has lived on a laptop and in CI does not get to sign for real money —
     and because asking for "provider" by name regardless of chain would quietly
     load the testnet key on mainnet. loadWallet turns these into the matching
     <NAME>_KEYSTORE_B64 env var on a host. */
  PROVIDER_KEY: process.env.PROVIDER_KEY || (ON_TESTNET ? "provider" : "provider_mainnet"),
  EVALUATOR_KEY: process.env.EVALUATOR_KEY || (ON_TESTNET ? "evaluator" : "evaluator_mainnet"),
  CLIENT_KEY: process.env.CLIENT_KEY || (ON_TESTNET ? "client" : "client_mainnet"),
  /* The pay wallet behind "pay with $STUBLY" (worker/tokenpay.js): it holds USDC to fund escrows
     for buyers who pay in the token. Only loaded when TOKENPAY=on. */
  TREASURY_KEY: process.env.TREASURY_KEY || (ON_TESTNET ? "treasury" : "treasury_mainnet"),
  /* Circle deployed the ERC-8004 registries. Env-overridable so mainnet is a
     configuration change, and so a mismatched pair fails loudly rather than
     minting identities into the wrong registry. */
  IDENTITY_REGISTRY: process.env.IDENTITY_REGISTRY || testnetDefault("0x8004A818BFB912233c491871b3d84c89A494BD9e"),
  REPUTATION_REGISTRY: process.env.REPUTATION_REGISTRY || testnetDefault("0x8004B663056A597Dffe9eCcC1965A193B7388713"),
  VALIDATION_REGISTRY: process.env.VALIDATION_REGISTRY || testnetDefault("0x8004Cb1BF31DAf7788923b405b754f57acEB4272"),
  /* Where this chain's agent cards are published. Mainnet cards live in their own
     folder so testnet metadataURIs keep resolving to what was minted against them.
     Defaulted by chain: registry.js builds each identity's permanent metadataURI from
     this, and a mainnet mint pointed at a testnet card could never be re-pointed. */
  CARD_PATH: process.env.CARD_PATH || (ON_TESTNET ? "agents" : CHAIN_ID === 5042 ? "agents/mainnet" : "agents/robinhood"),
};

/* The offline fallback, used whenever the explorer can't be reached (abi.js). The verified ABI
   supersedes it at runtime, but a fallback that can't read an order is not a fallback: the worker
   would keep running while every order failed, refunds included. So every function, event and
   error the worker, the help desk and /api/settle touch is here, copied from the verified
   implementation (AgenticCommerce). getJob's field order must match the verified struct exactly
   (id, client, provider, evaluator, description, budget, expiredAt, status, hook): a wrong order
   would misread every order's status. jobHasBudget is the contract's public mapping getter. */
const ERC8183_ABI_MIN = [
  "function createJob(address provider, address evaluator, uint256 expiredAt, string description, address hook) returns (uint256)",
  "function setBudget(uint256 jobId, uint256 amount, bytes optParams)",
  "function fund(uint256 jobId, bytes optParams)",
  "function submit(uint256 jobId, bytes32 deliverable, bytes optParams)",
  "function complete(uint256 jobId, bytes32 reason, bytes optParams)",
  "function reject(uint256 jobId, bytes32 reason, bytes optParams)",
  "function claimRefund(uint256 jobId)",
  "function getJob(uint256 jobId) view returns (tuple(uint256 id, address client, address provider, address evaluator, string description, uint256 budget, uint256 expiredAt, uint8 status, address hook))",
  "function jobHasBudget(uint256 jobId) view returns (bool)",
  "event JobCreated(uint256 indexed jobId, address indexed client, address indexed provider, address evaluator, uint256 expiredAt, address hook)",
  "event JobFunded(uint256 indexed jobId, address indexed client, uint256 amount)",
  "event JobSubmitted(uint256 indexed jobId, address indexed provider, bytes32 deliverable)",
  "event JobCompleted(uint256 indexed jobId, address indexed evaluator, bytes32 reason)",
  "event JobRejected(uint256 indexed jobId, address indexed rejector, bytes32 reason)",
  "event JobExpired(uint256 indexed jobId)",
  "event Refunded(uint256 indexed jobId, address indexed client, uint256 amount)",
  "error InvalidJob()",
  "error WrongStatus()",
  "error Unauthorized()",
  "error ZeroAddress()",
  "error ExpiryTooShort()",
  "error ZeroBudget()",
  "error ProviderNotSet()",
  "error FeesTooHigh()",
  "error HookNotWhitelisted()",
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
 * Load an encrypted keystore: testnet ones from make-wallets.js, mainnet ones
 * (names ending _mainnet) from make-mainnet-wallets.js.
 * The signer is wrapped in a NonceManager: the load-balanced public RPC can serve
 * a stale nonce right after a confirmation, which surfaces as malformed
 * "could not coalesce" errors — local nonce tracking sidesteps that entirely.
 */
const decrypted = new Map(); // keystore name → decrypted Wallet, see below
function loadWallet(name, prov) {
  /* Mainnet keystores open with their own password, which lives only in a host's
     environment settings. Never the testnet KEYSTORE_PASSWORD from .env, so no one
     leaked value opens both. */
  const mainnet = /_mainnet$/.test(name);
  const pw = process.env[mainnet ? "KEYSTORE_PASSWORD_MAINNET" : "KEYSTORE_PASSWORD"];
  if (!pw) {
    throw new Error(mainnet
      ? "KEYSTORE_PASSWORD_MAINNET not set; it belongs in the host's environment settings, not in .env"
      : "KEYSTORE_PASSWORD not set in .env");
  }

  let w = decrypted.get(name);
  if (!w) {
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

    /* Decrypting is deliberately slow (scrypt) and blocks the whole process while
       it runs: settlement, the support inbox and the help desk chat all stall. So
       each key is decrypted once per process, not once per pass. */
    w = Wallet.fromEncryptedJsonSync(json, pw);
    decrypted.set(name, w);
  }
  if (!prov) return w;
  const managed = new NonceManager(w.connect(prov));
  managed.address = w.address; // convenience for balance checks and job params
  return managed;
}

/**
 * Refuse to run against a chain we are not configured for.
 *
 * CHAIN_ID and the contract addresses come from separate env vars, so nothing
 * stops them disagreeing. Point RPC_URL at one chain while the addresses belong
 * to another and every read returns nothing while every write goes somewhere
 * unintended. On testnet that is merely confusing; with real money it is not.
 *
 * This asks the node rather than the provider. Ours is built with staticNetwork,
 * so getNetwork() hands back the chain id we configured instead of the one we are
 * talking to, which would make this compare a value against itself and pass.
 */
async function assertChain(prov) {
  /* Off testnet nothing is defaulted (see CFG), so a missing value is an empty
     string. Name what is missing instead of failing later on a confusing read. */
  if (!CFG.TESTNET) {
    const missing = [["RPC_URL", CFG.RPC_URL], ["ERC8183_ADDRESS", CFG.ERC8183], ["USDC_ADDRESS", CFG.USDC],
      ["EXPLORER", CFG.EXPLORER], ["EXPLORER_API", CFG.EXPLORER_API]].filter(([, v]) => !v).map(([k]) => k);
    if (missing.length) {
      throw new Error("chain " + CFG.CHAIN_ID + " is not configured (missing " + missing.join(", ") + ") - refusing to touch money");
    }
  }
  const live = Number(BigInt(await prov.send("eth_chainId", [])));
  if (live !== CFG.CHAIN_ID) {
    throw new Error(
      "connected to chain " + live + " but configured for " + CFG.CHAIN_ID +
      " - RPC_URL and CHAIN_ID disagree, refusing to touch money"
    );
  }
  return live;
}

module.exports = { CFG, ERC8183_ABI_MIN, ERC20_ABI, JOB_STATUS, provider, loadWallet, assertChain };
