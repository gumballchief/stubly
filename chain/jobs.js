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
/* How long to wait for a confirmation. ethers waits forever by default, and a
   single dropped transaction would then hold its key's queue (below), and every
   later write from that key, forever. */
const WAIT_MS = Number(process.env.TX_WAIT_MS || 180_000);

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

/**
 * Turn "execution reverted (unknown custom error)" into the contract's own name
 * for what went wrong. ERC-8183 reverts entirely through custom errors, so
 * without this every failure looks identical and none of them say anything —
 * WrongStatus() and ExpiryTooShort() are very different problems.
 */
function describeRevert(e, contract) {
  const data = e?.data ?? e?.info?.error?.data ?? e?.error?.data;
  if (typeof data === "string" && data.length >= 10) {
    try {
      const parsed = contract.interface.parseError(data);
      if (parsed) {
        const args = parsed.args.length ? `(${parsed.args.map(String).join(", ")})` : "()";
        return `${parsed.name}${args}`;
      }
    } catch { /* not one of this contract's errors */ }
  }
  return e?.shortMessage || e?.message || String(e);
}

/**
 * One write at a time per signing key, within this process.
 *
 * The settlement loop, the help desk and Launch Kit's sub-orders all sign with the
 * same keys. Two writes racing from one key can pick the same nonce, and then one
 * fails or quietly replaces the other. Queuing each write behind the previous one
 * from that key removes the race here. (Vercel's /api/settle signs from another
 * machine; the escrow's status checks and send()'s retry still cover that case.)
 */
const keyLocks = new Map();
function withKeyLock(address, fn) {
  const key = String(address || "unknown").toLowerCase();
  const run = (keyLocks.get(key) || Promise.resolve()).then(() => fn());
  const tail = run.then(() => {}, () => {});
  keyLocks.set(key, tail);
  tail.then(() => { if (keyLocks.get(key) === tail) keyLocks.delete(key); });
  return run;
}

async function signerAddress(contract) {
  const r = contract.runner;
  if (r?.address) return r.address;
  return typeof r?.getAddress === "function" ? r.getAddress() : "unknown";
}

async function send(contract, method, args, label) {
  // The whole attempt, retries included, holds the key: a retry must not interleave with someone else's write.
  return withKeyLock(await signerAddress(contract), () => sendNow(contract, method, args, label));
}

