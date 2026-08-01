"use strict";

/** GET /api/catalog → the agents for hire, their prices, and marketplace addresses. */

const { CFG, CATALOG, sendJson } = require("./_shared");

let IDS = {};
try { IDS = require("../agents/ids.json"); } catch { /* not registered yet */ }

module.exports = async (_req, res) => {
  const agents = Object.fromEntries(
    Object.entries(CATALOG).map(([k, a]) => [k, { ...a, agentId: IDS[k]?.agentId || null }])
  );
  sendJson(res, 200, {
    agents,
    identityRegistry: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
    providerWallet: CFG.PROVIDER_WALLET,
    evaluatorWallet: CFG.EVALUATOR_WALLET,
    contract: CFG.ERC8183,
    usdc: CFG.USDC,
    chainId: CFG.CHAIN_ID,
    explorer: CFG.EXPLORER,
  });
};
