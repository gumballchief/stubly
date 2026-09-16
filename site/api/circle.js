"use strict";

/**
 * Server side of Circle user-controlled wallets (PIN flow), as a thin REST proxy.
 * The Circle API key stays here on the server; the browser only ever sees
 * short-lived user tokens and challenge ids. Actions:
 *
 *   POST /api/circle  {action:"config"}                → is the PIN wallet on for this chain, and its moves
 *   POST /api/circle  {action:"start", userId?}        → create user (if new) + user token
 *                                                        + initialize the wallet challenge on the selected chain
 *   POST /api/circle  {action:"token", userId}         → fresh user token for an existing user
 *   POST /api/circle  {action:"wallets", userToken}    → list the user's wallets
 *   POST /api/circle  {action:"execute", …}            → PIN challenge for one of the hire/crew escrow calls
 *   POST /api/circle  {action:"findjob", client}       → latest JobCreated for that client with our provider
 *   POST /api/circle  {action:"balance", …}            → the wallet's USDC, one figure
 *   POST /api/circle  {action:"send", …}               → PIN challenge: USDC to another address on Arc
 *   POST /api/circle  {action:"withdrawQuote", …}      → Circle's fee to move USDC to Ethereum/Base/Arbitrum
 *   POST /api/circle  {action:"withdraw", …}           → PIN challenge: approve (if needed), then the CCTP burn
 *   POST /api/circle  {action:"withdrawStatus", …}     → where a send/approve/burn we created has got to
 *   POST /api/circle  {action:"depositQuote", …}       → Circle's fee to bring USDC to Arc from another chain
 *   POST /api/circle  {action:"depositStatus", …}      → where a browser-wallet burn towards Arc has got to
 *
 * The wallet is the visitor's own. Stubly never holds a balance: every move here
 * only builds a challenge, and nothing leaves until the owner types their PIN.
 *
 * ?chain=testnet|mainnet picks the chain like every other endpoint, with one
 * difference: asking for mainnet when mainnet isn't switched on gets a refusal,
 * never a quiet fall-through to testnet. Serving test-network values to someone
 * who believes they are moving real money is the one mistake this file must not
 * make.
 */

const { sendJson, cfg, CHAINS, configured, defaultChain } = require("./_shared");
const { Interface, zeroPadValue, ZeroHash } = require("ethers");

const BASE = "https://api.circle.com/v1/w3s";

/* ————— chain + credentials ————— */

/* Circle's CCTP V2 values, copied from developers.circle.com/cctp/references/contract-addresses.
   Testnet chains all share one TokenMessengerV2; so do the mainnet ones. Arc
   mainnet's own messenger and domain are NOT published yet, so they come only
   from the environment and an empty value keeps mainnet moves switched off. */
const CCTP_TESTNET = {
  iris: "https://iris-api-sandbox.circle.com",
  arcDomain: 26,
  tokenMessenger: "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA",
  destinations: {
    ethereum: { name: "Ethereum Sepolia", domain: 0, explorer: "https://sepolia.etherscan.io" },
    base: { name: "Base Sepolia", domain: 6, explorer: "https://sepolia.basescan.org" },
    arbitrum: { name: "Arbitrum Sepolia", domain: 3, explorer: "https://sepolia.arbiscan.io" },
  },
};
function cctpMainnet() {
  const domain = process.env.MAINNET_CCTP_DOMAIN;
  return {
    iris: "https://iris-api.circle.com",
    arcDomain: /^\d+$/.test(domain || "") ? Number(domain) : null,
    tokenMessenger: process.env.MAINNET_CCTP_TOKEN_MESSENGER || "",
    destinations: {
      ethereum: { name: "Ethereum", domain: 0, explorer: "https://etherscan.io" },
      base: { name: "Base", domain: 6, explorer: "https://basescan.org" },
      arbitrum: { name: "Arbitrum", domain: 3, explorer: "https://arbiscan.io" },
    },
  };
}

/* CCTP "Standard" finality. Arc has no Fast lane (standard is already fast), and
   standard carries no protocol fee on the routes we use. */
