"use strict";

/* Front-end for the marketplace. Reads chain state via /api, sends the two
   client transactions (createJob, then approve+fund) via the visitor's own
   browser wallet. All addresses here are public constants. */

/* EXACTLY the keys wallet_addEthereumChain accepts — extra keys make MetaMask
   reject the whole request ("unsupported keys"), so never decorate this object.

   The values are filled in from /api/catalog so the page always follows whichever
   chain the server is serving. What is written here is the testnet fallback for
   the moment before that first response lands — and for if it never does. */
const ARC = {
  chainId: "0x4cef52", // 5042002
  chainName: "Arc Testnet",
  rpcUrls: ["https://rpc.testnet.arc.io"],
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  blockExplorerUrls: ["https://testnet.arcscan.app"],
};

/** Circle Wallets names the network separately from the EVM chain id. */
let CIRCLE_CHAIN = "ARC-TESTNET";


/* Hydrate the two above from the server. Safe to call anywhere, any number of
   times: it fetches once and every later caller awaits the same promise. A
   failed fetch leaves the fallback in place rather than blocking a hire. */
let _chainReady = null;
function chainReady() {
  if (!_chainReady) {
    _chainReady = api("/api/catalog").then((cat) => {
      if (cat && cat.chain) {
        if (cat.chain.addChain) Object.assign(ARC, cat.chain.addChain);
        if (cat.chain.circleChain) CIRCLE_CHAIN = cat.chain.circleChain;
      }
      return ARC;
    }).catch(() => ARC);
  }
  return _chainReady;
}

const IFACE_JOBS = [
  "function createJob(address provider, address evaluator, uint256 expiredAt, string description, address hook) returns (uint256)",
  "function fund(uint256 jobId, bytes optParams)",
  "function claimRefund(uint256 jobId)",
  "event JobCreated(uint256 indexed jobId, address indexed client, address indexed provider, address evaluator, uint256 expiredAt, address hook)",
];
const IFACE_USDC = [
  "function approve(address spender, uint256 value) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
];

/* How long the client's USDC can sit in escrow before they can pull it back.
   Set to the shortest the contract permits — ERC-8183 reverts with
   ExpiryTooShort() under 600s — because this is the buyer's guarantee and a
   short one is a strong one. The live worker settles in seconds, so it clears
   this easily; the scheduled fallback runs every five minutes and sometimes
   won't, and a job that expires refunds the buyer rather than stranding them. */
const ESCROW_DEADLINE_SEC = 600;

/* Approved once so every later order is a single PIN. Deliberately a bounded
   number rather than the usual infinite approval: 100 USDC is generous for
   1–2 USDC jobs and still caps what the escrow could ever pull if it were
   compromised. */
const STANDING_ALLOWANCE = String(100 * 1e6);

