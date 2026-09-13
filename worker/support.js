"use strict";

/**
 * support@stubly.org, answered by the worker.
 *
 * Every couple of minutes it reads new mail, looks up any order number it finds on
 * the chain, and decides one of three things: answer it, hand it to a person, or
 * leave it alone. The model drafts; the code has the last word.
 *
 * Why the code has the last word: an email is untrusted text from anyone on the
 * internet, and this runs in the same process that holds the signing keys. So the
 * support path never touches a signer — it can only read public order state and
 * send mail — and every reply the model writes goes through hard checks before it
 * leaves. Anything about money that the chain does not already show as settled goes
 * to a human, whatever the model thinks.
 *
 * Nothing is answered twice, even across restarts: before any reply is sent the
 * Sent folder is searched for an existing reply to that exact message.
 */

const { ImapFlow } = require("imapflow");
const nodemailer = require("nodemailer");
const MailComposer = require("nodemailer/lib/mail-composer");
const { simpleParser } = require("mailparser");
const { generate } = require("./llm");
const { fence, UNTRUSTED_NOTICE } = require("./untrusted");

const ADDRESS = (process.env.SUPPORT_EMAIL || "support@stubly.org").toLowerCase();
const PASSWORD = process.env.SUPPORT_EMAIL_PASSWORD || "";
/* Where escalations go. Deliberately not a default in code: the repo is public. */
const NOTIFY_TO = (process.env.SUPPORT_NOTIFY_TO || "").trim();
const HOST = process.env.SUPPORT_MAIL_HOST || "mail.privateemail.com";
const SITE = (process.env.SITE_URL || "https://stubly.org").replace(/\/$/, "");
const MODE = process.env.SUPPORT_MODE === "draft" ? "draft" : "send";
const POLL_MS = Number(process.env.SUPPORT_POLL_MS || 120_000);
const LOOKBACK_DAYS = 3;
const MAX_PER_SENDER_PER_DAY = 3;
const MAX_REPLIES_PER_DAY = 60;
const HANDLED = "$StublyHandled";

const LINK_HOSTS = new Set(["stubly.org", "www.stubly.org", "faucet.circle.com", "testnet.arcscan.app"]);
const SETTLED = new Set(["Open", "Completed", "Rejected", "Expired"]); // nothing is owed on any of these

const status = {
  enabled: false,
  mode: MODE,
  notify: NOTIFY_TO ? "on" : "not configured",
  tracking: null,
  lastCheck: null,
  lastError: null,
  newLastCheck: null,
  replied: 0,
  escalated: 0,
  ignored: 0,
  skippedAutomated: 0,
};
const supportStatus = () => ({ ...status });

const sentBySender = new Map();
const sentToday = [];

const FACTS = `
Stubly (stubly.org) is a marketplace where people hire AI agents for small jobs and pay in USDC.
The payment sits in Circle's own escrow contract (ERC-8183) on the Arc blockchain. When the work
passes an independent check the agent is paid; if it fails, the buyer is refunded by the contract.
Stubly never holds the money.

- It currently runs on Arc TESTNET only. It uses free test USDC, not real money.
- Free test USDC: faucet.circle.com
- Every order has a page: ${SITE}/job?id=ORDER_NUMBER — it shows the status and, once finished, the report.
- If an agent fails to deliver, the order is refunded to the buyer's wallet automatically.
- If a funded order passes its deadline undelivered, the buyer can take the money back from that
  order page with the "Take my money back" button.
- Hiring several agents at once: ${SITE}/crew — each agent gets its own escrow.
- PIN wallet (no browser extension): ${SITE}/wallet — a Circle wallet protected by a 6-digit PIN.
  Stubly never holds the keys. If someone loses both their PIN and their Account ID, nobody can recover it.
- Buyers can cancel the standing USDC spending permission with the "Revoke permission" button on the
  hire and crew pages once their wallet is connected.
- Builders can list their own agent at ${SITE}/list.
- Arc mainnet opens to the public on September 16. Stubly plans to move once Circle's contracts are live
  there. Do not promise a date.
- Stubly has NO token. Any coin or token using the Stubly name is not affiliated with Stubly.
`.trim();

