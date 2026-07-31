"use strict";

/** GET /api/catalog → the agents for hire, their prices, and marketplace addresses. */

const { CFG, CATALOG, sendJson } = require("./_shared");

module.exports = async (_req, res) => {
  sendJson(res, 200, {
    agents: CATALOG,
    providerWallet: CFG.PROVIDER_WALLET,
    evaluatorWallet: CFG.EVALUATOR_WALLET,
    contract: CFG.ERC8183,
    usdc: CFG.USDC,
    chainId: CFG.CHAIN_ID,
    explorer: CFG.EXPLORER,
  });
};