const FINALITY = 2000;
/* Circle's Forwarding Service, version 0: the "cctp-forward" magic bytes and a
   zero data length. With it Circle mints on the destination itself, so the
   recipient needs no gas there. destinationCaller must stay zero. */
const FORWARD_HOOK = "0x636374702d666f7277617264" + "0".repeat(40);
/* Left behind on "Max" so the PIN wallet can still pay Arc gas (in USDC) for
   the move itself. Two contract calls on Arc cost well under a cent. */
const GAS_BUFFER_MINOR = 50_000n; // 0.05 USDC

/* The hire and crew flows (site/assets/app.js) approve at most this much, once. */
const STANDING_ALLOWANCE_CAP = 100n * 1_000_000n;

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
/* ethers rejects a mixed-case address whose checksum is off, and Circle and
   visitors both hand us addresses in any case. The format is already checked by
   ADDRESS_RE, so encode lower-case and never fail on letter case alone. */
const lc = (a) => String(a).toLowerCase();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const same = (a, b) => String(a || "").toLowerCase() === String(b || "").toLowerCase();

/** Like chainKey(), except an explicit but unusable chain stays that chain (and
    so reads as switched off) instead of becoming the default. */
function requestedChain(req) {
  let want = "";
  try { want = new URL((req && req.url) || "", "http://x").searchParams.get("chain") || ""; } catch { /* not a URL */ }
  return Object.prototype.hasOwnProperty.call(CHAINS, want) ? want : defaultChain();
}

/**
 * Everything a PIN-wallet request needs about its chain, and whether it is on.
 * Testnet is on whenever a Circle key exists. Mainnet needs every piece set on
 * purpose: the flag, a live Circle key and app (testnet keys can't see mainnet
 * users), Circle's own name for the chain (the "ARC" default in _shared.js is a
 * guess), USDC, and Arc's CCTP messenger and domain.
 */
function pinChain(req) {
  const key = requestedChain(req);
  const C = CHAINS[key];
  if (C.TESTNET) {
    const creds = { apiKey: process.env.CIRCLE_API_KEY || "", appId: process.env.CIRCLE_APP_ID || "" };
    return { key, C, creds, cctp: CCTP_TESTNET, circleChain: C.CIRCLE_CHAIN, enabled: Boolean(creds.apiKey) };
  }
  const creds = { apiKey: process.env.MAINNET_CIRCLE_API_KEY || "", appId: process.env.MAINNET_CIRCLE_APP_ID || "" };
  const cctp = cctpMainnet();
  const circleChain = process.env.MAINNET_CIRCLE_CHAIN || "";
  const enabled = process.env.MAINNET_PIN_WALLETS === "on"
    && configured(C) && ADDRESS_RE.test(C.USDC) && Boolean(circleChain)
    && Boolean(creds.apiKey) && Boolean(creds.appId)
    && ADDRESS_RE.test(cctp.tokenMessenger) && cctp.arcDomain !== null;
  return { key, C, creds, cctp, circleChain, enabled };
}

/* Errors written here are already plain words and pass straight through. */
class Plain extends Error {}

function requireOn(P) {
  if (!P.enabled) {
    throw new Plain(P.C.TESTNET
      ? "PIN wallets aren't set up on this server yet."
      : "PIN wallets aren't switched on for Arc mainnet yet. Use a browser wallet instead.");
  }
}

/* Anything Circle, Iris or the RPC said is logged here and replaced, so raw API
   text never reaches a visitor's page. */
