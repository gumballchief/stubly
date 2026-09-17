"use strict";

/**
 * Launch day for "pay with $STUBLY": from the token's address to the exact worker settings. Read-only.
 *
 *   npm run pay:launch -- 0xTOKEN            checks and prints
 *   npm run pay:launch -- 0xTOKEN --write    also writes the site's launch files (then commit, push, deploy):
 *        site/token.json      the token and pool; a worker with TOKENPAY=on picks it up within 15 seconds
 *        site/index.html      the homepage $STUBLY section's contract address (data-token)
 *        site/llms.txt        the official contract, for AI search
 *
 * 1. Checks the token: it has code, and 12 to 36 decimals (worker/tokenpay.js needs the last six digits
 *    of an amount to name an order).
 * 2. Finds its USDC pool on Uniswap v4. Anyone can initialize extra pools for a token, and a stray one
 *    was already sitting next to a real Argus launch, so every pool the token has with USDC is listed and
 *    the one holding the most liquidity is taken: the launchpad's own.
 * 3. Prices a 1 USDC job against that pool with the worker's own quote code, so what it prints is what
 *    buyers will be charged.
 * 4. Prints what to paste into Render and Vercel, with the current block as TOKENPAY_START_BLOCK.
 */

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { JsonRpcProvider, Contract, Interface, AbiCoder, keccak256, getAddress, isAddress, zeroPadValue, formatUnits } = require("ethers");

const RPC = process.env.MAINNET_RPC_URL || "https://rpc.mainnet.arc.io";
const USDC = "0x3600000000000000000000000000000000000000";
const POOL_MANAGER = "0x8366a39cc670b4001a1121b8f6a443a643e40951";
const STATE_VIEW = "0xf3334192d15450cdd385c8b70e03f9a6bd9e673b";
const PAY_WALLET_FILE = require("path").join(__dirname, "treasury_mainnet.keystore.json");

const PM = new Interface(["event Initialize(bytes32 indexed id, address indexed currency0, address indexed currency1, uint24 fee, int24 tickSpacing, address hooks, uint160 sqrtPriceX96, int24 tick)"]);
const SV = new Interface(["function getLiquidity(bytes32 poolId) view returns (uint128)"]);
const coder = AbiCoder.defaultAbiCoder();

async function deployBlock(p, addr, latest) {
  /* A token launched minutes ago is found in a short window; only an old one needs the whole chain. */
  const recent = Math.max(0, latest - 200_000);
  const hasCodeThen = await p.send("eth_getCode", [addr, "0x" + recent.toString(16)]);
  let lo = hasCodeThen && hasCodeThen !== "0x" ? 0 : recent, hi = latest;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const code = await p.send("eth_getCode", [addr, "0x" + mid.toString(16)]);
    if (code && code !== "0x") hi = mid; else lo = mid + 1;
  }
  return lo;
}

async function findPool(p, token, fromBlock, latest) {
  const topic = PM.getEvent("Initialize").topicHash;
  const pad = zeroPadValue(token, 32);
  const candidates = [];
  for (let start = fromBlock; start <= latest; start += 5000) {
    const end = Math.min(start + 4999, latest);
    // The token as currency0 and as currency1, asked together: on launch day every second counts.
    const found = await Promise.all([[topic, null, pad], [topic, null, null, pad]].map((topics) => p.getLogs({ address: POOL_MANAGER, topics, fromBlock: start, toBlock: end })));
    {
      for (const l of found.flat()) {
        const ev = PM.parseLog(l);
        const [c0, c1] = [getAddress(ev.args.currency0), getAddress(ev.args.currency1)];
        if (![c0, c1].includes(getAddress(USDC))) continue;
        const id = keccak256(coder.encode(["address", "address", "uint24", "int24", "address"], [c0, c1, ev.args.fee, ev.args.tickSpacing, ev.args.hooks]));
        const liquidity = SV.decodeFunctionResult("getLiquidity", await p.call({ to: STATE_VIEW, data: SV.encodeFunctionData("getLiquidity", [id]) }))[0];
        candidates.push({ id, fee: Number(ev.args.fee), tickSpacing: Number(ev.args.tickSpacing), hooks: getAddress(ev.args.hooks), liquidity, block: l.blockNumber });
      }
    }
  }
  candidates.sort((a, b) => (b.liquidity > a.liquidity ? 1 : b.liquidity < a.liquidity ? -1 : 0));
  return candidates;
}

