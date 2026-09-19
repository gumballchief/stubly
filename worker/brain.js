"use strict";

/**
 * What Stubly support knows, and the checks anything it writes must pass.
 *
 * Shared by the support inbox (support.js) and the help desk chat (desk.js), so an
 * answer by email and an answer in the chat come from the same facts and go through
 * the same rules.
 */

const { CFG } = require("../chain/config");

/* Two addresses on purpose. SITE is where the worker calls the site's API, and can be a
   deployment URL. Customers only ever get the public one: a deployment URL in a reply
   fails the link check and throws the whole answer away. */
const SITE = (process.env.SITE_URL || "https://stubly.org").replace(/\/$/, "");
const PUBLIC_SITE = "https://stubly.org";
const TESTNET_CHAIN_ID = 5042002;

/**
 * Who this worker answers for, from the chain it signs on. A worker serves one chain, and
 * everything it tells a customer (real money or test money, where to get USDC, which
 * explorer proves a refund) follows from that.
 *
 * The explorer fails closed. chain/config.js defaults EXPLORER to the testnet one, so a
 * mainnet worker whose EXPLORER was never set would otherwise hand out testnet links as
 * proof of a real refund. A testnet explorer on any other chain counts as no explorer.
 */
function chainFor({ chainId, explorer }) {
  const testnet = Number(chainId) === TESTNET_CHAIN_ID;
  let base = "";
  try {
    const u = new URL(String(explorer || ""));
    if (u.protocol === "https:" && (testnet || !/testnet/i.test(u.hostname))) base = u.origin + u.pathname.replace(/\/$/, "");
  } catch { /* unset or not a URL: no explorer links at all */ }
  const hosts = new Set(["stubly.org", "www.stubly.org"]);
  if (base) hosts.add(new URL(base).hostname.toLowerCase());
  // The one outside place each chain's facts send people for money.
  hosts.add(testnet ? "faucet.circle.com" : "robinhood.com");
  return { key: testnet ? "testnet" : "mainnet", testnet, chainId: Number(chainId), explorer: base, hosts };
}

const CHAIN = chainFor({ chainId: CFG.CHAIN_ID, explorer: CFG.EXPLORER });
const LINK_HOSTS = CHAIN.hosts;

/** An order's page. The chain is always in the link: the same number can be a different order on the other chain. */
const orderUrl = (id, key = CHAIN.key) => `${PUBLIC_SITE}/job?id=${id}&chain=${key === "testnet" ? "testnet" : "mainnet"}`;

function factsFor(chain) {
  const money = chain.testnet ? "USDC" : CFG.CURRENCY;
  const where = chain.testnet ? "Arc testnet" : CFG.CHAIN_NAME;
  const intro = `
Stubly (stubly.org) is a marketplace where people hire AI agents for small jobs and pay in ${money}.
The payment sits in an ERC-8183 escrow contract on ${where}. It is Stubly's own deployment of the open
ERC-8183 reference code, and it has no admin, so nobody, Stubly included, can change it or move the money
outside its rules. When the work passes an independent check the agent is paid; if it fails, the buyer is
refunded by the contract. Stubly never holds the money.
`.trim();

  const network = chain.testnet
    ? [
      "- This desk is running on Arc TESTNET, a sandbox. It uses free test USDC, not real money.",
      "- Free test USDC: faucet.circle.com",
    ]
    : [
      `- It runs on ${where} (chain id ${chain.chainId}). Payments are real ${money}, a US dollar stablecoin issued by Paxos.`,
      `- Getting ${money}: it is available inside Robinhood Wallet and on exchanges on ${where}. Network fees there are`,
      `  paid in ${CFG.GAS_COIN}, not in ${money}, so a buyer needs a few cents of ${CFG.GAS_COIN} on ${where} as well.`,
      "  For how to move money onto the chain, send people to robinhood.com. Do not name any other bridge, exchange or website.",
    ];

  const wallet = chain.testnet
    ? [
      `- PIN wallet (no browser extension): ${PUBLIC_SITE}/wallet. A Circle wallet protected by a 6-digit PIN.`,
      "  Stubly never holds the keys. If someone loses both their PIN and their Account ID, nobody can recover it.",
    ]
    : [
      `- Paying needs an EVM browser wallet such as MetaMask or Robinhood Wallet, with ${where} added. The hire page`,
      "  offers to add the network. The Stubly PIN wallet does not work on this chain. Do not promise that it will.",
    ];

  const archive = chain.testnet
    ? []
    : [
      "- Stubly used to run on the Arc chain and moved to Robinhood Chain. Old Arc order pages are no longer served.",
      "  Any Arc order that was paid and never finished can be refunded to its buyer by the Arc escrow itself.",
      "  This help desk cannot look up or act on Arc orders: pass those to a person.",
    ];

  return [
    intro,
    "",
    ...network,
    `- Every order has a page: ${orderUrl("ORDER_NUMBER", chain.key)}. It shows the status and, once finished, the report.`,
    "- If an agent fails to deliver, or a paid order passes its deadline undelivered, the order is refunded to",
    "  the buyer's wallet automatically through the escrow.",
    '- Buyers can also take the money back themselves with the "Take my money back" button on the order page',
    "  once a funded order passes its deadline.",
    '- The help desk (the "Help desk" button on every page, and the support inbox) is an AI agent. Given an order',
    `  number it checks the order on ${where}, restarts it if the agent stalled, rebuilds a report that went missing,`,
    "  and refunds the wallet that paid when an order can't be finished. It cannot send money anywhere else,",
    "  change prices, or refund an order that finished and delivered its report.",
    `- Hiring several agents at once: ${PUBLIC_SITE}/crew. Each agent gets its own escrow.`,
    ...wallet,
    `- Buyers can cancel the standing ${money} spending permission with the "Revoke permission" button on the`,
    "  hire and crew pages once their wallet is connected.",
    `- Builders can list their own agent at ${PUBLIC_SITE}/list.`,
    ...archive,
    "- Stubly has no token right now. An earlier $STUBLY on the Arc chain is retired and Stubly does not use it.",
    "  A new one on Robinhood Chain is planned, with no date. Until stubly.org itself shows a token address, any coin",
    "  using the Stubly name is not affiliated with Stubly. Never give a token address or tell anyone to buy anything.",
  ].join("\n");
}

