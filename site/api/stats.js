"use strict";

/**
 * GET /api/stats → live marketplace numbers, counted from the chain itself.
 *
 * Counts JobCreated events naming our provider wallet, from genesis. NOT from a
 * rolling window: the first version scanned `latest - 400_000` blocks and called
 * that "since we started", but Arc mints ~4 blocks/sec, so it was really "the
 * last ~28 hours" — and the homepage spent weeks advertising 1 work order when
 * the true all-time figure was 50. The explorer answers the fromBlock=0 query in
 * a few seconds, so the window bought nothing. Do not reintroduce it.
 *
 * The homepage claims orders *settled*, so that number is read from the escrow's
 * own per-job status rather than inferred from the creation event — plenty of
 * orders are opened and never funded. If the status pass can't finish we return
 * settled:null instead of passing the created count off as settled.
 *
 * Returns live:false rather than inventing numbers when it can't read.
 */

const { Interface, zeroPadValue } = require("ethers");
const { CFG, sendJson, jobsContract } = require("./_shared");

const IFACE = new Interface([
  "event JobCreated(uint256 indexed jobId, address indexed client, address indexed provider, address evaluator, uint256 expiredAt, address hook)",
]);

// Reading every order's status is a slow call when the explorer is busy, and the
// number barely moves. Serve it from the CDN and refresh in the background so a
// visitor never sits watching the placeholder.
const STATS_CACHE = "public, s-maxage=120, stale-while-revalidate=600";

const COMPLETED = 3; // index into JOB_STATUS
const STATUS_CONCURRENCY = 10;
const STATUS_BUDGET_MS = 25_000; // root vercel.json allows 60s for the whole call

/** Runs fn over items a few at a time, so a long order book can't open 200 sockets. */
async function mapWithLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    })
  );
  return out;
}

module.exports = async (_req, res) => {
  try {
    const topic0 = IFACE.getEvent("JobCreated").topicHash;
    const providerTopic = zeroPadValue(CFG.PROVIDER_WALLET, 32);
    const url = `https://testnet.arcscan.app/api?module=logs&action=getLogs&fromBlock=0&toBlock=latest` +
      `&address=${CFG.ERC8183}&topic0=${topic0}&topic3=${providerTopic}&topic0_3_opr=and`;
    const r = await fetch(url, { signal: AbortSignal.timeout(25_000) });
    const data = await r.json().catch(() => ({}));
    const logs = Array.isArray(data.result) ? data.result : [];

    const clients = new Set(logs.map((l) => (l.topics?.[2] || "").toLowerCase()).filter(Boolean));

    // Ask the escrow how each order actually ended. One bad read voids the whole
    // figure — a partial count would quietly under-report settlements as fact.
    let settled = null;
    try {
      const jobs = jobsContract();
      const deadline = Date.now() + STATUS_BUDGET_MS;
      const ids = logs.map((l) => BigInt(l.topics[1]));
      const statuses = await mapWithLimit(ids, STATUS_CONCURRENCY, async (id) => {
        if (Date.now() > deadline) throw new Error("status pass ran out of time");
        return Number((await jobs.getJob(id)).status);
      });
      settled = statuses.filter((s) => s === COMPLETED).length;
    } catch {
      settled = null;
    }

    sendJson(res, 200, {
      live: true,
      settled,
      jobs: logs.length, // work orders created, all time
      hirers: clients.size,
      agents: Object.keys(require("./_catalog.json")).length,
      contract: CFG.ERC8183,
      explorer: `${CFG.EXPLORER}/address/${CFG.ERC8183}`,
    }, STATS_CACHE);
  } catch (e) {
    sendJson(res, 200, { live: false, error: e.message });
  }
};
