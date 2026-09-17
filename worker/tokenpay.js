"use strict";

/**
 * Pay with $STUBLY.
 *
 * A buyer can pay for an agent in the token instead of USDC. Circle's escrow only takes
 * USDC, so Stubly's pay wallet stands in as the escrow's client: the owner keeps it topped
 * up with USDC (the token's trading-tax income), and it pays each order's USDC into the
 * escrow exactly as a buyer would. The buyer's tokens wait in the pay wallet until the
 * order settles:
 *   delivered and paid out -> the tokens are burned (sent to 0x…dEaD), or go to TOKENPAY_PAYOUT if
 *                             that names a wallet; never sold;
 *   refunded or expired    -> the escrow hands the USDC back to the pay wallet, and the
 *                             tokens go back to the buyer.
 * Every agent is Stubly's own, so the USDC the pay wallet puts in lands in Stubly's provider
 * wallet. A badly priced order costs tokens, never dollars leaving Stubly.
 *
 * How the buyer pays: Uniswap's Permit2, the canonical deployment on Arc. The buyer approves
 * Permit2 for the token once, then signs each order without gas. The signature names the pay
 * wallet as the only spender, the exact amount, a deadline and the order itself (agent, brief,
 * price), so it cannot be spent on a different order or by anyone else.
 *
 * The order of moves is chosen so a crash never strands anyone:
 *   1. createJob from the pay wallet. No money moves. The description records the buyer,
 *      the token amount, the Permit2 nonce and the deadline, so the chain alone can finish it.
 *   2. setBudget from the provider wallet.
 *   3. pull the tokens with the buyer's signature.
 *   4. fund the escrow from the pay wallet.
 * If 4 cannot happen in time, the tokens go back. Every token move afterwards is looked for in
 * the token's Transfer logs before it is sent: the last six digits of each amount belong to
 * that order alone, so a move that already happened is recognised and never made twice.
 *
 * Paying in the token is TOKENPAY_DISCOUNT_BPS cheaper than the USDC price (20% unless set), so
 * there is a reason to hold it and spend it.
 *
 * Off unless TOKENPAY=on with TOKENPAY_TOKEN and TOKENPAY_POOL set, and a pay wallet keystore
 * (treasury_mainnet on mainnet).
 */

const crypto = require("crypto");
const {
  Contract, Interface, TypedDataEncoder, verifyTypedData, getAddress, isAddress,
  parseUnits, formatUnits, keccak256, toUtf8Bytes, zeroPadValue,
} = require("ethers");
const { CFG, JOB_STATUS } = require("../chain/config");
const jobsLib = require("../chain/jobs");
const CATALOG = require("./catalog");
const { sells, ordersOpen } = require("../site/api/_shared");

const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
/* Where delivered orders' tokens go unless TOKENPAY_PAYOUT names a wallet. Not address(0): launchpad
   tokens (Argus's LaunchToken among them) refuse transfers to it. */
const BURN = "0x000000000000000000000000000000000000dEaD";
/* Uniswap's published quoters on Arc (chain 5042), each confirmed to have code on mainnet. */
const UNISWAP = {
  5042: { v4Quoter: "0x8dc178efb8111bb0973dd9d722ebeff267c98f94", v3Quoter: "0x7dfd4f31be6814d2906bde155c3e1b146eac1468" },
};

const DEADLINE_SEC = 600;          // the escrow deadline every Stubly order gets
const FUND_CUTOFF_SEC = 240;       // closer than this to the deadline, the agent can't finish: give the tokens back
const CLAIM_AFTER_SEC = 900;       // still locked this long past its deadline: take the escrow back ourselves
const GAS_RESERVE_RAW = 300_000n;  // 0.3 USDC the pay wallet keeps for its own gas
const TAG_UNIT = 1_000_000n;       // the last six digits of every token amount identify its order
const MAX_BRIEF = 300;             // the hire page's field allows 300 characters
const KEEP_DAYS = 30;              // finished orders stay in state this long, for limits and the status page
const FINAL = ["abandoned", "paid-out", "returned"];