const FACTS = factsFor(CHAIN);

/** The link rule in words, for prompts: the same hosts checkText enforces. */
const linkRule = (hosts = LINK_HOSTS) => [...hosts].filter((h) => !h.startsWith("www.")).join(", ");

const STATUS_MEANING = {
  Open: "created but never funded, so the buyer was not charged",
  Funded: "paid into escrow; the agent is working on it",
  Submitted: "work delivered; being checked",
  Completed: "finished and paid; the report is on the order page",
  Rejected: "closed without payment to the agent; the escrow was refunded to the buyer",
  Expired: "the deadline passed and the escrow was returned to the buyer",
};

/* Order numbers. A fresh escrow numbers orders from 1, so "#12" and "order 12" count at any
   length up to 12 digits. A bare number with nothing marking it as an order only counts at
   6-7 digits, the length Stubly's testnet orders have, because "I paid 2 USDC in 2026" names
   no order. A marked number followed by a unit ("order 2 days ago") is not an order either,
   nor is the start of a date ("order 2026-09-15", "order 9/15"), nor a "#" that numbers
   something else ("Issue #2", "step #3"): those would send the desk to read a stranger's order
   and use up the two lookups a turn gets. */
const ORDER_REF = /(?:(?<!\b(?:issue|step|item|option|point|question|problem|bug|ticket|part|note|task|line|rule|reason|comment|attempt|try|pr|version|v)\s*)#|\border(?:\s+(?:number|no\.?|num|id))?\s*[:#]?\s*)([1-9]\d{0,11})\b(?![.,\/-]\d)(?!\s*(?:usdc|usd|dollars?|cents?|days?|hours?|hrs?|minutes?|mins?|seconds?|secs?|weeks?|months?|years?|times?|agents?|%))|\b([1-9]\d{5,6})\b(?![.,\/-]\d)/gi;

/** Every order number in a text, first mention first. */
function orderIds(text) {
  return [...new Set([...String(text || "").matchAll(ORDER_REF)].map((m) => m[1] || m[2]))];
}

/** Order numbers (#12, order 12, 185899) and wallet addresses mentioned in a message. */
function extractRefs(text) {
  const t = String(text || "");
  const ids = orderIds(t).slice(0, 3);
  const wallets = [...new Set((t.match(/\b0x[a-fA-F0-9]{40}\b/g) || []).map((s) => s.toLowerCase()))].slice(0, 2);
  return { ids, wallets };
}

/** "testnet" or "mainnet" when a message names exactly one of them, else null. */
function chainNamed(text) {
  const t = String(text || "");
  const test = /\btest\s*-?\s*net\b|\btest\s+usdc\b/i.test(t);
  const main = /\bmain\s*-?\s*net\b/i.test(t);
  return test && !main ? "testnet" : main && !test ? "mainnet" : null;
}

/**
 * The chain a text says one particular order is on, or null. Only a chain attached to that order
 * counts: "testnet order #12", "order #12 on testnet", "#12 (testnet)", or an order link with
 * &chain=. A chain named anywhere else in the message is not about this order: "I'm not on
 * testnet, order #12 is stuck" and "I used test USDC before, now order #12 never came" are about a
 * mainnet order, and tagging it testnet would answer a real-money order with "test USDC, no value"
 * without ever looking at it.
 */
function orderChain(text, id) {
  const t = String(text || "");
  const n = String(id || "");
  if (!/^\d{1,12}$/.test(n)) return null;
  const found = new Set();
  // An order page link names its own chain.
  for (const link of t.match(/\S*[?&]id=\d+\S*/gi) || []) {
    const q = link.slice(link.search(/[?&]/));
    if (new RegExp(`[?&]id=${n}(?!\\d)`, "i").test(q)) {
      const c = q.match(/[?&]chain=(testnet|mainnet)\b/i);
      if (c) found.add(c[1].toLowerCase());
    }
  }
  const NET = String.raw`(test|main)\s*-?\s*net\b`;
  const MARK = String.raw`(?:#\s*|\border(?:\s+(?:number|no\.?|num|id))?\s*[:#]?\s*)`;
  const near = [
    new RegExp(String.raw`\b${NET}\s+(?:order\b\s*(?:(?:number|no\.?|num|id)\s*)?[:#]?\s*|#\s*)${n}(?!\d)`, "gi"), // testnet order #12
    new RegExp(String.raw`(?:${MARK})?(?<![\d.])${n}(?!\d)\s*(?:\(\s*|,?\s+(?:is\s+|was\s+)?(?:on|from|in)\s+(?:the\s+)?)(?:arc\s+)?${NET}`, "gi"), // #12 on testnet
  ];
  for (const re of near) {
    for (const m of t.matchAll(re)) {
      // "not a testnet order #12" says the opposite.
      if (/\b(?:not|isn'?t|wasn'?t|never)\b[\s\w]{0,10}$/i.test(t.slice(Math.max(0, m.index - 16), m.index))) continue;
      found.add(`${m[1].toLowerCase()}net`);
    }
  }
  return found.size === 1 ? [...found][0] : null;
}

const MONEY = /\b(refund|money back|charged|chargeback|didn'?t (get|receive)|did not (get|receive)|never (got|received|delivered)|scam|stolen|lost (my )?(funds|usdc|money)|where is my (money|usdc)|paid (and|but))/i;

/** The rules any outgoing text must pass. Returns why it may not go out, or null. */
function checkText(reply, { maxChars = 1500, hosts: allowed = LINK_HOSTS } = {}) {
  const text = String(reply || "");
  if (!text.trim()) return "empty reply";
  if (text.length > maxChars) return "reply too long";

  // Links only to our own site, this chain's explorer, and the one place this chain's facts send people for USDC.
  const hosts = text.match(/(?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?=[\/\s,.)!?:;]|$)/gi) || [];
  for (const raw of hosts) {
    const before = text[text.indexOf(raw) - 1];
    if (before === "@") continue; // part of an email address, checked below
    const host = raw.replace(/^https?:\/\//i, "").toLowerCase();
    if (!allowed.has(host)) return `link to ${host}`;
  }
  const emails = text.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) || [];
  if (emails.some((e) => !e.toLowerCase().endsWith("@stubly.org"))) return "mentions an outside email address";

  /* Never ask anyone for a secret. A secret may only come up inside a warning, and "warning"
     is read narrowly: a negation right before the verb ("never share your PIN", "nobody will
     ask for it"). Looser readings let "Nothing to worry about, enter your PIN" and "Don't worry.
     Please provide your private key" through. "PIN wallet" and "6-digit PIN" are the product. */
  const SECRET = /\b(seed(\s+phrase)?|recovery\s+(phrase|words?)|secret\s+(phrase|words?)|mnemonic|private\s+key|pass(word|code|phrase)|account\s+id|(12|24)[\s-]+words?|(?<!\d-digit\s)pin(?!\s+wallet))\b/i;
  const WARNING = /\b(never|nobody|no\s+one|don't|do\s+not|won't|will\s+not|can't|cannot)\b[\s\w,']{0,14}?\b(share|give|send|enter|type|tell|ask|asks|request|recover|hold|holds|store|stores|see|sees)\b/i;
  for (const sentence of text.split(/(?<=[.!?])\s+|\n+/)) {
    if (SECRET.test(sentence) && !WARNING.test(sentence)) return "mentions a secret outside a warning";
  }
  if (/0x[a-f0-9]{64}/i.test(text) || /\b(api[ _-]?key|keystore|private key:)/i.test(text)) return "looks like it contains a secret";

  // No full wallet addresses, and never tell anyone to send money somewhere: that is how drainers talk.
  if (/\b0x[a-f0-9]{40}\b/i.test(text)) return "contains a full wallet address";
  if (/\b(send|transfer|deposit|pay)\b[^.\n]{0,30}\b(usdc|usd|money|funds|crypto|eth|tokens?)\b[^.\n]{0,20}\bto\b/i.test(text)) return "tells them to send money";

  // No promises about money.
  if (/\b(we will|we'll|i will|i'll|going to)\b[^.\n]{0,30}\b(refund|send|pay|transfer|reimburse)/i.test(text)) return "promises a payment";
  return null;
}

module.exports = {
  SITE, PUBLIC_SITE, CHAIN, LINK_HOSTS, FACTS, STATUS_MEANING, MONEY,
  chainFor, factsFor, linkRule, orderUrl, orderIds, extractRefs, chainNamed, orderChain, checkText,
};
