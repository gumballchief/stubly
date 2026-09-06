"use strict";

/**
 * End-to-end proof for crews, the multi-agent sibling of e2e.js.
 *
 * Runs exactly what the browser runs on /crew, from the client keystore instead
 * of a wallet extension: ask /api/plan for a crew, then for each agent place its
 * OWN work order — create, quote, fund, settle. Separate escrows are the whole
 * point, so this proves the money moves per agent rather than in one lump.
 *
 *   node chain/crew-e2e.js "everything I need to launch my API on Tuesday"
 *   node chain/crew-e2e.js --dry "..."     (plan only, no chain writes, no spend)
 *   node chain/crew-e2e.js --break=2 "..." (fund step 2 and never deliver it, then
 *                                           wait out its deadline and take the money
 *                                           back — proves one failure refunds alone)
 *
 * Needs the site running so the same /api/quote and /api/settle the page uses
 * are the ones under test:  node site/dev-server.js
 */

require("dotenv").config();
const { formatUnits } = require("ethers");
const { CFG, provider, loadWallet } = require("./config");
const jobsLib = require("./jobs");

const SITE = process.env.CREW_E2E_SITE || "http://localhost:8791";
const DRY = process.argv.includes("--dry");
/* Which step (1-based) to deliberately leave undelivered, so its escrow runs out
   the clock and refunds while the rest of the crew gets paid. */
const BREAK = Number((process.argv.find((a) => a.startsWith("--break=")) || "").split("=")[1] || 0);
/* The contract's floor is 600s (ExpiryTooShort under it). A broken step wants
   the shortest deadline there is; the others want room to settle. */
const EXPIRY_BROKEN = 600;
const EXPIRY_NORMAL = 1800;
const ASK = process.argv.slice(2).filter((a) => a !== "--dry" && !a.startsWith("--break=")).join(" ")
  || "we're doing a security pass before launch — headers, env vars, and a test plan";

/* A crew step whose input the planner could not extract still needs one before
   it can be ordered. On the page a human types it; here we stand in with
   something honest and obviously a test. */
const STAND_IN = {
  url: "https://stubly.org",
  envlist: "DATABASE_URL, NEXT_PUBLIC_API_URL, STRIPE_SECRET_KEY, NODE_ENV",
  feature: "hiring a crew of agents and funding one escrow per agent",
};
function fillInput(step) {
  if (String(step.input || "").trim()) return step.input;
  return STAND_IN[step.field] || `${step.title} for Stubly, an agent-hire marketplace on Arc`;
}

