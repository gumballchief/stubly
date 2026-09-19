"use strict";

/**
 * Rehearse the whole money path on a private copy of Robinhood Chain. No real money, no keys.
 *
 *   npm run rehearse
 *
 * It starts a local Hardhat node forked from the live chain, so USDG is the real USDG contract with its
 * real code, then does what production will do:
 *   1. deploys Stubly's escrow with the same deployEscrow() the real deploy uses (same byte-identity
 *      proof, same admin renounce, same checks);
 *   2. a paid order: create, quote, fund, deliver, complete. The agent wallet must end up with the money;
 *   3. a rejected order: the judge rejects, the buyer must get every cent back;
 *   4. an abandoned order: funded, never delivered, deadline passes, a stranger claims the refund for
 *      the buyer.
 * USDG is a Paxos token with freeze and pause powers. This proves it behaves as a plain ERC-20 inside
 * the escrow before a real dollar goes in. It cannot prove Paxos will never freeze an address.
 *
 * Hardhat is not a dependency of this repo. It is borrowed from ../gold/protocol (HARDHAT_DIR overrides).
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, spawnSync } = require("child_process");
const { JsonRpcProvider, Wallet, Contract, AbiCoder, keccak256, toBeHex, zeroPadValue, parseUnits, formatUnits, ZeroAddress, id } = require("ethers");
const { ERC8183_ABI_MIN, ERC20_ABI, JOB_STATUS } = require("./config");
const { deployEscrow, circleReference } = require("./deploy-escrow");

const FORK_URL = process.env.ROBINHOOD_RPC_URL || "https://rpc.mainnet.chain.robinhood.com";
const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const HARDHAT_DIR = process.env.HARDHAT_DIR || path.join(__dirname, "..", "..", "gold", "protocol");
const PORT = 8555;
const LOCAL_CHAIN_ID = 31337;
const PRICE = parseUnits("1", 6);

const say = (s) => console.log(s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function check(ok, what) {
  if (!ok) throw new Error("FAILED: " + what);
  say("   ✓ " + what);
}

async function startFork() {
  if (!fs.existsSync(path.join(HARDHAT_DIR, "node_modules", "hardhat"))) {
    throw new Error(`Hardhat not found in ${HARDHAT_DIR}. Set HARDHAT_DIR to a folder that has it installed`);
  }
  const child = spawn("npx", ["hardhat", "node", "--fork", FORK_URL, "--port", String(PORT)], {
    cwd: HARDHAT_DIR, shell: process.platform === "win32", stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
  });
  let log = "";
  child.stdout.on("data", (d) => { log += d; });
  child.stderr.on("data", (d) => { log += d; });
  const provider = new JsonRpcProvider(`http://127.0.0.1:${PORT}`, LOCAL_CHAIN_ID, { staticNetwork: true, cacheTimeout: -1 });
  for (let i = 0; i < 60; i++) {
    if (child.exitCode !== null) throw new Error("the local chain stopped: " + log.slice(-600));
    try {
      await provider.send("eth_chainId", []);
      /* Hardhat has no hardfork history for chain 4663, so it refuses to run anything at the forked
         block itself. One local block on top, and "latest" is ours. */
      await provider.send("evm_mine", []);
      return { child, provider };
    } catch { await sleep(1000); }
  }
  child.kill();
  throw new Error("the local chain did not start in a minute: " + log.slice(-600));
}

function stop(child) {
  if (!child || child.exitCode !== null) return;
  // npx runs through a shell on Windows, so the node it started is a grandchild: take the whole tree down.
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
  else child.kill("SIGTERM");
}

/** Give a wallet USDG by writing its balance straight into the fork's storage. The slot is found, not assumed. */
async function giveUsdg(provider, who, amount) {
  const usdg = new Contract(USDG, ERC20_ABI, provider);
  const coder = AbiCoder.defaultAbiCoder();
  for (let slot = 0; slot < 60; slot++) {
    const key = keccak256(coder.encode(["address", "uint256"], [who, slot]));
    const before = await provider.getStorage(USDG, key);
    await provider.send("hardhat_setStorageAt", [USDG, key, zeroPadValue(toBeHex(amount), 32)]);
    if ((await usdg.balanceOf(who)) === amount) return slot;
    await provider.send("hardhat_setStorageAt", [USDG, key, before]);
  }
  throw new Error("could not find USDG's balance slot");
}

