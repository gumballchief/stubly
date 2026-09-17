"use strict";

/**
 * The help desk: the agent behind the chat on stubly.org, and behind the support
 * inbox whenever an email names an order.
 *
 * It can check an order, restart a stalled one, put back a lost report, and give
 * the money back. What it cannot do is decide to. Every action is picked by fixed
 * rules over what the chain says, and re-checked inside that order's lock right
 * before anything is signed. The model only writes the explanation, after the
 * actions are already done. So no message, however it is worded, can make the desk
 * do anything these rules would not have done on their own. At most it happens sooner.
 *
 * Money only ever goes back to the wallet that paid for that exact order:
 *  - while the escrow still holds it, through the evaluator's reject(), which
 *    Circle's contract pays out to the order's client and nobody else;
 *  - for a finished order whose report is gone and cannot be rebuilt, as a
 *    transfer of exactly that order's price. The transfer is signed first, recorded
 *    write-once together with its signature, and only that one signed transaction is
 *    ever broadcast, so no retry, restart or second worker can pay it twice.
 */

const fs = require("fs");
const crypto = require("crypto");
const { formatUnits } = require("ethers");
const { CFG, JOB_STATUS } = require("../chain/config");
const jobsLib = require("../chain/jobs");
const { generate } = require("./llm");
const { fence, UNTRUSTED_NOTICE } = require("./untrusted");
const { publishDeliverable, recordRefund } = require("./publish");
const { SITE, CHAIN, FACTS, linkRule, orderUrl, orderIds, extractRefs, orderChain, checkText } = require("./brain");

const ZERO = "0x0000000000000000000000000000000000000000";
const DEADLINE_SEC = 600;        // every Stubly order is created with a ten-minute escrow deadline
const START_GRACE_SEC = 120;     // the buyer's browser starts a first run the moment it funds; don't race it
const LATE_GRACE_SEC = 300;      // an undelivered order may still be worked this long past its deadline
const AGENT_ATTEMPTS = 3;
const SUBMIT_ATTEMPTS = 3;
const RUNS_PER_ORDER_PER_HOUR = 3;
const RECOVERY_EVERY_MS = 86_400_000; // one report rebuild per order per day, however often it is asked about
const GAS_MARGIN = 100_000n;     // 0.1 USDC kept back for gas on top of a refund transfer
const TESTNET = CFG.CHAIN_ID === 5042002;
/* Refunding a finished order means sending our own USDC. On testnet that is play money;
   anywhere else it stays off until someone turns it on deliberately. */
const TRANSFER_REFUNDS = process.env.DESK_TRANSFER_REFUNDS ? process.env.DESK_TRANSFER_REFUNDS === "on" : TESTNET;
const MAX_TRANSFER_USDC = Number(process.env.DESK_MAX_REFUND_USDC || 25);
const DAILY_TRANSFER_USDC = Number(process.env.DESK_DAILY_TRANSFER_USDC || 100);
const DAILY_ESCROW_REFUNDS = Number(process.env.DESK_DAILY_ESCROW_REFUNDS || 40);
const DAILY_MESSAGES = Number(process.env.DESK_DAILY_MESSAGES || 1500);
const REPLY_DEADLINE_MS = 45_000;
const REFUND_WAIT_MS = 25_000;   // a chat answer does not wait longer than this on a refund; the refund carries on
const MAX_ACTIVE_CHATS = 6;
const MAX_BODY_BYTES = 64_000;

