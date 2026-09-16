"use strict";

/**
 * support@stubly.org, answered by the worker.
 *
 * Every couple of minutes it reads new mail and decides one of three things: answer
 * it, hand it to a person, or leave it alone. When a mail names an order, the help
 * desk (desk.js) checks that order first and does whatever the rules say it needs
 * (restart it, rebuild a lost report, refund it), so the answer can say what was
 * done. The model drafts; the code has the last word.
 *
 * Why the code has the last word: an email is untrusted text from anyone on the
 * internet, and this runs in the same process that holds the signing keys. So the
 * words of a mail never reach a signer. All a mail can do is name an order, and what
 * happens to that order is decided by fixed rules over chain state, exactly as if it
 * had been named in the chat. Every reply the model writes goes through hard checks
 * before it leaves, and anything about money the order check did not resolve goes
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
const { SITE, CHAIN, FACTS, STATUS_MEANING, MONEY, linkRule, orderUrl, extractRefs, orderChain, checkText } = require("./brain");

/** A mail's own words: quoted lines ("> ...") and everything from the quoted-history header down are dropped. */
function freshText(text) {
  const lines = [];
  for (const line of String(text || "").split(/\r?\n/)) {
    // Gmail/Apple "On … wrote:", the classic "-----Original Message-----", and Outlook's rule line.
    if (/^\s*On\b.{0,200}\bwrote:\s*$/i.test(line) || /^\s*-{2,}\s*(Original|Forwarded) Message\s*-{2,}/i.test(line) || /^\s*_{10,}\s*$/.test(line)) break;
    if (/^\s*>/.test(line)) continue;
    lines.push(line);
  }
  return lines.join("\n");
}
const desk = require("./desk");

const ADDRESS = (process.env.SUPPORT_EMAIL || "support@stubly.org").toLowerCase();
const PASSWORD = process.env.SUPPORT_EMAIL_PASSWORD || "";
/* Where escalations go. Deliberately not a default in code: the repo is public. */
const NOTIFY_TO = (process.env.SUPPORT_NOTIFY_TO || "").trim();
const HOST = process.env.SUPPORT_MAIL_HOST || "mail.privateemail.com";
const MODE = process.env.SUPPORT_MODE === "draft" ? "draft" : "send";
const POLL_MS = Number(process.env.SUPPORT_POLL_MS || 120_000);
const LOOKBACK_DAYS = 3;
const MAX_PER_SENDER_PER_DAY = 3;
const MAX_REPLIES_PER_DAY = 60;
const HANDLED = "$StublyHandled";

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
const failures = new Map(); // message uid → failed attempts at handling it

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

/**
 * Read-only lookup, used when the help desk is not running (local tests, --once). Takes order
 * numbers, or { id, chain }. The site serves both chains, so the chain always goes with the
 * number: the same number is a different order on the other chain.
 */
async function lookupOrders(orders) {
  const out = [];
  for (const item of orders) {
    const id = String(item && typeof item === "object" ? item.id : item);
    const chain = (item && typeof item === "object" && item.chain) || CHAIN.key;
    try {
      const r = await fetch(`${SITE}/api/job?id=${id}&chain=${chain}`, { signal: AbortSignal.timeout(20_000) });
      const j = await r.json();
      if (!j || !j.live) { out.push({ id, found: false }); continue; }
      const overdue = (j.statusText === "Funded" || j.statusText === "Submitted") && Number(j.expiredAt) < Date.now() / 1000;
      let report = null;
      if (j.statusText === "Completed") {
        const d = await fetch(`${SITE}/api/deliverable?id=${id}&chain=${chain}`, { signal: AbortSignal.timeout(20_000) }).catch(() => null);
        report = !!(d && d.ok && (d.headers.get("content-type") || "").includes("markdown"));
      }
      out.push({ id, found: true, status: j.statusText, agent: j.agent, budget: j.budgetUsdc, overdue, report, page: orderUrl(id, chain) });
    } catch (e) {
      out.push({ id, found: false, error: e.message });
    }
  }
  return out;
}

