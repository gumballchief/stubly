"use strict";

/**
 * Shared constants for the site's serverless functions. Addresses are public
 * on-chain constants, not secrets. ABI fragments are copied verbatim from the
 * verified contract ABI (chain/erc8183.abi.json) — do not hand-edit shapes.
 */

const { JsonRpcProvider, Contract } = require("ethers");

const CFG = {
  RPC_URL: process.env.RPC_URL || "https://rpc.drpc.testnet.arc.io",
  CHAIN_ID: 5042002,
  ERC8183: "0x0747EEf0706327138c69792bF28Cd525089e4583",
  USDC: "0x3600000000000000000000000000000000000000",
  EXPLORER: "https://testnet.arcscan.app",
  PROVIDER_WALLET: "0x15b9F8a8658E10DaD42ec08CEf158Ca1392a8944",
  EVALUATOR_WALLET: "0x6F5A2E61DA4C779c6b4119F3BfEC8ec53Db488C7",
};

const JOB_STATUS = ["Open", "Funded", "Submitted", "Completed", "Rejected", "Expired"];

const ABI = [
  "function getJob(uint256 jobId) view returns (tuple(uint256 id, address client, address provider, address evaluator, string description, uint256 budget, uint256 expiredAt, uint8 status, address hook))",
  "function jobHasBudget(uint256 jobId) view returns (bool)",
];

// Single source of truth for the roster — shared with worker/catalog.js.
const CATALOG = require("./_catalog.json");

let _provider;
function provider() {
  if (!_provider) _provider = new JsonRpcProvider(CFG.RPC_URL, CFG.CHAIN_ID, { staticNetwork: true });
  return _provider;
}
function jobsContract() { return new Contract(CFG.ERC8183, ABI, provider()); }

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.setHeader("cache-control", "public, s-maxage=5, stale-while-revalidate=15");
  res.end(JSON.stringify(body));
}

module.exports = { CFG, JOB_STATUS, CATALOG, provider, jobsContract, sendJson };
