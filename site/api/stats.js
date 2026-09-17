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

const { Contract, Interface, zeroPadValue, formatUnits } = require("ethers");
const { cfg, sendJson, jobsContract, provider } = require("./_shared");
const { getLogs } = require("./_logs");

const IFACE = new Interface([
  "event JobCreated(uint256 indexed jobId, address indexed client, address indexed provider, address evaluator, uint256 expiredAt, address hook)",
]);

// Reading every order's status is a slow call when the explorer is busy, and the
// number barely moves. Serve it from the CDN and refresh in the background so a
// visitor never sits watching the placeholder.
const STATS_CACHE = "public, s-maxage=120, stale-while-revalidate=600";

const COMPLETED = 3; // index into JOB_STATUS
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const BURN = "0x000000000000000000000000000000000000dEaD";

/* Orders paid in the token (worker/tokenpay.js). The pay wallet sends a delivered order's tokens to the burn
   address in one transfer, so every such transfer is one job paid in the token, and their sum is what paying
   in it has burned. Read from the token's own logs: nothing here is a number we keep. */
async function tokenStats(C) {
  const addr = /^0x[0-9a-fA-F]{40}$/;
  if (!addr.test(C.PAY_TOKEN || "") || !addr.test(C.PAY_WALLET || "")) return null;
  const logs = await getLogs(C, { address: C.PAY_TOKEN, topics: [TRANSFER, zeroPadValue(C.PAY_WALLET, 32), zeroPadValue(BURN, 32)], fromBlock: 0, timeoutMs: 20_000 });
  const token = new Contract(C.PAY_TOKEN, ["function decimals() view returns (uint8)", "function symbol() view returns (string)"], provider(C));
  const [decimals, symbol] = await Promise.all([token.decimals(), token.symbol().catch(() => "TOKEN")]);
  const burnedRaw = logs.reduce((s, l) => s + BigInt(l.data), 0n);
  return {
    symbol: String(symbol).replace(/[^\w$.-]/g, "").slice(0, 12) || "TOKEN",
    jobsPaid: logs.length,
    burned: formatUnits(burnedRaw, decimals),
    partial: !!logs.partial,
  };
}
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

module.exports = async (req, res) => {
  try {
    const C = cfg(req);
    const topic0 = IFACE.getEvent("JobCreated").topicHash;
    const providerTopic = zeroPadValue(C.PROVIDER_WALLET, 32);
    const logs = await getLogs(C, { address: C.ERC8183, topics: [topic0, null, null, providerTopic], fromBlock: 0, timeoutMs: 25_000 });

    const clients = new Set(logs.map((l) => (l.topics?.[2] || "").toLowerCase()).filter(Boolean));

    // Ask the escrow how each order actually ended. One bad read voids the whole
    // figure — a partial count would quietly under-report settlements as fact.
    let settled = null;
    try {
      const jobs = jobsContract(C);
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

    let token = null;
    try { token = await tokenStats(C); } catch { token = null; } // the order counts still stand without it

    sendJson(res, 200, {
      live: true,
      settled,
      token,
      jobs: logs.length, // work orders created, all time
      hirers: clients.size,
      agents: Object.keys(require("./_catalog.json")).length,
      chain: C.KEY,
      contract: C.ERC8183,
      explorer: `${C.EXPLORER}/address/${C.ERC8183}`,
    }, STATS_CACHE);
  } catch (e) {
    sendJson(res, 200, { live: false, error: e.message });
  }
};
