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
