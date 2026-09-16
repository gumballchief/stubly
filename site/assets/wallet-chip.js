"use strict";

/**
 * The connected wallet, in the corner of every page, as a link to /profile.
 *
 * It asks eth_accounts, which never opens a popup: a wallet shows up only where
 * this visitor already connected the site, so the header stays quiet for everyone
 * else. The balance is read with a plain eth_call, so no page has to load ethers
 * just to draw a chip.
 */
(() => {
  const nav = document.querySelector(".top-inner nav");
  if (!nav || !window.ethereum) return;

  const picked = new URLSearchParams(location.search).get("chain");
  const chainQ = picked === "testnet" || picked === "mainnet" ? `?chain=${picked}` : "";
  const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;

  let slot = document.createElement("span");
  slot.className = "wallet-slot";
  nav.appendChild(slot);

  let chainInfo = null;
  async function chain() {
    if (!chainInfo) {
      const r = await fetch(`/api/catalog${chainQ}`);
      chainInfo = await r.json();
    }
    return chainInfo;
  }

  /* balanceOf(address) with no library: selector + the address padded to 32 bytes. */
  async function balance(address) {
    const c = await chain();
    const rpc = c?.chain?.addChain?.rpcUrls?.[0];
    if (!rpc || !c.usdc) return null;
    const data = "0x70a08231" + address.slice(2).toLowerCase().padStart(64, "0");
    const res = await fetch(rpc, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: c.usdc, data }, "latest"] }),
    });
    const j = await res.json();
    if (!j?.result || j.result === "0x") return null;
    return Number(BigInt(j.result)) / 1e6;
  }

  function render(address) {
    if (!address) {
      slot.innerHTML = '<button class="wallet-chip" type="button">Connect wallet</button>';
      slot.querySelector("button").addEventListener("click", async () => {
        try {
          const [a] = await window.ethereum.request({ method: "eth_requestAccounts" });
          if (a) show(a);
        } catch { /* the visitor closed the wallet popup */ }
      });
      return;
    }
    slot.innerHTML =
      `<a class="wallet-chip" href="/profile${chainQ}" title="${address} — your Stubly profile">` +
      `<b>${short(address)}</b><span class="chip-amt" hidden></span></a>`;
  }

  async function show(address) {
    render(address);
    const amt = slot.querySelector(".chip-amt");
    if (!amt) return;
    try {
      const b = await balance(address);
      if (b === null) return;
      amt.textContent = `${b.toFixed(2)} USDC`;
      amt.hidden = false;
    } catch { /* an unreachable node just means no number in the chip */ }
  }

  window.ethereum.request({ method: "eth_accounts" })
    .then((accts) => (accts && accts[0] ? show(accts[0]) : render(null)))
    .catch(() => render(null));

  window.ethereum.on?.("accountsChanged", (accts) => (accts && accts[0] ? show(accts[0]) : render(null)));
})();
