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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * The free public RPC intermittently returns malformed responses ("could not
 * coalesce error") under rapid sequential calls — reads and writes alike. Every
 * RPC touch goes through withRetry: real reverts fail identically three times,
 * blips succeed on the next attempt.
 */
async function withRetry(fn, attempt = 1) {
  try {
    return await fn();
  } catch (e) {
    if (attempt < 3) {
      await sleep(2500 * attempt);
      return withRetry(fn, attempt + 1);
    }
    throw e;
  }
}

/**
 * Fetch fee values explicitly so ethers never has to guess mid-send — the public
 * RPC's answers to fee queries are the least reliable part of the stack, and a
 * malformed one surfaces as "could not coalesce error". Falls back to legacy
 * gasPrice when EIP-1559 fields are absent.
 */
async function feeOverrides(prov) {
  const fd = await withRetry(() => prov.getFeeData());
  if (fd.maxFeePerGas != null) {
    return { maxFeePerGas: fd.maxFeePerGas * 2n, maxPriorityFeePerGas: fd.maxPriorityFeePerGas ?? 0n };
  }
  return { gasPrice: fd.gasPrice, type: 0 };
}

async function send(contract, method, args, label, attempt = 1) {
  await sleep(1200); // pacing: give the RPC a beat after the previous confirmation
  try {
    await contract[method].staticCall(...args); // dry-run: throws with the real revert reason
    const overrides = await feeOverrides(contract.runner.provider);
    const tx = await contract[method](...args, overrides);
    const rc = await tx.wait(1);
    console.log(`  ${label}: ${CFG.EXPLORER}/tx/${rc.hash}`);
    return rc;
  } catch (e) {
    if (attempt < 4) {
      contract.runner?.reset?.(); // NonceManager: drop local nonce state before retrying
      await sleep(3000 * attempt);
      return send(contract, method, args, label, attempt + 1);
    }
    throw e;
  }
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
  const allowance = await withRetry(() => usdc.allowance(owner, CFG.ERC8183));
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

/**
 * Settle with an already-computed bytes32 — used to commit the judge-record
 * digest itself, rather than a hash of a label. Anyone can fetch the published
 * record, recompute its digest, and compare it to what is on-chain.
 */
async function completeRaw(evaluatorSigner, jobId, digest32) {
  const { jobs } = await contracts(evaluatorSigner);
  await send(jobs, "complete", [jobId, digest32, NO_PARAMS], "complete");
}

async function rejectRaw(evaluatorSigner, jobId, digest32) {
  const { jobs } = await contracts(evaluatorSigner);
  await send(jobs, "reject", [jobId, digest32, NO_PARAMS], "reject");
}

module.exports = {
  contracts, contentHash, createJob, setBudget, fund, submit,
  complete, reject, completeRaw, rejectRaw, withRetry, JOB_STATUS,
};
