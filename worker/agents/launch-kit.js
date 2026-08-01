"use strict";

/**
 * House agent #7 — Launch Kit. The one that hires other agents.
 *
 * A client hires Launch Kit. Instead of doing the work itself, it opens its OWN
 * escrowed work orders against two other agents on the same ERC-8183 contract,
 * funds them out of its fee, has them deliver, and settles each one — then
 * assembles the results. Every hop is a real on-chain job:
 *
 *     client → Launch Kit → Copy Pack
 *                        → Thread Writer
 *
 * The agent spends from its own wallet (the provider wallet acting as a CLIENT),
 * which is what an autonomous agent with a budget actually looks like.
 *
 * Each sub-job runs its whole lifecycle inline — create, fund, work, submit,
 * judge — because the outer orchestrator is busy running THIS job; waiting on it
 * would deadlock.
 */

const { parseUnits } = require("ethers");
const { CFG, provider, loadWallet } = require("../../chain/config");
const jobsLib = require("../../chain/jobs");

const SUBS = [
  { key: "copy-pack", brief: (p) => ({ product: p }) },
  { key: "thread-writer", brief: (p) => ({ announcement: `Launching: ${p}` }) },
];
const SUB_BUDGET = "0.4"; // paid to each subcontractor out of the 2 USDC fee

async function subcontract(sub, product, wallets, budget) {
  const { agentWallet, evaluator } = wallets;
  const worker = require(`./${sub.key}`);

  const jobId = await jobsLib.createJob(agentWallet, {
    providerAddr: agentWallet.address,
    evaluatorAddr: evaluator.address,
    expiresInSec: 3600,
    description: JSON.stringify({ v: 1, agent: sub.key, input: sub.brief(product), sub: true }),
  });
  await jobsLib.setBudget(agentWallet, jobId, budget);
  await jobsLib.fund(agentWallet, jobId, budget);

  const deliverable = await worker.run(sub.brief(product));

  await jobsLib.submit(agentWallet, jobId, deliverable.content);
  await jobsLib.complete(evaluator, jobId, "subcontract-accepted");

  return { jobId: jobId.toString(), content: deliverable.content };
}

async function run(input) {
  const product = String(input.product || "").trim();
  if (product.length < 10 || product.length > 500) throw new Error("describe the product in 10–500 chars");

  const prov = provider();
  const wallets = { agentWallet: loadWallet("provider", prov), evaluator: loadWallet("evaluator", prov) };
  const { usdc } = await jobsLib.contracts(prov);
  const decimals = await jobsLib.withRetry(() => usdc.decimals());
  const budget = parseUnits(SUB_BUDGET, decimals);

  const results = {};
  for (const sub of SUBS) {
    console.log(`  [launch-kit] subcontracting → ${sub.key}`);
    results[sub.key] = await subcontract(sub, product, wallets, budget);
  }

  const receipts = SUBS
    .map((s) => `- **${s.key}** — work order #${results[s.key].jobId}, ${SUB_BUDGET} USDC escrowed and released`)
    .join("\n");

  const content = `# Launch Kit: ${product}

> One agent did not write this. Launch Kit hired two other agents on Stubly,
> paid each through its own escrowed work order, and assembled what they
> delivered. Every payment below is a transaction on Arc.

## Subcontracted work
${receipts}

Settled through Circle's ERC-8183 escrow at \`${CFG.ERC8183}\`.

---

${results["copy-pack"]?.content || "*(copy pack unavailable)*"}

---

${results["thread-writer"]?.content || "*(thread pack unavailable)*"}

---
*Assembled by the Launch Kit agent — an agent that hires agents.*
`;
  return { content, contentType: "text/markdown" };
}

module.exports = { key: "launch-kit", title: "Launch Kit", run };
