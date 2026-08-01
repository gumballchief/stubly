"use strict";

/**
 * GET /api/stats → live marketplace numbers, counted from the chain itself.
 * Counts JobCreated events naming our provider wallet via the explorer's indexed
 * log search. Returns live:false rather than inventing numbers when it can't read.
 */

const { Interface, zeroPadValue } = require("ethers");
const { CFG, sendJson, provider } = require("./_shared");

const IFACE = new Interface([
  "event JobCreated(uint256 indexed jobId, address indexed client, address indexed provider, address evaluator, uint256 expiredAt, address hook)",
]);

module.exports = async (_req, res) => {
  try {
    const topic0 = IFACE.getEvent("JobCreated").topicHash;
    const providerTopic = zeroPadValue(CFG.PROVIDER_WALLET, 32);
    // Arc mints ~4 blocks/sec — an all-time scan times the explorer out. This
    // window is "since we started", which is what the numbers claim anyway.
    const latest = await provider().getBlockNumber();
    const url = `https://testnet.arcscan.app/api?module=logs&action=getLogs&fromBlock=${Math.max(0, latest - 400_000)}&toBlock=latest` +
      `&address=${CFG.ERC8183}&topic0=${topic0}&topic3=${providerTopic}&topic0_3_opr=and`;
    const r = await fetch(url, { signal: AbortSignal.timeout(12_000) });
    const data = await r.json().catch(() => ({}));
    const logs = Array.isArray(data.result) ? data.result : [];

    const clients = new Set(logs.map((l) => (l.topics?.[2] || "").toLowerCase()).filter(Boolean));
    sendJson(res, 200, {
      live: true,
      jobs: logs.length,
      hirers: clients.size,
      agents: Object.keys(require("./_catalog.json")).length,
      contract: CFG.ERC8183,
      explorer: `${CFG.EXPLORER}/address/${CFG.ERC8183}`,
    });
  } catch (e) {
    sendJson(res, 200, { live: false, error: e.message });
  }
};
