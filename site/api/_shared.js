"use strict";

/**
 * Shared constants for the site's serverless functions. Addresses are public
 * on-chain constants, not secrets. ABI fragments are copied verbatim from the
 * verified contract ABI (chain/erc8183.abi.json) — do not hand-edit shapes.
 */

const { JsonRpcProvider, Contract } = require("ethers");

/**
 * Two chains, one codebase.
 *
 * Testnet's values are literals because they are settled, public and permanent —
 * every job id we have ever published resolves against them. Mainnet's arrive
 * from the environment on 16 September 2026, when Circle publishes the addresses;
 * nothing here is guessed in advance. A chain with no RPC and no escrow address
 * counts as "not configured" and can never be selected, so a half-filled mainnet
 * config degrades to testnet instead of serving wrong data.
 *
 * The serverless RPC default deliberately differs from chain/config.js: Arc's
 * plain public RPC returns malformed errors under Vercel's concurrency, so the
 * functions default to a dedicated host. In production RPC_URL overrides both.
 */
const CHAINS = {
  testnet: {
    KEY: "testnet",
    NAME: "Arc Testnet",
    TESTNET: true,
    CHAIN_ID: 5042002,
    RPC_URL: process.env.RPC_URL || "https://rpc.drpc.testnet.arc.io",
    /* wallet_addEthereumChain writes this into the visitor's wallet permanently,
       so it must be the chain's canonical public endpoint — never whichever
       provider we happen to be paying for server-side reads. */
    PUBLIC_RPC_URL: "https://rpc.testnet.arc.io",
    ERC8183: "0x0747EEf0706327138c69792bF28Cd525089e4583",
    USDC: "0x3600000000000000000000000000000000000000",
    IDENTITY_REGISTRY: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
    EXPLORER: "https://testnet.arcscan.app",
    EXPLORER_API: "https://testnet.arcscan.app/api",
    CIRCLE_CHAIN: "ARC-TESTNET",
    PROVIDER_WALLET: "0x15b9F8a8658E10DaD42ec08CEf158Ca1392a8944",
    EVALUATOR_WALLET: "0x6F5A2E61DA4C779c6b4119F3BfEC8ec53Db488C7",
    PROVIDER_KEY: "provider",
    EVALUATOR_KEY: "evaluator",
  },
  mainnet: {
    KEY: "mainnet",
    NAME: "Arc",
    TESTNET: false,
    CHAIN_ID: Number(process.env.MAINNET_CHAIN_ID || 5042),
    RPC_URL: process.env.MAINNET_RPC_URL || "",
    PUBLIC_RPC_URL: process.env.MAINNET_PUBLIC_RPC_URL || process.env.MAINNET_RPC_URL || "",
    ERC8183: process.env.MAINNET_ERC8183 || "",
    USDC: process.env.MAINNET_USDC || "",
    IDENTITY_REGISTRY: process.env.MAINNET_IDENTITY_REGISTRY || "",
    EXPLORER: process.env.MAINNET_EXPLORER || "",
    EXPLORER_API: process.env.MAINNET_EXPLORER_API || "",
    CIRCLE_CHAIN: process.env.MAINNET_CIRCLE_CHAIN || "ARC",
    PROVIDER_WALLET: process.env.MAINNET_PROVIDER_WALLET || "",
    EVALUATOR_WALLET: process.env.MAINNET_EVALUATOR_WALLET || "",
    /* Separate keystores, never the testnet ones: a key that has lived on a
       laptop and in three CI environments does not get to sign for real money. */
    PROVIDER_KEY: "provider_mainnet",
    EVALUATOR_KEY: "evaluator_mainnet",
  },
};

/** A chain is usable once it can be reached and has an escrow to read. */
function configured(c) {
  return Boolean(c && c.RPC_URL && c.ERC8183 && c.PROVIDER_WALLET);
}

/** Read every call so a test (or a launch-day env flip) takes effect at once. */
function defaultChain() {
  const want = process.env.DEFAULT_CHAIN || "testnet";
  return configured(CHAINS[want]) ? want : "testnet";
}

/** ?chain=testnet|mainnet picks the chain for one request. Anything unknown,
    unconfigured or missing falls through to the default rather than erroring —
    an old link with no ?chain must keep resolving. */
function chainKey(req) {
  let want = "";
  try { want = new URL(req && req.url || "", "http://x").searchParams.get("chain") || ""; } catch { /* not a URL */ }
  return configured(CHAINS[want]) ? want : defaultChain();
}

function cfg(req) { return CHAINS[chainKey(req)]; }

/* Back-compat: CFG still reads like the old flat constant, resolved against
   whichever chain is currently the default. Every line not yet migrated — and
   every call site that never sees a request — keeps working untouched. */
const CFG = new Proxy({}, {
  get: (_t, k) => CHAINS[defaultChain()][k],
  has: (_t, k) => k in CHAINS[defaultChain()],
  ownKeys: () => Reflect.ownKeys(CHAINS[defaultChain()]),
  getOwnPropertyDescriptor: (_t, k) => {
    const d = Object.getOwnPropertyDescriptor(CHAINS[defaultChain()], k);
    return d && { ...d, configurable: true };
  },
});

const JOB_STATUS = ["Open", "Funded", "Submitted", "Completed", "Rejected", "Expired"];

const ABI = [
  "function getJob(uint256 jobId) view returns (tuple(uint256 id, address client, address provider, address evaluator, string description, uint256 budget, uint256 expiredAt, uint8 status, address hook))",
  "function jobHasBudget(uint256 jobId) view returns (bool)",
];