const ORIGINS = new Set([
  "https://stubly.org",
  "https://www.stubly.org",
  ...String(process.env.DESK_EXTRA_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean),
]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nowSec = () => Math.floor(Date.now() / 1000);
const short = (a) => `${String(a).slice(0, 6)}…${String(a).slice(-4)}`;
const usdc = (v) => { const s = formatUnits(v, 6); return s.includes(".") ? s.replace(/\.?0+$/, "") : s; };
const orderLink = (id, chain) => orderUrl(id, chain);
// No explorer configured for this chain means no proof link, never a link into another chain's explorer.
const txLink = (hash) => (hash && CHAIN.explorer ? `${CHAIN.explorer}/tx/${hash}` : null);
const walletLink = (addr) => (addr && CHAIN.explorer ? `${CHAIN.explorer}/address/${addr}` : null);
const agentName = (key) => (key ? String(key).split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ") : "the agent");
// Errors end up on the public health page and in logs; an RPC error can carry the RPC URL, keys and all.
const errText = (e) => String(e?.shortMessage || e?.message || e).replace(/https?:\/\/\S+/g, "[url]").slice(0, 160);

/* ————— the rules ————— */

/**
 * Why an order still in escrow can no longer be finished, or null if it still can.
 * The settlement loop uses the same function, so the desk never refunds anything
 * the loop would not have refunded by itself.
 */
function refundReason({ status, now, expiredAt, attempts = 0, submitFails = 0, report = null }) {
  if (status === "Funded") {
    if (attempts >= AGENT_ATTEMPTS) return `the agent failed ${attempts} times`;
    if (submitFails >= SUBMIT_ATTEMPTS) return "its delivery could not be recorded on Arc";
    if (now > expiredAt + LATE_GRACE_SEC) return "it passed its deadline without a delivery";
  }
  if (status === "Submitted" && report === false && now > expiredAt) return "the delivered report was lost before it could be checked";
  return null;
}

/** What to do about an order, from its case file alone. */
function plan(cf, inLock = false) {
  if (!cf.found) return { code: "not-found" };
  if (!cf.ours) return { code: "not-ours" };
  if (cf.sub) return { code: "sub-order" };
  const busy = cf.busy && !inLock;
  const age = cf.now - (cf.expiredAt - DEADLINE_SEC);
  switch (cf.status) {
    case "Open":
      if (cf.budget > 0n) return { code: "unfunded" };
      return age > START_GRACE_SEC && !busy ? { code: "unquoted", action: "run" } : { code: "quoting" };
    case "Funded": {
      if (busy) return { code: "working", watch: true };
      const why = refundReason(cf);
      if (why) return { code: "refund", action: "refund", why, watch: true };
      if (age < START_GRACE_SEC) return { code: "starting", watch: true };
      return { code: "stalled", action: "run", watch: true };
    }
    case "Submitted": {
      if (busy) return { code: "working", watch: true };
      const why = refundReason(cf);
      if (why) return { code: "refund", action: "refund", why, watch: true };
      if (cf.report) return { code: "judging", action: "run", watch: true };
      return { code: "checking", watch: true };
    }
    case "Completed":
      if (cf.report === true) return { code: "done" };
      if (cf.report === null) return { code: "done-unknown" };
      return { code: "report-lost", action: "recover", watch: true };
    case "Rejected": return { code: "refunded" };
    case "Expired": return { code: "expired" };
    default: return { code: "lookup-failed" };
  }
}

/* ————— bookkeeping ————— */

let W = null;
let OURS = null;
/** The worker hands over its read contract, signers, state and order locks once they exist. */
function attach(worker) {
  // Kept by reference, never copied: the worker rebuilds its contract object every pass, and `jobs` is a live getter.
  W = worker;
  OURS = { provider: worker.providerAddr.toLowerCase(), evaluator: worker.evaluatorAddr.toLowerCase() };
}
const ready = () => !!W;

const stats = {
  chats: 0, emails: 0, limited: 0, replyFallbacks: 0, runs: 0, escrowRefunds: 0, transferRefunds: 0, rebuilt: 0, needsPerson: 0,
  clientKeys: { cf: 0, forwarded: 0, socket: 0 }, // which header identified callers; checks the rate limit keys on real addresses
  lastError: null,
};
const deskStatus = () => ({ enabled: !!W, transferRefundsEnabled: TRANSFER_REFUNDS, ...stats });

const daily = { day: "", escrow: 0, transferUsdc: 0 };
function today() {
  const d = new Date().toISOString().slice(0, 10);
  if (daily.day !== d) Object.assign(daily, { day: d, escrow: 0, transferUsdc: 0 });
  return daily;
}

const events = new Map();      // order id → what the desk did, for the chat to show later
const recoveries = new Map();  // order id → { at, code: running|rebuilt|present|refunded|needs-person, why, tx }
const runs = new Map();        // order id → times the desk restarted it

function capMap(map, max = 500) {
  while (map.size > max) map.delete(map.keys().next().value);
}

function note(id, ev) {
  const list = events.get(id) || [];
  list.push({ at: Date.now(), ...ev });
  events.set(id, list.slice(-12));
  capMap(events);
  console.log(`[desk] #${id} ${ev.title}${ev.detail ? `: ${ev.detail}` : ""}`);
}

function runAllowed(id) {
  const now = Date.now();
  const list = (runs.get(id) || []).filter((t) => now - t < 3_600_000);
  const ok = list.length < RUNS_PER_ORDER_PER_HOUR;
  if (ok) list.push(now);
  runs.set(id, list);
  capMap(runs, 2000);
  return ok;
}

/* ————— looking an order up ————— */

async function publishedReport(id) {
  try {
    // Uncached on purpose: a cached 404 read twice is one read, not two.
    // chainId names the store this worker's orders live in; without it the site reads its default chain's reports.
    const r = await fetch(`${SITE}/api/deliverable?id=${id}&chainId=${CFG.CHAIN_ID}&fresh=${Date.now()}`, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
    if (r.status === 404) return "";
    if (!r.ok) return null;
    return (await r.text()) || null;
  } catch {
    return null;
  }
}

/** true: readable. false: a real not-found twice, a few seconds apart. null: could not tell. Nothing is ever refunded on null. */
async function reportReadable(id) {
  const first = await publishedReport(id);
  if (first) return true;
  if (first === null) return null;
  await sleep(3000);
  const second = await publishedReport(id);
  return second ? true : second === null ? null : false;
}

async function inspect(id, { report = true } = {}) {
  const j = await jobsLib.withRetry(() => W.jobs.getJob(BigInt(id)));
  const client = String(j.client ?? j[1]);
  if (!client || client === ZERO) return { id, found: false };
  let spec = null;
  try { spec = JSON.parse(j.description ?? j[4]); } catch { /* not a Stubly order */ }
  const status = JOB_STATUS[Number(j.status ?? j[7])] || "?";
  const st = W.state.jobs[id] || {};
  const cf = {
    id,
    found: true,
    status,
    client,
    ours: String(j.provider ?? j[2]).toLowerCase() === OURS.provider
      && String(j.evaluator ?? j[3]).toLowerCase() === OURS.evaluator
      && !!(spec && W.AGENTS[spec.agent]),
    sub: !!spec?.sub,
    // Paid in the token (worker/tokenpay.js): the escrow's client is Stubly's pay wallet, and the buyer's tokens go back from there.
    paidInToken: !!spec?.pay,
    agent: spec?.agent || null,
    input: spec?.input || {},
    budget: BigInt(j.budget ?? j[5]),
    expiredAt: Number(j.expiredAt ?? j[6]),
    now: nowSec(),
    attempts: st.attempts || 0,
    submitFails: st.submitFails || 0,
    hash: st.hash || null,
    file: st.file || null,
    busy: W.busy(id),
    report: null,
  };
  cf.budgetUsdc = usdc(cf.budget);
  if (report && cf.ours && !cf.sub && (status === "Submitted" || status === "Completed")) {
    const local = status === "Submitted" && cf.file && fs.existsSync(cf.file);
    cf.report = local ? true : await reportReadable(id);
  }
  return cf;
}

/* ————— acting on it ————— */

async function act(cf, p) {
  if (p.action === "run") {
    if (!runAllowed(cf.id)) return { code: "held", watch: true, cf };
    if (!W.tryRun(cf.id)) return { code: "working", watch: true, cf };
    stats.runs++;
    note(cf.id, { title: p.code === "unquoted" ? "Pricing now" : p.code === "judging" ? "Judging" : "Restarted", tone: "blue", detail: agentName(cf.agent) });
    return { ...p, cf };
  }
  if (p.action === "refund") {
    // Past the desk's daily cap it steps aside rather than hold the order's lock: the loop refunds it on its next pass.
    if (today().escrow >= DAILY_ESCROW_REFUNDS) return { code: "refund", why: p.why, cf, watch: true };
    // A refund can queue behind other writes from the same key. The chat answers within REFUND_WAIT_MS either
    // way; if the refund lands later, the chat hears about it from /status.
    const running = refundFromEscrow(cf.id).catch((e) => {
      stats.lastError = `refund #${cf.id}: ${errText(e)}`;
      return { code: "refund-failed", why: p.why, cf, watch: true };
    });
    return Promise.race([running, sleep(REFUND_WAIT_MS).then(() => ({ code: "refund", why: p.why, cf, watch: true }))]);
  }
  if (p.action === "recover") return recoverReport(cf);
  return { ...p, cf };
}

/** `why` is shown to the buyer; `detail` only goes to the logs and the founder. */
function needsPerson(cf, why, detail = "") {
  stats.needsPerson++;
  note(cf.id, {
    title: "Needs a person",
    tone: "red",
    detail: why,
    text: `Order #${cf.id} needs a person: ${why}. Email support@stubly.org with the order number and it will be picked up there.`,
  });
  if (detail) console.log(`[desk] #${cf.id} detail: ${detail}`);
  Promise.resolve()
    .then(() => W.notify?.(`order #${cf.id} needs a person`, [
      `Order #${cf.id}: ${agentName(cf.agent)}, ${cf.budgetUsdc} USDC, ${cf.status}`,
      `Buyer wallet: ${cf.client}`,
      `Why: ${why}`,
      detail ? `Detail: ${detail}` : "",
      "",
      orderLink(cf.id),
    ].filter((l) => l !== null).join("\n")))
    .catch(() => {});
  return { code: "needs-person", why, cf };
}

function refundedNow(cf, why, tx) {
  today().escrow++;
  stats.escrowRefunds++;
  W.state.jobs[cf.id] = { ...(W.state.jobs[cf.id] || {}), phase: "refunded", refundReason: why };
  W.save();
  note(cf.id, {
    title: "Refunded",
    tone: "green",
    detail: `${cf.budgetUsdc} USDC back to ${short(cf.client)}`,
    link: txLink(tx) || walletLink(cf.client),
    text: `Order #${cf.id} couldn't be finished because ${why}, so it was refunded. the escrow sent ${cf.budgetUsdc} USDC back to the wallet that paid (${short(cf.client)}).`,
  });
  return { code: "refunded-now", why, cf, tx };
}

/** Give the escrow back to the buyer. Re-checked inside the order's lock, right before signing. */
async function refundFromEscrow(id) {
  if (W.busy(id)) return { code: "working", watch: true, cf: { id } };
  return W.withJobLock(id, async () => {
    const cf = await inspect(id);
    const p = plan(cf, true);
    if (p.action !== "refund") return { ...p, cf };
    if (today().escrow >= DAILY_ESCROW_REFUNDS) return { code: "refund", why: p.why, cf, watch: true }; // the loop refunds it by itself
    try {
      const rc = await jobsLib.reject(W.evaluatorSigner, id, `Stubly help desk refund: ${p.why}`);
      return refundedNow(cf, p.why, rc?.hash);
    } catch (e) {
      stats.lastError = `refund #${id}: ${errText(e)}`;
      console.log(`[desk] #${id} refund failed: ${errText(e)}`);
      // A failure after a blip can still mean the first attempt landed. Ask the chain, not the error.
      const after = await inspect(id).catch(() => null);
      if (after?.status === "Rejected") return refundedNow(after, p.why, null);
      if (after && after.status !== cf.status) return { ...plan(after, true), cf: after };
      return { code: "refund-failed", why: p.why, cf, watch: true };
    }
  });
}

function setRecovery(id, code, extra = {}) {
  recoveries.set(id, { at: Date.now(), code, why: extra.why || "", tx: extra.tx || null });
  capMap(recoveries);
}

async function recoverReport(cf) {
  const id = cf.id;
  // Asked again? Answer from what already happened instead of running the agent again.
  const prior = recoveries.get(id);
  if (prior && (prior.code === "running" || Date.now() - prior.at < RECOVERY_EVERY_MS)) {
    return { code: prior.code === "running" ? "recovering" : `recovery-${prior.code}`, why: prior.why, tx: prior.tx, cf, watch: prior.code === "running" };
  }
  setRecovery(id, "running");
  rebuildOrRefund(cf)
    .then((r) => setRecovery(id, r.code, r))
    .catch((e) => {
      stats.lastError = `recover #${id}: ${errText(e)}`;
      setRecovery(id, "needs-person", needsPerson(cf, "the report could not be recovered automatically", errText(e)));
    });
  return { code: "recovering", cf, watch: true };
}

const rebuiltNote = () =>
  `> Stubly note: the original copy of this report was lost after the order settled, so the agent ran the same job again on ${new Date().toISOString().slice(0, 10)}. ` +
  "Because it is a new run, this copy will not match the fingerprint recorded on Arc for the original.";

async function rebuildOrRefund(cf0) {
  const id = cf0.id;

  // The original may still be on this machine, matching what was committed on Arc. That is the best copy there is.
  let content = "";
  let original = false;
  if (cf0.file && cf0.hash && fs.existsSync(cf0.file)) {
    const text = fs.readFileSync(cf0.file, "utf8");
    if (jobsLib.contentHash(text) === cf0.hash) { content = text; original = true; }
  }

  // Otherwise run the agent again. Outside the order's lock: it can take minutes, and nothing should wait on it.
  // Launch Kit hires and pays other agents when it runs, so it is refunded instead of re-run.
  const agent = W.AGENTS[cf0.agent];
  if (!content && agent && cf0.agent !== "launch-kit") {
    for (let attempt = 1; attempt <= 2 && !content; attempt++) {
      try {
        const out = await agent.run(cf0.input || {});
        content = out && typeof out.content === "string" ? out.content.trim() : "";
        if (!content) throw new Error("the agent returned an empty report");
      } catch (e) {
        content = "";
        console.log(`[desk] #${id} rebuild attempt ${attempt} failed: ${errText(e)}`);
      }
    }
  }

  return W.withJobLock(id, async () => {
    const cf = await inspect(id);
    const p = plan(cf, true);
    if (p.code === "done") return { code: "present" };
    if (p.code !== "report-lost") return needsPerson(cf, "the report store could not be checked", `plan is ${p.code}`);

    if (content) {
      // Write-once: if a report appeared in the meantime, it stays and nothing is refunded.
      const pub = await publishDeliverable(id, original ? content : `${rebuiltNote()}\n\n${content}`, { rebuild: true });
      if (pub.exists) return { code: "present" };
      if (!pub.published) return needsPerson(cf, "the rebuilt report could not be published", pub.reason);
      stats.rebuilt++;
      note(id, {
        title: original ? "Report restored" : "Report rebuilt",
        tone: "green",
        detail: "It's on the order page",
        link: orderLink(id),
        linkText: "read the report",
        text: original
          ? `Order #${id}: the original report is back on the order page.`
          : `Order #${id}: the report is back on the order page. The original copy was lost, so ${agentName(cf.agent)} ran the same job again.`,
      });
      return { code: "rebuilt" };
    }
    return refundByTransfer(cf);
  });
}

/** The last resort, for a finished order whose report is gone for good: send its price back to the wallet that paid. */
async function refundByTransfer(cf) {
  const id = cf.id;
  const amount = cf.budget;
  const dollars = Number(formatUnits(amount, 6));
  if (!TRANSFER_REFUNDS) return needsPerson(cf, "automatic refunds for finished orders are switched off on this network");
  // Its client is the pay wallet, not the buyer, and the buyer paid in tokens: a USDC transfer would refund the wrong wallet in the wrong money.
  if (cf.paidInToken) return needsPerson(cf, "this order was paid in tokens, so its refund is handled by a person");
  if (amount <= 0n) return needsPerson(cf, "the order had no price to refund");
  if (dollars > MAX_TRANSFER_USDC) return needsPerson(cf, "the order is above the automatic refund limit");
  if (today().transferUsdc + dollars > DAILY_TRANSFER_USDC) return needsPerson(cf, "today's limit for automatic refunds was reached");

  let claimProblem = "the refund could not be recorded before sending";
  try {
    const r = await jobsLib.transferUsdc(W.providerSigner, cf.client, amount, {
      reserve: GAS_MARGIN,
      // Recorded after it is signed and before it is sent: the record holds the only transaction that may ever pay this refund.
      claim: async ({ hash, raw, nonce }) => {
        const c = await recordRefund(id, {
          order: id, chainId: CFG.CHAIN_ID, to: cf.client, amount: amount.toString(),
          reason: "report lost and could not be rebuilt", txHash: hash, nonce, signedTx: raw, at: new Date().toISOString(),
        });
        if (!c.claimed && c.already) claimProblem = "a refund for this order was already recorded once";
        return c.claimed;
      },
    });
    if (!r.claimed) return needsPerson(cf, claimProblem);
    today().transferUsdc += dollars;
    stats.transferRefunds++;
    note(id, {
      title: "Refunded",
      tone: "green",
      detail: `${cf.budgetUsdc} USDC back to ${short(cf.client)}`,
      link: txLink(r.hash),
      text: `Order #${id}: the report couldn't be rebuilt, so ${cf.budgetUsdc} USDC was sent back to the wallet that paid (${short(cf.client)}).`,
    });
    return { code: "refunded", tx: r.hash };
  } catch (e) {
    stats.lastError = `transfer #${id}: ${errText(e)}`;
    if (e.code === "SHORT") return needsPerson(cf, "the refund wallet is short on USDC");
    if (e.txHash) {
      today().transferUsdc += dollars;
      return { ...needsPerson(cf, `the refund was sent but is not confirmed yet (transaction ${e.txHash})`, errText(e)), tx: e.txHash };
    }
    return needsPerson(cf, "the refund could not be sent", errText(e));
  }
}

/**
 * Look at each order, and do whatever the rules say it needs. Shared by the chat and the inbox.
 * Takes order numbers, or { id, chain } when the customer said which chain the order is on.
 */
async function review(orders) {
  const out = [];
  for (const item of orders.slice(0, 2)) {
    const id = String(item && typeof item === "object" ? item.id : item);
    const chain = item && typeof item === "object" ? item.chain : null;
    /* An order on another chain lives in another contract with its own numbering, so this
       chain's order with the same number is somebody else's order. It is answered in words
       only: nothing is read from this chain and nothing is signed. */
    if (chain && chain !== CHAIN.key) {
      out.push({ id, code: "other-chain", chain, cf: { id } });
      continue;
    }
    try {
      const cf = await inspect(id);
      if (cf.ours && !cf.sub && ["Open", "Funded", "Submitted"].includes(cf.status) && !W.state.jobs[id]) {
        W.state.jobs[id] = { phase: "seen" }; // older than the loop's lookback, or lost in a redeploy: the loop owns it again
        W.save();
      }
      const p = plan(cf);
      const o = p.action ? await act(cf, p) : { ...p, cf };
      out.push({ id, ...o, cf: o.cf && o.cf.found !== undefined ? o.cf : cf });
    } catch (e) {
      stats.lastError = `review #${id}: ${errText(e)}`;
      out.push({ id, code: "lookup-failed", cf: { id } });
    }
  }
  return out;
}

/* ————— saying what happened ————— */

/** Code-written words and a stamp for every outcome. The chat model may rephrase these; it may not add to them. */
function describe(o) {
  const id = o.id;
  const cf = o.cf || {};
  const page = orderLink(id);
  const usd = cf.budgetUsdc;
  const agent = agentName(cf.agent);
  const why = o.why || "";
  if (o.code === "other-chain") return describeOtherChain(o);
  // Stubly's testnet orders stay readable after the move, and their numbers are what people remember.
  const archiveHint = CHAIN.testnet ? "" : ` If it's an older Arc testnet order, its page is ${orderLink(id, "testnet")}.`;
  const T = {
    "lookup-failed": [`I couldn't read order #${id} from Arc just now. Try again in a minute.`, { title: "Try again", tone: "red", detail: "Arc didn't answer" }, true],
    "not-found": [`There's no order #${id} on Stubly. Check the number at the top of your order page.${archiveHint}`, { title: "Not found", tone: "red", detail: `#${id}` }, true],
    "not-ours": [`Order #${id} exists on Arc, but it wasn't placed with a Stubly agent, so I can't act on it.`, { title: "Not a Stubly order", tone: "ink", detail: `#${id}` }, true],
    "sub-order": [`Order #${id} is an internal step inside a Launch Kit order. Check the Launch Kit order itself instead.`, { title: "Internal step", tone: "ink", detail: `#${id}` }],
    unfunded: [`Order #${id} was never paid, so nothing was charged. You can fund it from its order page.`, { title: "Not paid", tone: "ink", detail: "Nothing was charged", link: page }],
    quoting: [`Order #${id} is waiting for its price, which normally takes under a minute. Nothing has been charged.`, { title: "Pricing", tone: "blue", link: page }],
    unquoted: [`Order #${id} was stuck waiting for its price, so I asked the worker to price it now. Nothing has been charged.`, { title: "Pricing now", tone: "blue", link: page }],
    starting: [`Order #${id} was paid moments ago and ${agent} is starting. Most reports take one to three minutes.`, { title: "In progress", tone: "blue", detail: agent, link: page }],
    working: [`${agent} is working on order #${id} right now. Most reports take one to three minutes.`, { title: "In progress", tone: "blue", detail: agent, link: page }],
    stalled: [`Order #${id} was paid but had stalled, so I restarted ${agent}. If it can't be finished, the escrow refunds the wallet that paid automatically.`, { title: "Restarted", tone: "blue", detail: agent, link: page }],
    judging: [`${agent} delivered order #${id}, and I asked the judge to check it now.`, { title: "Judging", tone: "blue", detail: agent, link: page }],
    held: [`Order #${id} has already been restarted several times this hour. The worker keeps trying on its own, and the escrow refunds the wallet that paid if it can't be finished.`, { title: "Retrying", tone: "blue", detail: agent, link: page }],
    checking: [`${agent} delivered order #${id}. The judge checks it as soon as the report is readable.`, { title: "Delivered", tone: "blue", detail: "Waiting on the judge", link: page }],
    refund: [`Order #${id} can't be finished because ${why}. Its refund through the escrow is on the way, and this chat shows it when it lands.`, { title: "Refund queued", tone: "blue", detail: `${usd} USDC`, link: page }],
    done: [`Order #${id} is finished, and the report is on its order page.`, { title: "Completed", tone: "green", detail: "Report ready", link: page, linkText: "read the report" }],
    "done-unknown": [`Order #${id} is finished. I couldn't load the report just now, so try the order page again in a minute.`, { title: "Completed", tone: "green", link: page }],
    recovering: [`Order #${id} finished, but its report went missing. I'm rebuilding it now, which takes a minute or two. If it can't be rebuilt, the ${usd} USDC goes back to the wallet that paid.`, { title: "Rebuilding", tone: "blue", detail: "Report went missing", link: page }],
    "recovery-rebuilt": [`The report for order #${id} was rebuilt earlier today. If the order page doesn't show it yet, refresh it in a minute.`, { title: "Report rebuilt", tone: "green", link: page, linkText: "read the report" }],
    "recovery-present": [`The report for order #${id} turned out to be there after all. It's on the order page.`, { title: "Completed", tone: "green", detail: "Report ready", link: page, linkText: "read the report" }],
    "recovery-refunded": [`The report for order #${id} couldn't be rebuilt, so its ${usd} USDC was already sent back to the wallet that paid (${short(cf.client)}).`, { title: "Refunded", tone: "green", detail: `${usd} USDC to ${short(cf.client)}`, link: txLink(o.tx) || walletLink(cf.client), linkText: o.tx ? "view on Arc" : "view wallet" }],
    "recovery-needs-person": [`Order #${id} needs a person: ${why}. Email support@stubly.org with the order number and it will be picked up there.`, { title: "Needs a person", tone: "red", detail: why }, true],
    refunded: [`Order #${id} was already refunded. the escrow returned ${usd} USDC to the wallet that paid (${short(cf.client)}).`, { title: "Refunded", tone: "green", detail: `${usd} USDC returned`, link: walletLink(cf.client), linkText: "view wallet" }],
    expired: [`Order #${id} passed its deadline, and its ${usd} USDC was already taken back from the escrow.`, { title: "Expired", tone: "ink", detail: `${usd} USDC returned`, link: walletLink(cf.client), linkText: "view wallet" }],
    "refunded-now": [`Order #${id} couldn't be finished because ${why}, so I refunded it. the escrow sent ${usd} USDC back to the wallet that paid (${short(cf.client)}).`, { title: "Refunded", tone: "green", detail: `${usd} USDC to ${short(cf.client)}`, link: txLink(o.tx) || walletLink(cf.client), linkText: o.tx ? "view on Arc" : "view wallet" }],
    "refund-failed": [`Order #${id} is due a refund because ${why}, but the transaction didn't go through just now. The worker retries it automatically.`, { title: "Refund retrying", tone: "red", detail: `${usd} USDC`, link: page }, true],
    "needs-person": [`Order #${id} needs a person: ${why}. Email support@stubly.org with the order number and it will be picked up there.`, { title: "Needs a person", tone: "red", detail: why }, true],
  };
  const [plain, step, person] = T[o.code] || T["lookup-failed"];
  /* An order paid in tokens: the escrow's USDC goes back to Stubly's pay wallet, and the buyer's tokens go back to
     them from there. "USDC back to the wallet that paid" would name the wrong wallet and the wrong money. */
  const tokenRefund = o.cf?.paidInToken && ["refunded", "refunded-now", "expired", "refund"].includes(o.code);
  const text = !tokenRefund ? plain
    : `Order #${id} ${o.code === "refund" ? `can't be finished because ${why}, so it is being refunded` : o.code === "expired" ? "passed its deadline and was refunded" : "was refunded"}. It was paid in tokens, so the tokens go back to the wallet that paid automatically, usually within a few minutes.`;
  return { text, step: tokenRefund ? { ...step, detail: "Tokens go back automatically", link: page, linkText: "open order" } : step, needsPerson: !!person, watch: !!o.watch };
}

/**
 * An order on a chain this worker does not serve. The worker moves to mainnet at the flip and
 * testnet stops taking orders, but every testnet order page stays up, and a paid testnet order
 * that was never delivered is long past its ten-minute deadline, so its buyer can withdraw it
 * from that page without anyone's help. Written by code, so it can't drift into a promise.
 */
function describeOtherChain(o) {
  const id = o.id;
  const page = orderLink(id, o.chain);
  if (o.chain === "testnet") {
    return {
      text: `Order #${id} is on Arc testnet, which used test USDC with no real value. Testnet is closed to new orders and I can only act on Arc mainnet orders, but its page still shows what happened: ${page}. If it was paid and never delivered, its deadline has passed, so the wallet that paid can take the test USDC back with the "Take my money back" button there.`,
      step: { title: "Testnet order", tone: "ink", detail: "Test USDC, read-only", link: page, linkText: "open order" },
      needsPerson: false,
      watch: false,
    };
  }
  return {
    text: `Order #${id} is on Arc mainnet, and this help desk only works on Arc testnet orders. Email support@stubly.org with the order number and it will be picked up there.`,
    step: { title: "Mainnet order", tone: "red", detail: "Needs a person", link: page, linkText: "open order" },
    needsPerson: true,
    watch: false,
  };
}

const GENERIC =
  "I can check an order on Arc, restart it if the agent stalled, and refund the wallet that paid if it can't be finished. " +
  "Send me the order number (it's at the top of your order page and starts with #). For anything else, email support@stubly.org.";

/** Anything the model claims happened must have happened this turn, and any number it gives must come from the checks. */
function replyProblem(text, outcomes) {
  const bad = checkText(text, { maxChars: 900 });
  if (bad) return bad;
  const said = outcomes.map((o) => describe(o).text).join(" ");
  const did = new Set(outcomes.map((o) => o.code));
  const any = (...codes) => codes.some((c) => did.has(c));
  const sentences = text.split(/(?<=[.!?])\s+|\n+/);
  const conditional = /\b(if|when|once|whenever|automatically|always|would|can|could)\b/i;

  const refundClaim = /\b(refunded|reimbursed|credited|sent\s+(it|them|the\s+\w+|your\s+\w+)?\s*back|returned\s+(the|your)\s+(usdc|money|funds|payment))\b|\b\d+(\.\d+)?\s*usdc\s+back\b/i;
  if (!any("refunded", "refunded-now", "expired", "recovery-refunded") && sentences.some((s) => refundClaim.test(s) && !conditional.test(s))) {
    return "claims a refund that did not happen";
  }
  if (!any("stalled", "held") && sentences.some((s) => /\brestart(ed|ing)\b/i.test(s) && !conditional.test(s))) return "claims a restart that did not happen";
  if (/\b(rebuilt|rebuilding|restored)\b/i.test(text) && !any("recovering", "recovery-rebuilt")) return "claims a recovery that did not happen";

  // The same reading of order numbers the desk uses on the way in, so "#12" can't slip past because it is short.
  const checked = new Set(outcomes.map((o) => String(o.id)));
  for (const id of orderIds(text)) {
    if (!checked.has(id)) return `mentions order ${id}, which was not checked`;
  }
  for (const m of text.matchAll(/(\d+(?:\.\d+)?)\s*USDC/gi)) {
    if (!said.includes(`${m[1]} USDC`)) return `mentions an amount (${m[0]}) the check did not`;
  }
  for (const m of text.matchAll(/0x[a-f0-9]{3,}/gi)) {
    if (!said.toLowerCase().includes(m[0].toLowerCase())) return "mentions an address the check did not";
  }
  return null;
}

function withDeadline(promise, ms) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("reply took too long")), ms); })])
    .finally(() => clearTimeout(timer));
}

