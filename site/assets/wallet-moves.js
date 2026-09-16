"use strict";

/**
 * Add USDC and Send USDC out, for the Circle PIN wallet on /wallet.
 *
 * The wallet is the visitor's own; Stubly never holds a balance. A move out is a
 * PIN challenge the server builds with fixed addresses and checked amounts, so
 * nothing leaves until the owner types their PIN. USDC coming in from another
 * chain is two transactions the visitor signs in their own browser wallet.
 *
 * wallet.html's inline script owns creating and loading the wallet and announces
 * it with a "stubly:wallet" event. This file is deferred and can arrive after
 * that event, so it also reads window.stublyWallet on load.
 *
 * The PIN window resolves when the owner approves, not when the block lands, so
 * every move here polls until Circle reports it confirmed before stamping it.
 */
(function () {
  const $ = (s) => document.querySelector(s);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const newKey = () => crypto.randomUUID();

  /* Circle's CCTP V2 source chains (developers.circle.com/cctp/references/contract-addresses
     and /stablecoins/usdc-contract-addresses). Hardcoded on purpose: a browser
     wallet signs whatever it is handed, so these never come from a response. */
  const SOURCES = {
    testnet: {
      ethereum: { chainId: 11155111, domain: 0, usdc: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238", tokenMessenger: "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA" },
      base: { chainId: 84532, domain: 6, usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", tokenMessenger: "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA" },
      arbitrum: { chainId: 421614, domain: 3, usdc: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d", tokenMessenger: "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA" },
    },
    mainnet: {
      ethereum: { chainId: 1, domain: 0, usdc: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", tokenMessenger: "0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d" },
      base: { chainId: 8453, domain: 6, usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", tokenMessenger: "0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d" },
      arbitrum: { chainId: 42161, domain: 3, usdc: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", tokenMessenger: "0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d" },
    },
  };
  /* Circle's Forwarding Service, version 0: Circle mints on Arc itself, so the
     PIN wallet needs no gas to receive. Standard finality, same as the server. */
  const FORWARD_HOOK = "0x636374702d666f7277617264" + "0".repeat(40);
  const FINALITY = 2000;
  const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

  let W = null;            // { api, config, wallet, session } from wallet.html
  let balanceMinor = null; // USDC, 6 decimals, as BigInt
  let busy = false;

  /* ————— amounts ————— */

  function toMinor(v) {
    const s = String(v ?? "").trim();
    if (!/^\d{1,12}(\.\d+)?$/.test(s)) throw new Error("Enter an amount like 5 or 2.50.");
    const [whole, frac = ""] = s.split(".");
    if (frac.length > 6) throw new Error("USDC has 6 decimal places at most.");
    const m = BigInt(whole) * 1000000n + BigInt((frac + "000000").slice(0, 6));
    if (m <= 0n) throw new Error("The amount has to be more than zero.");
    return m;
  }
  function plain(minor) {
    const frac = (minor % 1000000n).toString().padStart(6, "0").replace(/0+$/, "");
    return `${minor / 1000000n}${frac ? `.${frac}` : ""}`;
  }
  function money(minor) {
    let frac = (minor % 1000000n).toString().padStart(6, "0").replace(/0+$/, "");
    while (frac.length < 2) frac += "0";
    return `${minor / 1000000n}.${frac}`;
  }
  const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;

  /* ————— small DOM helpers ————— */

  function logger(el) {
    const write = (text, cls, href) => {
      el.hidden = false;
      const line = document.createElement("div");
      if (cls) line.className = cls;
      line.textContent = text;
      if (href && /^https:\/\//.test(href)) {
        const a = document.createElement("a");
        a.href = href; a.target = "_blank"; a.rel = "noopener"; a.textContent = " view ↗";
        line.append(a);
      }
      el.append(line);
    };
    write.clear = () => { el.textContent = ""; el.hidden = true; };
    return write;
  }
  const addLog = logger($("#add-log"));
  const outLog = logger($("#out-log"));

  function radios(el, name, items, checked) {
    el.textContent = "";
    for (const it of items) {
      const label = document.createElement("label");
      const left = document.createElement("span");
      const input = document.createElement("input");
      input.type = "radio"; input.name = name; input.value = it.key; input.checked = it.key === checked;
      left.append(input, document.createTextNode(it.name));
      const pr = document.createElement("span");
      pr.className = "pr"; pr.textContent = it.note;
      label.append(left, pr);
      el.append(label);
    }
  }
  const picked = (name) => { const i = document.querySelector(`input[name="${name}"]:checked`); return i ? i.value : ""; };

  function stamp(text, color) {
    const zone = $("#w-stamps");
    zone.querySelectorAll(".move-stamp").forEach((s) => s.remove());
    const s = document.createElement("span");
    s.className = `stamp stamp-${color} fresh move-stamp`;
    s.textContent = text;
    zone.append(s);
  }

  function openPanel(which) {
    const moves = $("#moves");
    const add = which === "add";
    const panel = $(add ? "#panel-add" : "#panel-out");
    if (!moves.hidden && !panel.hidden) {
      moves.hidden = true;
      $("#btn-add").setAttribute("aria-expanded", "false");
      $("#btn-out").setAttribute("aria-expanded", "false");
      return;
    }
    moves.hidden = false;
    $("#panel-add").hidden = !add;
    $("#panel-out").hidden = add;
    $("#btn-add").setAttribute("aria-expanded", String(add));
    $("#btn-out").setAttribute("aria-expanded", String(!add));
    const still = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    moves.scrollIntoView({ behavior: still ? "auto" : "smooth", block: "start" });
  }

  /* ————— Circle session, balance, PIN ————— */

  /* Circle's user tokens last an hour; take a fresh one well before that. */
  async function session() {
    if (W.session && W.session.at && Date.now() - W.session.at < 30 * 60e3) return W.session;
    const uid = localStorage.getItem("am_circle_user");
    if (!uid) throw new Error("Wallet not loaded. Reload the page and try again.");
    const t = await W.api({ action: "token", userId: uid });
    if (t.error || !t.userToken) throw new Error(t.error || "Your wallet session expired. Reload the page and try again.");
    W.session = { userToken: t.userToken, encryptionKey: t.encryptionKey, appId: t.appId, at: Date.now() };
    return W.session;
  }

  async function call(body) {
    const s = await session();
    const r = await W.api({ ...body, userToken: s.userToken, walletId: W.wallet.id });
    if (r.error) throw new Error(r.error);
    return r;
  }

  async function refreshBalance() {
    if (!W) return;
    const el = $("#w-balance");
    try {
      const b = await call({ action: "balance" });
      balanceMinor = BigInt(b.usdcMinor);
      el.textContent = `${money(balanceMinor)} USDC`;
      el.removeAttribute("title");
    } catch (e) {
      el.textContent = "couldn't load";
      el.title = e.message;
    }
  }

  function runChallenge(s, challengeId) {
    return new Promise((resolve, reject) => {
      const sdk = new window.CircleW3S.W3SSdk();
      sdk.setAppSettings({ appId: s.appId });
      sdk.setAuthentication({ userToken: s.userToken, encryptionKey: s.encryptionKey });
      sdk.execute(challengeId, (error, result) => (error
        ? reject(new Error(error.message || "The PIN window closed before approving. Nothing was sent."))
        : resolve(result)));
    });
  }

  /** Circle's record of a move we started (failed ones included), or null if Circle
      still hasn't listed it after two looks. A lookup that errors throws. */
  async function lookup(kind, ref, extra) {
    for (let i = 0; i < 2; i++) {
      if (i) await sleep(3000);
      const r = await call({ action: "withdrawStatus", kind, ref, ...extra });
      if (r.state !== "waiting") return r;
    }
    return null;
  }

  /**
   * Before a retry starts step `kind` again. True: Circle has the earlier one, so
   * keep watching it. False: safe to start over, and the step gets a new key.
   * Starting over is allowed only when Circle says the earlier one failed, or when
   * its PIN window never approved and Circle still hasn't listed it. "Couldn't
   * check" and "approved but not listed yet" throw instead: a leftover allowance
   * from an abandoned withdraw would let a second burn really send twice.
   */
  async function resumable(it, kind, extra) {
    if (!it.started[kind]) return false;
    let r;
    try { r = await lookup(kind, it.keys[kind], extra); }
    catch { throw new Error("Couldn't check on the earlier try, so nothing new was started. Press Try again in a minute; it won't send twice."); }
    if (r && r.state !== "failed") return true;
    if (!r && it.signed[kind]) throw new Error("Circle hasn't listed the earlier try yet. Press Try again in a minute; it won't send twice.");
    it.keys[kind] = newKey(); it.started[kind] = false; it.signed[kind] = false;
    return false;
  }

  /** Poll until `done(status)`; null if it is still going when we stop watching. */
  async function waitFor(kind, ref, extra, { tries = 60, every = 3000, done = (r) => r.state === "confirmed", tick } = {}) {
    let misses = 0;
    for (let i = 0; i < tries; i++) {
      let r = null;
      try { r = await call({ action: "withdrawStatus", kind, ref, ...extra }); misses = 0; }
      catch (e) { if (++misses >= 5) throw e; }
      if (r) {
        if (r.state === "failed") {
          const e = new Error("The network turned that transaction down, so the USDC didn't move. Only the network fee was spent.");
          e.failed = true;
          throw e;
        }
        if (done(r)) return r;
        if (tick) tick(r, i);
      }
      await sleep(every);
    }
    return null;
  }

  /* ————— Send USDC out ————— */

  let out = null; // the intent under review: { to, amount, amountMinor, net, name, keys, started, done }

  function destination(key) {
    return (W.config.destinations || []).find((d) => d.key === key) || null;
  }

  function resetOut() {
    if (busy) return;
    out = null;
    $("#out-review").hidden = true;
    $("#btn-out-confirm").hidden = false;
    $("#btn-out-confirm").textContent = "Confirm with my PIN";
    $("#btn-out-edit").textContent = "Change it";
    $("#out-r-state").textContent = "check it";
  }

  function lockOut(on) {
    busy = on;
    ["#out-to", "#out-amount", "#btn-max", "#btn-out-review", "#btn-out-confirm", "#btn-out-edit"].forEach((s) => { $(s).disabled = on; });
    document.querySelectorAll('input[name="out-net"]').forEach((i) => { i.disabled = on; });
  }

  async function reviewOut() {
    if (busy) return;
    resetOut();
    outLog.clear();
    const btn = $("#btn-out-review");
    let locked = false;
    try {
      const rawTo = $("#out-to").value;
      const rawAmount = $("#out-amount").value;
      const to = rawTo.trim();
      if (!ADDRESS_RE.test(to) || /^0x0{40}$/.test(to)) throw new Error("That isn't a valid address. It starts with 0x and has 40 characters after that.");
      if (to.toLowerCase() === W.wallet.address.toLowerCase()) throw new Error("That's this wallet's own address. Enter where the USDC should go.");
      const amountMinor = toMinor(rawAmount);
      if (balanceMinor !== null && amountMinor > balanceMinor) throw new Error(`This wallet has ${money(balanceMinor)} USDC.`);
      const net = picked("out-net") || "arc";
      const amount = plain(amountMinor);
      // started: a challenge was created; signed: its PIN window approved it.
      const intent = { to, amount, amountMinor, net, keys: { send: newKey(), approve: newKey(), burn: newKey() }, started: {}, signed: {} };

      if (net === "arc") {
        intent.name = W.config.chain.name;
        $("#out-r-fee").textContent = "network fee only, a fraction of a cent from this wallet";
        $("#out-r-receive").textContent = `${amount} USDC`;
        $("#out-r-warn").textContent = "Check the address character by character. USDC sent to a wrong address can't be pulled back, not by us and not by Circle.";
      } else {
        const d = destination(net);
        if (!d) throw new Error("Pick a network.");
        intent.name = d.name;
        // Fields stay locked while Circle answers, so the ticket can't show numbers the form no longer has.
        lockOut(true);
        locked = true;
        btn.textContent = "Asking Circle for the fee…";
        const q = await W.api({ action: "withdrawQuote", destination: net, amount });
        lockOut(false);
        locked = false;
        if (q.error) throw new Error(q.error);
        if ($("#out-to").value !== rawTo || $("#out-amount").value !== rawAmount || (picked("out-net") || "arc") !== net) {
          throw new Error("The details changed while Circle worked out the fee. Press Review again.");
        }
        intent.maxFeeMinor = q.maxFeeMinor;
        $("#out-r-fee").textContent = `about ${q.fee} USDC, Circle's bridge, taken from the amount`;
        $("#out-r-receive").textContent = `about ${q.receiveAbout} USDC (at least ${q.receiveAtLeast})`;
        $("#out-r-warn").textContent = `Send to an address you control on ${d.name}. Circle delivers it there, so it needs no gas, usually within a few minutes. Some exchanges don't credit bridged deposits, so a wallet you own is safest. Two PIN prompts the first time: one lets the bridge take this amount, one sends it.`;
      }
      $("#out-r-to").textContent = to;
      $("#out-r-network").textContent = intent.name;
      $("#out-r-amount").textContent = `${amount} USDC`;
      out = intent;
      $("#out-review").hidden = false;
    } catch (e) {
      outLog(`✗ ${e.message}`, "bad");
    } finally {
      if (locked) lockOut(false);
      btn.disabled = false;
      btn.textContent = "Review";
    }
  }

  async function sendOnArc(it) {
    // A retry never starts a second send while Circle may still have the first one.
    if (!(await resumable(it, "send"))) {
      const s = await session();
      const r = await call({ action: "send", destinationAddress: it.to, amount: it.amount, idempotencyKey: it.keys.send });
      outLog("confirm with your PIN in the Circle window…");
      it.started.send = true;
      await runChallenge(s, r.challengeId);
      it.signed.send = true;
    }
    outLog("   approved — waiting for Arc to confirm…");
    const done = await waitFor("send", it.keys.send, {});
    if (!done) throw new Error("Still waiting on the network. Press Try again to keep watching; it won't send twice.");
    stamp("Sent", "blue");
    outLog(`sent ${it.amount} USDC to ${short(it.to)} ✓`, "ok", done.explorer);
  }

  async function sendViaBridge(it) {
    const extra = { destination: it.net };
    // True leaves started.burn set, so the loop is skipped and we only watch.
    await resumable(it, "burn", extra);
    for (let round = 0; round < 6 && !it.started.burn; round++) {
      await resumable(it, "approve");
      const s = await session();
      const r = await call({ action: "withdraw", destination: it.net, recipient: it.to, amount: it.amount,
        reviewedMaxFee: it.maxFeeMinor, idempotencyKeys: { approve: it.keys.approve, burn: it.keys.burn } });
      if (r.step === "approve") {
        if (it.started.approve) { await sleep(4000); continue; } // approved already; the chain read is catching up
        outLog("step 1 of 2 — let Circle's bridge take this amount (PIN)…");
        it.started.approve = true;
        await runChallenge(s, r.challengeId);
        it.signed.approve = true;
        outLog("   approved — waiting for it to land…");
        if (!(await waitFor("approve", it.keys.approve, {}))) throw new Error("The approval is slow to land. Press Try again in a minute; it picks up where it stopped.");
        continue;
      }
      outLog(`${it.started.approve ? "step 2 of 2" : "one step"} — send ${it.amount} USDC to ${it.name}, fee about ${r.fee} (PIN)…`);
      it.started.burn = true;
      await runChallenge(s, r.challengeId);
      it.signed.burn = true;
    }
    if (!it.started.burn) throw new Error("Couldn't get the send started. Press Try again in a minute.");

    outLog("   approved — waiting for Arc to confirm…");
    const burned = await waitFor("burn", it.keys.burn, extra);
    if (!burned) throw new Error("Still waiting on Arc. Press Try again to keep watching; it won't send twice.");
    stamp("Sent", "blue");
    outLog(`left Arc ✓ — Circle is delivering it on ${it.name}. You can leave this page; it doesn't depend on us.`, "ok", burned.explorer);
    refreshBalance();

    const arrived = await waitFor("burn", it.keys.burn, extra, { tries: 120, every: 10000, done: (x) => x.cctp === "delivered" });
    if (arrived) {
      stamp("Arrived", "green");
      outLog(`arrived on ${it.name} ✓`, "ok", arrived.destinationExplorer);
    } else {
      outLog(`Still on its way to ${it.name}. Circle finishes it without this page, so check that address later.`);
    }
  }

  async function confirmOut() {
    const it = out;
    if (!it || busy || it.done) return;
    // Locked before any await, so a double click can't drive two of these at once.
    lockOut(true);
    $("#out-r-state").textContent = "in progress";
    try {
      if (it.net === "arc") await sendOnArc(it); else await sendViaBridge(it);
      it.done = true;
      $("#out-r-state").textContent = "done";
      $("#btn-out-confirm").hidden = true;
      $("#btn-out-edit").textContent = "Send another";
    } catch (e) {
      if (e.failed) stamp("Failed", "red");
      outLog(`✗ ${e.message}`, "bad");
      $("#out-r-state").textContent = "stopped";
      $("#btn-out-confirm").textContent = "Try again";
    } finally {
      lockOut(false);
      refreshBalance();
    }
  }

  async function fillMax() {
    await refreshBalance();
    // A review or send may have started while the balance loaded; don't change its form under it.
    if (busy || balanceMinor === null) return;
    let buffer = 50000n;
    try { buffer = toMinor(W.config.gasBuffer); } catch { /* keep the default */ }
    const max = balanceMinor > buffer ? balanceMinor - buffer : 0n;
    resetOut();
    if (max <= 0n) {
      $("#out-amount").value = "";
      outLog("✗ Not enough USDC to send after leaving a little for the network fee.", "bad");
      return;
    }
    $("#out-amount").value = plain(max);
  }

  /* ————— Add USDC from another chain ————— */

  let add = null; // { src, amount, amountMinor, name, maxFeeMinor, pendingHash, burnHash }

  function lockAdd(on) {
    busy = on;
    ["#add-amount", "#btn-add-quote", "#btn-add-send"].forEach((s) => { $(s).disabled = on; });
    document.querySelectorAll('input[name="add-src"]').forEach((i) => { i.disabled = on; });
  }

  function walletMessage(e) {
    const code = e && (e.code ?? (e.info && e.info.error && e.info.error.code));
    if (code === "ACTION_REJECTED" || code === 4001) return "You declined in your browser wallet. Nothing more was sent.";
    if (code === "INSUFFICIENT_FUNDS") return "Your browser wallet needs a little ETH on that network to pay gas.";
    return (e && (e.shortMessage || e.message)) || "Something went wrong. Try again.";
  }

  async function quoteAdd() {
    if (busy) return;
    add = null;
    $("#add-review").hidden = true;
    addLog.clear();
    const btn = $("#btn-add-quote");
    let locked = false;
    try {
      const src = picked("add-src");
      const d = destination(src);
      if (!d) throw new Error("Pick where the USDC is now.");
      const rawAmount = $("#add-amount").value;
      const amountMinor = toMinor(rawAmount);
      lockAdd(true);
      locked = true;
      btn.textContent = "Asking Circle for the fee…";
      const q = await W.api({ action: "depositQuote", source: src, amount: plain(amountMinor) });
      lockAdd(false);
      locked = false;
      if (q.error) throw new Error(q.error);
      if (picked("add-src") !== src || $("#add-amount").value !== rawAmount) {
        throw new Error("The details changed while Circle worked out the fee. Press Show the fee again.");
      }
      $("#add-r-from").textContent = d.name;
      $("#add-r-amount").textContent = `${q.amount} USDC`;
      $("#add-r-fee").textContent = `about ${q.fee} USDC`;
      $("#add-r-receive").textContent = `about ${q.receiveAbout} USDC (at least ${q.receiveAtLeast})`;
      $("#add-r-to").textContent = W.wallet.address;
      add = { src, amount: q.amount, amountMinor, name: d.name, maxFeeMinor: q.maxFeeMinor };
      $("#btn-add-send").textContent = "Send from my browser wallet";
      $("#add-review").hidden = false;
    } catch (e) {
      addLog(`✗ ${e.message}`, "bad");
    } finally {
      if (locked) lockAdd(false);
      btn.disabled = false;
      btn.textContent = "Show the fee";
    }
  }

  async function switchTo(eth, chainId, name) {
    try {
      await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: `0x${chainId.toString(16)}` }] });
    } catch (e) {
      if (e && e.code === 4902) throw new Error(`Add ${name} to your browser wallet first, then try again.`);
      if (e && e.code === 4001) throw new Error("You declined the network switch. Nothing was sent.");
      throw new Error(`Couldn't switch your browser wallet to ${name}.`);
    }
  }

  async function sendFromBrowserWallet() {
    const it = add;
    if (!it || busy) return;
    const btn = $("#btn-add-send");
    lockAdd(true);
    try {
      const eth = window.ethereum;
      if (!eth) throw new Error("No browser wallet found. Install MetaMask, or send USDC on Arc to the address on the left.");
      if (!window.ethers) throw new Error("The wallet library didn't load. Reload the page and try again.");
      const net = SOURCES[W.config.chain.testnet ? "testnet" : "mainnet"][it.src];
      const listed = destination(it.src);
      const arcDomain = W.config.arcDomain;
      if (!net || !listed || listed.domain !== net.domain || !Number.isInteger(arcDomain)) throw new Error("This network isn't available for adding USDC right now.");
      if (!ADDRESS_RE.test(W.wallet.address)) throw new Error("Wallet not loaded. Reload the page and try again.");
      const { ethers } = window;

      if (!it.burnHash) {
        addLog("connecting your browser wallet…");
        const accounts = await eth.request({ method: "eth_requestAccounts" });
        const account = accounts && accounts[0];
        if (!account) throw new Error("Your browser wallet didn't share an account.");
        await switchTo(eth, net.chainId, it.name);
        /* Checked again right before every signature: a wallet can change network
           between two prompts, and a burn on the wrong chain isn't recoverable here. */
        const onChain = async () => {
          const id = await eth.request({ method: "eth_chainId" });
          if (BigInt(id) !== BigInt(net.chainId)) throw new Error(`Your browser wallet moved off ${it.name}. Switch back and try again.`);
        };
        const provider = new ethers.BrowserProvider(eth, "any");
        const turnedDown = () => new Error(`${it.name} turned that send down, so no USDC left your browser wallet. Only its gas was spent. Press Try again to send again.`);

        if (it.pendingHash) {
          /* A burn went out but we never saw its block. Ask the chain before anything
             else: a reverted burn must not be reported as on its way, and one that
             landed must not be sent a second time. */
          addLog(`checking the earlier send on ${it.name}…`);
          await onChain();
          const rc = await provider.waitForTransaction(it.pendingHash, 1, 5 * 60e3);
          if (!rc || rc.status !== 1) { it.pendingHash = null; throw turnedDown(); }
        } else {
          const signer = await provider.getSigner();
          const usdc = new ethers.Contract(net.usdc, [
            "function balanceOf(address) view returns (uint256)",
            "function allowance(address owner, address spender) view returns (uint256)",
            "function approve(address spender, uint256 value) returns (bool)",
          ], signer);

          await onChain();
          const held = await usdc.balanceOf(account);
          if (held < it.amountMinor) throw new Error(`That browser wallet has ${money(held)} USDC on ${it.name}.`);
          if ((await usdc.allowance(account, net.tokenMessenger)) < it.amountMinor) {
            addLog("step 1 of 2 — let Circle's bridge take this amount (confirm in your browser wallet)…");
            await onChain();
            await (await usdc.approve(net.tokenMessenger, it.amountMinor)).wait(1);
            addLog("   approved ✓", "ok");
          }

          /* A quote taken now, held under the cap the visitor saw, so the "at least"
             on the ticket stays a real floor. Same rule as the server's capFee. */
          const q = await W.api({ action: "depositQuote", source: it.src, amount: it.amount });
          if (q.error) throw new Error(q.error);
          const reviewed = BigInt(it.maxFeeMinor);
          const fresh = BigInt(q.maxFeeMinor);
          if (BigInt(q.needFeeMinor) > reviewed) {
            const e = new Error("Circle's bridge fee went up since you looked. Press Show the fee to see the new one.");
            e.requote = true;
            throw e;
          }
          const maxFee = fresh < reviewed ? fresh : reviewed;
          const tm = new ethers.Contract(net.tokenMessenger, [
            "function depositForBurnWithHook(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken, bytes32 destinationCaller, uint256 maxFee, uint32 minFinalityThreshold, bytes hookData)",
          ], signer);
          addLog(`step 2 of 2 — send ${it.amount} USDC to your Arc wallet, fee about ${q.fee} (confirm in your browser wallet)…`);
          await onChain();
          const tx = await tm.depositForBurnWithHook(it.amountMinor, arcDomain, ethers.zeroPadValue(W.wallet.address, 32),
            net.usdc, ethers.ZeroHash, maxFee, FINALITY, FORWARD_HOOK);
          it.pendingHash = tx.hash;
          addLog("   sent — waiting for the block…", "", `${listed.explorer}/tx/${tx.hash}`);
          let rc;
          try {
            rc = await tx.wait(1);
          } catch (e) {
            // A sped-up send is the same burn under a new hash; a revert or a cancel is no burn.
            if (e && e.code === "TRANSACTION_REPLACED" && !e.cancelled && e.replacement) { it.pendingHash = e.replacement.hash; rc = e.receipt; }
            else if (e && (e.code === "CALL_EXCEPTION" || e.code === "TRANSACTION_REPLACED")) rc = null;
            else throw e; // couldn't tell: pendingHash stays, and Try again asks the chain
          }
          if (!rc || rc.status !== 1) { it.pendingHash = null; throw turnedDown(); }
        }
        it.burnHash = it.pendingHash;
        it.pendingHash = null;
        stamp("Sent", "blue");
      }

      addLog(`left ${it.name} ✓ — Circle mints it into this wallet once ${it.name} finalizes, about 15–20 minutes. You can leave this page.`, "ok");
      btn.textContent = "Watching for it…";
      for (let i = 0; i < 100; i++) {
        const r = await W.api({ action: "depositStatus", source: it.src, txHash: it.burnHash }).catch(() => ({}));
        if (r.cctp === "delivered") {
          stamp("Arrived", "green");
          addLog("arrived in your wallet ✓", "ok", r.explorer);
          await refreshBalance();
          btn.textContent = "Done";
          add = null;
          return;
        }
        if (i % 4 === 3) refreshBalance();
        await sleep(15000);
      }
      addLog("Still on its way. Circle finishes it without this page; your balance updates when it lands.");
      btn.textContent = "Keep watching";
    } catch (e) {
      addLog(`✗ ${walletMessage(e)}`, "bad");
      btn.textContent = "Try again";
      if (e && e.requote) { add = null; $("#add-review").hidden = true; }
    } finally {
      lockAdd(false);
      btn.disabled = !add;
    }
  }

  /* ————— wiring ————— */

  function onWallet(detail) {
    if (!detail || !detail.wallet || !detail.config || !detail.config.moves) return;
    W = detail;
    $("#w-moves").hidden = false;
    $("#add-address").textContent = W.wallet.address;
    $("#add-faucet").hidden = !W.config.faucet;
    const dests = W.config.destinations || [];
    radios($("#add-source"), "add-src", dests.map((d) => ({ key: d.key, name: d.name, note: "browser wallet" })), dests[0] && dests[0].key);
    radios($("#out-network"), "out-net",
      [{ key: "arc", name: W.config.chain.name, note: "same network" }, ...dests.map((d) => ({ key: d.key, name: d.name, note: "Circle's bridge" }))],
      "arc");
    refreshBalance();
    if (/^#(add|deposit)$/.test(location.hash)) openPanel("add");
  }

  document.addEventListener("stubly:wallet", (e) => onWallet(e.detail));
  document.addEventListener("stubly:wallet-reset", () => {
    W = null; balanceMinor = null; out = null; add = null;
    $("#w-moves").hidden = true;
    $("#moves").hidden = true;
    outLog.clear(); addLog.clear();
    $("#out-review").hidden = true; $("#add-review").hidden = true;
  });

  $("#btn-add").addEventListener("click", () => openPanel("add"));
  $("#btn-out").addEventListener("click", () => openPanel("out"));
  $("#btn-copy-address").addEventListener("click", async () => {
    if (!W) return;
    try { await navigator.clipboard.writeText(W.wallet.address); $("#btn-copy-address").textContent = "Copied ✓"; }
    catch { $("#btn-copy-address").textContent = "Select it above and copy"; }
    setTimeout(() => { $("#btn-copy-address").textContent = "Copy address"; }, 2500);
  });

  $("#btn-out-review").addEventListener("click", reviewOut);
  $("#btn-out-confirm").addEventListener("click", confirmOut);
  $("#btn-out-edit").addEventListener("click", () => {
    const wasDone = out && out.done;
    resetOut();
    if (wasDone) { $("#out-amount").value = ""; outLog.clear(); }
    $("#out-to").focus();
  });
  $("#btn-max").addEventListener("click", fillMax);
  // Any edit after Review throws the review away, so a PIN never approves stale numbers.
  ["#out-to", "#out-amount"].forEach((s) => $(s).addEventListener("input", resetOut));
  $("#out-network").addEventListener("change", resetOut);

  $("#btn-add-quote").addEventListener("click", quoteAdd);
  $("#btn-add-send").addEventListener("click", sendFromBrowserWallet);
  $("#add-amount").addEventListener("input", () => { if (!busy) { add = null; $("#add-review").hidden = true; } });
  $("#add-source").addEventListener("change", () => { if (!busy) { add = null; $("#add-review").hidden = true; } });

  if (window.stublyWallet) onWallet(window.stublyWallet);
})();