function plainError(e) {
  if (e instanceof Plain) return e.message;
  const m = String((e && e.message) || "");
  const status = (e && e.status) || 0;
  console.error("[circle]", m.slice(0, 300));
  if (status === 401 || status === 403 || /token.*(expired|invalid)|unauthori[sz]ed/i.test(m)) return "Your wallet session expired. Reload the page and try again.";
  if (status === 429) return "Circle is busy right now. Wait a few seconds and try again.";
  if (/insufficient|not enough|exceeds? (the )?balance/i.test(m)) return "Not enough USDC in this wallet for that amount plus the network fee.";
  if (/idempoten/i.test(m)) return "That move was already started. Check your balance before trying it again.";
  if (/locked/i.test(m)) return "Circle has paused PIN entry after wrong tries. Wait 30 minutes and try again.";
  if (status === 404 || /not found/i.test(m)) return "Circle couldn't find that wallet. Reload the page and try again.";
  if ((e && e.name === "TimeoutError") || /abort|timed? ?out/i.test(m)) return "Circle took too long to answer. Try again in a minute.";
  return "Circle couldn't do that right now. Try again in a minute.";
}

async function circle(P, path, { method = "POST", body, userToken } = {}) {
  if (!P.creds.apiKey) throw new Plain("PIN wallets aren't set up on this server yet.");
  const headers = { "content-type": "application/json", authorization: `Bearer ${P.creds.apiKey}` };
  if (userToken) headers["X-User-Token"] = userToken;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: method === "GET" ? undefined : JSON.stringify(body || {}),
    signal: AbortSignal.timeout(15_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(`circle ${res.status}: ${data?.message || JSON.stringify(data).slice(0, 200)}`);
    e.status = res.status;
    throw e;
  }
  return data.data ?? data;
}

async function readBody(req) {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  try { return JSON.parse(raw || "{}"); } catch { return {}; }
}

/* Tokens, keys and challenges must never sit in a shared cache. */
const send = (res, status, body) => sendJson(res, status, body, "private, no-store");

/* ————— validation ————— */