const ERC20 = new Interface([
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function transfer(address to, uint256 value) returns (bool)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);
const PERMIT2_ABI = [
  "function permitWitnessTransferFrom(((address token, uint256 amount) permitted, uint256 nonce, uint256 deadline) permit, (address to, uint256 requestedAmount) transferDetails, address owner, bytes32 witness, string witnessTypeString, bytes signature)",
  "function nonceBitmap(address owner, uint256 wordPos) view returns (uint256)",
];
const JOB_CREATED = new Interface([
  "event JobCreated(uint256 indexed jobId, address indexed client, address indexed provider, address evaluator, uint256 expiredAt, address hook)",
]);
const V4_QUOTER = new Interface([
  "function quoteExactOutputSingle(((address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) poolKey, bool zeroForOne, uint128 exactAmount, bytes hookData) params) returns (uint256 amountIn, uint256 gasEstimate)",
]);
const V3_QUOTER = new Interface([
  "function quoteExactOutputSingle((address tokenIn, address tokenOut, uint256 amount, uint24 fee, uint160 sqrtPriceLimitX96) params) returns (uint256 amountIn, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
]);

/* What the buyer signs. Permit2 rebuilds the type hash from WITNESS_TYPE_STRING, so the two
   must describe the same struct: referenced types in alphabetical order, as EIP-712 sorts them. */
const TYPES = {
  PermitWitnessTransferFrom: [
    { name: "permitted", type: "TokenPermissions" },
    { name: "spender", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
    { name: "witness", type: "StublyOrder" },
  ],
  StublyOrder: [
    { name: "agent", type: "string" },
    { name: "brief", type: "bytes32" },
    { name: "priceUsdc", type: "uint256" },
  ],
  TokenPermissions: [{ name: "token", type: "address" }, { name: "amount", type: "uint256" }],
};
const WITNESS_TYPE_STRING = "StublyOrder witness)StublyOrder(string agent,bytes32 brief,uint256 priceUsdc)TokenPermissions(address token,uint256 amount)";

const nowSec = () => Math.floor(Date.now() / 1000);
const utcDay = (ms) => new Date(ms).toISOString().slice(0, 10);
const payError = (status, message) => Object.assign(new Error(message), { status });
// Errors reach the health page and the buyer's screen; an RPC error can carry the RPC URL, keys and all.
const errText = (e) => String(e?.shortMessage || e?.message || e).replace(/https?:\/\/\S+/g, "[url]").slice(0, 200);

function payConfig(env = process.env, chainId = CFG.CHAIN_ID) {
  const off = (reason) => ({ enabled: false, reason });
  if (env.TOKENPAY !== "on") return off("TOKENPAY is not on");
  const uni = UNISWAP[Number(chainId)];
  if (!uni) return off(`no Uniswap quoter known for chain ${chainId}`);
  if (!isAddress(env.TOKENPAY_TOKEN || "")) return off("TOKENPAY_TOKEN is not set to a token address");
  const payoutSetting = String(env.TOKENPAY_PAYOUT || "burn").trim();
  const burns = payoutSetting.toLowerCase() === "burn" || payoutSetting.toLowerCase() === BURN.toLowerCase();
  if (!burns && (!isAddress(payoutSetting) || BigInt(payoutSetting) === 0n)) return off('TOKENPAY_PAYOUT must be "burn" or a wallet address');

  const parts = String(env.TOKENPAY_POOL || "").split(":");
  let pool;
  if (parts[0] === "v4" && parts.length === 4 && isAddress(parts[3])) {
    pool = { kind: "v4", fee: Number(parts[1]), tickSpacing: Number(parts[2]), hooks: getAddress(parts[3]) };
  } else if (parts[0] === "v3" && parts.length === 2) {
    pool = { kind: "v3", fee: Number(parts[1]) };
  } else {
    return off("TOKENPAY_POOL must be v4:<fee>:<tickSpacing>:<hooks> or v3:<fee>");
  }
  if (!Number.isInteger(pool.fee) || pool.fee < 0 || pool.fee > 1_000_000) return off("TOKENPAY_POOL fee is out of range");
  if (pool.kind === "v4" && (!Number.isInteger(pool.tickSpacing) || pool.tickSpacing < 1)) return off("TOKENPAY_POOL tickSpacing is out of range");

  const num = (name, fallback, lo, hi) => {
    const v = env[name] === undefined || env[name] === "" ? fallback : Number(env[name]);
    return Number.isFinite(v) && v >= lo && v <= hi ? v : NaN;
  };
  const values = {
    TOKENPAY_DISCOUNT_BPS: num("TOKENPAY_DISCOUNT_BPS", 2000, 0, 5000),
    TOKENPAY_MAX_USDC_PER_DAY: num("TOKENPAY_MAX_USDC_PER_DAY", 25, 0.01, 1_000_000),
    TOKENPAY_MAX_USDC_PER_BUYER_PER_DAY: num("TOKENPAY_MAX_USDC_PER_BUYER_PER_DAY", 10, 0.01, 1_000_000),
    TOKENPAY_MAX_OPEN: num("TOKENPAY_MAX_OPEN", 5, 1, 100),
    TOKENPAY_QUOTE_SEC: num("TOKENPAY_QUOTE_SEC", 180, 60, 300),
    TOKENPAY_LOOKBACK_BLOCKS: num("TOKENPAY_LOOKBACK_BLOCKS", 200_000, 1_000, 5_000_000),
    TOKENPAY_START_BLOCK: num("TOKENPAY_START_BLOCK", 0, 0, Number.MAX_SAFE_INTEGER),
  };
  for (const [k, v] of Object.entries(values)) if (Number.isNaN(v)) return off(`${k} is out of range`);

  return {
    enabled: true, uni, pool,
    token: getAddress(env.TOKENPAY_TOKEN),
    payout: burns ? BURN : getAddress(payoutSetting),
    burns,
    discountBps: BigInt(Math.floor(values.TOKENPAY_DISCOUNT_BPS)),
    capDayRaw: parseUnits(String(values.TOKENPAY_MAX_USDC_PER_DAY), 6),
    capBuyerRaw: parseUnits(String(values.TOKENPAY_MAX_USDC_PER_BUYER_PER_DAY), 6),
    maxOpen: Math.floor(values.TOKENPAY_MAX_OPEN),
    quoteSec: Math.floor(values.TOKENPAY_QUOTE_SEC),
    lookback: Math.floor(values.TOKENPAY_LOOKBACK_BLOCKS),
    startBlock: Math.floor(values.TOKENPAY_START_BLOCK),
  };
}

/** How many tokens must be sold on the pool to get exactly `usdcOutRaw` USDC: the token's real price, fees and tax included. */
async function tokensForUsdc(cfg, prov, usdc, usdcOutRaw) {
  if (cfg.pool.kind === "v4") {
    const [currency0, currency1] = BigInt(usdc) < BigInt(cfg.token) ? [getAddress(usdc), cfg.token] : [cfg.token, getAddress(usdc)];
    const zeroForOne = currency0.toLowerCase() === cfg.token.toLowerCase(); // selling the token
    const data = V4_QUOTER.encodeFunctionData("quoteExactOutputSingle", [[[currency0, currency1, cfg.pool.fee, cfg.pool.tickSpacing, cfg.pool.hooks], zeroForOne, usdcOutRaw, "0x"]]);
    const raw = await jobsLib.withRetry(() => prov.call({ to: cfg.uni.v4Quoter, data }));
    return V4_QUOTER.decodeFunctionResult("quoteExactOutputSingle", raw)[0];
  }
  const data = V3_QUOTER.encodeFunctionData("quoteExactOutputSingle", [[cfg.token, getAddress(usdc), usdcOutRaw, cfg.pool.fee, 0n]]);
  const raw = await jobsLib.withRetry(() => prov.call({ to: cfg.uni.v3Quoter, data }));
  return V3_QUOTER.decodeFunctionResult("quoteExactOutputSingle", raw)[0];
}

const briefHash = (agent, input) => keccak256(toUtf8Bytes(JSON.stringify({ agent, input })));
const domainFor = (chainId) => ({ name: "Permit2", chainId: Number(chainId), verifyingContract: PERMIT2 });
function messageFor(o, token, spender) {
  return {
    permitted: { token, amount: BigInt(o.amount) },
    spender,
    nonce: BigInt(o.nonce),
    deadline: BigInt(o.deadline),
    witness: { agent: o.agent, brief: briefHash(o.agent, o.input), priceUsdc: BigInt(o.priceRaw) },
  };
}
const witnessHash = (o) => TypedDataEncoder.hashStruct("StublyOrder", { StublyOrder: TYPES.StublyOrder },
  { agent: o.agent, brief: briefHash(o.agent, o.input), priceUsdc: BigInt(o.priceRaw) });
const jsonSafe = (v) => JSON.parse(JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x)));

