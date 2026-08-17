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

const ERC20 = [
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address to, uint256 value) returns (bool)",
  "function decimals() view returns (uint8)",
];

/** Gas on Arc is USDC, so the float is also the gas tank. Leave it comfortable. */
const DEFAULT_KEEP = "2";
const DEFAULT_MIN = "10";

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
  const keep = parseUnits(process.env.SWEEP_KEEP || DEFAULT_KEEP, decimals);

  if (balance <= min) {
    return { swept: false, reason: `balance ${formatUnits(balance, decimals)} is under the ${formatUnits(min, decimals)} threshold` };
  }
  const amount = balance - keep;
  if (amount <= 0n) return { swept: false, reason: "nothing above the float" };

  // Never move money on a call that would revert.
  await usdc.transfer.staticCall(to, amount);
  const tx = await usdc.transfer(to, amount);
  await tx.wait(1);

  log(`[sweep] ${formatUnits(amount, decimals)} USDC → ${to}  (kept ${formatUnits(keep, decimals)} for gas)  ${CFG.CFG.EXPLORER}/tx/${tx.hash}`);
  return { swept: true, amount: formatUnits(amount, decimals), to, tx: tx.hash };
}

module.exports = { maybeSweep };