async function composeReply(messages, outcomes) {
  const said = outcomes.map((o) => describe(o).text);
  const fallback = said.length ? said.join("\n\n") : GENERIC;
  /* An order on another chain gets the code's words as they are. Given "this desk can't act on
     it", the model tended to ask for the order number again instead of passing on where the
     order page is and how its buyer takes the money back. */
  if (outcomes.some((o) => o.code === "other-chain")) return fallback;
  const transcript = messages.map((m) => `[${m.role === "user" ? "Customer" : "Help desk"}] ${m.text}`).join(" ");
  const prompt = [
    "You are the Stubly help desk, an AI agent answering a live chat on stubly.org.",
    "",
    "FACTS YOU MAY USE (nothing else is true about Stubly):",
    FACTS,
    "",
    "ORDERS CHECKED THIS TURN. This comes from the blockchain and the worker and is trustworthy.",
    "Everything described here has ALREADY happened. Nothing else has.",
    said.length ? said.map((s) => `- ${s}`).join("\n") : "- No order number was given, so no order was checked.",
    "",
    UNTRUSTED_NOTICE,
    "",
    "How to answer:",
    "- Reply to the customer's latest message. Plain text, no markdown. At most 90 words. Warm, direct, sentence case. No em dashes.",
    "- If an order was checked, tell them what happened to it in your own words, without adding anything the check does not say.",
    "- Never say you did something unless the check above says it happened. Never promise a refund, payment, amount or time.",
    "- Only mention order numbers, amounts and wallet addresses that appear in the check above.",
    "- If they describe a problem with an order but no order was checked, ask for the order number (at the top of the order page, starting with #).",
    "- You cannot send money on request, change prices, or refund an order that finished with its report. Refunds only ever go to the wallet that paid, and only when an order can't be finished.",
    `- Never ask for a seed phrase, private key, PIN, password or Account ID. Only link to ${linkRule()}.`,
    "- If they ask for a human, tell them to email support@stubly.org.",
    "",
    'Respond with ONLY this JSON: {"reply":"your message"}',
    "",
    "THE CONVERSATION SO FAR, oldest first:",
    fence(transcript, { maxChars: 8000 }),
  ].join("\n");

  let text = "";
  try {
    const r = await withDeadline(generate(prompt, { maxOutputTokens: 500 }), REPLY_DEADLINE_MS);
    const s = r.text.indexOf("{");
    const e = r.text.lastIndexOf("}");
    text = String(JSON.parse(r.text.slice(s, e + 1)).reply || "").replace(/\s*—\s*/g, ", ").trim();
  } catch (e) {
    stats.lastError = `reply: ${errText(e)}`;
  }
  const problem = text ? replyProblem(text, outcomes) : "no reply from the model";
  if (problem) {
    stats.replyFallbacks++;
    console.log(`[desk] model reply not used (${problem})`);
    return fallback;
  }
  return text;
}

