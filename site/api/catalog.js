"use strict";

/** GET /api/catalog → the agents for hire, their prices, and marketplace addresses.
 *  Also the single place the browser learns which chain it is talking to, so
 *  site/assets/app.js never hardcodes an address again. Add ?chain=testnet|mainnet
 *  to ask for a specific one. Each chain lists only the agents it sells. */

const { cfg, shelf, ordersOpen, sendJson } = require("./_shared");

/* Identity token ids belong to the chain they were minted on. A chain with no
   file serves null ids rather than another chain's — showing a testnet agent id
   as if it were a mainnet identity would be a wrong answer, not a missing one.

   Every require below is deliberately a static literal. A computed require path
   is invisible to the deployment bundler, so the file never ships and the catch
   quietly turns every agentId into null. Add one line per chain, by hand. */
const IDS_BY_CHAIN = {};
try { IDS_BY_CHAIN[5042002] = require("../agents/ids.json"); } catch { /* none on testnet */ }
// Written by chain/registry.js once the mainnet identities are minted; until then every mainnet agentId is null.
try { IDS_BY_CHAIN[5042] = require("../agents/ids.5042.json"); } catch { /* not registered yet */ }

function idsFor(chainId) {
  return IDS_BY_CHAIN[chainId] || {};
}

module.exports = async (req, res) => {
  const C = cfg(req);
  const IDS = idsFor(C.CHAIN_ID);

  const agents = Object.fromEntries(
    Object.entries(shelf(C)).map(([k, a]) => [k, { ...a, agentId: IDS[k]?.agentId || null }])
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
      // the dollar token buyers pay in on this chain: USDG on Robinhood Chain, USDC on the testnet
      currency: C.CURRENCY,
      // false once this chain stops taking new orders; its old orders stay readable
      ordersOpen: ordersOpen(C),
      /* EXACTLY the keys wallet_addEthereumChain accepts — extra keys make
         MetaMask reject the whole request, so never decorate this object.
         The public RPC only: a chain without one is never selected (configured()). */
      addChain: {
        chainId: `0x${C.CHAIN_ID.toString(16)}`,
        chainName: C.NAME,
        rpcUrls: [C.PUBLIC_RPC_URL],
        nativeCurrency: { ...C.NATIVE },
        blockExplorerUrls: [C.EXPLORER],
      },
    },
  });
};
