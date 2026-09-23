"use strict";

/**
 * GET /api/earnings?address=0x…  → what a wallet has earned and spent on Stubly.
 *
 * Everything here is reconstructed from the chain, not from our records:
 *   earned  = jobs where you were the PROVIDER and the job reached Completed
 *   spent   = jobs where you were the CLIENT and the job reached Completed
 *   pending = funded work that hasn't settled yet, on either side
 *   refunded/expired money is never counted as spent — it came back
 *
 * The provider fee cut Circle's contract takes is real, so "earned" reports the
 * budget and notes that the settled amount is slightly lower after protocol fees.
 */

const { Interface, zeroPadValue, formatUnits } = require("ethers");
const { cfg, JOB_STATUS, sendJson, provider, jobsContract } = require("./_shared");
const { getLogs } = require("./_logs");

const IFACE = new Interface([
  "event JobCreated(uint256 indexed jobId, address indexed client, address indexed provider, address evaluator, uint256 expiredAt, address hook)",
]);

/** JobCreated logs where `address` sits in the given indexed position (2 = client, 3 = provider). */
async function logsFor(C, address, position, latest) {
  const topics = [IFACE.getEvent("JobCreated").topicHash, null, null, null];
  topics[position] = zeroPadValue(address, 32);
  /* From the start: _logs.js never reads before the escrow existed, and caps its own walk where a node
     makes it walk. A fixed 400,000 blocks is a day on Arc and less on faster chains. */
  return getLogs(C, { address: C.ERC8183, topics, fromBlock: 0 });
}

const jobIdOf = (log) => BigInt(log.topics[1]).toString();
/* Orders paid in tokens are read one by one to find their buyer, so only the pay wallet's most recent ones are. */
const MAX_PAY_ORDERS = 300;

module.exports = async (req, res) => {
  try {
    const url = new URL(req.url, "http://x");
    const address = String(url.searchParams.get("address") || "").trim();
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return sendJson(res, 400, { error: "pass ?address=0x… (40 hex characters)" });
    }

    const C = cfg(req);
    const latest = await provider(C).getBlockNumber();
    /* Orders this wallet paid for in tokens have Stubly's pay wallet as the escrow's client, and name the buyer inside. */
    const payWallet = /^0x[a-fA-F0-9]{40}$/.test(C.PAY_WALLET || "") && C.PAY_WALLET.toLowerCase() !== address.toLowerCase() ? C.PAY_WALLET : null;
    const [asProvider, asClient, viaPay] = await Promise.all([
      logsFor(C, address, 3, latest), // topic3 = provider
      logsFor(C, address, 2, latest), // topic2 = client
      payWallet ? logsFor(C, payWallet, 2, latest) : Promise.resolve([]),
    ]);

    const ids = [
      ...asProvider.map((l) => ({ id: jobIdOf(l), side: "earned" })),
      ...asClient.map((l) => ({ id: jobIdOf(l), side: "spent" })),
      ...viaPay.slice(-MAX_PAY_ORDERS).map((l) => ({ id: jobIdOf(l), side: "spent", viaPay: true })),
    ];

    const jobs = jobsContract(C);
    const rows = [];
    for (const { id, side, viaPay } of ids) {
      try {
        const j = await jobs.getJob(BigInt(id));
        const status = JOB_STATUS[Number(j.status)] || "?";
        let spec = null;
        try { spec = JSON.parse(j.description); } catch { /* free-text job */ }
        const agent = spec?.agent || null;
        let paidIn = null;
        if (viaPay) {
          if (String(spec?.pay?.buyer || "").toLowerCase() !== address.toLowerCase()) continue;
          paidIn = { symbol: String(spec.pay.symbol || "TOKEN").replace(/[^\w$.-]/g, "").slice(0, 12) || "TOKEN" };
        }
        rows.push({
          ...(paidIn ? { paidIn } : {}),
          jobId: id,
          side,
          agent,
          status,
          amount: Number(formatUnits(j.budget, 6)),
          counterparty: side === "earned" ? j.client : j.provider,
        });
      } catch { /* unreadable job — skip rather than guess */ }
    }

    const settled = (side) => rows.filter((r) => r.side === side && r.status === "Completed");
    const pending = rows.filter((r) => ["Funded", "Submitted"].includes(r.status));
    const refunded = rows.filter((r) => ["Rejected", "Expired"].includes(r.status));

    const earned = settled("earned").reduce((s, r) => s + r.amount, 0);
    const spent = settled("spent").reduce((s, r) => s + r.amount, 0);

    /* Per-agent breakdown — which of your agents actually pull their weight. */
    const byAgent = {};
    for (const r of settled("earned")) {
      const k = r.agent || "(external)";
      byAgent[k] = byAgent[k] || { agent: k, jobs: 0, earned: 0 };
      byAgent[k].jobs++; byAgent[k].earned += r.amount;
    }
    for (const r of settled("spent")) {
      const k = r.agent || "(external)";
      byAgent[k] = byAgent[k] || { agent: k, jobs: 0, earned: 0, spent: 0 };
      byAgent[k].spent = (byAgent[k].spent || 0) + r.amount;
    }

    sendJson(res, 200, {
      live: true,
      address,
      summary: {
        earned: +earned.toFixed(6),
        spent: +spent.toFixed(6),
        net: +(earned - spent).toFixed(6),
        jobsSold: settled("earned").length,
        jobsBought: settled("spent").length,
        pendingJobs: pending.length,
        pendingValue: +pending.reduce((s, r) => s + r.amount, 0).toFixed(6),
        refundedJobs: refunded.length,
      },
      byAgent: Object.values(byAgent).sort((a, b) => b.earned - a.earned),
      jobs: rows.sort((a, b) => Number(b.jobId) - Number(a.jobId)).slice(0, 100),
      notes: [
        ...(asProvider.partial || asClient.partial || viaPay.partial ? ["Showing recent orders only: the block explorer is not answering, so this was read straight from the chain, which only reaches back a few days."] : []),
        "Earned and spent count only jobs that reached Completed. Rejected and expired jobs are excluded — that money was refunded.",
        "Amounts are the escrow budget. Circle's contract deducts a small protocol fee on settlement, so the amount that lands in a wallet is fractionally lower.",
      ],
    });
  } catch (e) {
    sendJson(res, 200, { live: false, error: e.shortMessage || e.message });
  }
};
