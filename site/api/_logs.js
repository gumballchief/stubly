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
 *
 * Arc's public node limits log reads per IP, and a serverless host shares its IPs with everyone
 * else's functions: on mainnet launch day stubly.org's profile got "rate limit exceeded" on its
 * very first eth_getLogs while the same query answered instantly from anywhere else. So each piece
 * a node refuses is asked of the chain's next official node (LOG_RPC_URLS), and the walk keeps
 * using whichever node last answered.
 *
 * Robinhood Chain is the opposite case: its node answers a log query over any range in one call, but
 * its blocks come about ten a second, so a 5,000-block walk from the escrow's first block is hundreds
 * of calls within a day and trips "Too Many Requests" on its own. So the whole range is asked for in
 * ONE call first. Only a node that refuses the range (Arc's does) gets the piece-by-piece walk.
 */

const RPC_SPAN = 5000;
const MAX_RPC_CHUNKS = 120; // 600,000 blocks, about three and a half days at Arc's half-second blocks
const RPC_CONCURRENCY = 3; // bursts are what trip a node's per-IP limit

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

async function rpc(C, method, params, url = C.RPC_URL) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(15_000),
  });
  const j = await r.json().catch(() => ({ error: { message: `HTTP ${r.status}` } }));
  if (j.error) throw new Error(`rpc ${method}: ${j.error.message || "error"}`);
  return j.result;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BUSY = /too many requests|rate limit|429/i;
const TOO_WIDE = /range|too large|too many blocks|exceed|limit(ed)? to|max(imum)? .*block|10,?000|5,?000/i;

/** A busy node is asked again after a short wait; any other refusal is final for this call. */
async function patient(fn) {
  for (let attempt = 0; ; attempt++) {
    try { return await fn(); } catch (e) {
      if (attempt >= 2 || !BUSY.test(e.message || "")) throw e;
      await sleep(700 * (attempt + 1) ** 2);
    }
  }
}

/** The configured node first, then the chain's other official nodes, each once. */
function logNodes(C) {
  return [...new Set([C.RPC_URL, ...(C.LOG_RPC_URLS || [])].filter(Boolean))];
}

/** One call, moved along the node list until a node answers. `at` is shared, so later calls start at the node that worked. */
async function rpcAny(C, nodes, at, method, params) {
  let last;
  for (let tried = 0; tried < nodes.length; tried++) {
    const i = (at.i + tried) % nodes.length;
    try {
      const out = await rpc(C, method, params, nodes[i]);
      at.i = i;
      return out;
    } catch (e) { last = e; }
  }
  throw last;
}

async function rpcLogs(C, q) {
  if (!C.RPC_URL) throw new Error("no RPC configured for this chain");
  const nodes = logNodes(C);
  const at = { i: 0 };
  const latest = parseInt(await rpcAny(C, nodes, at, "eth_blockNumber", []), 16);
  const wanted = Math.max(Number(q.fromBlock) || 0, Number(C.START_BLOCK) || 0);
  const floor = Math.max(0, latest - RPC_SPAN * MAX_RPC_CHUNKS + 1);
  const start = Math.max(wanted, floor);

  /* One call for everything, where the node allows it. */
  const filter = (from, to) => [{
    address: q.address,
    fromBlock: "0x" + from.toString(16),
    toBlock: "0x" + to.toString(16),
    topics: q.topics.map((t) => t || null),
  }];
  try {
    const logs = await patient(() => rpcAny(C, nodes, at, "eth_getLogs", filter(wanted, latest)));
    logs.partial = false;
    return logs;
  } catch (e) {
    if (!TOO_WIDE.test(e.message || "") || BUSY.test(e.message || "")) throw e;
  }

  const ranges = [];
  for (let b = start; b <= latest; b += RPC_SPAN) ranges.push([b, Math.min(b + RPC_SPAN - 1, latest)]);

  const pieces = new Array(ranges.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(RPC_CONCURRENCY, ranges.length) }, async () => {
    while (next < ranges.length) {
      const i = next++;
      const [from, to] = ranges[i];
      pieces[i] = await patient(() => rpcAny(C, nodes, at, "eth_getLogs", filter(from, to)));
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