async function main() {
  const token = process.argv.slice(2).find((a) => isAddress(a));
  if (!token) throw new Error("usage: npm run pay:launch -- 0xTOKEN_ADDRESS");
  const p = new JsonRpcProvider(RPC, 5042, { staticNetwork: true });
  const latest = await p.getBlockNumber();

  const code = await p.getCode(token);
  if (code === "0x") throw new Error(`no contract at ${token} on Arc mainnet`);
  const erc20 = new Contract(token, ["function decimals() view returns (uint8)", "function symbol() view returns (string)", "function name() view returns (string)"], p);
  const [decimals, symbol, name] = await Promise.all([erc20.decimals(), erc20.symbol(), erc20.name().catch(() => "")]);
  console.log(`\n✓ token ${name} ($${symbol}) at ${getAddress(token)}, ${decimals} decimals`);
  if (Number(decimals) < 12 || Number(decimals) > 36) throw new Error(`the token has ${decimals} decimals; paying in it needs 12 to 36`);

  const fromArg = process.argv.indexOf("--from");
  // --from <block> skips finding the token's deploy block, for when the launch block is already known.
  const born = fromArg > 0 && /^\d+$/.test(process.argv[fromArg + 1] || "") ? Number(process.argv[fromArg + 1]) : await deployBlock(p, token, latest);
  const pools = await findPool(p, getAddress(token), born, latest);
  if (!pools.length) throw new Error(`no Uniswap v4 pool pairs $${symbol} with USDC yet (searched from block ${born})`);
  for (const c of pools) console.log(`  pool fee ${c.fee} · tickSpacing ${c.tickSpacing} · hooks ${c.hooks} · liquidity ${c.liquidity} (block ${c.block})`);
  const pool = pools[0];
  if (pool.liquidity === 0n) throw new Error("every USDC pool for this token is empty; wait for the launch to finish");
  const POOL = `v4:${pool.fee}:${pool.tickSpacing}:${pool.hooks}`;
  console.log(`✓ the launch pool (most liquidity): ${POOL}`);

  const tokenpay = require("../worker/tokenpay");
  const cfg = tokenpay.payConfig({ TOKENPAY: "on", TOKENPAY_TOKEN: token, TOKENPAY_POOL: POOL }, 5042);
  if (!cfg.enabled) throw new Error(`the worker would refuse these settings: ${cfg.reason}`);
  const needed = await tokenpay._test.tokensForUsdc(cfg, p, USDC, 1_000_000n);
  const charged = (needed * (10_000n - cfg.discountBps)) / 10_000n;
  const fmt = (v) => Number(formatUnits(v, decimals)).toLocaleString("en-US", { maximumFractionDigits: 2 });
  console.log(`✓ live price: a 1 USDC job sells for ${fmt(needed)} $${symbol}; buyers pay ${fmt(charged)} $${symbol} (${Number(cfg.discountBps) / 100}% off), then it is burned`);

  let payWallet = "";
  try { payWallet = getAddress("0x" + JSON.parse(require("fs").readFileSync(PAY_WALLET_FILE, "utf8")).address.replace(/^0x/i, "")); } catch { /* not on this machine */ }
  if (payWallet) {
    const usdc = new Contract(USDC, ["function balanceOf(address) view returns (uint256)"], p);
    console.log(`✓ pay wallet ${payWallet} holds ${formatUnits(await usdc.balanceOf(payWallet), 6)} USDC`);
  }

  console.log([
    "",
    "Render > stubly-worker > Environment (TREASURY_MAINNET_KEYSTORE_B64 is already there):",
    "  TOKENPAY=on",
    `  TOKENPAY_TOKEN=${getAddress(token)}`,
    `  TOKENPAY_POOL=${POOL}`,
    `  TOKENPAY_START_BLOCK=${latest}`,
    "",
    "Vercel (production), then redeploy:",
    `  MAINNET_PAY_TOKEN=${getAddress(token)}`,
    payWallet ? `  MAINNET_PAY_WALLET=${payWallet}` : "  MAINNET_PAY_WALLET=<the pay wallet address>",
  ].join("\n"));

  if (process.argv.includes("--write")) {
    writeLaunchFiles(require("path").join(__dirname, "..", "site"), { token, symbol, decimals: Number(decimals), pool: POOL, startBlock: latest });
    console.log("\n✓ wrote site/token.json, the homepage contract address and the llms.txt line. Next: commit, push, deploy.");
  }
}

/** The three site edits launch day needs. Safe to run twice: the same address is never written twice. */
function writeLaunchFiles(site, { token, symbol, decimals, pool, startBlock }) {
  const fs = require("fs");
  const path = require("path");
  const ca = getAddress(token);
  fs.writeFileSync(path.join(site, "token.json"), JSON.stringify({ token: ca, symbol, decimals, pool, startBlock, chainId: 5042 }, null, 2) + "\n");

  const indexPath = path.join(site, "index.html");
  const index = fs.readFileSync(indexPath, "utf8");
  if (!/id="stubly-token" data-token="[^"]*"/.test(index)) throw new Error("site/index.html has no #stubly-token section to fill in");
  fs.writeFileSync(indexPath, index.replace(/(id="stubly-token" data-token=")[^"]*(")/, (_, a, b) => a + ca + b));

  const llmsPath = path.join(site, "llms.txt");
  const llms = fs.readFileSync(llmsPath, "utf8");
  if (!llms.includes(ca)) {
    const nl = llms.includes("\r\n") ? "\r\n" : "\n";
    fs.writeFileSync(llmsPath, llms.replace(/\s*$/, "") + nl + nl + `## $${symbol}` + nl + nl +
      `$${symbol} is Stubly's token on Arc mainnet. Official contract: ${ca}. Any job on stubly.org can be paid in $${symbol} for 20% off; the escrow still pays the agent in USDC, and the $${symbol} paid is burned once the job is delivered (returned if it is not). Buy on Argus: https://argus.world/token/${ca}` + nl);
  }
}

if (require.main === module) {
  main().catch((e) => { console.error("\nSTOPPED:", e.shortMessage || e.message); process.exit(1); });
}

module.exports = { findPool, deployBlock, writeLaunchFiles };