/* ————— HTTP: the chat on stubly.org ————— */

/* The desk only believes its own earlier replies. It signs each one, the widget sends the
   signature back with the history, and any "help desk" turn without a valid one is dropped,
   so a pasted script cannot put words in the desk's mouth. The key lives for one process;
   after a restart older turns simply drop out of the context. */
const TURN_KEY = crypto.randomBytes(32);
const signTurn = (conversation, text) => crypto.createHmac("sha256", TURN_KEY).update(`${conversation}\n${text}`).digest("base64url");
function validTurn(conversation, m) {
  if (typeof m.sig !== "string" || m.sig.length !== 43) return false;
  const given = Buffer.from(m.sig);
  const expected = Buffer.from(signTurn(conversation, m.text));
  return given.length === expected.length && crypto.timingSafeEqual(given, expected); // multibyte input would otherwise throw
}

const hits = new Map(); // key → { windowMs, times }
const GLOBAL_KEYS = new Set(["all", "miss"]);
const MAX_KEYS = 50_000;

/** Sliding-window limit. Returns seconds to wait, or 0 if allowed (and counts the hit). */
function limited(key, limit, windowMs) {
  const now = Date.now();
  const entry = hits.get(key) || { windowMs, times: [] };
  entry.times = entry.times.filter((t) => now - t < windowMs);
  if (entry.times.length >= limit) {
    hits.set(key, entry);
    return Math.max(1, Math.ceil((windowMs - (now - entry.times[0])) / 1000));
  }
  entry.times.push(now);
  if (!hits.has(key) && hits.size >= MAX_KEYS) {
    for (const k of hits.keys()) { if (!GLOBAL_KEYS.has(k)) { hits.delete(k); break; } }
  }
  hits.set(key, entry);
  return 0;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, e] of hits) {
    e.times = e.times.filter((t) => now - t < e.windowMs);
    if (!e.times.length) hits.delete(k);
  }
}, 60_000).unref();

