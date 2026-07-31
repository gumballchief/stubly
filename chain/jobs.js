"use strict";

/**
 * Thin, safe wrappers around Circle's ERC-8183 contract on Arc testnet.
 * Every write is staticCall'd first (keeper rule: a revert should cost a
 * console line, not gas), then sent and awaited to 1 confirmation.
 */

const { Contract, keccak256, toUtf8Bytes } = require("ethers");
const { CFG, ERC20_ABI, JOB_STATUS } = require("./config");
const { erc8183Abi } = require("./abi");

const NO_PARAMS = "0x";

async function contracts(signerOrProvider) {
  const abi = await erc8183Abi();
  return {
    jobs: new Contract(CFG.ERC8183, abi, signerOrProvider),
    usdc: new Contract(CFG.USDC, ERC20_ABI, signerOrProvider),
  };
}

async function send(contract, method, args, label) {
  await contract[method].staticCall(...args); // dry-run: throws with the real revert reason
  const tx = await contract[method](...args);
  const rc = await tx.wait(1);
  console.log(`  ${label}: ${CFG.EXPLORER}/tx/${rc.hash}`);
  return rc;
}

/** Hash any deliverable/reason content into the bytes32 the contract expects. */
function contentHash(text) {
  return keccak256(toUtf8Bytes(text));
}

async function createJob(clientSigner, { providerAddr, evaluatorAddr, expiresInSec, description }) {
  const { jobs } = await contracts(clientSigner);
  const expiredAt = Math.floor(Date.now() / 1000) + expiresInSec;
  const rc = await send(jobs, "createJob", [providerAddr, evaluatorAddr, expiredAt, description, "0x0000000000000000000000000000000000000000"], "createJob");
  // Pull jobId from the JobCreated event
  for (const log of rc.logs) {
    try {
      const parsed = jobs.interface.parseLog(log);
      if (parsed && parsed.name === "JobCreated") return parsed.args.jobId;
    } catch { /* other contracts' logs */ }
  }
  throw new Error("JobCreated event not found in receipt");
}

async function setBudget(providerSigner, jobId, amount) {
  const { jobs } = await contracts(providerSigner);
  await send(jobs, "setBudget", [jobId, amount, NO_PARAMS], "setBudget");
}

async function fund(clientSigner, jobId, amount) {
  const { jobs, usdc } = await contracts(clientSigner);
  const owner = await clientSigner.getAddress();
  const allowance = await usdc.allowance(owner, CFG.ERC8183);
  if (allowance < amount) await send(usdc, "approve", [CFG.ERC8183, amount], "approve");
  await send(jobs, "fund", [jobId, NO_PARAMS], "fund");
}

async function submit(providerSigner, jobId, deliverableText) {
  const { jobs } = await contracts(providerSigner);
  await send(jobs, "submit", [jobId, contentHash(deliverableText), NO_PARAMS], "submit");
}

async function complete(evaluatorSigner, jobId, reasonText) {
  const { jobs } = await contracts(evaluatorSigner);
  await send(jobs, "complete", [jobId, contentHash(reasonText), NO_PARAMS], "complete");
}

async function reject(evaluatorSigner, jobId, reasonText) {
  const { jobs } = await contracts(evaluatorSigner);
  await send(jobs, "reject", [jobId, contentHash(reasonText), NO_PARAMS], "reject");
}

module.exports = { contracts, contentHash, createJob, setBudget, fund, submit, complete, reject, JOB_STATUS };