const STATUS_MEANING = {
  Open: "created but never funded — the buyer was not charged",
  Funded: "paid into escrow; the agent is working on it",
  Submitted: "work delivered; being checked",
  Completed: "finished and paid; the report is on the order page",
  Rejected: "the work failed the check; the escrow was refunded to the buyer",
  Expired: "the deadline passed and the escrow was returned to the buyer",
};

/* ---------------- pure helpers (exported for the local test) ---------------- */

function senderOf(mail) {
  return (mail.from?.value?.[0]?.address || "").toLowerCase();
}

/** Mail that must never get a reply: bounces, auto-replies, lists, ourselves. */
function isAutomated(mail) {
  const from = senderOf(mail);
  if (!from) return "no sender";
  if (from === ADDRESS || from.endsWith("@stubly.org")) return "our own address";
  if (/^(no-?reply|do-?not-?reply|mailer-daemon|postmaster|bounces?|notifications?)([+._-].*)?@/i.test(from)) return "automated sender";
  const h = mail.headers || new Map();
  const auto = String(h.get("auto-submitted") || "").toLowerCase();
  if (auto && auto !== "no") return "auto-submitted";
  if (h.has("list-id") || h.has("list-unsubscribe")) return "mailing list";
  if (/^(bulk|list|junk)$/i.test(String(h.get("precedence") || ""))) return "bulk";
  if (h.has("x-autoreply") || h.has("x-autorespond")) return "autoresponder";
  if (/^(auto(matic)?[ -]?reply|out of (the )?office|undeliver|delivery status notification)/i.test(mail.subject || "")) return "auto-reply subject";
  return null;
}