function describeLookups(lookups) {
  if (!lookups.length) return "No order number was mentioned.";
  return lookups.map((l) => {
    if (l.outcome) return l.outcome;
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
  const problem = checkText(reply);
  if (problem) return problem;

  // Money complaints only get an automatic answer when the order check resolved or fully explains them.
  const body = `${mail.subject || ""}\n${mail.text || ""}`;
  if (MONEY.test(body)) {
    if (!lookups.length) return "money question without an order number to verify";
    const unresolved = (l) => (l.handled ? l.needsPerson : !l.found || !SETTLED.has(l.status) || l.overdue || l.report === false);
    if (lookups.some(unresolved)) return "money question the order check did not resolve";
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
    "ORDER CHECK FROM THE BLOCKCHAIN (trustworthy; anything it says was done has already been done):",
    describeLookups(lookups),
    "",
    UNTRUSTED_NOTICE,
    "",
    "Choose exactly one action:",
    `- "reply": for simple questions the facts fully answer (how it works, ${CHAIN.testnet ? "test USDC" : "getting USDC on Arc"}, where to find an order or`,
    "  report, PIN wallet basics, revoking permission, listing an agent), and for order problems the order check",
    "  above already resolved or fully explains (it was restarted, refunded, rebuilt, is in progress, or finished).",
    '- "escalate": money or order problems the order check did not resolve, anything saying something is broken',
    "  that the check does not explain, bugs, security reports, legal, press, partnerships, investment, grants,",
    "  complaints, anything you cannot answer from the facts, or anything you are unsure about.",
    '- "ignore": spam, sales pitches, SEO or marketing offers, scams, gibberish, messages not meant for Stubly.',
    "",
    `Rules for a reply: plain text, friendly, under 120 words, no markdown. Only link to ${linkRule()}.`,
    "Never ask for a seed phrase, private key, PIN, password or Account ID. Never promise",
    "a refund, payment, amount or timeline beyond what the order check says was done. Never claim to be a",
    "human. Sign off: — Stubly support",
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

/** A short note to the founder from anywhere in the worker. Does nothing until SUPPORT_NOTIFY_TO is set. */
async function notifyTeam(subject, text) {
  if (!NOTIFY_TO || !PASSWORD) return false;
  await transport().sendMail({
    from: `Stubly Help Desk <${ADDRESS}>`,
    to: NOTIFY_TO,
    subject: `[Stubly desk] ${subject}`.slice(0, 200),
    text,
  });
  return true;
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
    "Order check:",
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

  /* Only what the customer wrote this time. A reply quotes our last answer, which names order
     numbers and testnet links of its own, and those must not turn into orders or chains. */
  const asked = `${mail.subject || ""}\n${freshText(mail.text)}`;
  const { ids, wallets } = extractRefs(asked);
  // "testnet order #12" is answered without touching this chain; a chain named elsewhere in the mail is not about the order.
  const orders = ids.map((id) => ({ id, chain: orderChain(asked, id) }));
  // The same check-and-fix the chat runs. Without the worker attached (local tests), a read-only lookup.
  const lookups = desk.ready() ? await desk.reviewForEmail(orders) : await lookupOrders(orders);
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
        /* Retried, but not forever. Each retry re-runs the whole order check, and a mail that
           fails every time would otherwise do that every two minutes for days. */
        const tries = (failures.get(c.uid) || 0) + 1;
        failures.set(c.uid, tries);
        if (tries < 3) {
          log(`[support] uid ${c.uid}: ${e.message} — will retry next check`);
          continue; // not flagged, so it is picked up again
        }
        log(`[support] uid ${c.uid}: failed ${tries} times — flagged for a person instead of retrying`);
        result = { flag: ["\\Flagged"] };
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

module.exports = { startSupport, supportStatus, notifyTeam, _test: { isAutomated, extractRefs, freshText, lookupOrders, guardReply, decide } };