/* ————— the attached worker ————— */

let W = null;            // what the orchestrator hands over; see attach()
const quotes = new Map(); // quoteId -> a price a buyer may sign, in memory only: a restart just means asking again
const running = new Set();
let ticking = false;
let lastError = null;
let lastTickAt = null;

/**
 * ctx: { prov, jobs() , providerSigner, evaluatorSigner, treasurySigner, state, save, withJobLock, busy, runNow }
 * Called once the signers exist. Returns the reason it is off, if it is.
 */
function attach(ctx, env = process.env) {
  const cfg = payConfig(env, CFG.CHAIN_ID);
  W = { cfg, reason: cfg.enabled ? null : cfg.reason };
  if (!cfg.enabled) return W.reason;
  if (!ctx.treasurySigner) { W.reason = ctx.treasuryError || "no pay wallet keystore"; W.cfg = { enabled: false }; return W.reason; }
  const treasuryAddr = getAddress(ctx.treasurySigner.address);
  const ours = [ctx.providerSigner.address, ctx.evaluatorSigner.address].map((a) => a.toLowerCase());
  if (ours.includes(treasuryAddr.toLowerCase())) { W.reason = "the pay wallet must be its own wallet, not the provider or evaluator"; W.cfg = { enabled: false }; return W.reason; }
  if ([...ours, treasuryAddr.toLowerCase()].includes(cfg.payout.toLowerCase())) { W.reason = "TOKENPAY_PAYOUT must be a wallet outside the worker"; W.cfg = { enabled: false }; return W.reason; }

  Object.assign(W, ctx, { treasury: ctx.treasurySigner, treasuryAddr, tokenMeta: null });
  if (!W.state.tokenpay) W.state.tokenpay = { orders: {}, scannedTo: 0 };
  return null;
}

const on = () => !!(W && W.cfg && W.cfg.enabled);
const orders = () => W.state.tokenpay.orders;
const erc20 = (runner) => new Contract(W.cfg.token, ERC20, runner);

async function tokenMeta() {
  if (W.tokenMeta) return W.tokenMeta;
  const c = erc20(W.prov);
  const decimals = Number(await jobsLib.withRetry(() => c.decimals()));
  let symbol = "TOKEN";
  try { symbol = String(await jobsLib.withRetry(() => c.symbol())).replace(/[^\w$.-]/g, "").slice(0, 12) || symbol; } catch { /* a token without symbol() still works */ }
  /* The last six digits of an amount name its order. With fewer than 12 decimals those digits
     are worth something, so such a token is refused rather than silently priced wrong. */
  if (decimals < 12 || decimals > 36) {
    W.cfg = { enabled: false };
    W.reason = `the token has ${decimals} decimals; paying in it needs 12 to 36`;
    throw payError(503, "Paying in the token is switched off right now. You can still pay in USDC.");
  }
  W.tokenMeta = { decimals, symbol };
  return W.tokenMeta;
}

function ready() {
  if (!on()) throw payError(503, "Paying in the token is switched off right now. You can still pay in USDC.");
  return W;
}