async function sendNow(contract, method, args, label, attempt = 1) {
  await sleep(1200); // pacing: give the RPC a beat after the previous confirmation
  try {
    await contract[method].staticCall(...args); // dry-run: throws with the real revert reason
    const overrides = await feeOverrides(contract.runner.provider);
    const tx = await contract[method](...args, overrides);
    const rc = await tx.wait(1, WAIT_MS);
    console.log(`  ${label}: ${CFG.EXPLORER}/tx/${rc.hash}`);
    return rc;
  } catch (e) {
    /* A named revert is the contract saying no on purpose. Retrying it three
       more times just spends twelve seconds arriving at the same answer, so
       only the RPC's own flakiness is worth another go. */
    const named = describeRevert(e, contract);
    const isRevert = named !== (e?.shortMessage || e?.message);
    if (!isRevert && attempt < 4) {
      contract.runner?.reset?.(); // NonceManager: drop local nonce state before retrying
      await sleep(3000 * attempt);
      return sendNow(contract, method, args, label, attempt + 1);
    }
    if (isRevert) { e.revertName = named; e.shortMessage = `${label} reverted: ${named}`; }
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
  return send(jobs, "setBudget", [jobId, amount, NO_PARAMS], "setBudget");
}

async function fund(clientSigner, jobId, amount) {
  const { jobs, usdc } = await contracts(clientSigner);
  const owner = await clientSigner.getAddress();
  const allowance = await withRetry(() => usdc.allowance(owner, CFG.ERC8183));
  if (allowance < amount) await send(usdc, "approve", [CFG.ERC8183, amount], "approve");
  return send(jobs, "fund", [jobId, NO_PARAMS], "fund");
}

async function submit(providerSigner, jobId, deliverableText) {
  const { jobs } = await contracts(providerSigner);
  return send(jobs, "submit", [jobId, contentHash(deliverableText), NO_PARAMS], "submit");
}

async function complete(evaluatorSigner, jobId, reasonText) {
  const { jobs } = await contracts(evaluatorSigner);
  return send(jobs, "complete", [jobId, contentHash(reasonText), NO_PARAMS], "complete");
}

async function reject(evaluatorSigner, jobId, reasonText) {
  const { jobs } = await contracts(evaluatorSigner);
  return send(jobs, "reject", [jobId, contentHash(reasonText), NO_PARAMS], "reject");
}

/**
 * The client taking their own money back once the deadline passes. Nobody's
 * permission is needed and nothing of ours is involved — which is the whole
 * reason a crew is one escrow per agent rather than one for the lot.
 */
async function claimRefund(clientSigner, jobId) {
  const { jobs } = await contracts(clientSigner);
  return send(jobs, "claimRefund", [jobId], "claimRefund");
}

/**
 * Settle with an already-computed bytes32 — used to commit the judge-record
 * digest itself, rather than a hash of a label. Anyone can fetch the published
 * record, recompute its digest, and compare it to what is on-chain.
 */
async function completeRaw(evaluatorSigner, jobId, digest32) {
  const { jobs } = await contracts(evaluatorSigner);
  return send(jobs, "complete", [jobId, digest32, NO_PARAMS], "complete");
}

async function rejectRaw(evaluatorSigner, jobId, digest32) {
  const { jobs } = await contracts(evaluatorSigner);
  return send(jobs, "reject", [jobId, digest32, NO_PARAMS], "reject");
}

/**
 * A plain USDC transfer, for the one refund the escrow cannot make: an order that
 * already paid out. Unlike an escrow call, nothing on chain stops a second transfer,
 * so this never builds a second one. It signs exactly one transaction with an
 * explicit nonce, hands it to `claim` to be recorded before anything is sent, and
 * after that only ever re-broadcasts those same signed bytes: the same nonce cannot
 * be mined twice. Any failure after broadcast carries the hash, so whoever looks at
 * it can see whether the money moved instead of guessing.
 */
async function transferUsdc(signer, to, amount, { claim, reserve = 0n } = {}) {
  const { usdc } = await contracts(signer);
  const from = await signerAddress(usdc);
  return withKeyLock(from, async () => {
    const prov = usdc.runner.provider;
    signer.reset?.(); // the shared nonce counter may be stale after writes from elsewhere with this key
    try {
      const balance = await withRetry(() => usdc.balanceOf(from));
      if (balance < amount + reserve) throw Object.assign(new Error("not enough USDC in the refund wallet"), { code: "SHORT" });
      await usdc.transfer.staticCall(to, amount);

      const base = signer.signer || signer; // the Wallet inside the NonceManager
      const [nonce, fees, gas, req] = await Promise.all([
        withRetry(() => prov.getTransactionCount(from, "pending")),
        feeOverrides(prov),
        withRetry(() => usdc.transfer.estimateGas(to, amount)),
        usdc.transfer.populateTransaction(to, amount),
      ]);
      const raw = await base.signTransaction({ to: req.to, data: req.data, nonce, gasLimit: (gas * 12n) / 10n, chainId: CFG.CHAIN_ID, ...fees });
      const hash = keccak256(raw);
      if (claim && !(await claim({ hash, raw, nonce }))) return { claimed: false };

      for (let attempt = 1; attempt <= 3; attempt++) {
        try { await prov.broadcastTransaction(raw); break; } catch (e) {
          if (await prov.getTransaction(hash).catch(() => null)) break; // it got there after all
          if (attempt === 3) throw Object.assign(e, { txHash: hash });
          await sleep(2000 * attempt);
        }
      }
      let rc = null;
      try { rc = await prov.waitForTransaction(hash, 1, WAIT_MS); } catch (e) { throw Object.assign(e, { txHash: hash }); }
      if (!rc) throw Object.assign(new Error("refund not confirmed yet"), { txHash: hash });
      if (rc.status !== 1) throw Object.assign(new Error("refund transaction reverted"), { txHash: hash });
      console.log(`  refund transfer: ${CFG.EXPLORER}/tx/${hash}`);
      return { claimed: true, hash, rc };
    } finally {
      signer.reset?.(); // this nonce was used outside the counter
    }
  });
}

module.exports = {
  contracts, contentHash, createJob, setBudget, fund, submit,
  complete, reject, completeRaw, rejectRaw, claimRefund, transferUsdc, withKeyLock, withRetry, JOB_STATUS,
};
