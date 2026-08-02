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
const { CFG, JOB_STATUS, sendJson, provider, jobsContract } = require("./_shared");

const IFACE = new Interface([
  "event JobCreated(uint256 indexed jobId, address indexed client, address indexed provider, address evaluator, uint256 expiredAt, address hook)",
]);

const EXPLORER_LOGS = "https://testnet.arcscan.app/api";

/** Pull JobCreated logs where `address` sits in the given indexed position. */
async function logsFor(address, position, latest) {
  const topic0 = IFACE.getEvent("JobCreated").topicHash;
  const topicN = zeroPadValue(address, 32);
  const from = Math.max(0, latest - 400_000);
  const url =
    `${EXPLORER_LOGS}?module=logs&action=getLogs&fromBlock=${from}&toBlock=latest` +
    `&address=${CFG.ERC8183}&topic0=${topic0}&topic${position}=${topicN}&topic0_${position}_opr=and`;
  const r = await fetch(url, { signal: AbortSignal.timeout(14_000) });
  const data = await r.json().catch(() => ({}));
  return Array.isArray(data.result) ? data.result : [];
}

const jobIdOf = (log) => BigInt(log.topics[1]).toString();

module.exports = async (req, res) => {
  try {
    const url = new URL(req.url, "http://x");
    const address = String(url.searchParams.get("address") || "").trim();
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return sendJson(res, 400, { error: "pass ?address=0x… (40 hex characters)" });
    }

    const latest = await provider().getBlockNumber();
    const [asProvider, asClient] = await Promise.all([
      logsFor(address, 3, latest), // topic3 = provider
      logsFor(address, 2, latest), // topic2 = client
    ]);

    const ids = [
      ...asProvider.map((l) => ({ id: jobIdOf(l), side: "earned" })),
      ...asClient.map((l) => ({ id: jobIdOf(l), side: "spent" })),
    ];

    const jobs = jobsContract();
    const rows = [];
    for (const { id, side } of ids) {
      try {
        const j = await jobs.getJob(BigInt(id));
        const status = JOB_STATUS[Number(j.status)] || "?";
        let agent = null;
        try { agent = JSON.parse(j.description)?.agent || null; } catch { /* free-text job */ }
        rows.push({
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
        "Earned and spent count only jobs that reached Completed. Rejected and expired jobs are excluded — that money was refunded.",
        "Amounts are the escrow budget. Circle's contract deducts a small protocol fee on settlement, so the amount that lands in a wallet is fractionally lower.",
        "Net is on-chain revenue minus on-chain spend. What an agent costs its owner to run — model calls, hosting — is private off-chain business, the same way a payment processor shows revenue rather than your server bill.",
      ],
    });
  } catch (e) {
    sendJson(res, 200, { live: false, error: e.shortMessage || e.message });
  }
};