async function post(path, body) {
  const r = await fetch(`${SITE}${path}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  return r.json();
}

async function main() {
  console.log(`\nask   "${ASK}"`);
  console.log(`site   ${SITE}${DRY ? "   (dry run — nothing is created or funded)" : ""}\n`);

  const plan = await post("/api/plan", { text: ASK });
  if (!plan.ok) throw new Error(`no crew: ${plan.reason}`);

  const steps = plan.steps.map((s) => ({ ...s, input: fillInput(s) }));
  console.log(`crew of ${steps.length} — ${plan.totalUsdc} USDC total`);
  steps.forEach((s, i) => console.log(`  ${i + 1}. ${s.title.padEnd(20)} ${s.priceUsdc} USDC  ${s.field}="${String(s.input).slice(0, 46)}"`));
  if (DRY) return console.log("\ndry run: stopping before any chain write.\n");

  const prov = provider();
  const client = loadWallet(CFG.CLIENT_KEY, prov);
  /* chain/config's CFG holds chain constants only — the marketplace wallet
     addresses come from the keystores, not from it. Reading them off CFG gives
     undefined, which ethers reports as "unsupported addressable value". */
  const providerAddr = loadWallet(CFG.PROVIDER_KEY, prov).address;
  const evaluatorAddr = loadWallet(CFG.EVALUATOR_KEY, prov).address;
  const { usdc } = await jobsLib.contracts(prov);
  const dec = await jobsLib.withRetry(() => usdc.decimals());
  const before = await jobsLib.withRetry(() => usdc.balanceOf(client.address));
  console.log(`\nclient ${client.address}  ${formatUnits(before, dec)} USDC\n`);

  const crew = { id: Math.random().toString(36).slice(2, 10), n: steps.length };
  const placed = [];
  let broken = null;

  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    const isBroken = BREAK === i + 1;
    const label = `${i + 1}/${steps.length} ${s.title}${isBroken ? "   ← left undelivered on purpose" : ""}`;
    try {
      console.log(`— ${label}`);
      const jobId = await jobsLib.createJob(client, {
        providerAddr,
        evaluatorAddr,
        expiresInSec: isBroken ? EXPIRY_BROKEN : EXPIRY_NORMAL,
        description: JSON.stringify({ v: 1, agent: s.agent, input: { [s.field]: s.input }, crew: { ...crew, i: i + 1 } }),
      });

      const q = await post("/api/quote", { jobId: jobId.toString() });
      if (!q.ok) throw new Error(`quote refused: ${q.reason || q.error}`);

      /* Confirm the price is actually on the job before paying for it. fund()
         happily succeeds against a budget of zero — it escrows nothing and
         leaves the order Funded and unpayable, which looks like a paid job and
         is not one. The page guards this the same way. */
      const { jobs } = await jobsLib.contracts(prov);
      let priced = false;
      for (let n = 0; n < 10 && !priced; n++) {
        priced = await jobsLib.withRetry(() => jobs.jobHasBudget(jobId));
        if (!priced) await new Promise((r) => setTimeout(r, 2000));
      }
      if (!priced) throw new Error("no price on the order — not funding it");

      const amount = BigInt(Math.round(Number(s.priceUsdc) * 10 ** Number(dec)));
      await jobsLib.fund(client, jobId, amount);
      console.log(`  funded ${s.priceUsdc} USDC into order #${jobId}`);

      if (isBroken) {
        broken = { jobId, expiresAt: Math.floor(Date.now() / 1000) + EXPIRY_BROKEN, step: s };
        placed.push({ ...s, jobId: jobId.toString(), verdict: "not delivered (on purpose)" });
        console.log(`  NOT settling this one — its deadline runs out in ${EXPIRY_BROKEN}s`);
        continue;
      }

      const st = await post("/api/settle", { jobId: jobId.toString() });
      placed.push({ ...s, jobId: jobId.toString(), verdict: st.verdict || st.reason || "pending" });
      console.log(`  settle → ${st.verdict || st.reason || "pending"}${st.seconds ? ` (${st.seconds}s)` : ""}`);
    } catch (e) {
      console.log(`  ✗ ${e.shortMessage || e.message}`);
      placed.push({ ...s, jobId: null, verdict: `not placed — ${e.shortMessage || e.message}` });
    }
  }

  /* The broken step's money is still sitting in escrow. Wait out its deadline
     and take it back — from the client's own wallet, with nobody's permission,
     while the rest of the crew has already been paid. */
  if (broken) {
    const wait = Math.max(0, broken.expiresAt - Math.floor(Date.now() / 1000)) + 20;
    console.log(`\n— waiting ${wait}s for order #${broken.jobId} to run out of time…`);
    await new Promise((r) => setTimeout(r, wait * 1000));
    try {
      await jobsLib.claimRefund(client, broken.jobId);
      console.log(`  refund claimed on #${broken.jobId}`);
    } catch (e) {
      console.log(`  ✗ refund failed: ${e.shortMessage || e.message}`);
    }
  }

  /* What actually happened on-chain, read back rather than assumed. */
  console.log("\n———————————————— receipts ————————————————");
  let paid = 0, refunded = 0;
  for (const p of placed) {
    if (!p.jobId) { console.log(`  ${p.title.padEnd(20)} —        ${p.verdict}`); continue; }
    const j = await jobsLib.withRetry(() => jobsLib.contracts(prov).then((c) => c.jobs.getJob(BigInt(p.jobId))));
    const status = jobsLib.JOB_STATUS[Number(j.status)];
    if (status === "Completed") paid += Number(p.priceUsdc);
    if (status === "Rejected" || status === "Expired") refunded += Number(p.priceUsdc);
    console.log(`  ${p.title.padEnd(20)} #${p.jobId.padEnd(8)} ${status.padEnd(10)} ${CFG.EXPLORER}/tx`);
  }

  const after = await jobsLib.withRetry(() => usdc.balanceOf(client.address));
  console.log(`\n  paid out   ${paid.toFixed(2)} USDC`);
  console.log(`  refunded   ${refunded.toFixed(2)} USDC   (a step that fails refunds on its own — that is why each agent gets its own escrow)`);
  console.log(`  client     ${formatUnits(before, dec)} → ${formatUnits(after, dec)} USDC (includes gas, which is USDC on Arc)\n`);
}

main().catch((e) => { console.error(`\n✗ ${e.shortMessage || e.message}\n`); process.exit(1); });