// Single source of truth for the roster — shared with worker/catalog.js.
const CATALOG = require("./_catalog.json");

/**
 * Cheap keyword pass — catches the obvious requests without spending a model
 * call, and stands in for the model when it is slow, keyless or unhelpful.
 * Shared by /api/dispatch (one agent) and /api/plan (a crew).
 */
const HINTS = [
  [/\b(audit|check|review|speed|seo)\b.*https?:\/\//i, "site-audit"],
  [/\b(audit|check|review|speed|seo|broken link)\b.*\b(site|website|page|url|landing)\b/i, "site-audit"],
  [/\b(site|website|page|landing)\b.*\b(audit|check|review|speed|seo|slow)\b/i, "site-audit"],
  [/\bresearch\b|\bbrief\b|\bwrite.*about\b|\bexplain\b.*\bmarket\b/i, "research-brief"],
  [/\bcontract\b.*\b(check|audit|safe|verify|rug)\b/i, "contract-check"],
  [/\b(wallet|address)\b.*\b(report|holdings|balance|activity|what.*hold)\b/i, "wallet-report"],
  [/\btoken\b.*\b(report|supply|holders|distribution)\b/i, "token-report"],
  [/\b(tx|transaction)\b.*\b(explain|what happened|decode)\b/i, "tx-explain"],
  [/\btranslate\b|\binto (spanish|french|german|arabic|chinese)\b/i, "translate"],
  [/\breadme\b/i, "readme-writer"],
  [/\b(thread|tweet|twitter|x post)\b/i, "thread-writer"],
  [/\b(landing copy|copywriting|copy pack|headlines?|taglines?)\b/i, "copy-pack"],
  [/\b(name|brand).{0,20}\b(check|available|taken)\b/i, "name-check"],
  [/\b(pitch|deck)\b.*\b(critic|feedback|review|tear)\b/i, "pitch-critic"],
  /* The model occasionally answers "nothing fits" to requests that plainly do —
     "explain this error" came back empty on a shelf that has an error explainer.
     These cover the asks that arrive in the same words every time, so the floor
     never depends on the model having a good minute. */
  [/\b(type|reference|syntax|range)error\b|\bnullpointer\b|\bsegfault\b|\btraceback\b/i, "error-explain"],
  [/\b(error|exception|stack ?trace)\b.*\b(explain|mean|means|fix|why|what)\b/i, "error-explain"],
  [/\bexplain\b.*\b(error|exception|stack ?trace|crash)\b/i, "error-explain"],
  [/\b(security )?headers\b|\bcsp\b|\bhsts\b/i, "headers-check"],
  [/\benv(ironment)? (vars?|variables?)\b|\.env\b/i, "env-audit"],
  [/\bregular expression\b|\bregexp?\b/i, "regex-builder"],
  [/\bsql\b|\b(query)\b.*\b(explain|slow|optimi[sz]e)\b/i, "sql-explain"],
  /* Trailing s matters: people type "cold emails" and "runbooks". A \b straight
     after the singular misses every plural, which is how "cold emails and a
     follow-up sequence" came back as one agent instead of two. */
  [/\btest (plans?|cases|coverage)\b|\bqa plans?\b/i, "test-plan"],
  [/\bcold ?emails?\b|\bcold outreach\b/i, "cold-email"],
  [/\bfollow[- ]?up sequences?\b|\boutreach sequences?\b/i, "outreach-sequence"],
  [/\bfaqs?\b/i, "faq-writer"],
  [/\bapi (docs|documentation)\b/i, "api-docs"],
  [/\brunbooks?\b/i, "runbook"],
  [/\bpost[- ]?mortems?\b/i, "postmortem"],
  [/\blaunch\b.*\b(kit|package|everything)\b/i, "launch-kit"],
];

function keywordPick(text, skip = new Set()) {
  for (const [re, key] of HINTS) if (!skip.has(key) && re.test(text) && CATALOG[key]) return key;
  return null;
}

/** Every agent the request names outright, in table order, de-duplicated. */
function keywordAll(text, skip = new Set()) {
  const out = [];
  for (const [re, key] of HINTS) {
    if (skip.has(key) || out.includes(key) || !CATALOG[key]) continue;
    if (re.test(text)) out.push(key);
  }
  return out;
}

/* One provider per chain, memoised across warm invocations so a cold start is
   paid once. Passing a config object selects that chain; passing nothing keeps
   the old single-chain behaviour for call sites that never see a request. */
const _providers = {};
function chainOf(c) { return c && c.KEY ? c : CHAINS[defaultChain()]; }

function provider(c) {
  const conf = chainOf(c);
  if (!_providers[conf.KEY]) {
    _providers[conf.KEY] = new JsonRpcProvider(conf.RPC_URL, conf.CHAIN_ID, { staticNetwork: true });
  }
  return _providers[conf.KEY];
}
function jobsContract(c) {
  const conf = chainOf(c);
  return new Contract(conf.ERC8183, ABI, provider(conf));
}

/** cacheControl overrides the default for endpoints that are expensive to compute. */
function sendJson(res, status, body, cacheControl) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.setHeader("cache-control", cacheControl || "public, s-maxage=5, stale-while-revalidate=15");
  res.end(JSON.stringify(body));
}

module.exports = {
  CFG, CHAINS, cfg, chainKey, defaultChain, configured,
  JOB_STATUS, CATALOG, HINTS, keywordPick, keywordAll,
  provider, jobsContract, sendJson,
};
