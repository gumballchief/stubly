"use strict";

/* Front-end for the marketplace. Reads chain state via /api, sends the two
   client transactions (createJob, then approve+fund) via the visitor's own
   browser wallet. All addresses here are public constants. */

const ARC = {
  chainIdHex: "0x4cef52", // 5042002
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

/* ————— wallet plumbing ————— */
async function connectWallet(log) {
  if (!window.ethereum) throw new Error("No browser wallet found. Install MetaMask (or any EVM wallet extension) and reload.");
  const [addr] = await window.ethereum.request({ method: "eth_requestAccounts" });
  const current = await window.ethereum.request({ method: "eth_chainId" });
  if (current.toLowerCase() !== ARC.chainIdHex) {
    log(`switching wallet to ${ARC.chainName}…`);
    try {
      await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: ARC.chainIdHex }] });
    } catch (e) {
      if (e.code === 4902) {
        await window.ethereum.request({ method: "wallet_addEthereumChain", params: [ARC] });
      } else throw e;
    }
  }
  return addr;
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
      account = await connectWallet(log);
      tIn.client.textContent = fmt(account);
      log(`wallet connected: ${account}`, "ok");
      $("#btn-connect").textContent = fmt(account);
      $("#btn-create").disabled = false;
    } catch (e) { log(`✗ ${e.message}`, "bad"); }
  });

  $("#btn-create").addEventListener("click", async () => {
    try {
      const a = agents[selected];
      const val = inputField.value.trim();
      if (!val) return log("✗ fill in the job field first", "bad");
      $("#btn-create").disabled = true;

      const provider = new ethers.BrowserProvider(window.ethereum);
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
