"use strict";

/**
 * Deploy Stubly's ERC-8183 escrow on Arc mainnet, and give up every admin power over it.
 *
 *   npm run escrow:deploy -- --dry-run    checks only: nothing is signed, no password asked
 *   npm run escrow:deploy                 deploys (you type DEPLOY, then the mainnet password)
 *
 * Why this exists: Circle has not deployed ERC-8183 on Arc mainnet. The escrow Circle runs on
 * Arc testnet is the ERC-8183 reference implementation (AgenticCommerce behind an ERC1967Proxy),
 * published with the standard under CC0. chain/escrow/*.json is that code, compiled from the source
 * Circle verified, with Circle's exact settings.
 *
 * What a run does, stopping at the first thing that is not exactly right:
 *  1. Proves the bytecode is Circle's: the contract our creation code would produce (an eth_call on
 *     mainnet) is byte for byte the contract Circle runs on testnet, with its one immutable (the
 *     contract's own address) masked. The proxy's code is checked the same way.
 *  2. Deploys the implementation, then the proxy, which initializes it in the same transaction
 *     (payment token USDC, both fees zero), so nobody can initialize it in between.
 *  3. Renounces ADMIN_ROLE and DEFAULT_ADMIN_ROLE. After that nobody, Stubly included, can upgrade
 *     the escrow, set a fee or add a hook. Checked on-chain: the deployer holds no role, and the
 *     contract's own logs show no role was ever granted to anyone else.
 *  4. Writes chain/escrow-mainnet.json. npm run mainnet:check and mainnet:flip use it from then on.
 *
 * Each transaction is signed first and recorded in that file before it is broadcast, so a run that
 * stops half way resumes where it stopped and never deploys twice. The deploy wallet is its own key
 * (npm run wallets:mainnet -- --with-deployer): after step 3 it has no power over anything.
 */

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const {
  JsonRpcProvider, Wallet, Interface, AbiCoder, keccak256, getAddress, dataSlice, ZeroAddress, formatUnits,
} = require("ethers");

const IMPL = require("./escrow/AgenticCommerce.json");
const PROXY = require("./escrow/ERC1967Proxy.json");

const CIRCLE_TESTNET_ESCROW = "0x0747EEf0706327138c69792bF28Cd525089e4583";
const CIRCLE_TESTNET_IMPL = IMPL.circleTestnetContract;
const USDC = "0x3600000000000000000000000000000000000000";
const IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
const STATE_FILE = path.join(__dirname, "escrow-mainnet.json");
const WAIT_MS = 180_000;
const MIN_DEPLOYER_USDC = 0.5; // the whole run costs about 0.25 USDC in gas at today's price

const ESCROW = new Interface([
  "function initialize(address paymentToken_, address treasury_, address admin_)",
  "function renounceRole(bytes32 role, address callerConfirmation)",
  "function hasRole(bytes32 role, address account) view returns (bool)",
  "function ADMIN_ROLE() view returns (bytes32)",
  "function DEFAULT_ADMIN_ROLE() view returns (bytes32)",
  "function paymentToken() view returns (address)",
  "function platformFeeBP() view returns (uint256)",
  "function evaluatorFeeBP() view returns (uint256)",
  "function whitelistedHooks(address) view returns (bool)",
  "function createJob(address provider, address evaluator, uint256 expiredAt, string description, address hook) returns (uint256)",
  "event RoleGranted(bytes32 indexed role, address indexed account, address indexed sender)",
  "event RoleRevoked(bytes32 indexed role, address indexed account, address indexed sender)",
  "error InvalidInitialization()",
]);
const ADMIN_ROLE = keccak256(Buffer.from("ADMIN_ROLE"));
const DEFAULT_ADMIN_ROLE = "0x" + "00".repeat(32);
const coder = AbiCoder.defaultAbiCoder();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Runtime code with the immutables blanked, so the same contract at two addresses compares equal. */
function masked(hex, refs = IMPL.immutableReferences) {
  let s = String(hex || "").replace(/^0x/, "").toLowerCase();
  for (const list of Object.values(refs || {})) {
    for (const { start, length } of list) s = s.slice(0, start * 2) + "0".repeat(length * 2) + s.slice((start + length) * 2);
  }
  return "0x" + s;
}

