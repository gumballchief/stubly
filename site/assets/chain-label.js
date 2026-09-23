"use strict";

/**
 * Keep the page honest about which chain it is serving.
 *
 * Stubly serves Arc mainnet (real USDC) and keeps Arc testnet as a readable archive of
 * past orders, from one deployment. The same page can be about either, so the chain the
 * page is actually showing decides the wording: ?chain in the address when there is one,
 * otherwise whatever the server's default is, as /api/catalog reports it.
 *
 * Chain-dependent copy is marked in the HTML rather than rewritten from here, so the words
 * stay next to the page they belong to:
 *   data-chain-only="mainnet" | "testnet"   shown only on that chain
 *   data-chain-link="explorer" | "contract" | "identityRegistry"
 *                                            href filled from the served chain's explorer
 *   data-chain-short="contract" | "identityRegistry"
 *                                            text filled with that address, shortened
 *
 * The shipped HTML shows the mainnet wording. So a failed fetch leaves a testnet page
 * saying its money is real, never a mainnet page saying its money is not: a site telling
 * a buyer their money is not at risk while taking it is the worst bug this codebase
 * could have. Links with no known address stay without an href rather than pointing at
 * another chain's contract.
 *
 * This is deliberately its own file rather than part of app.js: several pages, including
 * the judge page, do not load app.js at all.
 */
(function () {
  const want = new URLSearchParams(location.search).get("chain");
  const query = want === "testnet" || want === "mainnet" ? `?chain=${want}` : "";

  fetch(`/api/catalog${query}`)
    .then((r) => r.json())
    .then((cat) => {
      const c = cat && cat.chain;
      if (!c) return;
      const key = c.testnet ? "testnet" : "mainnet";

      const badge = document.querySelector(".wordmark small");
      if (badge) badge.textContent = String(c.name || "Arc").toUpperCase();

      document.querySelectorAll("[data-chain-only]").forEach((el) => {
        el.hidden = el.getAttribute("data-chain-only") !== key;
      });

      const explorer = String(cat.explorer || "").replace(/\/$/, "");
      document.querySelectorAll("[data-chain-link]").forEach((a) => {
        const what = a.getAttribute("data-chain-link");
        const address = what === "explorer" ? "" : cat[what];
        if (!explorer || (what !== "explorer" && !address)) { a.removeAttribute("href"); return; }
        a.href = what === "explorer" ? explorer : `${explorer}/address/${address}`;
      });

      document.querySelectorAll("[data-chain-short]").forEach((el) => {
        const address = String(cat[el.getAttribute("data-chain-short")] || "");
        el.textContent = address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "not published yet";
      });

      /* Pages not yet marked up (wallet.html) still carry the old testnet footer. */
      if (!c.testnet) {
        document.querySelectorAll("footer .foot span:not([data-chain-only])").forEach((el) => {
          if (/testnet only/i.test(el.textContent)) el.textContent = "Real USDC, held in escrow on Arc, never by us";
        });
      }
    })
    .catch(() => { /* leave the page exactly as it shipped */ });
})();