let active = 0;

function ipv6Prefix(ip) {
  const [head, tail = ""] = ip.split("::");
  const a = head ? head.split(":") : [];
  const b = tail ? tail.split(":") : [];
  const full = [...a, ...Array(Math.max(0, 8 - a.length - b.length)).fill("0"), ...b];
  return `${full.slice(0, 4).join(":")}::/64`; // one household or phone gets a whole /64; limit it as one
}

/**
 * Who is calling, for rate limits. Cloudflare, in front of Render, overwrites cf-connecting-ip,
 * so a caller cannot choose it. Without it, the last x-forwarded-for hop is the one our own
 * proxy appended; everything before it is whatever the caller sent.
 */
function clientKey(req) {
  const h = req.headers;
  let ip = String(h["cf-connecting-ip"] || "").trim();
  let source = "cf";
  if (!ip) {
    const hops = String(h["x-forwarded-for"] || "").split(",").map((s) => s.trim()).filter(Boolean);
    ip = hops[hops.length - 1] || "";
    source = "forwarded";
  }
  if (!ip) { ip = String(req.socket?.remoteAddress || "unknown"); source = "socket"; }
  stats.clientKeys[source]++;
  if (ip.includes(":") && !ip.startsWith("::ffff:")) ip = ipv6Prefix(ip);
  return crypto.createHash("sha256").update(ip).digest("hex").slice(0, 16); // never logged or kept raw
}

