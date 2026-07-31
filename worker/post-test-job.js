"use strict";

/**
 * Post a real test job as the client wallet, exactly like the marketplace UI will:
 * description = JSON spec the orchestrator understands, then setBudget + fund.
 *
 *   node worker/post-test-job.js research-brief "USDC adoption in Africa"
 *   node worker/post-test-job.js site-audit "https://gldfi.net"
 */

const { parseUnits } = require("ethers");
const { provider, loadWallet } = require("../chain/config");
const jobsLib = require("../chain/jobs");

const PRICES = { "research-brief": "1", "site-audit": "1" };

async function main() {
  const [agent, arg] = process.argv.slice(2);
  if (!PRICES[agent] || !arg) {
    console.log('usage: node worker/post-test-job.js <research-brief|site-audit> "<topic or url>"');
    process.exit(1);
  }
  const input = agent === "site-audit" ? { url: arg } : { topic: arg };

  const prov = provider();
  const client = loadWallet("client", prov);
  const providerW = loadWallet("provider");   // address only, no signing
  const evaluator = loadWallet("evaluator");  // address only, no signing

  const { usdc } = await jobsLib.contracts(prov);
  const decimals = await jobsLib.withRetry(() => usdc.decimals());
  const budget = parseUnits(PRICES[agent], decimals);

  const jobId = await jobsLib.createJob(client, {
    providerAddr: providerW.address,
    evaluatorAddr: evaluator.address,
    expiresInSec: 24 * 3600,
    description: JSON.stringify({ v: 1, agent, input }),
  });
  console.log(`jobId=${jobId}`);

  const providerSigner = loadWallet("provider", prov);
  await jobsLib.setBudget(providerSigner, jobId, budget);
  await jobsLib.fund(client, jobId, budget);
  console.log(`job ${jobId} funded — run: node worker/orchestrator.js --once`);
}

main().catch((e) => { console.error("FAILED:", e.shortMessage || e.message); process.exit(1); });