/** "1.5" → 1500000n. Plain decimal only, above zero, at most USDC's 6 places. */
function parseAmount(v) {
  const s = String(v ?? "").trim();
  if (!/^\d{1,12}(\.\d+)?$/.test(s)) throw new Plain("Enter an amount like 5 or 2.50.");
  const [whole, frac = ""] = s.split(".");
  if (frac.length > 6) throw new Plain("USDC has 6 decimal places at most.");
  const minor = BigInt(whole) * 1_000_000n + BigInt((frac + "000000").slice(0, 6));
  if (minor <= 0n) throw new Plain("The amount has to be more than zero.");
  return minor;
}
const fmtUsdc = (minor) => {
  const n = BigInt(minor);
  const frac = (n % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return `${n / 1_000_000n}${frac ? `.${frac}` : ""}`;
};

function needAddress(v, what) {
  if (!ADDRESS_RE.test(String(v || "")) || same(v, ZERO_ADDRESS)) throw new Plain(`${what} isn't a valid address. It starts with 0x and has 40 characters after that.`);
  return String(v);
}
function needKey(v) {
  if (!UUID_RE.test(String(v || ""))) throw new Plain("Missing a move id. Reload the page and try again.");
  return String(v);
}
function needSession(body) {
  if (!body.userToken || typeof body.userToken !== "string") throw new Plain("Your wallet session expired. Reload the page and try again.");
  if (!UUID_RE.test(String(body.walletId || ""))) throw new Plain("Wallet not loaded yet. Reload the page and try again.");
}
function destinationOf(P, key) {
  const d = Object.prototype.hasOwnProperty.call(P.cctp.destinations, key) ? P.cctp.destinations[key] : null;
  if (!d) throw new Plain("Pick Ethereum, Base or Arbitrum.");
  return d;
}

/* ————— the generic execute, narrowed ————— */

const UINT_RE = /^\d{1,78}$/;
/**
 * The only contract calls the hire and crew pages make with a PIN wallet
 * (every `action:"execute"` in site/assets/app.js). Anything else — a transfer,
 * an approve to someone who isn't the escrow — is refused, so a script injected
 * into the page can't dress a drain up as one more PIN prompt in a hire.
 */
function executeAllowed(C, contractAddress, sig, params) {
  const p = Array.isArray(params) ? params : [];
  if (same(contractAddress, C.ERC8183)) {
    if (sig === "createJob(address,address,uint256,string,address)") {
      return p.length === 5 && same(p[0], C.PROVIDER_WALLET) && same(p[1], C.EVALUATOR_WALLET)
        && UINT_RE.test(String(p[2])) && typeof p[3] === "string" && p[3].length <= 8000 && same(p[4], ZERO_ADDRESS);
    }
    if (sig === "fund(uint256,bytes)") {
      return p.length === 2 && UINT_RE.test(String(p[0])) && p[1] === "0x";
    }
    return false;
  }
  if (same(contractAddress, C.USDC) && sig === "approve(address,uint256)") {
    return p.length === 2 && same(p[0], C.ERC8183) && UINT_RE.test(String(p[1])) && BigInt(p[1]) <= STANDING_ALLOWANCE_CAP;
  }
  return false;
}

/* ————— CCTP helpers ————— */

const IFACE_USDC = new Interface([
  "function approve(address spender, uint256 value) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
]);
const IFACE_TM = new Interface([
  "function depositForBurnWithHook(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken, bytes32 destinationCaller, uint256 maxFee, uint32 minFinalityThreshold, bytes hookData)",
]);

function burnCallData({ amount, domain, recipient, usdc, maxFee }) {
  return IFACE_TM.encodeFunctionData("depositForBurnWithHook", [
    amount, domain, zeroPadValue(lc(recipient), 32), lc(usdc), ZeroHash, maxFee, FINALITY, FORWARD_HOOK,
  ]);
}

/**
 * Fee math from one Iris quote row. minimumFee is in basis points (may carry
 * decimals); forwardFee is in USDC minor units. `fee` is what Circle expects to
 * take; `maxFee` is the ceiling signed into the burn — the high forwarding
 * estimate plus a fifth again, because a burn whose cap is too low can stall or
 * revert and the difference is never charged anyway.
 */
function feeMath(amount, row) {
  const bps = Number(row && row.minimumFee);
  const ff = row && row.forwardFee;
  if (!Number.isFinite(bps) || bps < 0 || !ff) throw new Plain("Circle isn't forwarding on that route right now. Try again later.");
  const toMinor = (v) => { if (!/^\d+$/.test(String(v))) throw new Plain("Circle's fee quote looked wrong. Try again in a minute."); return BigInt(v); };
  const medium = toMinor(ff.medium);
  const high = toMinor(ff.high ?? ff.medium);
  const hundredthsBps = BigInt(Math.ceil(Math.round(bps * 1e6) / 1e4)); // 1 bps = 100
  const protocol = (amount * hundredthsBps + 999_999n) / 1_000_000n;     // ceil(amount·bps/10000)
  const fee = protocol + medium;
  const maxFee = protocol + high + (high + 4n) / 5n;
  if (amount <= maxFee) throw new Plain(`That's not more than the fee. Move more than ${fmtUsdc(maxFee)} USDC.`);
  // `need` is Circle's own high estimate with no headroom: the least a cap can be.
  return { fee, maxFee, need: protocol + high, receiveAbout: amount - fee, receiveAtLeast: amount - maxFee };
}

/** The visitor's reviewed cap, in minor units, as the browser echoes it back. */
function needReviewedFee(v) {
  if (!/^\d{1,30}$/.test(String(v ?? ""))) throw new Plain("Review the send again before confirming.");
  return BigInt(v);
}

/**
 * The fee cap signed into a burn. Never above the cap the visitor reviewed, so the
 * "at least" on their ticket stays a real floor; a fresh quote that came back lower
 * tightens it. When Circle's own high estimate no longer fits under the reviewed
 * cap, fees rose between Review and PIN, and the visitor has to look again.
 */
function capFee(q, reviewed) {
  if (q.need > reviewed) throw new Plain("Circle's bridge fee went up since you reviewed it. Review it again to see the new fee.");
  return q.maxFee < reviewed ? q.maxFee : reviewed;
}

async function quote(P, srcDomain, dstDomain, amount) {
  let rows;
  try {
    const r = await fetch(`${P.cctp.iris}/v2/burn/USDC/fees/${srcDomain}/${dstDomain}?forward=true`, { signal: AbortSignal.timeout(10_000) });
    if (!r.ok) throw new Error(`iris fees ${r.status}`);
    rows = await r.json();
  } catch (e) {
    console.error("[circle] fee quote", String(e.message).slice(0, 200));
    throw new Plain("Circle's fee quote isn't answering. Try again in a minute.");
  }
  const list = Array.isArray(rows) ? rows : (rows && rows.data) || [];
  const row = list.find((x) => Number(x.finalityThreshold) === FINALITY);
  return feeMath(amount, row);
}
const quoteOut = (q) => ({
  fee: fmtUsdc(q.fee), maxFee: fmtUsdc(q.maxFee),
  receiveAbout: fmtUsdc(q.receiveAbout), receiveAtLeast: fmtUsdc(q.receiveAtLeast),
});

async function rpcAllowance(C, owner, spender) {
  let j;
  try {
    const r = await fetch(C.RPC_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call",
        params: [{ to: C.USDC, data: IFACE_USDC.encodeFunctionData("allowance", [lc(owner), lc(spender)]) }, "latest"] }),
      signal: AbortSignal.timeout(10_000),
    });
    j = await r.json();
  } catch { j = null; }
  if (!j || typeof j.result !== "string" || j.error) throw new Plain("Couldn't read the network right now. Try again in a minute.");
  return IFACE_USDC.decodeFunctionResult("allowance", j.result)[0];
}