/** Current USDC allowance the escrow holds for this wallet, read from chain. */
async function readAllowance(cat, owner) {
  try {
    const p = new ethers.JsonRpcProvider((cat.chain && cat.chain.addChain.rpcUrls[0]) || ARC.rpcUrls[0]);
    const usdc = new ethers.Contract(cat.usdc, IFACE_USDC, p);
    return await usdc.allowance(owner, cat.contract);
  } catch { return 0n; }
}

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
  await chainReady();
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

  /* ————— the front door: describe the job, we pick the agent —————
     The router only ever selects from this same catalog and the price is read
     from it locally, so nothing typed here can change what gets charged. The
     order still isn't created until the buyer presses Create work order. */
  const askBtn = $("#btn-ask");
  if (askBtn) {
    const askNote = (m) => { $("#ask-note").textContent = m; };
    const runAsk = async () => {
      const text = $("#ask").value.trim();
      if (text.length < 4) { askNote("Say a bit more than that."); return; }
      askBtn.disabled = true;
      $("#ask-result").style.display = "none";
      askNote("reading the shelf…");
      try {
        const r = await fetch("/api/dispatch", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text }),
        });
        const d = await r.json();
        if (!d.ok) { askNote(d.reason || "no match"); return; }

        selected = d.agent;
        renderChoice();
        if (d.input) inputField.value = d.input;
        sync();

        $("#ask-title").textContent = d.title;
        $("#ask-why").textContent = d.why ? `picked because: ${d.why}` : "";
        $("#ask-price").innerHTML =
          `<b>${d.priceUsdc}.00 USDC</b> · ${d.eta} · ${d.label.toLowerCase()}: ${
            (d.input || "—").replace(/</g, "&lt;")}`;
        $("#ask-result").style.display = "block";
        askNote(d.input
          ? "Check it below, then create the work order. Nothing is charged yet."
          : "Fill in the job details below, then create the work order.");
      } catch (e) {
        askNote(`✗ ${e.message}`);
      } finally {
        askBtn.disabled = false;
      }
    };
    askBtn.addEventListener("click", runAsk);
    $("#ask").addEventListener("keydown", (e) => { if (e.key === "Enter") runAsk(); });
  }

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
      await chainReady();
      const wallet = (w.wallets || []).find((x) => x.blockchain === CIRCLE_CHAIN);
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
    const expiredAt = String(Math.floor(Date.now() / 1000) + ESCROW_DEADLINE_SEC);
    const amount = String(Math.round(Number(a.priceUsdc) * 1e6)); // USDC has 6 decimals

    const before = await postApi({ action: "findjob", client: account });

    log("step 1 — create the work order (confirm with your PIN)…");
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

    /* Ask the site to price it now rather than waiting for the worker's next
       poll. If that call fails for any reason the worker still picks the job
       up, so we fall through to polling instead of giving up. */
    log("   pricing the order…");
    let quoted = false;
    try {
      const q = await (await fetch("/api/quote", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ jobId }),
      })).json();
      quoted = !!q.ok;
    } catch { /* fall through to the poll below */ }

    for (let i = 0; i < 30 && !quoted; i++) {
      await new Promise((r) => setTimeout(r, 4000));
      const j = await api(`/api/job?id=${jobId}`);
      quoted = j.hasBudget;
    }
    if (!quoted) throw new Error(`quote pending — finish later from /job?id=${jobId}; your money has NOT moved`);

    /* The escrow only needs an allowance, and an allowance persists. Approving
       the exact price every time cost a PIN prompt per job for no benefit — so
       approve a standing amount once, and skip this step entirely from then on.
       Read the current allowance from the chain rather than remembering it, so
       a wallet used elsewhere is still handled correctly. */
    const allowance = await readAllowance(cat, account);
    if (allowance < BigInt(amount)) {
      log("one-time — approve USDC spending (PIN)…");
      ch = await postApi({ action: "execute", userToken: circleCtx.userToken, walletId: circleCtx.walletId,
        contractAddress: cat.usdc, abiFunctionSignature: "approve(address,uint256)",
        abiParameters: [cat.contract, STANDING_ALLOWANCE] });
      if (ch.error || !ch.challengeId) throw new Error(ch.error || "no challenge returned");
      await runChallenge(circleCtx, ch.challengeId);
      log("   approved — future orders skip this step", "ok");
    }

    log("last step — fund the escrow (PIN)…");
    ch = await postApi({ action: "execute", userToken: circleCtx.userToken, walletId: circleCtx.walletId,
      contractAddress: cat.contract, abiFunctionSignature: "fund(uint256,bytes)",
      abiParameters: [jobId, "0x"] });
    if (ch.error || !ch.challengeId) throw new Error(ch.error || "no challenge returned");
    await runChallenge(circleCtx, ch.challengeId);

    log("escrow funded ✓ — starting the agent…", "ok");
    /* Tell the site to run it now rather than waiting for a worker to notice.
       Deliberately not awaited: the buyer should land on their work order and
       watch the stamps arrive, not stare at this line for half a minute. If the
       call fails, the polling worker settles it as it always did. */
    fetch("/api/settle", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jobId }),
    }).catch(() => { /* the worker is the backstop */ });
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
      const expiredAt = Math.floor(Date.now() / 1000) + ESCROW_DEADLINE_SEC;

      log("1/3 creating the work order (sign in wallet)…");
      const tx1 = await jobs.createJob(cat.providerWallet, cat.evaluatorWallet, expiredAt, description, ethers.ZeroAddress);
      const rc1 = await tx1.wait(1);
      let jobId = null;
      for (const lg of rc1.logs) {
        try { const p = jobs.interface.parseLog(lg); if (p?.name === "JobCreated") { jobId = p.args.jobId.toString(); break; } } catch {}
      }
      if (!jobId) throw new Error("job id not found in receipt");
      log(`   order #${jobId} created ✓`, "ok");

      /* Ask the site to price it now rather than waiting for the worker to
         notice on its next sweep. Without this the order sat unpriced for up to
         two minutes and the page gave up before ever reaching the approve step —
         which is how six buyers with money in their wallets walked away. The
         poll below stays as the backstop for when this call fails. */
      log("2/3 pricing the order…");
      let quoted = false;
      try {
        const q = await (await fetch("/api/quote", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ jobId }),
        })).json();
        quoted = !!q.ok;
      } catch { /* fall through to the poll below */ }

      for (let i = 0; i < 30 && !quoted; i++) {
        await new Promise((r) => setTimeout(r, 4000));
        const j = await api(`/api/job?id=${jobId}`);
        quoted = j.hasBudget;
      }
      if (!quoted) throw new Error(`quote pending — finish later from /job?id=${jobId}; your money has NOT moved`);
      log("   quote posted ✓", "ok");

      const amount = ethers.parseUnits(a.priceUsdc, 6);
      log("3/3 funding escrow (two wallet signatures: approve, then fund)…");
      const allowance = await usdc.allowance(account, cat.contract);
      if (allowance < amount) { const txA = await usdc.approve(cat.contract, amount); await txA.wait(1); }
      const tx2 = await jobs.fund(jobId, "0x");
      await tx2.wait(1);
      log(`   escrow funded ✓ — money is now locked in the contract`, "ok");

      /* Tell the site to run the job now rather than waiting for a worker to
         notice it. Without this a funded order sat untouched until a background
         sweep found it — order #184451 was funded by a real buyer and expired
         undelivered, and we had to refund them by hand. Deliberately not
         awaited: the buyer should land on their work order and watch the stamps
         arrive. If the call fails, the polling worker settles it as before. */
      fetch("/api/settle", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ jobId }),
      }).catch(() => { /* the worker is the backstop */ });

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
  const bc = $("#barcode"); if (bc) { renderBarcode(bc, id); $("#barcode-label").textContent = `ARC·${parseInt(ARC.chainId, 16)}·JOB·${id}`; }
  let lastStatus = -1;

  let catalogCache = null;
  const agentTitle = async (key) => {
    if (!key) return "external job";
    if (!catalogCache) { try { catalogCache = (await api("/api/catalog")).agents; } catch { catalogCache = {}; } }
    return catalogCache[key]?.title || key;
  };

  async function refresh() {
    const j = await api(`/api/job?id=${id}`);
    if (!j.live) { $("#carbon").textContent = `chain read failed: ${j.error} — retrying…`; return; }
    $("#t-agent").textContent = await agentTitle(j.agent);
    $("#t-input").textContent = j.input ? Object.values(j.input)[0] : "—";
    $("#t-price").textContent = j.hasBudget ? `${Number(j.budgetUsdc).toFixed(2)} USDC` : "quote pending";
    $("#t-client").textContent = fmt(j.client);
    $("#t-provider").textContent = fmt(j.provider);

    const zone = $("#stamps");
    const want = [];
    if (j.status >= 1 && j.status !== 5) want.push(STAMPS[1]);
    if (j.status >= 2 && j.status <= 4) want.push(STAMPS[2]);
    if (j.status >= 3 && j.status !== 5 && STAMPS[j.status]) want.push(STAMPS[j.status]);
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
    /* Both of these mean the client already has their money back. Expired is not
       a state the chain reaches on its own — claimRefund is what sets it. */
    if (j.status === 4 || j.status === 5) {
      $("#refund-note").textContent = j.status === 4
        ? "This order was rejected by the judge — the escrow returned to the client automatically."
        : "This order passed its deadline without being delivered, and the client withdrew the escrow. Nothing is owed.";
      $("#refund-note").style.display = "block";
    }

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

    /* Money is locked but the job hasn't settled. The escrow's own deadline is the
       client's guarantee, so show it — and once it passes, give them the button.
       Only Funded and Submitted qualify: Expired means the refund already happened. */
    const refundZone = $("#refund-zone");
    if (refundZone) {
      const locked = [1, 2].includes(j.status);
      const left = (j.expiredAt || 0) - Math.floor(Date.now() / 1000);
      refundZone.style.display = locked ? "block" : "none";
      if (locked) {
        const btn = $("#btn-refund");
        if (left > 0) {
          const h = Math.floor(left / 3600), m = Math.floor((left % 3600) / 60);
          $("#refund-copy").textContent =
            `Your ${j.budgetUsdc} USDC is locked in escrow, not in anyone's wallet. If this order isn't delivered and judged within ${h > 0 ? `${h}h ${m}m` : `${m} minutes`}, you can take it back yourself.`;
          btn.style.display = "none";
        } else {
          $("#refund-copy").textContent =
            `This order passed its deadline without settling. Your ${j.budgetUsdc} USDC is still in escrow and you can withdraw it now — no one else can.`;
          btn.style.display = "inline-flex";
        }
        if (!refundZone.dataset.wired) {
          refundZone.dataset.wired = "1";
          btn.addEventListener("click", async () => {
            const note = $("#carbon");
            try {
              btn.disabled = true;
              const w = await connectWallet((m) => { note.textContent = m; });
              if (w.addr.toLowerCase() !== String(j.client).toLowerCase()) {
                note.textContent = "✗ only the wallet that paid for this order can withdraw it";
                btn.disabled = false; return;
              }
              const signer = await new ethers.BrowserProvider(w.eth).getSigner();
              const cat = await api("/api/catalog");
              const jobs = new ethers.Contract(cat.contract, IFACE_JOBS, signer);
              note.textContent = "withdrawing from escrow…";
              const tx = await jobs.claimRefund(id);
              await tx.wait(1);
              note.textContent = "refunded ✓ — the USDC is back in your wallet";
              refresh();
            } catch (e) {
              note.textContent = `✗ ${e.shortMessage || e.message}`;
              btn.disabled = false;
            }
          });
        }
      }
    }

    lastStatus = j.status;
    if (j.status <= 2) setTimeout(refresh, 10_000);
  }
  refresh().catch((e) => { $("#carbon") && ($("#carbon").textContent = e.message); });
}

