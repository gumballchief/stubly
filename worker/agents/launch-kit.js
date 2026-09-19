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
 *
 * Every sub-order goes to the chain of the order that hired Launch Kit (ctx.chain):
 * /api/settle passes the request's, the worker its own. Built from the process's
 * env instead, a mainnet order on Vercel opened its sub-orders against testnet's
 * escrow address over the mainnet RPC. It is not sold on mainnet at all yet (see
 * MAINNET_ROSTER in site/api/_shared.js), and refuses to spend where it is not sold.
 */

const { JsonRpcProvider, parseUnits } = require("ethers");
const { CFG, provider, loadWallet } = require("../../chain/config");
const jobsLib = require("../../chain/jobs");
const { sells } = require("../../site/api/_shared");

const SUBS = [
  { key: "copy-pack", brief: (p) => ({ product: p }) },
  { key: "thread-writer", brief: (p) => ({ announcement: `Launching: ${p}` }) },
];
const SUB_BUDGET = "0.4"; // paid to each subcontractor out of the 2 USDC fee
/* USDC one run needs on hand in the provider wallet, before gas. Each sub-order is
   funded up front and paid back to the same wallet when it settles; worker/sweep.js
   never sweeps below it on a chain that sells Launch Kit. */
const FLOAT_USDC = SUBS.length * Number(SUB_BUDGET);

async function subcontract(sub, product, wallets, budget, ctx) {
  const { agentWallet, evaluator } = wallets;
  const C = ctx.chain;
  const worker = require(`./${sub.key}`);

  const jobId = await jobsLib.createJob(agentWallet, {
    providerAddr: agentWallet.address,
    evaluatorAddr: evaluator.address,
    expiresInSec: 3600,
    description: JSON.stringify({ v: 1, agent: sub.key, input: sub.brief(product), sub: true }),
  }, C);
  await jobsLib.setBudget(agentWallet, jobId, budget, C);
  await jobsLib.fund(agentWallet, jobId, budget, C);

  const deliverable = await worker.run(sub.brief(product), ctx);

  await jobsLib.submit(agentWallet, jobId, deliverable.content, C);
  await jobsLib.complete(evaluator, jobId, "subcontract-accepted", C);

  return { jobId: jobId.toString(), content: deliverable.content };
}

/**
 * ctx: { chain, provider, providerSigner, evaluatorSigner }, all optional. Given no chain,
 * the worker's own config is used; given a chain without a provider, one is built for it.
 * Signers passed in are reused, so this run shares its caller's nonce counters.
 */
async function run(input, ctx = {}) {
  const product = String(input.product || "").trim();
  if (product.length < 10 || product.length > 500) throw new Error("describe the product in 10–500 chars");

  const C = ctx.chain || CFG;
  if (!sells(C, "launch-kit")) throw new Error(`Launch Kit is not sold on chain ${C.CHAIN_ID}`);
  const prov = ctx.provider || (ctx.chain ? new JsonRpcProvider(C.RPC_URL, C.CHAIN_ID, { staticNetwork: true }) : provider());
  const wallets = {
    agentWallet: ctx.providerSigner || loadWallet(C.PROVIDER_KEY, prov),
    evaluator: ctx.evaluatorSigner || loadWallet(C.EVALUATOR_KEY, prov),
  };
  const subCtx = { ...ctx, chain: C, provider: prov, providerSigner: wallets.agentWallet, evaluatorSigner: wallets.evaluator };
  const { usdc } = await jobsLib.contracts(prov, C);
  const decimals = await jobsLib.withRetry(() => usdc.decimals());
  const budget = parseUnits(SUB_BUDGET, decimals);

  const results = {};
  for (const sub of SUBS) {
    console.log(`  [launch-kit] subcontracting → ${sub.key}`);
    results[sub.key] = await subcontract(sub, product, wallets, budget, subCtx);
  }

  const receipts = SUBS
    .map((s) => `- **${s.key}** — work order #${results[s.key].jobId}, ${SUB_BUDGET} ${CFG.CURRENCY} escrowed and released`)
    .join("\n");

  const content = `# Launch Kit: ${product}

> One agent did not write this. Launch Kit hired two other agents on Stubly,
> paid each through its own escrowed work order, and assembled what they
> delivered. Every payment below is a transaction on ${CFG.CHAIN_NAME}.

## Subcontracted work
${receipts}

Settled through the ERC-8183 escrow at \`${C.ERC8183}\`.

---

${results["copy-pack"]?.content || "*(copy pack unavailable)*"}

---

${results["thread-writer"]?.content || "*(thread pack unavailable)*"}

---
*Assembled by the Launch Kit agent — an agent that hires agents.*
`;
  return { content, contentType: "text/markdown" };
}

module.exports = { key: "launch-kit", title: "Launch Kit", run, FLOAT_USDC };