/** Iris' view of one burn: pending, or delivered with the destination tx. */
async function messageStatus(P, srcDomain, txHash) {
  const r = await fetch(`${P.cctp.iris}/v2/messages/${srcDomain}?transactionHash=${txHash}`, { signal: AbortSignal.timeout(10_000) });
  if (r.status === 404) return { cctp: "pending" };
  if (!r.ok) throw new Plain("Circle's bridge status isn't answering. It will keep going without us — check again in a minute.");
  const m = ((await r.json()).messages || [])[0];
  if (!m) return { cctp: "pending" };
  return {
    cctp: m.forwardTxHash ? "delivered" : m.status === "complete" ? "attested" : "pending",
    forwardTxHash: m.forwardTxHash || null,
    delayReason: m.delayReason || null,
  };
}

/** The wallet as Circle sees it, refused if it lives on another chain. */
async function walletOn(P, userToken, walletId) {
  const w = await circle(P, `/wallets/${walletId}`, { method: "GET", userToken });
  const wallet = w.wallet || w;
  if (!wallet || wallet.blockchain !== P.circleChain || !ADDRESS_RE.test(wallet.address || "")) {
    throw new Plain(`That wallet isn't on ${P.C.NAME}. Reload the page and try again.`);
  }
  return wallet;
}

/** One figure: on Arc, native USDC (18 dp) and the ERC-20 (6 dp) are the same funds. */
function usdcFromBalances(P, tokenBalances) {
  const rows = (Array.isArray(tokenBalances) ? tokenBalances : [])
    .filter((b) => b && b.token && (!b.token.blockchain || b.token.blockchain === P.circleChain));
  const pick = rows.find((b) => same(b.token.tokenAddress, P.C.USDC))
    || rows.find((b) => b.token.isNative && /^USDC$/i.test(b.token.symbol || ""));
  const s = String((pick && pick.amount) || "0");
  if (!/^\d+(\.\d+)?$/.test(s)) return 0n;
  const [whole, frac = ""] = s.split(".");
  return BigInt(whole) * 1_000_000n + BigInt((frac + "000000").slice(0, 6)); // truncate, never round up
}

async function contractExecution(P, userToken, { walletId, contractAddress, callData, idempotencyKey, refId }) {
  const d = await circle(P, "/user/transactions/contractExecution", {
    userToken,
    body: { idempotencyKey, walletId, contractAddress, callData, feeLevel: "MEDIUM", refId },
  });
  if (!d.challengeId) throw new Error("contractExecution returned no challengeId");
  return d.challengeId;
}

const TX_KINDS = new Set(["send", "approve", "burn"]);
const refOf = (kind, key) => `stubly:${kind}:${key}`;

/* ————— handler ————— */

