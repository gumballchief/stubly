"use strict";

/**
 * What Stubly support knows, and the checks anything it writes must pass.
 *
 * Shared by the support inbox (support.js) and the help desk chat (desk.js), so an
 * answer by email and an answer in the chat come from the same facts and go through
 * the same rules.
 */

/* Two addresses on purpose. SITE is where the worker calls the site's API, and can be a
   deployment URL. Customers only ever get the public one: a deployment URL in a reply
   fails the link check and throws the whole answer away. */
const SITE = (process.env.SITE_URL || "https://stubly.org").replace(/\/$/, "");
const PUBLIC_SITE = "https://stubly.org";
const LINK_HOSTS = new Set(["stubly.org", "www.stubly.org", "faucet.circle.com", "testnet.arcscan.app"]);

const FACTS = `
Stubly (stubly.org) is a marketplace where people hire AI agents for small jobs and pay in USDC.
The payment sits in Circle's own escrow contract (ERC-8183) on the Arc blockchain. When the work
passes an independent check the agent is paid; if it fails, the buyer is refunded by the contract.
Stubly never holds the money.

- It currently runs on Arc TESTNET only. It uses free test USDC, not real money.
- Free test USDC: faucet.circle.com
- Every order has a page: ${PUBLIC_SITE}/job?id=ORDER_NUMBER. It shows the status and, once finished, the report.
- If an agent fails to deliver, or a paid order passes its deadline undelivered, the order is refunded to
  the buyer's wallet automatically through the escrow.
- Buyers can also take the money back themselves with the "Take my money back" button on the order page
  once a funded order passes its deadline.
- The help desk (the "Help desk" button on every page, and the support inbox) is an AI agent. Given an order
  number it checks the order on Arc, restarts it if the agent stalled, rebuilds a report that went missing,
  and refunds the wallet that paid when an order can't be finished. It cannot send money anywhere else,
  change prices, or refund an order that finished and delivered its report.
- Hiring several agents at once: ${PUBLIC_SITE}/crew. Each agent gets its own escrow.
- PIN wallet (no browser extension): ${PUBLIC_SITE}/wallet. A Circle wallet protected by a 6-digit PIN.
  Stubly never holds the keys. If someone loses both their PIN and their Account ID, nobody can recover it.
- Buyers can cancel the standing USDC spending permission with the "Revoke permission" button on the
  hire and crew pages once their wallet is connected.
- Builders can list their own agent at ${PUBLIC_SITE}/list.
- Arc mainnet opens to the public on September 16. Stubly plans to move once Circle's contracts are live
  there. Do not promise a date.
- Stubly has NO token. Any coin or token using the Stubly name is not affiliated with Stubly.
`.trim();

const STATUS_MEANING = {
  Open: "created but never funded, so the buyer was not charged",
  Funded: "paid into escrow; the agent is working on it",
  Submitted: "work delivered; being checked",
  Completed: "finished and paid; the report is on the order page",
  Rejected: "closed without payment to the agent; the escrow was refunded to the buyer",
  Expired: "the deadline passed and the escrow was returned to the buyer",
};

/** Order numbers (#185899 or 185899) and wallet addresses mentioned in a message. */
function extractRefs(text) {
  const t = String(text || "");
  const ids = [...new Set((t.match(/#?\b[1-9]\d{5,6}\b/g) || []).map((s) => s.replace("#", "")))].slice(0, 3);
  const wallets = [...new Set((t.match(/\b0x[a-fA-F0-9]{40}\b/g) || []).map((s) => s.toLowerCase()))].slice(0, 2);
  return { ids, wallets };
}

const MONEY = /\b(refund|money back|charged|chargeback|didn'?t (get|receive)|did not (get|receive)|never (got|received|delivered)|scam|stolen|lost (my )?(funds|usdc|money)|where is my (money|usdc)|paid (and|but))/i;

/** The rules any outgoing text must pass. Returns why it may not go out, or null. */
function checkText(reply, { maxChars = 1500 } = {}) {
  const text = String(reply || "");
  if (!text.trim()) return "empty reply";
  if (text.length > maxChars) return "reply too long";

  // Links only to our own site and the two public tools we point people at.
  const hosts = text.match(/(?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?=[\/\s,.)!?:;]|$)/gi) || [];
  for (const raw of hosts) {
    const before = text[text.indexOf(raw) - 1];
    if (before === "@") continue; // part of an email address, checked below
    const host = raw.replace(/^https?:\/\//i, "").toLowerCase();
    if (!LINK_HOSTS.has(host)) return `link to ${host}`;
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

module.exports = { SITE, PUBLIC_SITE, LINK_HOSTS, FACTS, STATUS_MEANING, MONEY, extractRefs, checkText };