function openOrders() { return Object.values(orders()).filter((o) => !FINAL.includes(o.phase)); }
function spentToday(buyer) {
  const day = utcDay(Date.now());
  return Object.values(orders())
    .filter((o) => utcDay(o.at) === day && o.phase !== "abandoned" && (!buyer || o.buyer.toLowerCase() === buyer.toLowerCase()))
    .reduce((s, o) => s + BigInt(o.priceRaw), 0n);
}
function checkLimits(symbol, buyer, priceRaw) {
  if (openOrders().length >= W.cfg.maxOpen) throw payError(429, `A lot of $${symbol} orders are in progress right now. Try again in a few minutes, or pay in USDC.`);
  if (spentToday() + priceRaw > W.cfg.capDayRaw) throw payError(429, `Today's limit for orders paid in $${symbol} is used up. It resets at midnight UTC. You can still pay in USDC.`);
  if (spentToday(buyer) + priceRaw > W.cfg.capBuyerRaw) throw payError(429, `You've reached today's limit for paying in $${symbol}. It resets at midnight UTC. You can still pay in USDC.`);
}

function freshTag() {
  const inUse = new Set([...openOrders(), ...quotes.values()].map((o) => (BigInt(o.amount) % TAG_UNIT).toString()));
  for (;;) {
    const tag = BigInt(crypto.randomInt(1, Number(TAG_UNIT)));
    if (!inUse.has(tag.toString())) return tag;
  }
}

const fmtTokens = (raw, decimals) => {
  const s = formatUnits(raw, decimals);
  const [whole, frac = ""] = s.split(".");
  const cut = frac.slice(0, 4).replace(/0+$/, "");
  return `${Number(whole).toLocaleString("en-US")}${cut ? `.${cut}` : ""}`;
};

/** A price for one order, and the exact Permit2 message the buyer's wallet should sign for it. */
async function quote({ agent, text, buyer } = {}) {
  const w = ready();
  const { decimals, symbol } = await tokenMeta();
  if (!ordersOpen(CFG)) throw payError(403, "This chain is not taking new orders right now.");
  const cat = CATALOG[agent];
  if (!cat || !sells(CFG, agent)) throw payError(400, "That agent isn't sold here.");
  const brief = String(text || "").trim();
  if (!brief) throw payError(400, "Fill in the job field first.");
  if (brief.length > MAX_BRIEF) throw payError(400, `Keep the job field under ${MAX_BRIEF} characters.`);
  if (!isAddress(buyer || "")) throw payError(400, "Connect a wallet first.");
  const buyerAddr = getAddress(buyer);
  if ([w.treasuryAddr, w.cfg.payout].some((a) => a.toLowerCase() === buyerAddr.toLowerCase())) throw payError(400, "That wallet can't pay for orders.");

  const input = { [cat.input.field]: brief };
  const priceRaw = parseUnits(String(cat.priceUsdc), 6);
  checkLimits(symbol, buyerAddr, priceRaw);

  let needed;
  try { needed = await tokensForUsdc(w.cfg, w.prov, CFG.USDC, priceRaw); } catch (e) {
    lastError = `quote: ${errText(e)}`;
    throw payError(503, `The $${symbol} price can't be read from the pool right now. Try again in a minute, or pay in USDC.`);
  }
  if (needed <= 0n) throw payError(503, `The $${symbol} price can't be read from the pool right now. Try again in a minute, or pay in USDC.`);
  const discounted = (needed * (10_000n - w.cfg.discountBps) + 9_999n) / 10_000n;
  const amount = ((discounted + TAG_UNIT - 1n) / TAG_UNIT) * TAG_UNIT + freshTag();

  const token = erc20(w.prov);
  const [balance, allowance] = await Promise.all([
    jobsLib.withRetry(() => token.balanceOf(buyerAddr)),
    jobsLib.withRetry(() => token.allowance(buyerAddr, PERMIT2)),
  ]);
  if (balance < amount) {
    throw payError(402, `This order costs ${fmtTokens(amount, decimals)} $${symbol}, and this wallet holds ${fmtTokens(balance, decimals)}.`);
  }

  const q = {
    id: crypto.randomBytes(12).toString("hex"),
    buyer: buyerAddr, agent, input, priceRaw: priceRaw.toString(), amount: amount.toString(),
    nonce: BigInt("0x" + crypto.randomBytes(31).toString("hex")).toString(),
    deadline: nowSec() + w.cfg.quoteSec,
  };
  quotes.set(q.id, q);
  pruneQuotes();
  return jsonSafe({
    quoteId: q.id,
    token: w.cfg.token, symbol, decimals,
    amount: q.amount, amountText: fmtTokens(amount, decimals),
    priceUsdc: String(cat.priceUsdc),
    discountBps: w.cfg.discountBps,
    deadline: q.deadline,
    permit2: PERMIT2,
    needsApproval: allowance < amount,
    typedData: { domain: domainFor(CFG.CHAIN_ID), types: { ...TYPES }, primaryType: "PermitWitnessTransferFrom", message: messageFor(q, w.cfg.token, w.treasuryAddr) },
  });
}

function pruneQuotes() {
  const now = nowSec();
  for (const [id, q] of quotes) if (q.deadline < now - 60) quotes.delete(id);
  while (quotes.size > 500) quotes.delete(quotes.keys().next().value);
}

