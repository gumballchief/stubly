"use strict";

/* Front-end for the marketplace. Reads chain state via /api, sends the two
   client transactions (createJob, then approve+fund) via the visitor's own
   browser wallet. All addresses here are public constants. */

/* EXACTLY the keys wallet_addEthereumChain accepts — extra keys make MetaMask
   reject the whole request ("unsupported keys"), so never decorate this object. */
const ARC = {
  chainId: "0x4cef52", // 5042002
  chainName: "Arc Testnet",
  rpcUrls: ["https://rpc.testnet.arc.io"],
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  blockExplorerUrls: ["https://testnet.arcscan.app"],
};

const IFACE_JOBS = [
  "function createJob(address provider, address evaluator, uint256 expiredAt, string description, address hook) returns (uint256)",
  "function fund(uint256 jobId, bytes optParams)",
  "event JobCreated(uint256 indexed jobId, address indexed client, address indexed provider, address evaluator, uint256 expiredAt, address hook)",
];
const IFACE_USDC = [
  "function approve(address spender, uint256 value) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
];

const $ = (sel) => document.querySelector(sel);
const fmt = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;

async function api(path) {
  const r = await fetch(path);
  return r.ok || r.headers.get("content-type")?.includes("json") ? r.json() : Promise.reject(new Error(`${r.status}`));
}
async function postApi(body) {
  const r = await fetch("/api/circle", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return r.json();
}

/* Run one Circle challenge: opens the secure widget, resolves when the user
   approves with their PIN, rejects on error/cancel. */
function runChallenge(ctx, challengeId) {
  return new Promise((resolve, reject) => {
    const sdk = new window.CircleW3S.W3SSdk();
    sdk.setAppSettings({ appId: ctx.appId });
    sdk.setAuthentication({ userToken: ctx.userToken, encryptionKey: ctx.encryptionKey });
    sdk.execute(challengeId, (error, result) => error ? reject(new Error(error.message || "cancelled")) : resolve(result));
  });
}

/* tiny markdown renderer — headings, bold, lists, links; enough for reports */
function mdToHtml(md) {
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const inline = (s) =>
    s.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
     .replace(/\*([^*]+)\*/g, "<i>$1</i>")
     .replace(/`([^`]+)`/g, "<code>$1</code>")
     .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2" rel="noopener" target="_blank">$1</a>');
  const lines = esc(md).split(/\r?\n/);
  let html = "", inList = false;
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^[-*] /.test(line.trim())) {
      if (!inList) { html += "<ul>"; inList = true; }
      html += `<li>${inline(line.trim().slice(2))}</li>`;
      continue;
    }
    if (inList) { html += "</ul>"; inList = false; }
    if (/^### /.test(line)) html += `<h3>${inline(line.slice(4))}</h3>`;
    else if (/^## /.test(line)) html += `<h2>${inline(line.slice(3))}</h2>`;
    else if (/^# /.test(line)) html += `<h1>${inline(line.slice(2))}</h1>`;
    else if (/^---+$/.test(line)) html += "<hr>";
    else if (line.trim()) html += `<p>${inline(line)}</p>`;
  }
  if (inList) html += "</ul>";
  return html;
}

/* ————— wallet plumbing (EIP-6963: every installed wallet announces itself) ————— */
const WALLETS = [];
window.addEventListener("eip6963:announceProvider", (e) => {
  if (!WALLETS.some((w) => w.info.uuid === e.detail.info.uuid)) WALLETS.push(e.detail);
});
window.dispatchEvent(new Event("eip6963:requestProvider"));

function showWalletPicker() {
  return new Promise((resolve, reject) => {
    const host = $("#wallet-pick");
    host.style.display = "grid";
    host.innerHTML = WALLETS.map((w, i) =>
      `<button type="button" class="wallet-opt" data-i="${i}">
         <img src="${w.info.icon}" alt="" width="20" height="20"> ${w.info.name}</button>`).join("");
    host.querySelectorAll(".wallet-opt").forEach((b) =>
      b.addEventListener("click", () => { host.style.display = "none"; resolve(WALLETS[Number(b.dataset.i)]); }));
    setTimeout(() => { if (host.style.display !== "none") { host.style.display = "none"; reject(new Error("no wallet chosen")); } }, 60_000);
  });
}

async function pickWallet() {
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  await new Promise((r) => setTimeout(r, 150));
  if (WALLETS.length > 1) return showWalletPicker();
  if (WALLETS.length === 1) return WALLETS[0];
  if (window.ethereum) return { provider: window.ethereum, info: { name: "Browser wallet" } };
  throw new Error("No browser wallet found. Install MetaMask (or any EVM wallet extension) and reload.");
}

async function connectWallet(log) {
  const chosen = await pickWallet();
  const eth = chosen.provider;
  log(`using ${chosen.info.name}…`);
  const [addr] = await eth.request({ method: "eth_requestAccounts" });
  const current = await eth.request({ method: "eth_chainId" });
  if (current.toLowerCase() !== ARC.chainId) {
    log(`switching ${chosen.info.name} to ${ARC.chainName}…`);
    try {
      await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: ARC.chainId }] });
    } catch (e) {
      // 4902 = unknown chain; some wallets bury it in e.data — try adding either way
      await eth.request({ method: "wallet_addEthereumChain", params: [ARC] });
      await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: ARC.chainId }] });
    }
  }
  return { addr, eth, name: chosen.info.name };
}

async function disconnectWallet(eth) {
  try { await eth.request({ method: "wallet_revokePermissions", params: [{ eth_accounts: {} }] }); }
  catch { /* older wallets have no revoke — clearing our own state is enough */ }
}

/* ————— page: hire ————— */
async function initHire() {
  const cat = await api("/api/catalog");
  const agents = cat.agents;
  const choiceBox = $("#agent-choice");
  const inputField = $("#job-input");
  const inputLabel = $("#job-input-label");
  const priceLine = $("#price-line");
  const tIn = { agent: $("#t-agent"), input: $("#t-input"), price: $("#t-price"), client: $("#t-client") };
  let selected = Object.keys(agents)[0];
  let account = null;
  let walletEth = null;  // extension path: the provider chosen in the picker
  let mode = null;       // "extension" | "circle"
  let circleCtx = null;  // circle path: { userToken, encryptionKey, walletId, appId }

  const logEl = $("#carbon");
  const log = (msg, cls) => { logEl.innerHTML += (cls ? `<span class="${cls}">` : "") + msg + (cls ? "</span>" : "") + "\n"; logEl.scrollTop = logEl.scrollHeight; };

  function renderChoice() {
    choiceBox.innerHTML = Object.entries(agents).map(([key, a]) => `
      <label><span><input type="radio" name="agent" value="${key}" ${key === selected ? "checked" : ""}> ${a.title}</span>
      <span class="pr">${a.priceUsdc} USDC · ${a.eta}</span></label>`).join("");
    choiceBox.querySelectorAll("input").forEach((r) => r.addEventListener("change", () => { selected = r.value; sync(); }));
  }
  function sync() {
    const a = agents[selected];
    inputLabel.textContent = a.input.label;
    inputField.placeholder = a.input.placeholder;
    priceLine.textContent = `${a.priceUsdc}.00 USDC — held in escrow until the judge signs off`;
    tIn.agent.textContent = a.title;
    tIn.input.textContent = inputField.value || "—";
    tIn.price.textContent = `${a.priceUsdc}.00 USDC`;
  }
  inputField.addEventListener("input", sync);
  renderChoice(); sync();

  $("#btn-connect").addEventListener("click", async () => {
    try {
      const w = await connectWallet(log);
      account = w.addr; walletEth = w.eth; mode = "extension";
      tIn.client.textContent = fmt(account);
      log(`connected via ${w.name}: ${account}`, "ok");
      $("#btn-connect").textContent = fmt(account);
      $("#btn-create").disabled = false;
      $("#btn-disconnect").style.display = "inline-block";
    } catch (e) { log(`✗ ${e.message}`, "bad"); }
  });

  $("#btn-pin").addEventListener("click", async () => {
    try {
      const userId = localStorage.getItem("am_circle_user");
      if (!userId) { log("no PIN wallet on this browser yet — create one first at /wallet", "bad"); return; }
      log("loading your PIN wallet…");
      const t = await postApi({ action: "token", userId });
      if (t.error) throw new Error(t.error);
      const w = await postApi({ action: "wallets", userToken: t.userToken });
      const wallet = (w.wallets || []).find((x) => x.blockchain === "ARC-TESTNET");
      if (!wallet) throw new Error("no Arc wallet found for this account — create one at /wallet");
      account = wallet.address; mode = "circle";
      circleCtx = { userToken: t.userToken, encryptionKey: t.encryptionKey, walletId: wallet.id, appId: t.appId };
      tIn.client.textContent = fmt(account);
      $("#btn-pin").textContent = `PIN · ${fmt(account)}`;
      $("#btn-create").disabled = false;
      log(`PIN wallet ready: ${account}`, "ok");
      log("each payment step will ask for your PIN in Circle's secure window");
    } catch (e) { log(`✗ ${e.message}`, "bad"); }
  });

  $("#btn-disconnect").addEventListener("click", async () => {
    if (walletEth) await disconnectWallet(walletEth);
    account = null; walletEth = null;
    tIn.client.textContent = "connect wallet";
    $("#btn-connect").textContent = "Connect wallet";
    $("#btn-create").disabled = true;
    $("#btn-disconnect").style.display = "none";
    log("disconnected — pick any wallet to reconnect", "ok");
  });

  async function circleHireFlow(a, val) {
    const description = JSON.stringify({ v: 1, agent: selected, input: { [a.input.field]: val } });
    const expiredAt = String(Math.floor(Date.now() / 1000) + 24 * 3600);
    const amount = String(Math.round(Number(a.priceUsdc) * 1e6)); // USDC has 6 decimals

    const before = await postApi({ action: "findjob", client: account });

    log("step 1/3 — create the work order (confirm with your PIN)…");
    let ch = await postApi({ action: "execute", userToken: circleCtx.userToken, walletId: circleCtx.walletId,
      contractAddress: cat.contract, abiFunctionSignature: "createJob(address,address,uint256,string,address)",
      abiParameters: [cat.providerWallet, cat.evaluatorWallet, expiredAt, description, "0x0000000000000000000000000000000000000000"] });
    if (ch.error || !ch.challengeId) throw new Error(ch.error || "no challenge returned");
    await runChallenge(circleCtx, ch.challengeId);

    log("   waiting for the order to land on-chain…");
    let jobId = null;
    for (let i = 0; i < 30 && !jobId; i++) {
      await new Promise((r) => setTimeout(r, 4000));
      const f = await postApi({ action: "findjob", client: account });
      if (f.jobId && f.jobId !== before.jobId) jobId = f.jobId;
    }
    if (!jobId) throw new Error("order not found on-chain yet — check /job in a minute, your money has not moved");
    log(`   order #${jobId} created ✓`, "ok");

    log("   waiting for the agent to quote…");
    let quoted = false;
    for (let i = 0; i < 30 && !quoted; i++) {
      await new Promise((r) => setTimeout(r, 4000));
      const j = await api(`/api/job?id=${jobId}`);
      quoted = j.hasBudget;
    }
    if (!quoted) throw new Error(`quote pending — finish later from /job?id=${jobId}; your money has NOT moved`);

    log("step 2/3 — approve the USDC (PIN again)…");
    ch = await postApi({ action: "execute", userToken: circleCtx.userToken, walletId: circleCtx.walletId,
      contractAddress: cat.usdc, abiFunctionSignature: "approve(address,uint256)",
      abiParameters: [cat.contract, amount] });
    if (ch.error || !ch.challengeId) throw new Error(ch.error || "no challenge returned");
    await runChallenge(circleCtx, ch.challengeId);

    log("step 3/3 — fund the escrow (last PIN)…");
    ch = await postApi({ action: "execute", userToken: circleCtx.userToken, walletId: circleCtx.walletId,
      contractAddress: cat.contract, abiFunctionSignature: "fund(uint256,bytes)",
      abiParameters: [jobId, "0x"] });
    if (ch.error || !ch.challengeId) throw new Error(ch.error || "no challenge returned");
    await runChallenge(circleCtx, ch.challengeId);

    log("escrow funded ✓ — opening your work order…", "ok");
    setTimeout(() => { location.href = `/job?id=${jobId}`; }, 1200);
  }

  $("#btn-create").addEventListener("click", async () => {
    try {
      const a = agents[selected];
      const val = inputField.value.trim();
      if (!val) return log("✗ fill in the job field first", "bad");
      $("#btn-create").disabled = true;

      if (mode === "circle") {
        try { await circleHireFlow(a, val); } catch (e) { log(`✗ ${e.message}`, "bad"); $("#btn-create").disabled = false; }
        return;
      }

      const provider = new ethers.BrowserProvider(walletEth);
      const signer = await provider.getSigner();
      const jobs = new ethers.Contract(cat.contract, IFACE_JOBS, signer);
      const usdc = new ethers.Contract(cat.usdc, IFACE_USDC, signer);

      const description = JSON.stringify({ v: 1, agent: selected, input: { [a.input.field]: val } });
      const expiredAt = Math.floor(Date.now() / 1000) + 24 * 3600;

      log("1/3 creating the work order (sign in wallet)…");
      const tx1 = await jobs.createJob(cat.providerWallet, cat.evaluatorWallet, expiredAt, description, ethers.ZeroAddress);
      const rc1 = await tx1.wait(1);
      let jobId = null;
      for (const lg of rc1.logs) {
        try { const p = jobs.interface.parseLog(lg); if (p?.name === "JobCreated") { jobId = p.args.jobId.toString(); break; } } catch {}
      }
      if (!jobId) throw new Error("job id not found in receipt");
      log(`   order #${jobId} created ✓`, "ok");

      log("2/3 waiting for the agent to quote the price…");
      let quoted = false;
      for (let i = 0; i < 30 && !quoted; i++) {
        await new Promise((r) => setTimeout(r, 4000));
        const j = await api(`/api/job?id=${jobId}`);
        quoted = j.hasBudget;
      }
      if (!quoted) throw new Error("agent has not quoted yet — the orchestrator may be offline. Your money has NOT moved; try again later from the job page.");
      log("   quote posted ✓", "ok");

      const amount = ethers.parseUnits(a.priceUsdc, 6);
      log("3/3 funding escrow (two wallet signatures: approve, then fund)…");
      const allowance = await usdc.allowance(account, cat.contract);
      if (allowance < amount) { const txA = await usdc.approve(cat.contract, amount); await txA.wait(1); }
      const tx2 = await jobs.fund(jobId, "0x");
      await tx2.wait(1);
      log(`   escrow funded ✓ — money is now locked in the contract`, "ok");
      log(`opening work order #${jobId}…`);
      location.href = `/job?id=${jobId}`;
    } catch (e) {
      log(`✗ ${e.shortMessage || e.message}`, "bad");
      $("#btn-create").disabled = false;
    }
  });
}

