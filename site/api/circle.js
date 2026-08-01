"use strict";

/**
 * Server side of Circle user-controlled wallets (PIN flow), as a thin REST proxy.
 * The CIRCLE_API_KEY stays here on the server; the browser only ever sees
 * short-lived user tokens and challenge ids. Actions:
 *
 *   POST /api/circle  {action:"start", userId?}   → create user (if new) + user token
 *                                                    + initialize ARC-TESTNET wallet challenge
 *   POST /api/circle  {action:"token", userId}    → fresh user token for an existing user
 *   POST /api/circle  {action:"wallets", userToken} → list the user's wallets
 */

const { sendJson, CFG } = require("./_shared");

const BASE = "https://api.circle.com/v1/w3s";

async function circle(path, body, method = "POST") {
  const key = process.env.CIRCLE_API_KEY;
  if (!key) throw new Error("CIRCLE_API_KEY not configured on the server yet");
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: method === "GET" ? undefined : JSON.stringify(body || {}),
    signal: AbortSignal.timeout(15_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`circle ${res.status}: ${data?.message || JSON.stringify(data).slice(0, 200)}`);
  return data.data ?? data;
}

async function readBody(req) {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  try { return JSON.parse(raw || "{}"); } catch { return {}; }
}

module.exports = async (req, res) => {
  try {
    if (req.method !== "POST") return sendJson(res, 405, { error: "POST only" });
    const body = await readBody(req);

    if (body.action === "start") {
      const userId = body.userId || crypto.randomUUID();
      if (!body.userId) {
        try { await circle("/users", { userId }); }
        catch (e) { if (!/already exists/i.test(e.message)) throw e; }
      }
      const tok = await circle("/users/token", { userId });
      // /user/initialize needs the X-User-Token header, so call it directly:
      const initRes = await fetch(`${BASE}/user/initialize`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${process.env.CIRCLE_API_KEY}`,
          "X-User-Token": tok.userToken,
        },
        body: JSON.stringify({ idempotencyKey: crypto.randomUUID(), blockchains: ["ARC-TESTNET"] }),
        signal: AbortSignal.timeout(15_000),
      });
      const initData = await initRes.json().catch(() => ({}));
      const challengeId = initData?.data?.challengeId || null;

      return sendJson(res, 200, {
        userId,
        userToken: tok.userToken,
        encryptionKey: tok.encryptionKey,
        challengeId,
        appId: process.env.CIRCLE_APP_ID || "",
        note: challengeId ? "run the challenge in the SDK widget" : "user may already be initialized — fetch wallets",
      });
    }

    if (body.action === "token") {
      if (!body.userId) return sendJson(res, 400, { error: "userId required" });
      const tok = await circle("/users/token", { userId: body.userId });
      return sendJson(res, 200, { userToken: tok.userToken, encryptionKey: tok.encryptionKey, appId: process.env.CIRCLE_APP_ID || "" });
    }

    if (body.action === "execute") {
      // Create a contract-execution challenge: the user's Circle wallet will run
      // this call once they approve it with their PIN in the SDK widget.
      const { userToken, walletId, contractAddress, abiFunctionSignature, abiParameters } = body;
      if (!userToken || !walletId || !contractAddress || !abiFunctionSignature) {
        return sendJson(res, 400, { error: "userToken, walletId, contractAddress, abiFunctionSignature required" });
      }
      const r = await fetch(`${BASE}/user/transactions/contractExecution`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${process.env.CIRCLE_API_KEY}`,
          "X-User-Token": userToken,
        },
        body: JSON.stringify({
          idempotencyKey: crypto.randomUUID(),
          walletId,
          contractAddress,
          abiFunctionSignature,
          abiParameters: abiParameters || [],
          feeLevel: "MEDIUM",
        }),
        signal: AbortSignal.timeout(15_000),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) return sendJson(res, 200, { error: data?.message || `circle ${r.status}` });
      return sendJson(res, 200, { challengeId: data?.data?.challengeId || null });
    }

    if (body.action === "findjob") {
      // Latest JobCreated for a given client with our provider — via the explorer's
      // indexed log search (Arc mints ~4 blocks/sec, so raw range scans can't keep up).
      const { Interface, zeroPadValue } = require("ethers");
      const client = String(body.client || "");
      if (!/^0x[a-fA-F0-9]{40}$/.test(client)) return sendJson(res, 400, { error: "client address required" });
      const iface = new Interface(["event JobCreated(uint256 indexed jobId, address indexed client, address indexed provider, address evaluator, uint256 expiredAt, address hook)"]);
      const topic0 = iface.getEvent("JobCreated").topicHash;
      // ~4 blocks/sec on Arc: 200k blocks ≈ the last ~14 hours, plenty for a hire session
      const { provider } = require("./_shared");
      const latest = await provider().getBlockNumber();
      const url = `https://testnet.arcscan.app/api?module=logs&action=getLogs&fromBlock=${Math.max(0, latest - 200_000)}&toBlock=latest` +
        `&address=${CFG.ERC8183}&topic0=${topic0}&topic2=${zeroPadValue(client, 32)}&topic0_2_opr=and`;
      const r = await fetch(url, { signal: AbortSignal.timeout(12_000) });
      const data = await r.json().catch(() => ({}));
      const providerTopic = zeroPadValue(CFG.PROVIDER_WALLET, 32).toLowerCase();
      const ours = (Array.isArray(data.result) ? data.result : [])
        .filter((l) => (l.topics?.[3] || "").toLowerCase() === providerTopic);
      if (!ours.length) return sendJson(res, 200, { jobId: null });
      const last = ours[ours.length - 1];
      return sendJson(res, 200, { jobId: BigInt(last.topics[1]).toString(), tx: last.transactionHash });
    }

    if (body.action === "wallets") {
      if (!body.userToken) return sendJson(res, 400, { error: "userToken required" });
      const r = await fetch(`${BASE}/wallets`, {
        headers: { authorization: `Bearer ${process.env.CIRCLE_API_KEY}`, "X-User-Token": body.userToken },
        signal: AbortSignal.timeout(15_000),
      });
      const data = await r.json().catch(() => ({}));
      return sendJson(res, 200, { wallets: data?.data?.wallets || [] });
    }

    return sendJson(res, 400, { error: "unknown action" });
  } catch (e) {
    sendJson(res, 200, { error: e.message });
  }
};