/** The buyer signed: check everything again, record the order, and start it. */
async function placeOrder({ quoteId, signature } = {}) {
  const w = ready();
  const { symbol, decimals } = await tokenMeta();
  const q = quotes.get(String(quoteId || ""));
  if (!q) throw payError(410, "That price has expired. Get a new one.");
  if (q.orderId || q.placing) return { orderId: q.id }; // a double click: the same order
  if (nowSec() > q.deadline - 45) throw payError(410, "That price has expired. Get a new one.");

  let signer;
  try { signer = verifyTypedData(domainFor(CFG.CHAIN_ID), TYPES, messageFor(q, w.cfg.token, w.treasuryAddr), String(signature || "")); } catch {
    throw payError(400, "That signature couldn't be read. Try again.");
  }
  if (signer.toLowerCase() !== q.buyer.toLowerCase()) throw payError(400, "That signature is from a different wallet than the one that asked for the price.");
  q.placing = true; // before the first await, so two requests for one quote cannot both place it
  try {
    return await place(w, q, String(signature), symbol, decimals);
  } finally {
    q.placing = false;
  }
}

async function place(w, q, signature, symbol, decimals) {
  checkLimits(symbol, q.buyer, BigInt(q.priceRaw));

  const token = erc20(w.prov);
  const usdc = new Contract(CFG.USDC, ERC20, w.prov);
  const [balance, allowance, float] = await Promise.all([
    jobsLib.withRetry(() => token.balanceOf(q.buyer)),
    jobsLib.withRetry(() => token.allowance(q.buyer, PERMIT2)),
    jobsLib.withRetry(() => usdc.balanceOf(w.treasuryAddr)),
  ]);
  if (allowance < BigInt(q.amount)) throw payError(402, `Your wallet hasn't allowed Permit2 to move $${symbol} yet. Approve it, then sign again.`);
  if (balance < BigInt(q.amount)) throw payError(402, `This order costs ${fmtTokens(BigInt(q.amount), decimals)} $${symbol}, and this wallet holds ${fmtTokens(balance, decimals)}.`);
  if (float < BigInt(q.priceRaw) + GAS_RESERVE_RAW) {
    lastError = "pay wallet is out of USDC";
    throw payError(503, `Paying in $${symbol} is paused right now. You can still pay in USDC.`);
  }

  const fromBlock = await jobsLib.withRetry(() => w.prov.getBlockNumber());
  const { placing, ...fields } = q;
  const o = { ...fields, signature, phase: "accepted", at: Date.now(), fromBlock, attempts: 0 };
  orders()[o.id] = o;
  q.orderId = o.id;
  w.save();
  kick(o);
  return { orderId: o.id };
}

/** Where an order stands, for the buyer's page. Nothing identifying: the id is 24 random hex characters. */
function orderStatus(id) {
  if (!on()) throw payError(503, "Paying in the token is switched off right now.");
  const o = orders()[String(id || "")];
  if (!o) throw payError(404, "No order with that id. If you just signed, nothing moved: try again.");
  const view = {
    accepted: ["Opening your work order", false, false],
    created: ["Pricing your work order", false, false],
    priced: ["Collecting your tokens", false, false],
    recovered: ["Checking your payment", false, false],
    paid: ["Paying the escrow in USDC", false, false],
    funded: ["Paid. The agent is on it", true, false],
    "payout-due": ["Delivered", true, false],
    "paid-out": ["Delivered", true, false],
    "return-due": ["Sending your tokens back", true, true],
    returned: ["Your tokens were sent back", true, true],
    abandoned: ["Not placed. No tokens moved", true, true],
  }[o.phase] || ["Working on it", false, false];
  return {
    phase: o.phase, title: view[0], placed: view[1], failed: view[2],
    jobId: o.jobId || null, note: o.note || null,
    chain: CFG.TESTNET ? "testnet" : "mainnet",
    retrying: o.attempts > 0 && !FINAL.includes(o.phase),
  };
}

/* ————— moving an order along ————— */

async function getJob(jobId) {
  const j = await jobsLib.withRetry(() => W.jobs().getJob(jobId));
  return { status: JOB_STATUS[Number(j.status ?? j[7])] || "?", expiredAt: Number(j.expiredAt ?? j[6]), description: j.description ?? j[4], client: j.client ?? j[1] };
}

/** Transfers of the token from one address to another since a block, oldest first. */
async function transfers(from, to, fromBlock) {
  const latest = await jobsLib.withRetry(() => W.prov.getBlockNumber());
  const topics = [ERC20.getEvent("Transfer").topicHash, zeroPadValue(from, 32), zeroPadValue(to, 32)];
  const out = [];
  for (let start = Math.max(0, Number(fromBlock) || 0); start <= latest; start += 5000) {
    const end = Math.min(start + 4999, latest);
    const logs = await jobsLib.withRetry(() => W.prov.getLogs({ address: W.cfg.token, topics, fromBlock: start, toBlock: end }));
    for (const l of logs) out.push({ value: BigInt(l.data), hash: l.transactionHash });
  }
  return out;
}

/** True while the pay wallet has a transaction the network has not mined: a move it sent may still land. */
async function treasuryPending() {
  const [pending, latest] = await Promise.all([
    jobsLib.withRetry(() => W.prov.getTransactionCount(W.treasuryAddr, "pending")),
    jobsLib.withRetry(() => W.prov.getTransactionCount(W.treasuryAddr, "latest")),
  ]);
  return pending > latest;
}