/** Circle's live escrow on Arc testnet: what ours must be identical to. */
async function circleReference(testnet) {
  const [implRuntime, proxyRuntime] = await Promise.all([testnet.getCode(CIRCLE_TESTNET_IMPL), testnet.getCode(CIRCLE_TESTNET_ESCROW)]);
  if (implRuntime === "0x" || proxyRuntime === "0x") throw new Error("could not read Circle's escrow on Arc testnet; try again in a minute");
  return { implRuntime, proxyRuntime };
}

function readState(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}
function writeState(file, state) {
  fs.writeFileSync(file, JSON.stringify(state, null, 2) + "\n");
}

async function feeOverrides(provider) {
  const fd = await provider.getFeeData();
  if (fd.maxFeePerGas != null) return { maxFeePerGas: fd.maxFeePerGas * 2n, maxPriorityFeePerGas: fd.maxPriorityFeePerGas ?? 0n, type: 2 };
  return { gasPrice: fd.gasPrice, type: 0 };
}

/**
 * The deployment, step by step. Everything it needs is passed in, so the same code runs against a local
 * test chain. `state` is saved after every change; a step already recorded is checked, never repeated.
 */
async function deployEscrow({
  provider, signer, deployerAddress, reference, usdc = USDC, statePath = STATE_FILE,
  chainId = 5042, dryRun = false, stopAfter = null, log = console.log,
}) {
  const live = Number(BigInt(await provider.send("eth_chainId", [])));
  if (live !== chainId) throw new Error(`connected to chain ${live}, expected ${chainId}. Nothing was sent`);
  const me = getAddress(deployerAddress || (await signer.getAddress()));
  const state = readState(statePath) || { chainId, deployer: me };
  if (state.chainId !== chainId) throw new Error(`${statePath} is for chain ${state.chainId}, not ${chainId}. Nothing was sent`);
  if (getAddress(state.deployer) !== me) throw new Error(`${statePath} was started by ${state.deployer}, not ${me}. Nothing was sent`);
  const save = () => writeState(statePath, state);

  /* 1. The code is Circle's, before anything is signed. */
  if (keccak256(masked(reference.implRuntime)) !== IMPL.runtimeMaskedHash) {
    throw new Error("Circle's testnet escrow no longer matches the stored build (Circle may have upgraded it). Nothing was sent");
  }
  const wouldDeploy = await provider.call({ from: me, data: IMPL.bytecode });
  if (masked(wouldDeploy) !== masked(reference.implRuntime)) throw new Error("the stored escrow code does not produce Circle's contract. Nothing was sent");
  if (keccak256(reference.proxyRuntime) !== PROXY.runtimeMaskedHash || !PROXY.bytecode.toLowerCase().includes(reference.proxyRuntime.slice(2).toLowerCase())) {
    throw new Error("the stored proxy code does not contain Circle's proxy. Nothing was sent");
  }
  log("✓ the escrow code is byte-for-byte the contract Circle runs on Arc testnet");

  if (dryRun) {
    const [gas, fees, balance] = await Promise.all([
      provider.estimateGas({ from: me, data: IMPL.bytecode }),
      provider.getFeeData(),
      provider.getBalance(me),
    ]);
    const price = fees.maxFeePerGas ?? fees.gasPrice;
    const total = (gas + 300_000n + 2n * 60_000n) * price;
    return { dryRun: true, deployer: me, estimatedUsdc: Number(formatUnits(total, 18)), deployerUsdc: Number(formatUnits(balance, 18)), state };
  }

  let nextNonce = 0; // never below the last nonce this run used
  /** Sign, record, then broadcast: a run cut off at any point knows exactly what it sent. */
  async function send(key, req) {
    const rec = state[key];
    if (rec?.hash) {
      const rc = await provider.getTransactionReceipt(rec.hash);
      if (rc) {
        if (rc.status !== 1) throw new Error(`${key} transaction ${rec.hash} failed on-chain. Nothing else was sent`);
        return rc;
      }
      const latestNonce = await provider.getTransactionCount(me, "latest");
      if (latestNonce <= rec.nonce) {
        log(`  re-sending ${key} from the last run (${rec.hash})`);
        try { await provider.broadcastTransaction(rec.raw); } catch { /* already known */ }
        const again = await provider.waitForTransaction(rec.hash, 1, WAIT_MS);
        if (!again) throw new Error(`${key} is still not confirmed (${rec.hash}). Run this again in a minute; it will not send twice`);
        if (again.status !== 1) throw new Error(`${key} transaction ${rec.hash} failed on-chain. Nothing else was sent`);
        return again;
      }
      // That nonce went to another transaction, so the recorded one can never land. Sign afresh.
    }
    const [pendingHex, fees, gas] = await Promise.all([
      // Asked of the node directly: ethers caches identical reads for a moment, which handed two back-to-back sends one nonce.
      provider.send("eth_getTransactionCount", [me, "pending"]),
      feeOverrides(provider),
      provider.estimateGas({ ...req, from: me }),
    ]);
    const nonce = Math.max(Number(BigInt(pendingHex)), nextNonce);
    nextNonce = nonce + 1;
    const raw = await signer.signTransaction({ ...req, nonce, chainId, gasLimit: (gas * 12n) / 10n, ...fees });
    const hash = keccak256(raw);
    state[key] = { hash, nonce, raw };
    save();
    for (let attempt = 1; ; attempt++) {
      try { await provider.broadcastTransaction(raw); break; } catch (e) {
        if (await provider.getTransaction(hash).catch(() => null)) break;
        if (attempt === 3) throw new Error(`${key} could not be broadcast: ${e.shortMessage || e.message}. Run this again; it resumes`);
        await sleep(2000 * attempt);
      }
    }
    const rc = await provider.waitForTransaction(hash, 1, WAIT_MS);
    if (!rc) throw new Error(`${key} is not confirmed yet (${hash}). Run this again in a minute; it will not send twice`);
    if (rc.status !== 1) throw new Error(`${key} transaction ${hash} failed on-chain`);
    return rc;
  }

  /* 2a. The implementation. Its constructor locks it, so it can never be initialized directly. */
  if (!state.implementation) {
    log("… deploying the escrow implementation");
    const rc = await send("implementationTx", { data: IMPL.bytecode });
    state.implementation = getAddress(rc.contractAddress);
    state.implementationBlock = rc.blockNumber;
    save();
  }
  const implCode = await provider.getCode(state.implementation);
  if (masked(implCode) !== masked(reference.implRuntime)) throw new Error(`the contract at ${state.implementation} is not Circle's escrow code. Stopped`);
  try {
    await provider.call({ from: me, to: state.implementation, data: ESCROW.encodeFunctionData("initialize", [usdc, me, me]) });
    throw new Error(`the implementation at ${state.implementation} can be initialized directly. Stopped`);
  } catch (e) {
    if (/can be initialized directly/.test(e.message)) throw e;
  }
  log(`✓ implementation ${state.implementation}: Circle's code, locked against direct use`);
  if (stopAfter === "implementation") return state;

  /* 2b. The proxy, initialized in its own constructor: USDC, no fees, the deployer as the only admin for now. */
  if (!state.escrow) {
    log("… deploying the escrow itself");
    const init = ESCROW.encodeFunctionData("initialize", [usdc, me, me]);
    const args = coder.encode(["address", "bytes"], [state.implementation, init]);
    const rc = await send("escrowTx", { data: PROXY.bytecode + args.slice(2) });
    state.escrow = getAddress(rc.contractAddress);
    state.escrowBlock = rc.blockNumber;
    save();
  }
  const escrow = state.escrow;
  const read = async (fn, args = []) => ESCROW.decodeFunctionResult(fn, await provider.call({ to: escrow, data: ESCROW.encodeFunctionData(fn, args) }))[0];
  const proxyCode = await provider.getCode(escrow);
  const slot = await provider.getStorage(escrow, IMPL_SLOT);
  if (proxyCode.toLowerCase() !== reference.proxyRuntime.toLowerCase()) throw new Error(`the contract at ${escrow} is not Circle's proxy code. Stopped`);
  if (getAddress(dataSlice(slot, 12)) !== state.implementation) throw new Error(`the escrow at ${escrow} points at another implementation. Stopped`);
  if (getAddress(await read("paymentToken")) !== getAddress(usdc)) throw new Error("the escrow's payment token is not USDC. Stopped");
  if ((await read("platformFeeBP")) !== 0n || (await read("evaluatorFeeBP")) !== 0n) throw new Error("the escrow charges a fee. Stopped");
  if (await read("whitelistedHooks", [ZeroAddress]) !== true) throw new Error("the escrow does not accept orders without a hook. Stopped");
  log(`✓ escrow ${escrow}: pays in USDC, no fees`);
  if (stopAfter === "escrow") return state;

  /* 3. Give up every admin power. */
  for (const [key, role, name] of [["renounceAdminTx", ADMIN_ROLE, "fee and hook control"], ["renounceDefaultAdminTx", DEFAULT_ADMIN_ROLE, "upgrade control"]]) {
    if (await read("hasRole", [role, me])) {
      log(`… giving up ${name}`);
      await send(key, { to: escrow, data: ESCROW.encodeFunctionData("renounceRole", [role, me]) });
    }
  }

  /* 4. Prove nobody holds a role: not the deployer now, and no one else ever. */
  if (await read("hasRole", [ADMIN_ROLE, me]) || await read("hasRole", [DEFAULT_ADMIN_ROLE, me])) throw new Error("the deployer still holds an admin role. Run this again");
  const latest = await provider.getBlockNumber();
  const granted = new Map();
  for (let start = state.escrowBlock; start <= latest; start += 5000) {
    const logs = await provider.getLogs({ address: escrow, fromBlock: start, toBlock: Math.min(start + 4999, latest) });
    for (const l of logs) {
      let ev;
      try { ev = ESCROW.parseLog(l); } catch { continue; }
      const k = `${ev?.args?.role}:${String(ev?.args?.account).toLowerCase()}`;
      if (ev?.name === "RoleGranted") granted.set(k, (granted.get(k) || 0) + 1);
      if (ev?.name === "RoleRevoked") granted.set(k, (granted.get(k) || 0) - 1);
    }
  }
  const holders = [...granted].filter(([, n]) => n > 0).map(([k]) => k);
  if (holders.length) throw new Error(`someone still holds a role on the escrow: ${holders.join(", ")}. Stopped`);
  if (!granted.size) throw new Error("the escrow's role history could not be read. Run this again");
  for (const role of [ADMIN_ROLE, DEFAULT_ADMIN_ROLE]) {
    for (const who of new Set([...granted.keys()].map((k) => k.split(":")[1]))) {
      if (await read("hasRole", [role, who])) throw new Error(`${who} still holds a role on the escrow. Stopped`);
    }
  }
  log("✓ nobody holds any admin role: the escrow can never be upgraded, charge a fee or take a hook");

  // It takes orders: a createJob simulated from an unrelated address.
  const probe = "0x" + "11".repeat(20);
  const ts = (await provider.getBlock("latest")).timestamp;
  await provider.call({ from: probe, to: escrow, data: ESCROW.encodeFunctionData("createJob", [me, me, BigInt(ts + 3600), "check", ZeroAddress]) });
  log("✓ it accepts orders");

  state.finishedAt = state.finishedAt || new Date().toISOString();
  for (const k of ["implementationTx", "escrowTx", "renounceAdminTx", "renounceDefaultAdminTx"]) if (state[k]) delete state[k].raw;
  save();
  return state;
}