async function main() {
  say("\nStubly money rehearsal on a private copy of Robinhood Chain\n");
  const { child, provider } = await startFork();
  try {
    const forkedFrom = await provider.getBlockNumber();
    say(`── forked at block ${forkedFrom}`);

    const [deployer, buyer, agent, judge, stranger] = Array.from({ length: 5 }, () => Wallet.createRandom().connect(provider));
    for (const w of [deployer, buyer, agent, judge, stranger]) await provider.send("hardhat_setBalance", [w.address, toBeHex(parseUnits("1", 18))]);
    const slot = await giveUsdg(provider, buyer.address, parseUnits("10", 6));
    say(`── test buyer holds 10 USDG (balance slot ${slot})`);

    say("\n── 1. Deploy the escrow exactly as production will");
    const reference = await circleReference(new JsonRpcProvider("https://rpc.testnet.arc.io", 5042002, { staticNetwork: true }));
    const statePath = path.join(os.tmpdir(), `stubly-rehearse-${Date.now()}.json`);
    const state = await deployEscrow({ provider, signer: deployer, reference, usdc: USDG, statePath, chainId: LOCAL_CHAIN_ID, log: (m) => say("   " + m) });
    fs.rmSync(statePath, { force: true });

    const usdg = new Contract(USDG, ERC20_ABI, provider);
    const jobs = new Contract(state.escrow, ERC8183_ABI_MIN, provider);
    const bal = (w) => usdg.balanceOf(w.address);
    const statusOf = async (jobId) => JOB_STATUS[Number((await jobs.getJob(jobId)).status)];
    const wait = async (txp) => (await txp).wait();

    async function open(desc) {
      const now = (await provider.getBlock("latest")).timestamp;
      const rc = await wait(jobs.connect(buyer).createJob(agent.address, judge.address, BigInt(now + 600), desc, ZeroAddress));
      const jobId = rc.logs.map((l) => { try { return jobs.interface.parseLog(l); } catch { return null; } }).find((e) => e?.name === "JobCreated").args.jobId;
      await wait(jobs.connect(agent).setBudget(jobId, PRICE, "0x"));
      await wait(usdg.connect(buyer).approve(state.escrow, PRICE));
      await wait(jobs.connect(buyer).fund(jobId, "0x"));
      return jobId;
    }

    say("\n── 2. A paid order");
    let [b0, a0] = [await bal(buyer), await bal(agent)];
    let jobId = await open("rehearsal: paid");
    check((await statusOf(jobId)) === "Funded", `order #${jobId} is Funded`);
    check((await usdg.balanceOf(state.escrow)) === PRICE, "the escrow holds exactly 1 USDG");
    await wait(jobs.connect(agent).submit(jobId, id("the report"), "0x"));
    await wait(jobs.connect(judge).complete(jobId, id("passed"), "0x"));
    check((await statusOf(jobId)) === "Completed", "it is Completed");
    check((await bal(agent)) - a0 === PRICE, "the agent wallet received the full 1 USDG (no fee taken)");
    check(b0 - (await bal(buyer)) === PRICE, "the buyer paid exactly 1 USDG");

    say("\n── 3. A rejected order");
    b0 = await bal(buyer);
    jobId = await open("rehearsal: rejected");
    await wait(jobs.connect(agent).submit(jobId, id("a bad report"), "0x"));
    await wait(jobs.connect(judge).reject(jobId, id("failed the check"), "0x"));
    check((await statusOf(jobId)) === "Rejected", `order #${jobId} is Rejected`);
    check((await bal(buyer)) === b0, "the buyer got every cent back");

    say("\n── 4. An abandoned order");
    b0 = await bal(buyer);
    jobId = await open("rehearsal: abandoned");
    await provider.send("evm_increaseTime", [700]);
    await provider.send("evm_mine", []);
    await wait(jobs.connect(stranger).claimRefund(jobId));
    check((await statusOf(jobId)) === "Expired", `order #${jobId} is Expired`);
    check((await bal(buyer)) === b0, "a stranger's claim sent the money to the buyer, not to the stranger");
    check((await bal(stranger)) === 0n, "the stranger received nothing");
    check((await usdg.balanceOf(state.escrow)) === 0n, "the escrow is empty again");

    say(`\nRehearsal passed. Agent wallet earned ${formatUnits(await bal(agent), 6)} USDG; nothing real moved.`);
  } finally {
    stop(child);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error("\n" + (e.shortMessage || e.message)); process.exit(1); });
