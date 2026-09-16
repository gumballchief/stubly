"use strict";

/** GET /api/job?id=161321 → live job state straight from the chain. */

const { formatUnits } = require("ethers");
const { cfg, CHAINS, JOB_STATUS, jobsContract, sendJson } = require("./_shared");

const ZERO = "0x0000000000000000000000000000000000000000";

/* null only for a definite "no such order": an empty slot or the contract's InvalidJob revert.
   A network error still throws, so a flaky node never sends a reader to the wrong chain. */
async function readJob(C, id) {
  try {
    const j = await jobsContract(C).getJob(BigInt(id));
    return j.client === ZERO ? null : j;
  } catch (e) {
    if (e?.revert?.name === "InvalidJob" || /InvalidJob/.test(e.shortMessage || e.message || "")) return null;
    throw e;
  }
}

module.exports = async (req, res) => {
  try {
    const url = new URL(req.url, "http://x");
    const id = url.searchParams.get("id");
    if (!id || !/^\d+$/.test(id)) return sendJson(res, 400, { error: "pass ?id=<job number>" });

    let C = cfg(req);
    let j = await readJob(C, id);
    /* The article, the grant application and the demo link testnet orders with no ?chain.
       Once the default is mainnet, an order mainnet has never heard of is looked up on
       testnet before it is called missing. An explicit ?chain always means that chain. */
    const bare = !url.searchParams.has("chain") && !url.searchParams.has("chainId");
    if (!j && bare && C.KEY !== "testnet" && CHAINS.testnet) {
      C = CHAINS.testnet;
      j = await readJob(C, id);
    }
    if (!j) return sendJson(res, 404, { error: "no such job" });

    let spec = null;
    try { spec = JSON.parse(j.description); } catch { /* free-text job */ }

    sendJson(res, 200, {
      live: true,
      id,
      status: Number(j.status),
      statusText: JOB_STATUS[Number(j.status)] || "?",
      budgetUsdc: formatUnits(j.budget, 6),
      hasBudget: j.budget > 0n,
      client: j.client,
      provider: j.provider,
      evaluator: j.evaluator,
      expiredAt: Number(j.expiredAt),
      agent: spec?.agent || null,
      input: spec?.input || null,
      ours: j.provider.toLowerCase() === C.PROVIDER_WALLET.toLowerCase(),
      explorer: `${C.EXPLORER}/address/${C.ERC8183}`,
      chain: C.KEY,
    });
  } catch (e) {
    sendJson(res, 200, { live: false, error: e.shortMessage || e.message });
  }
};