function send(res, code, body, headers = {}) {
  try {
    res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store", ...headers });
    res.end(JSON.stringify(body));
  } catch { /* the caller hung up */ }
}

function readJson(req, max) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let over = false;
    const chunks = [];
    req.setTimeout(15_000, () => { reject(Object.assign(new Error("timeout"), { status: 408 })); req.destroy(); });
    req.on("data", (c) => {
      size += c.length;
      if (size > max) {
        over = true;
        if (size > max * 4) req.destroy(); // drain a little so the caller can read a 413; not forever
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (over) return reject(Object.assign(new Error("too large"), { status: 413 }));
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); } catch { reject(Object.assign(new Error("bad json"), { status: 400 })); }
    });
    req.on("close", () => { if (over) reject(Object.assign(new Error("too large"), { status: 413 })); });
    req.on("error", reject);
  });
}

function cleanMessages(list, conversation) {
  return (Array.isArray(list) ? list : []).slice(-12)
    .filter((m) => m && typeof m.text === "string" && (m.role === "user" || (m.role === "agent" && validTurn(conversation, m))))
    .map((m) => ({ role: m.role, text: m.text.trim().slice(0, m.role === "user" ? 1000 : 1500) }))
    .filter((m) => m.text);
}

/**
 * The orders a turn is about: numbers in the latest message, else the last one mentioned, else the
 * order page they're on. Each carries the chain it is on when that is known: the one the message
 * attaches to that order ("testnet order #12"), or for the order page, the page's own chain. null
 * means this worker's chain, so a loosely worded message is looked up here rather than waved off.
 */
