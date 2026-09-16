"use strict";

/**
 * Move earnings off the hot wallet.
 *
 * ERC-8183 pays the `provider` address, and the provider is also the account
 * that has to sign submit() — so the wallet that receives money is unavoidably
 * a wallet whose key is online. That is fine for a few dollars of testnet play
 * money and not fine for real income: today that key exists on a laptop, in
 * GitHub's secrets and in Vercel's environment, and whoever takes any one of
 * them takes the balance.
 *
 * So the hot wallet stops being the vault. It keeps a working float, and
 * anything above that is swept to an address that never signs anything and
 * whose key lives nowhere near a server. Same split exchanges use.
 *
 * Off unless SWEEP_TO is set. Nothing here runs by accident.
 */

const { Contract, formatUnits, parseUnits, isAddress } = require("ethers");
const CFG = require("../chain/config");
const { assertWritable } = require("../chain/jobs");
const { sells } = require("../site/api/_shared");
const launchKit = require("./agents/launch-kit");

const ERC20 = [
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address to, uint256 value) returns (bool)",
  "function decimals() view returns (uint8)",
];

/** Gas on Arc is USDC, so the float is also the gas tank. Leave it comfortable. */
const DEFAULT_KEEP = "2";
const DEFAULT_MIN = "10";
const GAS_BUFFER_USDC = 0.5;
const REFUND_GAS_MARGIN_USDC = 0.1; // worker/desk.js keeps this back on top of every transfer refund

/**
 * The least the hot wallet must still hold after a sweep, whatever SWEEP_KEEP says.
 *
 * The same wallet pays gas, funds Launch Kit's sub-orders up front, and, where the help
 * desk may refund a finished order by transfer, sends that refund. A 2 USDC float swept
 * down to meant the next transfer refund came back "not enough USDC" and went to a
 * person, and the next Launch Kit could not fund its sub-orders.
 */
function requiredFloatUsdc(C = CFG.CFG, env = process.env) {
  // The same switch and default as worker/desk.js: transfer refunds are on by default on testnet only.
  const transfers = env.DESK_TRANSFER_REFUNDS ? env.DESK_TRANSFER_REFUNDS === "on" : Number(C.CHAIN_ID) === 5042002;
  const refund = transfers ? Number(env.DESK_MAX_REFUND_USDC || 25) + REFUND_GAS_MARGIN_USDC : 0;
  const kit = sells(C, "launch-kit") ? launchKit.FLOAT_USDC : 0;
  return GAS_BUFFER_USDC + refund + kit;
}

async function maybeSweep(signer, log = console.log) {
  const to = process.env.SWEEP_TO;
  if (!to) return { swept: false, reason: "SWEEP_TO not set" };
  if (!isAddress(to)) return { swept: false, reason: `SWEEP_TO is not an address: ${to}` };

  const from = await signer.getAddress();
  if (to.toLowerCase() === from.toLowerCase()) {
    return { swept: false, reason: "SWEEP_TO is the hot wallet itself" };
  }

  const usdc = new Contract(CFG.CFG.USDC, ERC20, signer);
  const decimals = await usdc.decimals();
  const balance = await usdc.balanceOf(from);

  const min = parseUnits(process.env.SWEEP_MIN || DEFAULT_MIN, decimals);
  const floor = requiredFloatUsdc();
  const keepUsdc = Math.max(Number(process.env.SWEEP_KEEP || DEFAULT_KEEP), floor);
  const keep = parseUnits(keepUsdc.toFixed(Math.min(6, Number(decimals))), decimals);

  if (balance <= min) {
    return { swept: false, reason: `balance ${formatUnits(balance, decimals)} is under the ${formatUnits(min, decimals)} threshold` };
  }
  const amount = balance - keep;
  if (amount <= 0n) return { swept: false, reason: "nothing above the float" };

  // A transfer to an address with no code "succeeds" and moves nothing; prove the chain first.
  await assertWritable(signer.provider, CFG.CFG);
  // Never move money on a call that would revert.
  await usdc.transfer.staticCall(to, amount);
  const tx = await usdc.transfer(to, amount);
  // Bounded: the sweep runs inside the provider key's write queue, and a dropped transaction must not hold it forever.
  await tx.wait(1, Number(process.env.TX_WAIT_MS || 180_000));

  log(`[sweep] ${formatUnits(amount, decimals)} USDC → ${to}  (kept ${formatUnits(keep, decimals)} for gas, refunds and sub-orders)  ${CFG.CFG.EXPLORER}/tx/${tx.hash}`);
  return { swept: true, amount: formatUnits(amount, decimals), to, tx: tx.hash };
}

module.exports = { maybeSweep, requiredFloatUsdc };
