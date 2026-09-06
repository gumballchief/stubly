"use strict";

/**
 * End-to-end proof of the money loop on Arc testnet.
 *
 *   node chain/e2e.js --dry    connectivity only: chain id, contract code, balances
 *   node chain/e2e.js          full lifecycle: create → setBudget → fund → submit →
 *                              complete → verify provider got paid. Prints Arcscan links.
 *
 * Reads the three testnet keystores made by make-wallets.js. Amounts are tiny on
 * purpose (1 USDC budget) so one faucet claim covers many runs.
 */

const { formatUnits, parseUnits } = require("ethers");
const { CFG, provider, loadWallet } = require("./config");
const jobsLib = require("./jobs");

const DRY = process.argv.includes("--dry");

async function main() {
  const prov = provider();
  const net = await prov.getNetwork();
  if (Number(net.chainId) !== CFG.CHAIN_ID) throw new Error(`connected to chain ${net.chainId}, expected ${CFG.CHAIN_ID}`);
  console.log(`connected: chain ${net.chainId} via ${CFG.RPC_URL}`);

  const code = await prov.getCode(CFG.ERC8183);
  if (code === "0x") throw new Error(`no contract code at ERC-8183 address ${CFG.ERC8183}`);
  console.log(`ERC-8183 code present at ${CFG.ERC8183} (${(code.length - 2) / 2} bytes)`);

  const client = loadWallet(CFG.CLIENT_KEY, prov);
  const providerW = loadWallet(CFG.PROVIDER_KEY, prov);
  const evaluator = loadWallet(CFG.EVALUATOR_KEY, prov);

  const { usdc } = await jobsLib.contracts(prov);
  const decimals = await usdc.decimals();
  console.log(`USDC decimals (ERC-20 interface): ${decimals}`);

  for (const [name, w] of [["client", client], ["provider", providerW], ["evaluator", evaluator]]) {
    const erc20Bal = await usdc.balanceOf(w.address);
    const nativeBal = await prov.getBalance(w.address);
    console.log(`${name} ${w.address}  usdc=${formatUnits(erc20Bal, decimals)}  native=${formatUnits(nativeBal, 18)}`);
  }

  if (DRY) { console.log("\ndry run OK — fund wallets at https://faucet.circle.com then run: npm run e2e"); return; }

  const bal = (addr) => jobsLib.withRetry(() => usdc.balanceOf(addr));
  const budget = parseUnits("1", decimals);
  const provBalBefore = await bal(providerW.address);

  console.log("\n— happy path —");
  const jobId = await jobsLib.createJob(client, {
    providerAddr: providerW.address,
    evaluatorAddr: evaluator.address,
    expiresInSec: 3600,
    description: "e2e: research brief demo job",
  });
  console.log(`  jobId=${jobId}`);
  await jobsLib.setBudget(providerW, jobId, budget);
  await jobsLib.fund(client, jobId, budget);
  await jobsLib.submit(providerW, jobId, "e2e-deliverable-v1");
  await jobsLib.complete(evaluator, jobId, "meets-spec");

  const provBalAfter = await bal(providerW.address);
  const earned = provBalAfter - provBalBefore;
  console.log(`  provider earned: ${formatUnits(earned, decimals)} USDC`);
  if (earned <= 0n) throw new Error("provider balance did not increase — settlement failed");

  console.log("\n— reject path —");
  const jobId2 = await jobsLib.createJob(client, {
    providerAddr: providerW.address,
    evaluatorAddr: evaluator.address,
    expiresInSec: 3600,
    description: "e2e: reject/refund demo job",
  });
  const clientBalBefore = await bal(client.address);
  await jobsLib.setBudget(providerW, jobId2, budget);
  await jobsLib.fund(client, jobId2, budget);
  await jobsLib.submit(providerW, jobId2, "e2e-bad-deliverable");
  await jobsLib.reject(evaluator, jobId2, "does-not-meet-spec");
  const clientBalAfter = await bal(client.address);
  console.log(`  client net after reject (should be ~0 delta minus gas): ${formatUnits(clientBalAfter - clientBalBefore, decimals)} USDC`);

  console.log("\nE2E COMPLETE — links above are the proof.");
}

main().catch((e) => { console.error("\nFAILED:", e.shortMessage || e.message); process.exit(1); });