async function nonceUsed(owner, nonce) {
  const permit2 = new Contract(PERMIT2, PERMIT2_ABI, W.prov);
  const bitmap = await jobsLib.withRetry(() => permit2.nonceBitmap(owner, nonce >> 8n));
  return ((bitmap >> (nonce & 0xffn)) & 1n) === 1n;
}

function describe(o) {
  const { symbol, decimals } = W.tokenMeta;
  return JSON.stringify({
    v: 1, agent: o.agent, input: o.input,
    pay: { token: W.cfg.token, symbol, decimals, amount: o.amount, buyer: o.buyer, nonce: o.nonce, deadline: o.deadline, order: o.id },
  });
}

/** Our createJob for this order, if one reached the chain: a crash between sending and recording must not open a second. */
async function findJobForOrder(o) {
  const latest = await jobsLib.withRetry(() => W.prov.getBlockNumber());
  const topics = [JOB_CREATED.getEvent("JobCreated").topicHash, null, zeroPadValue(W.treasuryAddr, 32)];
  for (let start = o.fromBlock; start <= latest; start += 5000) {
    const logs = await jobsLib.withRetry(() => W.prov.getLogs({ address: CFG.ERC8183, topics, fromBlock: start, toBlock: Math.min(start + 4999, latest) }));
    for (const l of logs) {
      const jobId = BigInt(l.topics[1]).toString();
      const j = await getJob(jobId);
      try { if (JSON.parse(j.description)?.pay?.order === o.id) return jobId; } catch { /* not ours */ }
    }
  }
  return null;
}

/** setBudget unless the job has one, checked inside the job's lock: the settlement pass prices new orders too. */
function priceJob(o) {
  return W.withJobLock(o.jobId, async () => {
    const hasBudget = await jobsLib.withRetry(() => W.jobs().jobHasBudget(o.jobId));
    if (!hasBudget) await jobsLib.setBudget(W.providerSigner, o.jobId, BigInt(o.priceRaw), CFG);
  });
}

async function sendTokens(to, amount, label) {
  const token = new Contract(W.cfg.token, ERC20, W.treasury);
  return jobsLib.send(token, "transfer", [to, amount], label, CFG);
}

async function stepOrder(o) {
  switch (o.phase) {
    case "accepted": {
      if (o.sentCreate) {
        const found = await findJobForOrder(o);
        if (found) { o.jobId = found; o.phase = "created"; return; }
      }
      if (nowSec() > o.deadline - 30) { o.phase = "abandoned"; o.note = "The signature ran out before the order was opened. No tokens moved."; return; }
      o.sentCreate = true; W.save();
      const jobId = await jobsLib.createJob(W.treasury, {
        providerAddr: W.providerSigner.address, evaluatorAddr: W.evaluatorSigner.address, expiresInSec: DEADLINE_SEC, description: describe(o),
      }, CFG);
      o.jobId = jobId.toString(); o.phase = "created";
      return;
    }

    case "created": {
      if (W.busy(o.jobId)) return;
      const j = await getJob(o.jobId);
      if (j.status !== "Open") { o.phase = "priced"; return; }
      await priceJob(o);
      o.phase = "priced";
      return;
    }

    case "priced": {
      // Already here? A crash after the pull and before it was recorded.
      const seen = (await transfers(o.buyer, W.treasuryAddr, o.fromBlock)).find((t) => t.value === BigInt(o.amount));
      if (seen) { o.pullTx = seen.hash; o.received = o.amount; o.phase = "paid"; return; }
      if (!o.pullTx) {
        if (await nonceUsed(o.buyer, BigInt(o.nonce))) {
          if (await treasuryPending()) return;
          o.phase = "abandoned"; o.note = "The payment signature was cancelled from the buyer's wallet. No tokens moved."; return;
        }
        if (nowSec() > o.deadline) { o.phase = "abandoned"; o.note = "The signature ran out before the tokens were collected. No tokens moved."; return; }
        const permit2 = new Contract(PERMIT2, PERMIT2_ABI, W.treasury);
        const rc = await jobsLib.send(permit2, "permitWitnessTransferFrom", [
          [[W.cfg.token, BigInt(o.amount)], BigInt(o.nonce), BigInt(o.deadline)],
          [W.treasuryAddr, BigInt(o.amount)],
          o.buyer, witnessHash(o), WITNESS_TYPE_STRING, o.signature,
        ], "collect tokens", CFG);
        o.pullTx = rc.hash;
      }
      /* What actually arrived, from the receipt. A token that takes a cut on transfers delivers
         less than was signed for, and then the order is not placed: what arrived goes back. */
      const rc = await jobsLib.withRetry(() => W.prov.getTransactionReceipt(o.pullTx));
      if (!rc) return; // not mined yet
      const topic = ERC20.getEvent("Transfer").topicHash;
      const received = rc.logs
        .filter((l) => l.address.toLowerCase() === W.cfg.token.toLowerCase() && l.topics[0] === topic
          && BigInt(l.topics[1]) === BigInt(o.buyer) && BigInt(l.topics[2]) === BigInt(W.treasuryAddr))
        .reduce((s, l) => s + BigInt(l.data), 0n);
      if (received === 0n) { o.phase = "abandoned"; o.note = "The payment moved no tokens."; return; }
      o.received = received.toString();
      if (received < BigInt(o.amount)) { o.phase = "return-due"; o.note = "The token took a cut on the way in, so the order was not placed. What arrived is being sent back."; return; }
      o.phase = "paid";
      return;
    }

    case "recovered": {
      // Found on the chain after a restart, with no signature to collect with.
      const seen = (await transfers(o.buyer, W.treasuryAddr, o.fromBlock)).find((t) => t.value === BigInt(o.amount));
      if (seen) { o.pullTx = seen.hash; o.received = o.amount; o.phase = "paid"; return; }
      if (await treasuryPending()) return;
      if (nowSec() <= o.deadline) return; // a collect sent just before the restart could still land
      o.phase = "abandoned"; o.note = "The tokens were never collected. No tokens moved.";
      return;
    }

    case "paid": {
      if (W.busy(o.jobId)) return;
      const j = await getJob(o.jobId);
      if (j.status !== "Open") { o.phase = "funded"; return; }
      if (nowSec() > j.expiredAt - FUND_CUTOFF_SEC || o.attempts >= 4) {
        o.phase = "return-due"; o.note = "The order couldn't be paid into escrow in time. Your tokens are being sent back.";
        return;
      }
      await priceJob(o);
      await W.withJobLock(o.jobId, () => jobsLib.fund(W.treasury, o.jobId, BigInt(o.priceRaw), CFG));
      o.phase = "funded"; o.attempts = 0; o.error = null;
      W.runNow?.(o.jobId);
      return;
    }

    case "funded": {
      const j = await getJob(o.jobId);
      if (j.status === "Completed") { o.phase = "payout-due"; return; }
      if (j.status === "Rejected" || j.status === "Expired") { o.phase = "return-due"; return; }
      if (["Funded", "Submitted"].includes(j.status) && nowSec() > j.expiredAt + CLAIM_AFTER_SEC && !W.busy(o.jobId)) {
        await W.withJobLock(o.jobId, () => jobsLib.claimRefund(W.treasury, o.jobId, CFG));
        o.phase = "return-due";
      }
      return;
    }

    case "payout-due":
    case "return-due": {
      const payout = o.phase === "payout-due";
      const to = payout ? W.cfg.payout : o.buyer;
      const amount = BigInt(o.received || o.amount);
      const done = (await transfers(W.treasuryAddr, to, o.fromBlock)).find((t) => t.value === amount);
      if (done) { o.settleTx = done.hash; o.phase = payout ? "paid-out" : "returned"; return; }
      if (await treasuryPending()) return; // an earlier send may still land; decide on the next tick
      const rc = await sendTokens(to, amount, payout ? "tokens to payout" : "tokens back to buyer");
      o.settleTx = rc.hash; o.phase = payout ? "paid-out" : "returned";
      return;
    }

    default:
      return;
  }
}