module.exports = async (req, res) => {
  try {
    if (req.method !== "POST") return send(res, 405, { error: "POST only" });
    const body = await readBody(req);
    const P = pinChain(req);
    const C = P.C;

    if (body.action === "config") {
      const on = P.enabled;
      return send(res, 200, {
        chain: { key: P.key, name: C.NAME, testnet: C.TESTNET, chainId: C.CHAIN_ID, explorer: C.EXPLORER || null },
        pinWallets: on,
        moves: on,
        circleChain: on ? P.circleChain : null,
        usdc: on ? C.USDC : null,
        faucet: C.TESTNET ? "https://faucet.circle.com" : null,
        arcDomain: on ? P.cctp.arcDomain : null,
        gasBuffer: fmtUsdc(GAS_BUFFER_MINOR),
        destinations: on
          ? Object.entries(P.cctp.destinations).map(([key, d]) => ({ key, name: d.name, domain: d.domain, explorer: d.explorer }))
          : [],
      });
    }

    if (body.action === "findjob") {
      // Latest JobCreated for a given client with our provider — via the explorer's
      // indexed log search (Arc mints ~4 blocks/sec, so raw range scans can't keep up).
      const { zeroPadValue: pad } = require("ethers");
      const client = String(body.client || "");
      if (!ADDRESS_RE.test(client)) return send(res, 400, { error: "client address required" });
      const iface = new Interface(["event JobCreated(uint256 indexed jobId, address indexed client, address indexed provider, address evaluator, uint256 expiredAt, address hook)"]);
      const topic0 = iface.getEvent("JobCreated").topicHash;
      // ~4 blocks/sec on Arc: 200k blocks ≈ the last ~14 hours, plenty for a hire session
      const { provider } = require("./_shared");
      const J = cfg(req);
      const latest = await provider(J).getBlockNumber();
      const url = `${J.EXPLORER_API}?module=logs&action=getLogs&fromBlock=${Math.max(0, latest - 200_000)}&toBlock=latest` +
        `&address=${J.ERC8183}&topic0=${topic0}&topic2=${pad(client, 32)}&topic0_2_opr=and`;
      const r = await fetch(url, { signal: AbortSignal.timeout(12_000) });
      const data = await r.json().catch(() => ({}));
      const providerTopic = pad(J.PROVIDER_WALLET, 32).toLowerCase();
      const ours = (Array.isArray(data.result) ? data.result : [])
        .filter((l) => (l.topics?.[3] || "").toLowerCase() === providerTopic);
      if (!ours.length) return send(res, 200, { jobId: null });
      const last = ours[ours.length - 1];
      return send(res, 200, { jobId: BigInt(last.topics[1]).toString(), tx: last.transactionHash });
    }

    // Everything below talks to Circle for this chain, so the chain must be on.
    requireOn(P);

    if (body.action === "start") {
      const userId = body.userId || crypto.randomUUID();
      if (!body.userId) {
        try { await circle(P, "/users", { body: { userId } }); }
        catch (e) { if (!/already exists/i.test(e.message)) throw e; }
      }
      const tok = await circle(P, "/users/token", { body: { userId } });
      let challengeId = null;
      try {
        const init = await circle(P, "/user/initialize", {
          userToken: tok.userToken,
          body: { idempotencyKey: crypto.randomUUID(), blockchains: [P.circleChain] },
        });
        challengeId = init.challengeId || null;
      } catch (e) {
        /* An initialized user answers with an error here; the page then just loads wallets. */
        console.error("[circle] initialize", String(e.message).slice(0, 200));
      }

      return send(res, 200, {
        userId,
        userToken: tok.userToken,
        encryptionKey: tok.encryptionKey,
        challengeId,
        appId: P.creds.appId,
        note: challengeId ? "run the challenge in the SDK widget" : "user may already be initialized — fetch wallets",
      });
    }

    if (body.action === "token") {
      if (!body.userId) return send(res, 400, { error: "userId required" });
      const tok = await circle(P, "/users/token", { body: { userId: String(body.userId) } });
      return send(res, 200, { userToken: tok.userToken, encryptionKey: tok.encryptionKey, appId: P.creds.appId });
    }

    if (body.action === "wallets") {
      if (!body.userToken) return send(res, 400, { error: "userToken required" });
      const data = await circle(P, "/wallets", { method: "GET", userToken: body.userToken });
      return send(res, 200, { wallets: data?.wallets || [] });
    }

    if (body.action === "execute") {
      // Create a contract-execution challenge: the user's Circle wallet will run
      // this call once they approve it with their PIN in the SDK widget.
      const { userToken, walletId, contractAddress, abiFunctionSignature, abiParameters } = body;
      if (!userToken || !walletId || !contractAddress || !abiFunctionSignature) {
        return send(res, 400, { error: "userToken, walletId, contractAddress, abiFunctionSignature required" });
      }
      if (!executeAllowed(C, contractAddress, abiFunctionSignature, abiParameters)) {
        return send(res, 200, { error: "Stubly only asks a PIN wallet to create, approve or fund its own work orders. This request was something else, so it was refused." });
      }
      const d = await circle(P, "/user/transactions/contractExecution", {
        userToken,
        body: {
          idempotencyKey: UUID_RE.test(String(body.idempotencyKey || "")) ? body.idempotencyKey : crypto.randomUUID(),
          walletId,
          contractAddress,
          abiFunctionSignature,
          abiParameters: abiParameters || [],
          feeLevel: "MEDIUM",
        },
      });
      return send(res, 200, { challengeId: d?.challengeId || null });
    }

    if (body.action === "balance") {
      needSession(body);
      const wallet = await walletOn(P, body.userToken, body.walletId);
      const b = await circle(P, `/wallets/${body.walletId}/balances`, { method: "GET", userToken: body.userToken });
      const minor = usdcFromBalances(P, b.tokenBalances);
      return send(res, 200, { usdc: fmtUsdc(minor), usdcMinor: minor.toString(), address: wallet.address });
    }

    if (body.action === "send") {
      needSession(body);
      const idempotencyKey = needKey(body.idempotencyKey);
      const to = needAddress(body.destinationAddress, "The address");
      const amount = parseAmount(body.amount);
      const wallet = await walletOn(P, body.userToken, body.walletId);
      if (same(to, wallet.address)) throw new Plain("That's this wallet's own address. Enter where the USDC should go.");
      const d = await circle(P, "/user/transactions/transfer", {
        userToken: body.userToken,
        body: {
          idempotencyKey,
          walletId: body.walletId,
          destinationAddress: to,
          tokenAddress: C.USDC,
          blockchain: P.circleChain,
          amounts: [fmtUsdc(amount)],
          feeLevel: "MEDIUM",
          refId: refOf("send", idempotencyKey),
        },
      });
      if (!d.challengeId) throw new Error("transfer returned no challengeId");
      return send(res, 200, { challengeId: d.challengeId, ref: idempotencyKey });
    }

    if (body.action === "withdrawQuote") {
      const dest = destinationOf(P, body.destination);
      const amount = parseAmount(body.amount);
      const q = await quote(P, P.cctp.arcDomain, dest.domain, amount);
      return send(res, 200, { destination: body.destination, network: dest.name, amount: fmtUsdc(amount), ...quoteOut(q), maxFeeMinor: q.maxFee.toString() });
    }

    if (body.action === "withdraw") {
      needSession(body);
      const dest = destinationOf(P, body.destination);
      const amount = parseAmount(body.amount);
      const recipient = needAddress(body.recipient, "The address");
      const keys = body.idempotencyKeys || {};
      const approveKey = needKey(keys.approve);
      const burnKey = needKey(keys.burn);
      if (approveKey === burnKey) throw new Plain("Missing a move id. Reload the page and try again.");
      const reviewed = needReviewedFee(body.reviewedMaxFee);
      const wallet = await walletOn(P, body.userToken, body.walletId);

      /* Approve exactly this amount, and only when the messenger can't already
         pull it — a second PIN prompt nobody needed is a prompt people learn to
         click through. */
      const allowance = await rpcAllowance(C, wallet.address, P.cctp.tokenMessenger);
      if (allowance < amount) {
        const challengeId = await contractExecution(P, body.userToken, {
          walletId: body.walletId,
          contractAddress: C.USDC,
          callData: IFACE_USDC.encodeFunctionData("approve", [lc(P.cctp.tokenMessenger), amount]),
          idempotencyKey: approveKey,
          refId: refOf("approve", approveKey),
        });
        return send(res, 200, { step: "approve", challengeId, ref: approveKey });
      }

      // A quote taken now, held under the cap the visitor reviewed.
      const q = await quote(P, P.cctp.arcDomain, dest.domain, amount);
      const maxFee = capFee(q, reviewed);
      const challengeId = await contractExecution(P, body.userToken, {
        walletId: body.walletId,
        contractAddress: P.cctp.tokenMessenger,
        callData: burnCallData({ amount, domain: dest.domain, recipient, usdc: C.USDC, maxFee }),
        idempotencyKey: burnKey,
        refId: refOf("burn", burnKey),
      });
      return send(res, 200, { step: "burn", challengeId, ref: burnKey, network: dest.name, amount: fmtUsdc(amount),
        ...quoteOut(q), maxFee: fmtUsdc(maxFee), receiveAtLeast: fmtUsdc(amount - maxFee) });
    }

    if (body.action === "withdrawStatus") {
      needSession(body);
      const ref = needKey(body.ref);
      const kind = TX_KINDS.has(body.kind) ? body.kind : "burn";
      const list = await circle(P, `/transactions?walletIds=${encodeURIComponent(body.walletId)}&pageSize=50`, { method: "GET", userToken: body.userToken });
      const tx = (list.transactions || []).find((t) => t.refId === refOf(kind, ref));
      if (!tx) return send(res, 200, { state: "waiting" });
      const st = String(tx.state || "").toUpperCase();
      const state = ["FAILED", "CANCELLED", "DENIED"].includes(st) ? "failed"
        : ["CONFIRMED", "COMPLETE"].includes(st) ? "confirmed" : "pending";
      const txHash = /^0x[0-9a-fA-F]{64}$/.test(tx.txHash || "") ? tx.txHash : null;
      const out = { state, txHash, explorer: txHash && C.EXPLORER ? `${C.EXPLORER}/tx/${txHash}` : null };
      if (kind === "burn" && state === "confirmed" && txHash) {
        const dest = destinationOf(P, body.destination);
        const m = await messageStatus(P, P.cctp.arcDomain, txHash);
        Object.assign(out, m, { destinationExplorer: m.forwardTxHash ? `${dest.explorer}/tx/${m.forwardTxHash}` : null });
      }
      return send(res, 200, out);
    }

    if (body.action === "depositQuote") {
      const src = destinationOf(P, body.source);
      const amount = parseAmount(body.amount);
      const q = await quote(P, src.domain, P.cctp.arcDomain, amount);
      return send(res, 200, { source: body.source, network: src.name, arcDomain: P.cctp.arcDomain, amount: fmtUsdc(amount), ...quoteOut(q),
        maxFeeMinor: q.maxFee.toString(), needFeeMinor: q.need.toString() });
    }

    if (body.action === "depositStatus") {
      const src = destinationOf(P, body.source);
      if (!/^0x[0-9a-fA-F]{64}$/.test(String(body.txHash || ""))) throw new Plain("That transaction hash doesn't look right.");
      const m = await messageStatus(P, src.domain, body.txHash);
      return send(res, 200, { ...m, explorer: m.forwardTxHash && C.EXPLORER ? `${C.EXPLORER}/tx/${m.forwardTxHash}` : null });
    }

    return send(res, 400, { error: "unknown action" });
  } catch (e) {
    send(res, 200, { error: plainError(e) });
  }
};

/* For the scratchpad tests only; nothing in the site imports these. */
module.exports._test = { parseAmount, fmtUsdc, feeMath, capFee, burnCallData, executeAllowed, usdcFromBalances, FORWARD_HOOK, GAS_BUFFER_MINOR };