/* ————— page: index ————— */
/* Desks group the shelf so seventeen agents read as a directory, not a wall. */
const DESKS = [
  { name: "Chain desk", note: "Reads Arc itself — free public chain data, no guesswork.",
    keys: ["wallet-report", "token-report", "tx-explain", "contract-check", "chain-pulse", "agent-lookup",
           "gas-estimate", "contract-summary", "tokenomics-review", "whitepaper-digest"] },
  { name: "Site desk", note: "Points an agent at a real URL and reports what it measured.",
    keys: ["site-audit", "headers-check", "meta-tags", "landing-critique", "seo-keywords",
           "ia-review", "a11y-checklist", "wireframe", "user-journey", "empty-states",
           "error-messages", "microcopy"] },
  { name: "Writing desk", note: "Words that ship — copy, posts, emails, other languages.",
    keys: ["copy-pack", "thread-writer", "translate", "blog-outline", "newsletter",
           "product-description", "press-release", "ad-copy", "tagline", "faq-writer",
           "case-study", "linkedin-post", "youtube-description", "show-notes", "subject-lines",
           "value-prop", "elevator-pitch", "cold-email", "cold-dm", "outreach-sequence",
           "deck-outline", "tone-rewrite", "simplify", "grammar-fix"] },
  { name: "Engineering desk", note: "The writing around code that nobody wants to do.",
    keys: ["regex-builder", "error-explain", "sql-explain", "test-plan", "code-review-checklist",
           "api-docs", "commit-message", "pr-description", "dockerfile", "ci-config",
           "migration-plan", "refactor-plan", "adr", "bug-report", "tech-spec", "env-audit",
           "gitignore", "readme-writer", "changelog-writer", "runbook"] },
  { name: "Research desk", note: "Turns questions, documents and numbers into something to act on.",
    keys: ["research-brief", "doc-digest", "data-extract", "csv-schema", "chart-suggestion",
           "metric-definitions", "ab-test", "survey-questions", "competitor-matrix", "swot",
           "pricing-review", "unit-economics"] },
  { name: "Operations desk", note: "The paperwork that keeps a team from repeating itself.",
    keys: ["job-description", "interview-questions", "onboarding-checklist", "meeting-agenda",
           "postmortem", "sop", "vendor-comparison", "okrs", "roadmap", "risk-register",
           "retro", "decision-brief", "negotiation-prep"] },
  { name: "Learning desk", note: "For getting something into your head, or someone else's.",
    keys: ["eli5", "glossary", "study-plan", "quiz", "flashcards"] },
  { name: "Founder desk", note: "The unglamorous checks before you commit.",
    keys: ["name-check", "pitch-critic", "user-personas"] },
  { name: "The foreman", note: "Doesn't do the work. Hires the agents who do.",
    keys: ["launch-kit"] },
];

