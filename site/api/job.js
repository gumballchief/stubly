"use strict";

/** GET /api/job?id=161321 → live job state straight from the chain. */

const { formatUnits } = require("ethers");
const { CFG, JOB_STATUS, jobsContract, sendJson } = require("./_shared");

module.exports = async (req, res) => {
  try {
    const url = new URL(req.url, "http://x");
    const id = url.searchParams.get("id");
    if (!id || !/^\d+$/.test(id)) return sendJson(res, 400, { error: "pass ?id=<job number>" });

    const j = await jobsContract().getJob(BigInt(id));
    if (j.client === "0x0000000000000000000000000000000000000000") return sendJson(res, 404, { error: "no such job" });

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
      ours: j.provider.toLowerCase() === CFG.PROVIDER_WALLET.toLowerCase(),
      explorer: `${CFG.EXPLORER}/address/${CFG.ERC8183}`,
    });
  } catch (e) {
    sendJson(res, 200, { live: false, error: e.shortMessage || e.message });
  }
};
