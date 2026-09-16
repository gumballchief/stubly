"use strict";

/**
 * Event log reads that survive a blocked explorer.
 *
 * The explorer's Etherscan-style getLogs answers a whole history in one call, so it is
 * asked first. But every explorer rate-limits, and Arc mainnet's explorer sits behind a
 * Cloudflare browser check that no server can pass. When the answer is not a real log
 * list, the same query goes to the chain's own RPC in 5,000-block pieces (the public node
 * refuses 10,000). The RPC walk starts no earlier than the chain's START_BLOCK, the
 * escrow's deployment, because nothing of Stubly's can be older than that.
 *
 * A walk that had to stop short of the requested start says so (partial = true), so a
 * page can say "recent history" instead of presenting a cut-off list as everything.
 */

const RPC_SPAN = 5000;
const MAX_RPC_CHUNKS = 120; // 600,000 blocks, about three and a half days at Arc's half-second blocks
const RPC_CONCURRENCY = 6;

async function explorerLogs(C, q) {
  if (!C.EXPLORER_API) return null;
  const base = String(C.EXPLORER_API).replace(/\/+$/, "").replace(/\/v2$/, "");
  let url = `${base}?module=logs&action=getLogs&fromBlock=${q.fromBlock || 0}&toBlock=latest&address=${q.address}`;
  q.topics.forEach((t, i) => {
    if (!t) return;
    url += `&topic${i}=${t}`;
    if (i > 0) url += `&topic0_${i}_opr=and`;
  });
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(q.timeoutMs || 14_000) });
    const data = await r.json();
    if (Array.isArray(data.result)) return data.result;
    if (r.ok && /no (logs|records) found/i.test(data.message || "")) return [];
  } catch { /* a challenge page, a timeout or a rate limit: not an answer */ }
  return null;
}

async function rpc(C, method, params) {
  const r = await fetch(C.RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(15_000),
  });
  const j = await r.json();
  if (j.error) throw new Error(`rpc ${method}: ${j.error.message || "error"}`);
  return j.result;
}

async function rpcLogs(C, q) {
  if (!C.RPC_URL) throw new Error("no RPC configured for this chain");
  const latest = parseInt(await rpc(C, "eth_blockNumber", []), 16);
  const wanted = Math.max(Number(q.fromBlock) || 0, Number(C.START_BLOCK) || 0);
  const floor = Math.max(0, latest - RPC_SPAN * MAX_RPC_CHUNKS + 1);
  const start = Math.max(wanted, floor);

  const ranges = [];
  for (let b = start; b <= latest; b += RPC_SPAN) ranges.push([b, Math.min(b + RPC_SPAN - 1, latest)]);

  const pieces = new Array(ranges.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(RPC_CONCURRENCY, ranges.length) }, async () => {
    while (next < ranges.length) {
      const i = next++;
      const [from, to] = ranges[i];
      pieces[i] = await rpc(C, "eth_getLogs", [{
        address: q.address,
        fromBlock: "0x" + from.toString(16),
        toBlock: "0x" + to.toString(16),
        topics: q.topics.map((t) => t || null),
      }]);
    }
  }));

  const logs = pieces.flat();
  logs.partial = start > wanted;
  return logs;
}

/**
 * getLogs(C, { address, topics: [topic0, topic1|null, topic2|null, topic3|null], fromBlock })
 * resolves to the matching logs, oldest first, in the explorer's shape (topics, data,
 * transactionHash). It throws only when neither the explorer nor the RPC could answer.
 */
async function getLogs(C, q) {
  const fromExplorer = await explorerLogs(C, q);
  if (fromExplorer) return fromExplorer;
  return rpcLogs(C, q);
}

module.exports = { getLogs, explorerLogs, rpcLogs, RPC_SPAN };