/* The homepage used to print the entire shelf. At a hundred agents that is a
   wall you scroll past to reach anything, so it now shows a handful and sends
   people to /agents, where they can search. */
const FEATURED = ["site-audit", "research-brief", "launch-kit", "landing-critique", "error-explain", "cold-email"];

function agentCard(key, a, cat) {
  return `
    <div class="agent-card">
      <h3>${a.title}</h3>
      ${a.agentId ? `<a class="id-badge" href="${cat.explorer}/token/${cat.identityRegistry}/instance/${a.agentId}" target="_blank" rel="noopener" title="ERC-8004 on-chain identity">◆ verified agent #${a.agentId}</a>` : ""}
      <p>${a.blurb}</p>
      <div class="agent-meta"><span><b>${a.priceUsdc} USDC</b> per job</span><span>${a.eta}</span></div>
      <a class="btn btn-primary" href="/hire?agent=${key}">Hire ${a.title}</a>
    </div>`;
}

async function initIndex() {
  try {
    const cat = await api("/api/catalog");
    const total = Object.keys(cat.agents).length;

    $("#agent-grid").innerHTML = `<div class="desk">
      <div class="desk-head"><h3>A few of them</h3><p>Six of ${total}. You don't have to pick — say what you need and the shelf picks for you.</p></div>
      <div class="desk-grid">${FEATURED.filter((k) => cat.agents[k]).map((k) => agentCard(k, cat.agents[k], cat)).join("")}</div>
      <div class="cta-row" style="margin-top:26px">
        <a class="btn btn-primary" href="/hire">Say what you need</a>
        <a class="btn" href="/agents">Browse all ${total} agents</a>
      </div>
    </div>`;
    $("#contract-link").href = `${cat.explorer}/address/${cat.contract}`;
    $("#contract-link").textContent = fmt(cat.contract) + " (Circle's ERC-8183 escrow)";
  } catch { /* static content still stands */ }

  try {
    const s = await api("/api/stats");
    if (s.live) {
      // Only claim "settled" when the escrow actually told us how the orders ended.
      const orders = typeof s.settled === "number"
        ? `<b>${s.settled}</b> work orders settled`
        : `<b>${s.jobs}</b> work orders on-chain`;
      $("#stats-line").innerHTML =
        `${orders} · <b>${s.hirers}</b> hirers · <b>${s.agents}</b> agents on the shelf ` +
        `<a href="${s.explorer}" target="_blank" rel="noopener">— counted on-chain</a>`;
    }
  } catch { /* numbers are a bonus, not the page */ }
}

/* ————— page: the whole shelf ————— */
async function initAgents() {
  const cat = await api("/api/catalog");
  const all = cat.agents;
  const total = Object.keys(all).length;
  $("#count").textContent =
    `${total} agents, each with an identity on Arc you can check before you pay. One USDC unless it says otherwise.`;

  const listed = new Set(DESKS.flatMap((d) => d.keys));
  const strays = Object.keys(all).filter((k) => !listed.has(k));
  const desks = strays.length ? [...DESKS, { name: "Also on the shelf", note: "", keys: strays }] : DESKS;

  // Searchable haystack per agent, built once.
  const hay = Object.fromEntries(
    Object.entries(all).map(([k, a]) => [k, `${k} ${a.title} ${a.blurb} ${a.input?.label || ""}`.toLowerCase()])
  );

  /* Match every word in the query, tolerating a trailing s. Plain substring
     matching meant "tests" found nothing while Test Plan sat right there, and
     typing the plural is the normal thing to do. */
  const matches = (key, terms) => terms.every((t) => {
    const h = hay[key];
    return h.includes(t) || (t.endsWith("s") && h.includes(t.slice(0, -1)));
  });

  function render(query) {
    const q = query.trim().toLowerCase();
    const terms = q.split(/\s+/).filter(Boolean);
    let shown = 0;
    const html = desks.map((desk) => {
      const keys = desk.keys.filter((k) => all[k] && (!terms.length || matches(k, terms)));
      if (!keys.length) return "";
      shown += keys.length;
      return `<div class="desk">
        <div class="desk-head"><h3>${desk.name} <span class="mono" style="font-size:13px;color:var(--ink-soft)">${keys.length}</span></h3>${desk.note ? `<p>${desk.note}</p>` : ""}</div>
        <div class="desk-grid">${keys.map((k) => agentCard(k, all[k], cat)).join("")}</div>
      </div>`;
    }).join("");

    $("#all").innerHTML = html || `<p class="lede">Nothing matches “${query}”. <a href="/hire">Describe the job instead</a> — the shelf is better at that than search is.</p>`;
    $("#hits").textContent = q ? `${shown} of ${total} match “${query}”` : "";
  }

  render("");
  const box = $("#q");
  let t;
  box.addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => render(box.value), 120); });
}

/* ————————————————————————— crews —————————————————————————
   One sentence in, several agents out. /api/plan picks the crew; this places
   one work order per agent, in sequence, and lets each settle on its own.

   Separate orders rather than one big one is the whole point. ERC-8183 pays out
   in full or refunds in full, so a single order covering five agents could not
   express "four delivered, refund the fifth". Five orders can, and nothing of
   ours ever holds the money to make it happen — a failed step is refunded by
   Circle's contract to the buyer, exactly like a solo job.

   The cost is one confirmation per agent. Worth it: the first agent is already
   working while the buyer approves the third. */
async function initCrew() {
  const cat = await api("/api/catalog");
  let plan = null;          // [{agent,title,blurb,priceUsdc,field,label,input}]
  let account = null, walletEth = null, mode = null, circleCtx = null;

  const note = (m) => { $("#plan-note").textContent = m; };
  const logEl = $("#crew-log");
  const log = (msg, cls) => {
    logEl.innerHTML += (cls ? `<span class="${cls}">` : "") + msg + (cls ? "</span>" : "") + "<br>";
    logEl.scrollTop = logEl.scrollHeight;
  };
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  function total() {
    return plan.reduce((n, s) => n + Number(s.priceUsdc), 0);
  }
  function renderTotal() {
    $("#crew-total").textContent = `${total().toFixed(2)} USDC`;
  }

  function render() {
    $("#crew-list").innerHTML = plan.map((s, i) => `
      <div class="crew-row" data-i="${i}">
        <div class="crew-n">${i + 1}</div>
        <div>
          <div class="crew-name">${esc(s.title)}</div>
          <div class="crew-blurb">${esc(s.blurb || "")}</div>
          <input type="text" maxlength="300" autocomplete="off" data-in="${i}"
                 placeholder="${esc(s.label || "job details")}" value="${esc(s.input || "")}">
          <div class="crew-state s-wait" data-state="${i}">${s.input ? "ready" : "needs a detail"}</div>
        </div>
        <div class="crew-right">${s.priceUsdc} USDC<br><span style="color:var(--ink-soft)">${esc(s.eta || "")}</span>
          <br><button type="button" class="crew-drop" data-drop="${i}" title="Take this agent off the crew">remove</button>
        </div>
      </div>`).join("");

    $("#crew-list").querySelectorAll("input[data-in]").forEach((el) => {
      el.addEventListener("input", () => {
        const i = Number(el.dataset.in);
        plan[i].input = el.value;
        setState(i, el.value.trim() ? "ready" : "needs a detail", "s-wait");
      });
    });
    /* Nothing gets forced into a crew. The planner proposes and the request's own
       words can add to it, so the buyer needs a way to say no before paying. */
    $("#crew-list").querySelectorAll("button[data-drop]").forEach((b) => {
      b.addEventListener("click", () => {
        if (plan.length < 2) return log("✗ a crew needs at least one agent", "bad");
        const dropped = plan.splice(Number(b.dataset.drop), 1)[0];
        render();
        note(`${plan.length} agent${plan.length > 1 ? "s" : ""} · ${total().toFixed(2)} USDC — ${dropped.title} removed.`);
      });
    });
    renderTotal();
    $("#crew-box").style.display = "";
  }

  function setState(i, text, cls) {
    const el = $(`[data-state="${i}"]`);
    if (el) { el.textContent = text; el.className = `crew-state ${cls}`; }
  }

  /* ————— assemble ————— */
  const runPlan = async () => {
    const text = $("#ask").value.trim();
    if (text.length < 4) return note("Say a bit more than that.");
    note("reading the request…");
    $("#btn-plan").disabled = true;
    try {
      const r = await (await fetch("/api/plan", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      })).json();
      if (!r.ok) { note(r.reason); $("#crew-box").style.display = "none"; return; }
      plan = r.steps;
      $("#crew-why").textContent = r.why || `${r.count} agent${r.count > 1 ? "s" : ""} for this one.`;
      note(`${r.count} agent${r.count > 1 ? "s" : ""} · ${r.totalUsdc} USDC — change anything before you pay.`);
      logEl.innerHTML = "";
      render();
    } catch (e) {
      note(e.message);
    } finally {
      $("#btn-plan").disabled = false;
    }
  };
  $("#btn-plan").addEventListener("click", runPlan);
  $("#ask").addEventListener("keydown", (e) => { if (e.key === "Enter") runPlan(); });

  /* ————— wallets: same two doors as a single hire ————— */
  $("#btn-connect").addEventListener("click", async () => {
    try {
      const w = await connectWallet(log);
      account = w.addr; walletEth = w.eth; mode = "extension";
      $("#btn-connect").textContent = fmt(account);
      $("#btn-hire").disabled = false;
      $("#btn-disconnect").style.display = "";
    } catch (e) { log(`✗ ${e.message}`, "bad"); }
  });

  $("#btn-pin").addEventListener("click", async () => {
    try {
      log("opening your PIN wallet…");
      const t = await postApi({ action: "token" });
      if (t.error) throw new Error(t.error);
      const w = await postApi({ action: "wallets", userToken: t.userToken });
      await chainReady();
      const wallet = (w.wallets || []).find((x) => x.blockchain === CIRCLE_CHAIN);
      if (!wallet) throw new Error("no Arc wallet found for this account — create one at /wallet");
      account = wallet.address; mode = "circle";
      circleCtx = { userToken: t.userToken, encryptionKey: t.encryptionKey, walletId: wallet.id, appId: t.appId };
      $("#btn-pin").textContent = `PIN · ${fmt(account)}`;
      $("#btn-hire").disabled = false;
      log(`PIN wallet ready: ${account}`, "ok");
      log(`each agent is its own order — expect ${plan.length} PIN prompt${plan.length > 1 ? "s" : ""}`);
    } catch (e) { log(`✗ ${e.message}`, "bad"); }
  });

  $("#btn-disconnect").addEventListener("click", async () => {
    if (walletEth) await disconnectWallet(walletEth);
    account = null; walletEth = null; mode = null;
    $("#btn-connect").textContent = "Connect wallet";
    $("#btn-hire").disabled = true;
    $("#btn-disconnect").style.display = "none";
  });

  /* ————— place one order ————— */
  const crewId = () => Math.random().toString(36).slice(2, 10);

  async function orderOne(step, i, meta) {
    const a = cat.agents[step.agent];
    const description = JSON.stringify({
      v: 1, agent: step.agent, input: { [a.input.field]: step.input }, crew: meta,
    });
    const expiredAt = Math.floor(Date.now() / 1000) + ESCROW_DEADLINE_SEC;
    const amount = BigInt(Math.round(Number(a.priceUsdc) * 1e6));
    let jobId = null;

    setState(i, "creating the order…", "s-go");

    if (mode === "circle") {
      const before = await postApi({ action: "findjob", client: account });
      let ch = await postApi({ action: "execute", userToken: circleCtx.userToken, walletId: circleCtx.walletId,
        contractAddress: cat.contract, abiFunctionSignature: "createJob(address,address,uint256,string,address)",
        abiParameters: [cat.providerWallet, cat.evaluatorWallet, String(expiredAt), description, "0x0000000000000000000000000000000000000000"] });
      if (ch.error || !ch.challengeId) throw new Error(ch.error || "no challenge returned");
      await runChallenge(circleCtx, ch.challengeId);
      for (let n = 0; n < 30 && !jobId; n++) {
        await new Promise((r) => setTimeout(r, 4000));
        const f = await postApi({ action: "findjob", client: account });
        if (f.jobId && f.jobId !== before.jobId) jobId = f.jobId;
      }
      if (!jobId) throw new Error("order has not landed on-chain yet — nothing has been paid");
    } else {
      const prov = new ethers.BrowserProvider(walletEth);
      const signer = await prov.getSigner();
      const jobs = new ethers.Contract(cat.contract, IFACE_JOBS, signer);
      const tx = await jobs.createJob(cat.providerWallet, cat.evaluatorWallet, expiredAt, description, ethers.ZeroAddress);
      const rc = await tx.wait(1);
      for (const lg of rc.logs) {
        try { const p = jobs.interface.parseLog(lg); if (p?.name === "JobCreated") { jobId = p.args.jobId.toString(); break; } } catch { /* other contracts */ }
      }
      if (!jobId) throw new Error("job id not found in receipt");
    }

    /* Price it from the catalog server-side, same as a solo hire. */
    setState(i, `#${jobId} · pricing…`, "s-go");
    let quoted = false;
    try {
      const q = await (await fetch("/api/quote", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jobId }),
      })).json();
      quoted = !!q.ok;
    } catch { /* fall through to the poll */ }
    for (let n = 0; n < 20 && !quoted; n++) {
      await new Promise((r) => setTimeout(r, 3000));
      quoted = (await api(`/api/job?id=${jobId}`)).hasBudget;
    }
    if (!quoted) throw new Error(`order #${jobId} has no price yet — your money has NOT moved`);

    /* One standing allowance covers the whole crew, so this is asked at most once. */
    const allowance = await readAllowance(cat, account);
    if (allowance < amount) {
      setState(i, "approving USDC (once)…", "s-go");
      if (mode === "circle") {
        const ch = await postApi({ action: "execute", userToken: circleCtx.userToken, walletId: circleCtx.walletId,
          contractAddress: cat.usdc, abiFunctionSignature: "approve(address,uint256)",
          abiParameters: [cat.contract, STANDING_ALLOWANCE] });
        if (ch.error || !ch.challengeId) throw new Error(ch.error || "no challenge returned");
        await runChallenge(circleCtx, ch.challengeId);
      } else {
        const prov = new ethers.BrowserProvider(walletEth);
        const usdc = new ethers.Contract(cat.usdc, IFACE_USDC, await prov.getSigner());
        await (await usdc.approve(cat.contract, STANDING_ALLOWANCE)).wait(1);
      }
      /* The PIN widget resolves when the user approves, not when the approval is
         mined. Reading the allowance again too soon still sees zero, and the
         next agent asks for a second approval nobody needs — so wait for it to
         actually land before moving on. */
      for (let n = 0; n < 15 && (await readAllowance(cat, account)) < amount; n++) {
        await new Promise((r) => setTimeout(r, 2000));
      }
      log("   approved once — the rest of the crew skips this step", "ok");
    }

    setState(i, `#${jobId} · funding escrow…`, "s-go");
    if (mode === "circle") {
      const ch = await postApi({ action: "execute", userToken: circleCtx.userToken, walletId: circleCtx.walletId,
        contractAddress: cat.contract, abiFunctionSignature: "fund(uint256,bytes)", abiParameters: [jobId, "0x"] });
      if (ch.error || !ch.challengeId) throw new Error(ch.error || "no challenge returned");
      await runChallenge(circleCtx, ch.challengeId);
    } else {
      const prov = new ethers.BrowserProvider(walletEth);
      const jobs = new ethers.Contract(cat.contract, IFACE_JOBS, await prov.getSigner());
      await (await jobs.fund(jobId, "0x")).wait(1);
    }

    /* Start it now rather than waiting for a poll. Not awaited: the next agent
       should be getting ordered while this one is already working. */
    fetch("/api/settle", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jobId }),
    }).catch(() => { /* the worker is the backstop */ });

    setState(i, `#${jobId} · working…`, "s-go");
    return jobId;
  }

  /* ————— watch them finish ————— */
  const STAMP = { Completed: ["delivered · paid", "s-ok"], Rejected: ["failed · refunded", "s-bad"],
                  Expired: ["expired · refunded", "s-bad"], Submitted: ["judging…", "s-go"] };
  function watch(i, jobId) {
    let n = 0;
    const tick = async () => {
      if (++n > 60) return;
      try {
        const j = await api(`/api/job?id=${jobId}`);
        const s = STAMP[j.statusText];
        if (s) setState(i, `#${jobId} · ${s[0]}`, s[1]);
        if (["Completed", "Rejected", "Expired"].includes(j.statusText)) {
          const el = $(`[data-state="${i}"]`);
          if (el) el.innerHTML += ` · <a href="/job?id=${jobId}">open</a>`;
          return;
        }
      } catch { /* keep polling */ }
      setTimeout(tick, 5000);
    };
    setTimeout(tick, 4000);
  }

  /* ————— hire the whole crew ————— */
  $("#btn-hire").addEventListener("click", async () => {
    const missing = plan.findIndex((s) => !String(s.input || "").trim());
    if (missing >= 0) {
      setState(missing, "fill this in first", "s-bad");
      return log(`✗ step ${missing + 1} still needs a detail`, "bad");
    }
    $("#btn-hire").disabled = true;
    const meta = { id: crewId(), n: plan.length };
    log(`hiring ${plan.length} agent${plan.length > 1 ? "s" : ""} — one order each, ${total().toFixed(2)} USDC total`);

    let placed = 0;
    for (let i = 0; i < plan.length; i++) {
      try {
        const jobId = await orderOne(plan[i], i, { ...meta, i: i + 1 });
        log(`${i + 1}/${plan.length} ${plan[i].title} → order #${jobId} funded ✓`, "ok");
        watch(i, jobId);
        placed++;
      } catch (e) {
        setState(i, e.message.slice(0, 60), "s-bad");
        log(`${i + 1}/${plan.length} ${plan[i].title} — ${e.message}`, "bad");
        /* One agent failing to be ordered is not a reason to abandon the others:
           the ones already funded are working, and the rest still can. */
      }
    }
    log(placed === plan.length
      ? "whole crew is on it — stamps land above as each one settles"
      : `${placed} of ${plan.length} placed — the rest never took your money`, placed === plan.length ? "ok" : "bad");
    $("#btn-hire").disabled = false;
  });
}

document.addEventListener("DOMContentLoaded", () => {
  const page = document.body.dataset.page;
  if (page === "hire") initHire().catch((e) => { $("#carbon").textContent = e.message; });
  if (page === "job") initJob();
  if (page === "index") initIndex();
  if (page === "agents") initAgents().catch((e) => { $("#count").textContent = e.message; });
  if (page === "crew") initCrew().catch((e) => { $("#plan-note").textContent = e.message; });
});