async function advance(o) {
  for (let step = 0; step < 12; step++) {
    const before = o.phase;
    await stepOrder(o);
    if (o.phase !== before) { o.attempts = 0; o.error = null; }
    W.save();
    if (o.phase === before || FINAL.includes(o.phase)) return;
  }
}

function kick(o) {
  if (running.has(o.id)) return Promise.resolve();
  running.add(o.id);
  return advance(o)
    .catch((e) => {
      o.attempts = (o.attempts || 0) + 1;
      o.error = errText(e);
      lastError = `order ${o.id.slice(0, 6)}: ${o.error}`;
      console.log(`[tokenpay] order ${o.id.slice(0, 6)} (${o.phase}): ${o.error}`);
    })
    .finally(() => { running.delete(o.id); W.save(); });
}

/** Orders this worker has no record of, rebuilt from the escrow's JobCreated logs for the pay wallet. */
async function scanChain() {
  const st = W.state.tokenpay;
  const latest = await jobsLib.withRetry(() => W.prov.getBlockNumber());
  const from = Math.max(st.scannedTo ? st.scannedTo + 1 : 0, latest - W.cfg.lookback, W.cfg.startBlock, 0);
  const topics = [JOB_CREATED.getEvent("JobCreated").topicHash, null, zeroPadValue(W.treasuryAddr, 32)];
  const known = new Set(Object.values(orders()).map((o) => o.jobId).filter(Boolean));
  for (let start = from; start <= latest; start += 5000) {
    const end = Math.min(start + 4999, latest);
    const logs = await jobsLib.withRetry(() => W.prov.getLogs({ address: CFG.ERC8183, topics, fromBlock: start, toBlock: end }));
    for (const l of logs) {
      const jobId = BigInt(l.topics[1]).toString();
      if (known.has(jobId)) continue;
      const j = await getJob(jobId);
      let spec = null;
      try { spec = JSON.parse(j.description); } catch { continue; }
      const p = spec?.pay;
      if (!p || typeof p.order !== "string" || !isAddress(p.buyer || "") || !/^\d+$/.test(String(p.amount)) || !CATALOG[spec.agent]) continue;
      if (String(p.token || "").toLowerCase() !== W.cfg.token.toLowerCase()) continue;
      if (orders()[p.order]) {
        // A second job for an order we already track: a createJob that was sent twice. It stays unfunded.
        if (!orders()[p.order].jobId) orders()[p.order].jobId = jobId;
        continue;
      }
      orders()[p.order] = {
        id: p.order, recovered: true, buyer: getAddress(p.buyer), agent: spec.agent, input: spec.input,
        priceRaw: parseUnits(String(CATALOG[spec.agent].priceUsdc), 6).toString(), amount: String(p.amount),
        nonce: String(p.nonce || "0"), deadline: Number(p.deadline) || 0, jobId,
        at: Date.now(), fromBlock: l.blockNumber, attempts: 0, phase: "recovered",
      };
      known.add(jobId);
      console.log(`[tokenpay] recovered order for job ${jobId} from the chain`);
    }
    st.scannedTo = end;
  }
}