function turnOrders(messages, pageOrder, pageChain = null) {
  const users = messages.filter((m) => m.role === "user");
  const from = (text) =>
    extractRefs(text).ids.map((id) => ({ id, chain: orderChain(text, id) || (id === pageOrder ? pageChain : null) }));
  const latest = from(users[users.length - 1]?.text || "");
  if (latest.length) return latest.slice(0, 2);
  for (let i = users.length - 2; i >= 0; i--) {
    const found = from(users[i].text);
    if (found.length) return found.slice(-1);
  }
  return pageOrder ? [{ id: pageOrder, chain: pageChain }] : [];
}

function ordersFor(messages, pageOrder) {
  return turnOrders(messages, pageOrder).map((o) => o.id);
}

async function chat(req, res) {
  // JSON only. A plain form or no-cors POST from another site cannot set this without a preflight we refuse.
  if (!/^application\/json\b/i.test(String(req.headers["content-type"] || ""))) {
    return send(res, 415, { reply: "The help desk only accepts messages from the chat on stubly.org." });
  }
  const who = clientKey(req);
  const wait = limited(`m:${who}`, 6, 60_000) || limited(`h:${who}`, 40, 3_600_000) || limited(`d:${who}`, 150, 86_400_000);
  if (wait) {
    stats.limited++;
    return send(res, 429, { reply: `That's a lot of messages in a short time. You can send again in ${Math.min(wait, 3600)} seconds.`, retryAfter: Math.min(wait, 3600) }, { "retry-after": String(Math.min(wait, 3600)) });
  }
  let body;
  try {
    body = await readJson(req, MAX_BODY_BYTES);
  } catch (e) {
    return send(res, e.status || 400, { reply: "That message couldn't be read. Try sending it again." });
  }
  const conversation = /^[a-z0-9]{6,40}$/i.test(String(body.conversation || "")) ? String(body.conversation) : `anon${who}`;
  const messages = cleanMessages(body.messages, conversation);
  const last = messages[messages.length - 1];
  if (!last || last.role !== "user") return send(res, 400, { reply: "Type a message first." });

  // Busy first, then the shared daily budget, so being turned away never uses anyone's quota up.
  if (active >= MAX_ACTIVE_CHATS) return send(res, 503, { reply: "The help desk is busy with other people right now. Try again in a few seconds.", retryAfter: 15 });
  const capped = limited("all", DAILY_MESSAGES, 86_400_000);
  if (capped) {
    stats.limited++;
    return send(res, 429, { reply: "The help desk has reached its message limit for today. Email support@stubly.org with your order number and it will be answered there.", retryAfter: Math.min(capped, 3600) });
  }

  active++;
  try {
    stats.chats++;
    const pageOrder = /^\d{1,12}$/.test(String(body.context?.orderId || "")) ? String(body.context.orderId) : null;
    const pageChain = ["testnet", "mainnet"].includes(body.context?.chain) ? body.context.chain : null;
    const outcomes = await review(turnOrders(messages, pageOrder, pageChain));
    const reply = (await composeReply(messages, outcomes)).slice(0, 1500);
    const described = outcomes.map((o) => ({ o, d: describe(o) }));
    const watched = described.find((x) => x.d.watch);
    console.log(`[desk] chat ${who.slice(0, 6)}: ${outcomes.map((o) => `#${o.id} ${o.code}`).join(", ") || "no order"}`);
    return send(res, 200, {
      reply,
      sig: signTurn(conversation, reply),
      steps: described.map((x) => x.d.step),
      watch: watched ? { orderId: watched.o.id, chain: CHAIN.key, status: watched.o.cf?.status || null, since: Date.now() } : null,
    });
  } finally {
    active--;
  }
}

const statusCache = new Map();
const statusFlight = new Map();

async function statusInspect(id) {
  const hit = statusCache.get(id);
  if (hit && Date.now() - hit.at < 10_000) return hit.cf;
  if (statusFlight.has(id)) return statusFlight.get(id);
  if (limited("miss", 60, 60_000)) return null; // a global budget on chain reads, so polling can't crowd out settlement
  const p = inspect(id, { report: false })
    .then((cf) => { statusCache.set(id, { at: Date.now(), cf }); capMap(statusCache); return cf; })
    .finally(() => statusFlight.delete(id));
  statusFlight.set(id, p);
  return p;
}

/** What the chat polls while it follows an order: its status, and anything the desk did since. Reads only. */
async function status(req, res, url) {
  const wait = limited(`s:${clientKey(req)}`, 20, 60_000);
  if (wait) return send(res, 429, { retryAfter: wait });
  const id = String(url.searchParams.get("order") || "");
  if (!/^\d{1,12}$/.test(id)) return send(res, 400, { error: "order required" });
  // Only orders the worker or the desk is actually following. Anything else has nothing to report.
  if (!W.state.jobs[id] && !events.has(id) && !recoveries.has(id)) return send(res, 200, { status: null, settled: true, events: [] });

  const since = Number(url.searchParams.get("since") || 0);
  const cf = await statusInspect(id);
  if (!cf) return send(res, 503, { retryAfter: 30 });
  const busy = W.busy(id) || recoveries.get(id)?.code === "running";
  return send(res, 200, {
    status: cf.status || null,
    settled: !cf.found || !cf.ours || (!busy && ["Completed", "Rejected", "Expired"].includes(cf.status)),
    events: (events.get(id) || [])
      .filter((e) => e.at > since)
      .map(({ at, title, detail, tone, link, linkText, text }) => ({ at, title, detail, tone, link, linkText, text })),
  });
}

function cors(req, res) {
  const origin = req.headers.origin;
  if (origin && ORIGINS.has(origin)) res.setHeader("access-control-allow-origin", origin);
  res.setHeader("vary", "origin");
  res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type");
  res.setHeader("access-control-max-age", "600");
}

/** The routes the desk owns. Returns false for anything else, so the health endpoint keeps answering it. */
function handleHttp(req, res) {
  let url;
  try { url = new URL(req.url || "/", "http://desk"); } catch { return false; } // "//" and friends are not ours
  if (url.pathname !== "/chat" && url.pathname !== "/status") return false;
  cors(req, res);
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return true; }
  const origin = req.headers.origin;
  if (origin && !ORIGINS.has(origin)) { send(res, 403, { error: "origin not allowed" }); return true; }
  if (!W) { send(res, 503, { reply: "The help desk is starting up. Try again in a minute, or email support@stubly.org.", retryAfter: 30 }); return true; }

  const route = url.pathname === "/chat" && req.method === "POST" ? chat(req, res)
    : url.pathname === "/status" && req.method === "GET" ? status(req, res, url)
    : Promise.resolve(send(res, 405, { error: "method not allowed" }));
  route.catch((e) => {
    stats.lastError = `${url.pathname}: ${errText(e)}`;
    console.log(`[desk] ${url.pathname} failed: ${errText(e)}`);
    if (!res.headersSent) send(res, 500, { reply: "Something broke on the help desk's side. Try again, or email support@stubly.org with your order number." });
  });
  return true;
}

/** For the support inbox: the same review, shaped like its order lookups. */
async function reviewForEmail(orders) {
  stats.emails++;
  const outcomes = await review(orders);
  return outcomes.map((o) => {
    const d = describe(o);
    return { id: o.id, found: o.code !== "not-found", status: o.cf?.status, report: o.cf?.report ?? null, page: orderLink(o.id, o.chain), handled: true, outcome: d.text, needsPerson: d.needsPerson };
  });
}

module.exports = {
  attach, ready, handleHttp, deskStatus, reviewForEmail, refundReason, reportReadable,
  // The same request plumbing for the other routes on the worker's server (worker/tokenpay.js).
  http: { send, readJson, limited, clientKey, cors, ORIGINS },
  _test: { plan, describe, inspect, review, composeReply, replyProblem, ordersFor, turnOrders, cleanMessages, signTurn, limited, clientKey },
};