/** Order numbers (#185899 or 185899) and wallet addresses mentioned in the mail. */
function extractRefs(text) {
  const t = String(text || "");
  const ids = [...new Set((t.match(/#?\b1\d{5}\b/g) || []).map((s) => s.replace("#", "")))].slice(0, 3);
  const wallets = [...new Set((t.match(/\b0x[a-fA-F0-9]{40}\b/g) || []).map((s) => s.toLowerCase()))].slice(0, 2);
  return { ids, wallets };
}

async function lookupOrders(ids) {
  const out = [];
  for (const id of ids) {
    try {
      const r = await fetch(`${SITE}/api/job?id=${id}`, { signal: AbortSignal.timeout(20_000) });
      const j = await r.json();
      if (!j || !j.live) { out.push({ id, found: false }); continue; }
      const overdue = (j.statusText === "Funded" || j.statusText === "Submitted") && Number(j.expiredAt) < Date.now() / 1000;
      let report = null;
      if (j.statusText === "Completed") {
        const d = await fetch(`${SITE}/api/deliverable?id=${id}`, { signal: AbortSignal.timeout(20_000) }).catch(() => null);
        report = !!(d && d.ok && (d.headers.get("content-type") || "").includes("markdown"));
      }
      out.push({ id, found: true, status: j.statusText, agent: j.agent, budget: j.budgetUsdc, overdue, report, page: `${SITE}/job?id=${id}` });
    } catch (e) {
      out.push({ id, found: false, error: e.message });
    }
  }
  return out;
}

const MONEY = /\b(refund|money back|charged|chargeback|didn'?t (get|receive)|did not (get|receive)|never (got|received|delivered)|scam|stolen|lost (my )?(funds|usdc|money)|where is my (money|usdc)|paid (and|but))/i;

function describeLookups(lookups) {
  if (!lookups.length) return "No order number was mentioned.";
  return lookups.map((l) => {
    if (!l.found) return `Order #${l.id}: not found on Stubly.`;
    const bits = [`Order #${l.id}: ${l.status} — ${STATUS_MEANING[l.status] || "unknown state"}`];
    if (l.overdue) bits.push("PAST ITS DEADLINE WHILE STILL FUNDED");
    if (l.report === false) bits.push("the report is NOT published yet");
    if (l.report === true) bits.push(`report available at ${l.page}`);
    return bits.join("; ");
  }).join("\n");
}

/** The hard rules. Returns a reason to escalate instead of sending, or null if the reply may go. */
function guardReply(reply, { mail, lookups }) {
  const text = String(reply || "");
  if (!text.trim()) return "empty reply";
  if (text.length > 1500) return "reply too long";

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

  // Never ask anyone for a secret. "Never share your PIN" is fine; "send us your PIN" is not.
  const askRe = /\b(send|share|give|tell|provide|enter|reply with|confirm)\b[^.\n]{0,40}\b(seed|recovery phrase|mnemonic|private key|pin|password|passcode|secret|account id)\b/gi;
  for (const m of text.matchAll(askRe)) {
    const lead = text.slice(Math.max(0, m.index - 24), m.index).toLowerCase();
    if (!/(never|not|n't|no one|nobody)/.test(lead)) return "asks for a secret";
  }
  if (/0x[a-f0-9]{64}/i.test(text) || /\b(api[ _-]?key|keystore|private key:)/i.test(text)) return "looks like it contains a secret";

  // No promises about money.
  if (/\b(we will|we'll|i will|i'll|going to)\b[^.\n]{0,30}\b(refund|send|pay|transfer|reimburse)/i.test(text)) return "promises a payment";

  // Money complaints only get an automatic answer when the chain already shows nothing is owed.
  const body = `${mail.subject || ""}\n${mail.text || ""}`;
  if (MONEY.test(body)) {
    if (!lookups.length) return "money question without an order number to verify";
    if (lookups.some((l) => !l.found || !SETTLED.has(l.status) || l.overdue || l.report === false)) return "money question the chain does not show as settled";
  }
  return null;
}

async function decide(mail, lookups) {
  const prompt = [
    "You answer the support inbox for Stubly. Decide what to do with ONE customer email.",
    "",
    "FACTS YOU MAY USE (nothing else is true about Stubly):",
    FACTS,
    "",
    "LIVE ORDER LOOKUP FROM THE BLOCKCHAIN (trustworthy):",
    describeLookups(lookups),
    "",
    UNTRUSTED_NOTICE,
    "",
    "Choose exactly one action:",
    '- "reply": ONLY for simple questions the facts or the lookup fully answer (how it works, test USDC,',
    "  where to find an order or report, PIN wallet basics, revoking permission, listing an agent, whether",
    "  a looked-up order was refunded or finished).",
    '- "escalate": refunds or money not clearly settled by the lookup, anything saying something is broken,',
    "  bugs, security reports, legal, press, partnerships, investment, grants, complaints, anything you",
    "  cannot answer from the facts, or anything you are unsure about.",
    '- "ignore": spam, sales pitches, SEO or marketing offers, scams, gibberish, messages not meant for Stubly.',
    "",
    "Rules for a reply: plain text, friendly, under 120 words, no markdown. Only link to stubly.org or",
    "faucet.circle.com. Never ask for a seed phrase, private key, PIN, password or Account ID. Never promise",
    "a refund, payment, amount or timeline. Never claim to be a human. Sign off: — Stubly support",
    "",
    'Respond with ONLY this JSON and nothing else: {"action":"reply|escalate|ignore","category":"short label",',
    '"reply":"the reply text, or a suggested draft if escalating","summary":"one line for the founder","reason":"why"}',
    "",
    `From: ${senderOf(mail)}`,
    fence(`Subject: ${mail.subject || "(none)"}\n\n${mail.text || ""}`, { maxChars: 6000 }),
  ].join("\n");

  let parsed = null;
  try {
    const { text } = await generate(prompt, { maxOutputTokens: 900 });
    const s = text.indexOf("{"), e = text.lastIndexOf("}");
    parsed = JSON.parse(text.slice(s, e + 1));
  } catch (err) {
    return { action: "escalate", category: "unreadable", reply: "", summary: "The model's answer could not be read.", reason: err.message };
  }
  const action = ["reply", "escalate", "ignore"].includes(parsed.action) ? parsed.action : "escalate";
  const out = {
    action,
    category: String(parsed.category || "general").slice(0, 40),
    reply: String(parsed.reply || ""),
    summary: String(parsed.summary || "").slice(0, 300),
    reason: String(parsed.reason || "").slice(0, 300),
  };
  if (out.action === "reply") {
    const blocked = guardReply(out.reply, { mail, lookups });
    if (blocked) { out.action = "escalate"; out.reason = `held back by the safety check: ${blocked}`; }
  }
  return out;
}

/* ---------------- mail plumbing ---------------- */

function capAllows(sender) {
  const dayAgo = Date.now() - 86_400_000;
  while (sentToday.length && sentToday[0] < dayAgo) sentToday.shift();
  const mine = (sentBySender.get(sender) || []).filter((t) => t > dayAgo);
  sentBySender.set(sender, mine);
  return sentToday.length < MAX_REPLIES_PER_DAY && mine.length < MAX_PER_SENDER_PER_DAY;
}

function noteSent(sender) {
  const now = Date.now();
  sentToday.push(now);
  sentBySender.set(sender, [...(sentBySender.get(sender) || []), now]);
}

function holdingReply(lookups) {
  return [
    "Hi,",
    "",
    "Thanks for writing in. This one needs a person, so it has been passed straight to the team and you will hear back soon.",
    ...(lookups.length ? [] : ["", "If it is about an order, reply with the order number (it starts with #) so it can be looked up faster."]),
    "",
    "— Stubly support",
  ].join("\n");
}

function transport() {
  return nodemailer.createTransport({ host: HOST, port: 465, secure: true, auth: { user: ADDRESS, pass: PASSWORD } });
}

async function alreadyReplied(client, sentPath, messageId) {
  if (!messageId || !sentPath) return false;
  const lock = await client.getMailboxLock(sentPath);
  try {
    const hits = await client.search({ header: { "in-reply-to": messageId } }, { uid: true });
    return Array.isArray(hits) && hits.length > 0;
  } finally {
    lock.release();
  }
}

async function sendReply(client, sentPath, mail, text) {
  const subject = mail.subject || "your message";
  const refs = [].concat(mail.references || []).filter(Boolean);
  const opts = {
    from: `Stubly Support <${ADDRESS}>`,
    to: senderOf(mail),
    subject: /^re:/i.test(subject) ? subject : `Re: ${subject}`,
    text,
    inReplyTo: mail.messageId,
    references: [...refs, mail.messageId].filter(Boolean),
  };
  await transport().sendMail(opts);
  noteSent(senderOf(mail));
  try {
    const raw = await new MailComposer(opts).compile().build();
    if (sentPath) await client.append(sentPath, raw, ["\\Seen"]);
  } catch { /* the reply went out; a missing Sent copy is not worth retrying for */ }
}

async function notifyFounder(mail, d, lookups) {
  if (!NOTIFY_TO) return false;
  const body = [
    "A support email needs you.",
    "",
    `From:     ${senderOf(mail)}`,
    `Subject:  ${mail.subject || "(none)"}`,
    `Category: ${d.category}`,
    `Summary:  ${d.summary}`,
    `Why:      ${d.reason}`,
    "",
    "Order lookup:",
    describeLookups(lookups),
    "",
    MODE === "send" ? "The customer has been sent a short note saying a person will follow up." : "Draft mode: the customer has NOT been answered.",
    "",
    "Suggested reply (not sent):",
    d.reply || "(none)",
    "",
    "Their message:",
    String(mail.text || "").slice(0, 3000),
    "",
    "Answer from support@stubly.org in Private Email webmail.",
  ].join("\n");
  await transport().sendMail({
    from: `Stubly Support Bot <${ADDRESS}>`,
    to: NOTIFY_TO,
    subject: `[Stubly support] needs you — ${mail.subject || d.category}`.slice(0, 200),
    text: body,
  });
  return true;
}

async function handleOne(client, sentPath, uid, source, log) {
  const mail = await simpleParser(source);
  const sender = senderOf(mail);
  const masked = sender.replace(/^(.{2}).*(@.*)$/, "$1…$2");

  const automated = isAutomated(mail);
  if (automated) { status.skippedAutomated++; log(`[support] uid ${uid} from ${masked}: skipped (${automated})`); return { flag: [] }; }

  if (await alreadyReplied(client, sentPath, mail.messageId)) {
    log(`[support] uid ${uid} from ${masked}: already answered earlier`);
    return { flag: [] };
  }

  const { ids, wallets } = extractRefs(`${mail.subject || ""}\n${mail.text || ""}`);
  const lookups = await lookupOrders(ids);
  const d = await decide(mail, lookups);
  if (wallets.length) d.summary = `${d.summary} (wallets mentioned: ${wallets.join(", ")})`;

  if (d.action === "ignore") {
    status.ignored++;
    log(`[support] uid ${uid} from ${masked}: ignored (${d.category})`);
    return { flag: [] };
  }

  if (d.action === "reply" && MODE === "send" && capAllows(sender)) {
    await sendReply(client, sentPath, mail, d.reply);
    status.replied++;
    log(`[support] uid ${uid} from ${masked}: answered (${d.category})`);
    return { flag: ["\\Answered"] };
  }

  if (d.action === "reply") d.reason = MODE === "draft" ? "draft mode — nothing is sent automatically" : "reply limit reached for this sender or today";

  // Escalate: tell the founder first, then let the customer know a person is on it.
  const notified = await notifyFounder(mail, d, lookups);
  if (MODE === "send" && capAllows(sender)) await sendReply(client, sentPath, mail, holdingReply(lookups));
  status.escalated++;
  log(`[support] uid ${uid} from ${masked}: escalated (${d.category})${notified ? "" : " — notify address not set, flagged in the inbox"}`);
  return { flag: ["\\Flagged"] };
}

async function checkOnce(log) {
  const client = new ImapFlow({
    host: HOST, port: 993, secure: true,
    auth: { user: ADDRESS, pass: PASSWORD },
    logger: false, socketTimeout: 90_000,
  });
  client.on("error", (e) => { status.lastError = e.message; });
  await client.connect();
  try {
    const boxes = await client.list();
    const sentPath = (boxes.find((b) => b.specialUse === "\\Sent") || boxes.find((b) => /^sent/i.test(b.path)) || {}).path || null;

    // Collect first: imapflow must not run other commands while a fetch is being iterated.
    let candidates = [];
    let lock = await client.getMailboxLock("INBOX");
    try {
      const flags = client.mailbox.permanentFlags || new Set();
      const keywords = flags.has("\\*");
      status.tracking = keywords ? "keyword" : "seen-flag";
      const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000);
      const query = keywords ? { unKeyword: HANDLED, since } : { seen: false, since };
      const uids = (await client.search(query, { uid: true })) || [];
      status.newLastCheck = uids.length;
      if (uids.length) {
        for await (const msg of client.fetch(uids.slice(0, 20), { source: true }, { uid: true })) {
          candidates.push({ uid: msg.uid, source: msg.source });
        }
      }
    } finally {
      lock.release();
    }

    for (const c of candidates) {
      let result;
      try {
        result = await handleOne(client, sentPath, c.uid, c.source, log);
      } catch (e) {
        status.lastError = `message ${c.uid}: ${e.message}`;
        log(`[support] uid ${c.uid}: ${e.message} — will retry next check`);
        continue; // not flagged, so it is picked up again
      }
      lock = await client.getMailboxLock("INBOX");
      try {
        const add = status.tracking === "keyword" ? [HANDLED, ...result.flag] : ["\\Seen", ...result.flag];
        await client.messageFlagsAdd(String(c.uid), add, { uid: true });
      } finally {
        lock.release();
      }
    }
  } finally {
    await client.logout().catch(() => {});
  }
}

function startSupport(log = console.log) {
  if (!PASSWORD) {
    status.enabled = false;
    status.lastError = "SUPPORT_EMAIL_PASSWORD not set";
    log("[support] off — SUPPORT_EMAIL_PASSWORD is not set");
    return;
  }
  status.enabled = true;
  log(`[support] watching ${ADDRESS} every ${Math.round(POLL_MS / 1000)}s (mode: ${MODE}, escalations: ${status.notify})`);

  /* Reading the inbox proves the password; it does not prove replies can leave. Log in to
     the outgoing server once at startup, so a broken send path shows on the health page
     instead of surfacing the first time a customer is waiting on an answer. */
  status.smtp = "checking";
  transport().verify()
    .then(() => { status.smtp = "ok"; })
    .catch((e) => { status.smtp = `failed: ${e.message}`; log(`[support] outgoing mail check failed: ${e.message}`); });
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await checkOnce(log);
      status.lastError = null;
    } catch (e) {
      status.lastError = e.message;
      log(`[support] check failed: ${e.message}`);
    } finally {
      status.lastCheck = new Date().toISOString();
      running = false;
    }
  };
  tick();
  setInterval(tick, POLL_MS);
}

module.exports = { startSupport, supportStatus, _test: { isAutomated, extractRefs, lookupOrders, guardReply, decide } };
