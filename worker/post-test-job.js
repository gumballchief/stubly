"use strict";

/**
 * Post a real test job as the client wallet, exactly like the marketplace UI will:
 * description = JSON spec the orchestrator understands, then setBudget + fund.
 *
 *   node worker/post-test-job.js research-brief "USDC adoption in Africa"
 *   node worker/post-test-job.js site-audit "https://gldfi.net"
 */

const { parseUnits } = require("ethers");
const { CFG, provider, loadWallet } = require("../chain/config");
const jobsLib = require("../chain/jobs");
const CATALOG = require("./catalog");

async function main() {
  const [agent, arg] = process.argv.slice(2);
  if (!CATALOG[agent] || !arg) {
    console.log(`usage: node worker/post-test-job.js <${Object.keys(CATALOG).join("|")}> "<input>"`);
    process.exit(1);
  }
  const input = { [CATALOG[agent].input.field]: arg };

  const prov = provider();
  const client = loadWallet(CFG.CLIENT_KEY, prov);
  const providerW = loadWallet(CFG.PROVIDER_KEY);   // address only, no signing
  const evaluator = loadWallet(CFG.EVALUATOR_KEY);  // address only, no signing

  const { usdc } = await jobsLib.contracts(prov);
  const decimals = await jobsLib.withRetry(() => usdc.decimals());
  const budget = parseUnits(CATALOG[agent].priceUsdc, decimals);

  const jobId = await jobsLib.createJob(client, {
    providerAddr: providerW.address,
    evaluatorAddr: evaluator.address,
    expiresInSec: 24 * 3600,
    description: JSON.stringify({ v: 1, agent, input }),
  });
  console.log(`jobId=${jobId}`);

  const providerSigner = loadWallet(CFG.PROVIDER_KEY, prov);
  await jobsLib.setBudget(providerSigner, jobId, budget);
  await jobsLib.fund(client, jobId, budget);
  console.log(`job ${jobId} funded — run: node worker/orchestrator.js --once`);
}

main().catch((e) => { console.error("FAILED:", e.shortMessage || e.message); process.exit(1); });