function pruneOrders() {
  const cutoff = Date.now() - KEEP_DAYS * 86_400_000;
  for (const [id, o] of Object.entries(orders())) if (FINAL.includes(o.phase) && o.at < cutoff) delete orders()[id];
}

/** One pass over every unfinished order. Called from the worker's loop; never runs twice at once. */
async function tick() {
  if (!on() || ticking) return;
  ticking = true;
  try {
    await tokenMeta();
    // The pay wallet's nonce counter starts fresh, inside its own write queue, as the other keys' do each pass.
    await jobsLib.withKeyLock(W.treasuryAddr, async () => W.treasury.reset?.());
    await scanChain();
    for (const o of Object.values(orders())) {
      if (FINAL.includes(o.phase) || running.has(o.id)) continue;
      await kick(o);
    }
    pruneOrders();
    pruneQuotes();
    W.save();
    lastTickAt = Date.now();
  } catch (e) {
    lastError = `tick: ${errText(e)}`;
    console.log(`[tokenpay] ${lastError}`);
  } finally {
    ticking = false;
  }
}

function status() {
  if (!W || !on()) return { on: false, reason: W?.reason || "not attached" };
  const open = openOrders();
  return {
    on: true,
    token: W.cfg.token,
    payWallet: W.treasuryAddr,
    burns: W.cfg.burns,
    discountBps: Number(W.cfg.discountBps),
    open: open.length,
    stuck: open.filter((o) => o.attempts >= 3).length,
    lastTickSecondsAgo: lastTickAt ? Math.round((Date.now() - lastTickAt) / 1000) : null,
    lastError,
  };
}

/* ————— HTTP, beside the help desk on the worker's server ————— */

function handleHttp(req, res, http) {
  let url;
  try { url = new URL(req.url || "/", "http://pay"); } catch { return false; }
  if (!url.pathname.startsWith("/pay/")) return false;
  http.cors(req, res);
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return true; }
  const origin = req.headers.origin;
  if (origin && !http.ORIGINS.has(origin)) { http.send(res, 403, { error: "origin not allowed" }); return true; }
  const who = http.clientKey(req);
  const json = () => {
    if (!/^application\/json\b/i.test(String(req.headers["content-type"] || ""))) throw payError(415, "JSON only.");
    return http.readJson(req, 16_000);
  };
  const limit = (key, n, ms) => {
    const wait = http.limited(`${key}:${who}`, n, ms);
    if (wait) throw Object.assign(payError(429, `Too many tries. Wait ${wait} seconds.`), { retryAfter: wait });
  };

  const route = (async () => {
    if (url.pathname === "/pay/config" && req.method === "GET") {
      if (!on()) return http.send(res, 200, { on: false, chainId: CFG.CHAIN_ID });
      try {
        const { symbol, decimals } = await tokenMeta();
        return http.send(res, 200, { on: true, chainId: CFG.CHAIN_ID, token: W.cfg.token, symbol, decimals, permit2: PERMIT2, spender: W.treasuryAddr, discountBps: Number(W.cfg.discountBps), burns: W.cfg.burns });
      } catch {
        return http.send(res, 200, { on: false, chainId: CFG.CHAIN_ID });
      }
    }
    if (url.pathname === "/pay/quote" && req.method === "POST") {
      limit("pq", 12, 60_000);
      return http.send(res, 200, await quote(await json()));
    }
    if (url.pathname === "/pay/order" && req.method === "POST") {
      limit("po", 6, 60_000);
      return http.send(res, 200, await placeOrder(await json()));
    }
    if (url.pathname === "/pay/order" && req.method === "GET") {
      limit("ps", 90, 60_000);
      return http.send(res, 200, orderStatus(url.searchParams.get("id")));
    }
    return http.send(res, 405, { error: "method not allowed" });
  })();
  route.catch((e) => {
    if (e.status) return http.send(res, e.status, { error: e.message, ...(e.retryAfter ? { retryAfter: e.retryAfter } : {}) });
    lastError = `${url.pathname}: ${errText(e)}`;
    console.log(`[tokenpay] ${lastError}`);
    http.send(res, 500, { error: "Something went wrong on Stubly's side. No tokens moved. Try again, or pay in USDC." });
  });
  return true;
}

module.exports = {
  payConfig, attach, tick, status, handleHttp, quote, placeOrder, orderStatus,
  PERMIT2, BURN, TYPES, WITNESS_TYPE_STRING, UNISWAP, FINAL,
  _test: { tokensForUsdc, witnessHash, messageFor, domainFor, briefHash, stepOrder, advance, scanChain, get W() { return W; }, quotes, reset: () => { W = null; quotes.clear(); running.clear(); lastError = null; } },
};
