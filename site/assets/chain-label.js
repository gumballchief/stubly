"use strict";

/**
 * Keep the page honest about which chain it is serving.
 *
 * Every page ships with "ARC TESTNET" in the header and "Testnet only — no real
 * funds" in the footer, and the judge page promises the platform fee is switched
 * off. All three stop being true the moment mainnet is the default, and a site
 * telling a buyer their money is not at risk while taking it is the worst bug
 * this codebase could have. So the served chain decides the wording.
 *
 * This is deliberately its own file rather than part of app.js: four of the ten
 * pages — including the judge page making the strongest promise — do not load
 * app.js at all, so anything living there would have missed exactly the pages
 * that matter most.
 *
 * The shipped HTML is already the testnet wording, so on testnet this changes
 * nothing, and a failed fetch leaves the page as-is rather than blanking it.
 */
(function () {
  fetch("/api/catalog")
    .then((r) => r.json())
    .then((cat) => {
      const c = cat && cat.chain;
      if (!c) return;

      const badge = document.querySelector(".wordmark small");
      if (badge) badge.textContent = String(c.name || "Arc").toUpperCase();

      if (c.testnet) return;

      document.querySelectorAll("footer .foot span").forEach((el) => {
        if (/testnet only/i.test(el.textContent)) {
          el.textContent = "Real USDC — held in Circle's escrow, never by us";
        }
      });

      const note = document.getElementById("chain-note");
      if (note) {
        note.innerHTML =
          "<h3>Real money</h3><p>This is Arc mainnet and the USDC is real. It sits in " +
          "Circle's escrow contract, not ours, and the same published rules decide " +
          "every verdict.</p>";
      }
    })
    .catch(() => { /* leave the page exactly as it shipped */ });
})();
