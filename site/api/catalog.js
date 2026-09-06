"use strict";

/** GET /api/catalog → the agents for hire, their prices, and marketplace addresses.
 *  Also the single place the browser learns which chain it is talking to, so
 *  site/assets/app.js never hardcodes an address again. Add ?chain=testnet|mainnet
 *  to ask for a specific one. */

const { cfg, CATALOG, sendJson } = require("./_shared");

/* Identity token ids belong to the chain they were minted on. ids.json is the
   original testnet file; anything else lives beside it as ids.<chainId>.json.
   A chain with no file serves null ids rather than another chain's — showing a
   testnet agent id as if it were a mainnet identity would be a wrong answer,
   not a missing one. */
function idsFor(chainId) {
  for (const p of [`../agents/ids.${chainId}.json`, chainId === 5042002 ? "../agents/ids.json" : null]) {
    if (!p) continue;
    try { return require(p); } catch { /* not registered on this chain */ }
  }
  return {};
}

module.exports = async (req, res) => {
  const C = cfg(req);
  const IDS = idsFor(C.CHAIN_ID);

  const agents = Object.fromEntries(
    Object.entries(CATALOG).map(([k, a]) => [k, { ...a, agentId: IDS[k]?.agentId || null }])
  );

  sendJson(res, 200, {
    agents,
    identityRegistry: C.IDENTITY_REGISTRY,
    providerWallet: C.PROVIDER_WALLET,
    evaluatorWallet: C.EVALUATOR_WALLET,
    contract: C.ERC8183,
    usdc: C.USDC,
    chainId: C.CHAIN_ID,
    explorer: C.EXPLORER,
    chain: {
      key: C.KEY,
      name: C.NAME,
      testnet: C.TESTNET,
      circleChain: C.CIRCLE_CHAIN,
      /* EXACTLY the keys wallet_addEthereumChain accepts — extra keys make
         MetaMask reject the whole request, so never decorate this object. */
      addChain: {
        chainId: `0x${C.CHAIN_ID.toString(16)}`,
        chainName: C.NAME,
        rpcUrls: [C.PUBLIC_RPC_URL || C.RPC_URL],
        nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
        blockExplorerUrls: [C.EXPLORER],
      },
    },
  });
};