/* ————— the command ————— */

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (a) => { rl.close(); resolve(a.trim()); }));
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const rpcUrl = process.env.MAINNET_RPC_URL || "https://rpc.mainnet.arc.io";
  const provider = new JsonRpcProvider(rpcUrl, 5042, { staticNetwork: true });
  const testnet = new JsonRpcProvider("https://rpc.testnet.arc.io", 5042002, { staticNetwork: true });
  const { fileFor, keystoreAddress, askHidden } = require("./make-mainnet-wallets");

  console.log("\nStubly escrow on Arc mainnet" + (dryRun ? " (dry run: nothing is signed)" : "") + "\n");

  const done = readState(STATE_FILE);
  if (done?.finishedAt) {
    console.log(`Already deployed on ${done.finishedAt}: ${done.escrow}. Nothing to do.`);
    console.log("Next: npm run mainnet:check");
    return;
  }

  const circleOnMainnet = await provider.getCode(CIRCLE_TESTNET_ESCROW);
  if (circleOnMainnet !== "0x" && !args.includes("--anyway")) {
    console.log(`Circle's own escrow is now on mainnet at ${CIRCLE_TESTNET_ESCROW}. Use that instead: nothing to deploy.`);
    console.log("Run npm run mainnet:check. (To deploy Stubly's anyway, add --anyway.)");
    return;
  }

  const deployer = keystoreAddress(fileFor("deployer_mainnet"));
  if (!deployer) {
    if (!dryRun) throw new Error("make the deploy wallet first, in its own terminal window: npm run wallets:mainnet -- --with-deployer");
    console.log("! no deploy wallet yet. Make it with: npm run wallets:mainnet -- --with-deployer\n");
  }
  const reference = await circleReference(testnet);
  const from = deployer || "0x" + "11".repeat(20);

  if (dryRun) {
    const r = await deployEscrow({ provider, deployerAddress: from, reference, dryRun: true });
    console.log(`  cost: about ${r.estimatedUsdc.toFixed(2)} USDC of gas`);
    if (deployer) console.log(`  deploy wallet ${deployer} holds ${r.deployerUsdc.toFixed(2)} USDC${r.deployerUsdc < MIN_DEPLOYER_USDC ? ` (send it at least ${MIN_DEPLOYER_USDC} USDC first)` : ""}`);
    console.log("\nDry run passed. To deploy for real: npm run escrow:deploy");
    return;
  }

  if (!process.stdin.isTTY) throw new Error("run this in its own terminal window; it needs to hide the password");
  const balance = Number(formatUnits(await provider.getBalance(deployer), 18));
  if (balance < MIN_DEPLOYER_USDC && !readState(STATE_FILE)) {
    throw new Error(`the deploy wallet ${deployer} holds ${balance.toFixed(2)} USDC. Send it ${MIN_DEPLOYER_USDC} USDC on Arc mainnet, then run this again`);
  }

  console.log([
    `This deploys Stubly's escrow from ${deployer} (${balance.toFixed(2)} USDC), then gives up every admin power over it.`,
    "After that nobody, Stubly included, can upgrade it, charge a fee or touch what it holds.",
    "It costs about 0.25 USDC of gas.",
    "",
  ].join("\n"));
  if ((await ask("Type DEPLOY to go ahead: ")) !== "DEPLOY") { console.log("Stopped. Nothing was sent."); return; }

  const password = await askHidden("Mainnet password (hidden): ");
  console.log("Opening the deploy wallet (a few seconds)...");
  const wallet = (await Wallet.fromEncryptedJson(fs.readFileSync(fileFor("deployer_mainnet"), "utf8"), password)).connect(provider);
  if (getAddress(wallet.address) !== getAddress(deployer)) throw new Error("that keystore opened to a different address. Nothing was sent");

  const state = await deployEscrow({ provider, signer: wallet, reference });
  console.log([
    "",
    `Done. Stubly's escrow: ${state.escrow}`,
    `Explorer: https://explorer.arc.io/address/${state.escrow}`,
    "Saved to chain/escrow-mainnet.json. The flip uses it automatically.",
    "Next: npm run mainnet:check",
  ].join("\n"));
}

if (require.main === module) {
  main().catch((e) => { console.error("\nSTOPPED:", e.shortMessage || e.message); process.exit(1); });
}

module.exports = { deployEscrow, circleReference, masked, STATE_FILE, ADMIN_ROLE, DEFAULT_ADMIN_ROLE, CIRCLE_TESTNET_ESCROW };