/* machine strip: stripe widths derived from the real job number's digits */
function renderBarcode(el, seed) {
  const digits = String(seed).split("").map(Number);
  let html = "";
  for (const d of digits) {
    html += `<i style="width:${2 + (d % 4)}px"></i><i style="width:2px;opacity:0"></i><i style="width:${1 + (d % 3)}px"></i>`;
  }
  el.innerHTML = html.repeat(3);
}

/* ————— page: job ————— */
const STAMPS = { 1: ["FUNDED", "stamp-blue"], 2: ["DELIVERED", "stamp-blue"], 3: ["PAID OUT", "stamp-green"], 4: ["REFUNDED", "stamp-red"], 5: ["EXPIRED", "stamp-red"] };
const STEPS = [
  [0, "Order created", "the work order exists on-chain"],
  [1, "Escrow funded", "USDC locked in the contract"],
  [2, "Work delivered", "deliverable fingerprint submitted"],
  [3, "Settled", "judge signed off — agent paid (or client refunded)"],
];

async function initJob() {
  const id = new URLSearchParams(location.search).get("id");
  if (!id) { $("#job-main").innerHTML = "<p>No job number in the address. Open a work order like <code>/job?id=161321</code>.</p>"; return; }
  $("#t-no").textContent = `#${id}`;
  const bc = $("#barcode"); if (bc) { renderBarcode(bc, id); $("#barcode-label").textContent = `ARC·5042002·JOB·${id}`; }
  let lastStatus = -1;

  async function refresh() {
    const j = await api(`/api/job?id=${id}`);
    if (!j.live) { $("#carbon").textContent = `chain read failed: ${j.error} — retrying…`; return; }
    $("#t-agent").textContent = j.agent ? (j.agent === "site-audit" ? "Site Audit" : "Research Brief") : "external job";
    $("#t-input").textContent = j.input ? Object.values(j.input)[0] : "—";
    $("#t-price").textContent = j.hasBudget ? `${Number(j.budgetUsdc).toFixed(2)} USDC` : "quote pending";
    $("#t-client").textContent = fmt(j.client);
    $("#t-provider").textContent = fmt(j.provider);

    const zone = $("#stamps");
    const want = [];
    if (j.status >= 1 && j.status !== 5) want.push(STAMPS[1]);
    if (j.status >= 2 && j.status <= 4) want.push(STAMPS[2]);
    if (j.status >= 3 && STAMPS[j.status]) want.push(STAMPS[j.status]);
    if (j.status === 5) want.push(STAMPS[5]);
    zone.innerHTML = want.map(([txt, cls], i) =>
      `<span class="stamp ${cls} ${j.status !== lastStatus && i === want.length - 1 ? "fresh" : ""}">${txt}</span>`).join("");

    const done = j.status >= 3 ? 4 : j.status + 1;
    $("#timeline").innerHTML = STEPS.map(([n, t, d], i) =>
      `<div class="tl-step ${i < done ? "done" : "pending"}"><span class="tl-mark">${i < done ? "[x]" : "[ ]"}</span><span><b>${t}</b> — ${d}</span></div>`).join("");

    if (j.status >= 2) {
      try {
        const r = await fetch(`/api/deliverable?id=${id}`);
        if (r.ok && r.headers.get("content-type")?.includes("markdown")) {
          $("#deliverable-wrap").style.display = "block";
          $("#deliverable").innerHTML = mdToHtml(await r.text());
        }
      } catch {}
    }
    if (j.status === 4) $("#refund-note").style.display = "block";

    // order created but escrow not funded → offer funding right here
    const fundZone = $("#fund-zone");
    if (fundZone) {
      fundZone.style.display = j.status === 0 && j.hasBudget ? "block" : "none";
      if (j.status === 0 && j.hasBudget && !fundZone.dataset.wired) {
        fundZone.dataset.wired = "1";
        $("#btn-fund").addEventListener("click", async () => {
          const note = $("#carbon");
          try {
            $("#btn-fund").disabled = true;
            const w = await connectWallet((m) => { note.textContent = m; });
            const signer = await new ethers.BrowserProvider(w.eth).getSigner();
            const cat = await api("/api/catalog");
            const jobs = new ethers.Contract(cat.contract, IFACE_JOBS, signer);
            const usdc = new ethers.Contract(cat.usdc, IFACE_USDC, signer);
            const amount = ethers.parseUnits(Number(j.budgetUsdc).toFixed(6), 6);
            note.textContent = "funding: approve, then fund (two signatures)…";
            const allowance = await usdc.allowance(w.addr, cat.contract);
            if (allowance < amount) { const txA = await usdc.approve(cat.contract, amount); await txA.wait(1); }
            const tx = await jobs.fund(id, "0x");
            await tx.wait(1);
            note.textContent = "escrow funded ✓ — the agent picks this up within a minute";
            refresh();
          } catch (e) {
            note.textContent = `✗ ${e.shortMessage || e.message}`;
            $("#btn-fund").disabled = false;
          }
        });
      }
    }

    lastStatus = j.status;
    if (j.status <= 2) setTimeout(refresh, 10_000);
  }
  refresh().catch((e) => { $("#carbon") && ($("#carbon").textContent = e.message); });
}

/* ————— page: index ————— */
async function initIndex() {
  try {
    const cat = await api("/api/catalog");
    $("#agent-grid").innerHTML = Object.entries(cat.agents).map(([key, a]) => `
      <div class="agent-card">
        <h3>${a.title}</h3>
        <p>${a.blurb}</p>
        <div class="agent-meta"><span><b>${a.priceUsdc} USDC</b> per job</span><span>${a.eta}</span></div>
        <a class="btn btn-primary" href="/hire?agent=${key}">Hire ${a.title}</a>
      </div>`).join("");
    $("#contract-link").href = `${cat.explorer}/address/${cat.contract}`;
    $("#contract-link").textContent = fmt(cat.contract) + " (Circle's ERC-8183 escrow)";
  } catch { /* static content still stands */ }
}

document.addEventListener("DOMContentLoaded", () => {
  const page = document.body.dataset.page;
  if (page === "hire") initHire().catch((e) => { $("#carbon").textContent = e.message; });
  if (page === "job") initJob();
  if (page === "index") initIndex();
});
