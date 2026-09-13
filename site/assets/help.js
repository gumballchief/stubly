/* Stubly help desk: a chat panel that talks to the support agent on the worker.
   The agent can look an order up on Arc, retry it, or refund it; this file only
   shows what it says and did. Everything it returns is rendered as text, never as
   HTML, and links are only made clickable for our own site, Circle's faucet and
   the Arc explorer. */
(() => {
  "use strict";
  if (window.StublyDesk) return;

  const LOCAL = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  const DESK = ((LOCAL && new URLSearchParams(location.search).get("desk")) || "https://stubly-worker.onrender.com").replace(/\/$/, "");
  const LINK_HOSTS = new Set(["stubly.org", "www.stubly.org", "faucet.circle.com", "testnet.arcscan.app"]);
  const TONES = new Set(["green", "blue", "red", "ink"]);
  const MAX_CHARS = 800;
  const MAX_BYTES = 24_000; // the desk refuses bodies over 64KB; stay well under it
  const KEEP = 30;
  const STORE = "stubly_desk_v1";

  const pageOrder = (() => {
    const id = new URLSearchParams(location.search).get("id") || "";
    return document.body.dataset.page === "job" && /^\d{1,12}$/.test(id) ? id : null;
  })();

  const fresh = () => ({
    id: "d" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36),
    no: String(1000 + Math.floor(Math.random() * 9000)),
    msgs: [],
    open: false,
    watch: null,
  });
  let state = (() => {
    try {
      const s = JSON.parse(sessionStorage.getItem(STORE) || "null");
      if (s && Array.isArray(s.msgs) && typeof s.id === "string") return s;
    } catch { /* private window or blocked storage: start clean */ }
    return fresh();
  })();
  const save = () => {
    state.msgs = state.msgs.slice(-KEEP);
    try { sessionStorage.setItem(STORE, JSON.stringify(state)); } catch { /* not fatal */ }
  };

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  /* ————— styles, in the site's work-order language ————— */
  const style = el("style");
  style.textContent = `
.sd-root { --sd-shadow: 3px 3px 0 var(--ink); }
.sd-root [hidden] { display:none !important; } /* the panel and badge set display, which would beat the hidden attribute */
.sd-sr { position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0 0 0 0); white-space:nowrap; }
.sd-launch {
  position:fixed; right:20px; bottom:max(20px, env(safe-area-inset-bottom)); z-index:60;
  display:flex; align-items:stretch; min-height:52px; padding:0; cursor:pointer;
  background:var(--manila); color:var(--ink); border:2px solid var(--ink); border-radius:4px;
  box-shadow:var(--sd-shadow); touch-action:manipulation; text-align:left;
  transition:transform .15s ease, box-shadow .15s ease;
}
.sd-launch:hover { transform:translate(-1px,-1px); box-shadow:4px 4px 0 var(--ink); }
.sd-launch:active { transform:translate(2px,2px); box-shadow:1px 1px 0 var(--ink); }
.sd-perf {
  width:16px; flex:none; border-right:1.5px dashed var(--dash);
  background-image:radial-gradient(circle 2.5px, var(--desk) 96%, transparent 100%);
  background-size:16px 12px; background-position:0 4px; background-repeat:repeat-y;
}
.sd-launch-label { display:flex; flex-direction:column; justify-content:center; gap:4px; padding:8px 16px 8px 12px; }
.sd-launch-kicker { font:400 9.5px/1 "IBM Plex Mono", ui-monospace, monospace; letter-spacing:.2em; text-transform:uppercase; color:var(--ink-soft); }
.sd-launch-title { font:400 14px/1 "Archivo Black", sans-serif; letter-spacing:.06em; text-transform:uppercase; }
.sd-badge {
  position:absolute; top:-9px; right:-9px; min-width:20px; height:20px; padding:0 5px;
  display:grid; place-items:center; background:var(--stamp-red); color:#fff; border:2px solid var(--ink);
  border-radius:3px; font:600 11px/1 "IBM Plex Mono", monospace;
}

.sd-panel {
  position:fixed; right:20px; bottom:calc(max(20px, env(safe-area-inset-bottom)) + 66px); z-index:60;
  width:min(410px, calc(100vw - 32px)); height:min(640px, calc(100dvh - 120px));
  display:flex; flex-direction:column; overflow:hidden;
  background:var(--paper); color:var(--ink); border:2px solid var(--ink); border-radius:6px;
  box-shadow:5px 5px 0 var(--ink); transform-origin:bottom right; animation:sd-in .18s ease-out;
}
@keyframes sd-in { from { opacity:0; transform:translateY(10px) scale(.98); } to { opacity:1; transform:none; } }

.sd-head { position:relative; background:var(--manila); border-bottom:1.5px dashed var(--dash); padding:10px 10px 14px 18px; }
.sd-head::before, .sd-head::after {
  content:""; position:absolute; bottom:-8px; width:14px; height:14px; border-radius:50%;
  background:var(--desk); border:2px solid var(--ink);
}
.sd-head::before { left:-9px; }
.sd-head::after { right:-9px; }
.sd-head-row { display:flex; align-items:center; justify-content:space-between; gap:10px; }
.sd-kicker { font:400 10.5px/1 "IBM Plex Mono", monospace; letter-spacing:.2em; text-transform:uppercase; color:var(--ink-soft); }
.sd-kicker b { font-weight:600; color:var(--ink); letter-spacing:.08em; }
.sd-close {
  min-width:44px; min-height:44px; padding:0 10px; cursor:pointer; background:transparent; color:var(--ink);
  border:1.5px solid transparent; border-radius:4px; font:600 12px/1 "IBM Plex Mono", monospace; letter-spacing:.08em; text-transform:uppercase;
}
.sd-close:hover { border-color:var(--ink); }
.sd-title { font:400 21px/1.05 "Archivo Black", sans-serif; text-transform:uppercase; letter-spacing:.01em; margin-top:-2px; }
.sd-sub { margin-top:7px; font-size:13.5px; line-height:1.45; color:var(--ink-soft); max-width:36ch; }

.sd-log {
  flex:1; overflow-y:auto; overscroll-behavior:contain; padding:20px 18px 12px;
  display:flex; flex-direction:column; gap:16px; background:var(--paper);
}
.sd-log:focus-visible { outline-offset:-3px; }
.sd-msg { max-width:90%; font-size:14.5px; line-height:1.5; }
.sd-agent { align-self:flex-start; border-left:2px solid var(--ink); padding-left:12px; }
.sd-user { align-self:flex-end; background:var(--desk); border:1.5px solid var(--ink); border-radius:4px; padding:9px 12px; }
.sd-who { display:block; margin-bottom:5px; font:600 10px/1 "IBM Plex Mono", monospace; letter-spacing:.18em; text-transform:uppercase; color:var(--ink-soft); }
.sd-error { border-left-color:var(--stamp-red); }
.sd-error .sd-who { color:var(--stamp-red); }
.sd-text { white-space:pre-wrap; overflow-wrap:anywhere; }
.sd-text a, .sd-step-detail a { color:var(--usdc-deep); }

.sd-steps { margin-top:10px; display:flex; flex-direction:column; }
.sd-step { display:grid; grid-template-columns:auto 1fr; gap:12px; align-items:center; padding:9px 0 8px; border-top:1px dashed var(--dash); }
.sd-stamp {
  justify-self:start; font:400 11px/1 "Archivo Black", sans-serif; letter-spacing:.1em; text-transform:uppercase;
  padding:6px 8px 5px; border:2.5px solid currentColor; border-radius:4px; white-space:nowrap;
  transform:rotate(-3deg); opacity:.9; mix-blend-mode:multiply; user-select:none;
}
.sd-step:nth-child(even) .sd-stamp { transform:rotate(2deg); }
.sd-green { color:var(--stamp-green); } .sd-blue { color:var(--stamp-blue); } .sd-red { color:var(--stamp-red); } .sd-ink { color:var(--ink); }
@keyframes sd-thunk { 0% { transform:scale(1.5) rotate(-3deg); opacity:0; } 60% { transform:scale(.95) rotate(-3deg); opacity:.95; } 100% { transform:rotate(-3deg); opacity:.9; } }
.sd-fresh { animation:sd-thunk .28s ease-out; }
.sd-step-detail { font:12px/1.45 "IBM Plex Mono", monospace; color:var(--ink-soft); overflow-wrap:anywhere; }

.sd-chips { display:flex; flex-wrap:wrap; gap:8px; }
.sd-chip {
  min-height:44px; padding:8px 12px; cursor:pointer; text-align:left;
  background:var(--paper); color:var(--ink); border:1.5px solid var(--ink); border-radius:4px;
  font:600 13.5px/1.25 "Public Sans", sans-serif; touch-action:manipulation;
  transition:transform .15s ease, box-shadow .15s ease;
}
.sd-chip:hover { transform:translate(-1px,-1px); box-shadow:var(--sd-shadow); }
.sd-chip:active { transform:none; box-shadow:none; }
.sd-msg .sd-chip { margin-top:10px; }

.sd-working { padding:0 18px 10px; font:12px/1.4 "IBM Plex Mono", monospace; color:var(--ink-soft); background:var(--paper); }
.sd-working::after { content:""; display:inline-block; width:7px; height:12px; margin-left:6px; vertical-align:-1px; background:var(--ink-soft); animation:sd-blink 1s steps(1) infinite; }
@keyframes sd-blink { 50% { opacity:0; } }

.sd-form { display:grid; grid-template-columns:1fr auto; gap:8px; align-items:end; padding:12px 12px 8px; background:var(--manila); border-top:2px solid var(--ink); }
.sd-input {
  width:100%; min-height:46px; max-height:132px; resize:none; padding:12px 12px 11px;
  font:16px/1.35 "Public Sans", sans-serif; color:var(--ink); background:var(--paper);
  border:1.5px solid var(--ink); border-radius:4px;
}
.sd-input::placeholder { color:#6b7688; }
.sd-input:focus { outline:3px solid rgba(39,117,202,.35); outline-offset:0; }
.sd-send {
  min-height:46px; padding:0 18px; cursor:pointer; background:var(--usdc); color:#fff;
  border:2px solid var(--usdc-deep); border-radius:4px; font:700 14.5px/1 "Public Sans", sans-serif;
  touch-action:manipulation; transition:transform .15s ease, box-shadow .15s ease;
}
.sd-send:hover { transform:translate(-1px,-1px); box-shadow:3px 3px 0 var(--usdc-deep); }
.sd-send:active { transform:none; box-shadow:none; }
.sd-send[disabled] { opacity:.45; cursor:not-allowed; transform:none; box-shadow:none; }
.sd-meta { grid-column:1 / -1; display:flex; justify-content:space-between; align-items:center; gap:10px; font:11px/1.3 "IBM Plex Mono", monospace; color:var(--ink-soft); }
.sd-meta-right { display:flex; align-items:center; gap:10px; }
.sd-over { color:var(--stamp-red); }
.sd-restart { min-height:32px; padding:0 2px; cursor:pointer; background:none; border:0; color:var(--ink-soft); font:inherit; text-decoration:underline; text-underline-offset:3px; }
.sd-restart:hover { color:var(--ink); }

@media (max-width:560px) {
  .sd-panel { left:0; right:0; bottom:0; width:100%; height:min(88dvh, 100dvh); border-width:2px 0 0; border-radius:8px 8px 0 0; box-shadow:0 -8px 24px -12px rgba(22,35,59,.45); transform-origin:bottom center; }
  .sd-head::before, .sd-head::after { display:none; }
  .sd-form { padding-bottom:max(8px, env(safe-area-inset-bottom)); }
  .sd-root.sd-is-open .sd-launch { display:none; }
  .sd-launch { right:12px; bottom:max(12px, env(safe-area-inset-bottom)); }
}
@media (max-height:560px) { .sd-sub { display:none; } }
@media (prefers-reduced-motion: reduce) { .sd-panel, .sd-fresh, .sd-working::after { animation:none; } .sd-launch, .sd-chip, .sd-send { transition:none; } }
@media print { .sd-root { display:none; } }
`;
  document.head.append(style);

  /* ————— links: only to places we point people at ————— */
  const safeUrl = (raw) => {
    try {
      const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
      return u.protocol === "https:" && LINK_HOSTS.has(u.hostname.toLowerCase()) ? u : null;
    } catch { return null; }
  };
  const isOurs = (u) => /(^|\.)stubly\.org$/i.test(u.hostname);
  const URL_RE = /\bsupport@stubly\.org\b|\bhttps?:\/\/[^\s<>"']+|\b(?:www\.)?(?:stubly\.org|faucet\.circle\.com|testnet\.arcscan\.app)(?:\/[^\s<>"']*)?/gi;

  function richText(node, text) {
    let last = 0;
    for (const m of text.matchAll(URL_RE)) {
      if (m.index < last) continue;
      const raw = m[0].replace(/[.,;:!?)\]]+$/, "");
      node.append(text.slice(last, m.index));
      last = m.index + raw.length;
      if (raw.toLowerCase() === "support@stubly.org") {
        const a = el("a", null, raw);
        a.href = "mailto:support@stubly.org" + (pageOrder ? `?subject=${encodeURIComponent(`Order #${pageOrder}`)}` : "");
        node.append(a);
        continue;
      }
      const u = text[m.index - 1] === "@" ? null : safeUrl(raw);
      if (!u) { node.append(raw); continue; }
      const a = el("a", null, raw);
      a.href = u.href;
      if (!isOurs(u)) { a.target = "_blank"; a.rel = "noopener noreferrer"; }
      node.append(a);
    }
    node.append(text.slice(last));
  }

  // Everything that becomes a stamp goes through here, whether it came from the desk just now or from storage.
  const cleanSteps = (steps) => (Array.isArray(steps) ? steps : [])
    .filter((s) => s && typeof s.title === "string" && s.title.trim())
    .slice(0, 6)
    .map((s) => ({
      title: s.title.trim().slice(0, 22),
      detail: typeof s.detail === "string" ? s.detail.slice(0, 240) : "",
      tone: TONES.has(s.tone) ? s.tone : "ink",
      link: typeof s.link === "string" ? s.link.slice(0, 300) : null,
      linkText: typeof s.linkText === "string" ? s.linkText.slice(0, 32) : null,
    }));

  /* ————— the panel ————— */
  const root = el("div", "sd-root");

  const launch = el("button", "sd-launch");
  launch.type = "button";
  launch.setAttribute("aria-controls", "sd-panel");
  launch.setAttribute("aria-expanded", "false");
  const perf = el("span", "sd-perf");
  perf.setAttribute("aria-hidden", "true");
  const launchLabel = el("span", "sd-launch-label");
  launchLabel.append(el("span", "sd-launch-kicker", pageOrder ? `Order #${pageOrder}` : "Order trouble?"), el("span", "sd-launch-title", "Help desk"));
  const badge = el("span", "sd-badge");
  badge.hidden = true;
  badge.setAttribute("aria-hidden", "true");
  const unreadNote = el("span", "sd-sr"); // the button's name is its visible text; unread replies are added here
  launch.append(perf, launchLabel, badge, unreadNote);

  const panel = el("section", "sd-panel");
  panel.id = "sd-panel";
  panel.hidden = true;
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "false");
  panel.setAttribute("aria-labelledby", "sd-title");

  const head = el("header", "sd-head");
  const headRow = el("div", "sd-head-row");
  const kicker = el("span", "sd-kicker", "Service desk · ");
  kicker.append(el("b", null, `No. ${state.no}`));
  const closeBtn = el("button", "sd-close", "Close");
  closeBtn.type = "button";
  closeBtn.setAttribute("aria-label", "Close help desk");
  headRow.append(kicker, closeBtn);
  const title = el("h2", "sd-title", "Help desk");
  title.id = "sd-title";
  head.append(headRow, title, el("p", "sd-sub", "Checks your order on Arc, retries what failed, and refunds the wallet that paid when an order can't be finished."));

  const log = el("div", "sd-log");
  log.setAttribute("role", "log");
  log.setAttribute("aria-label", "Conversation");
  log.tabIndex = 0;

  const working = el("div", "sd-working");
  working.hidden = true;
  working.setAttribute("aria-hidden", "true");
  const statusLine = el("span", "sd-sr");
  statusLine.setAttribute("role", "status");

  const form = el("form", "sd-form");
  const label = el("label", "sd-sr", "Message the help desk");
  label.htmlFor = "sd-input";
  const input = el("textarea", "sd-input");
  input.id = "sd-input";
  input.rows = 1;
  input.maxLength = MAX_CHARS;
  input.autocomplete = "off";
  input.enterKeyHint = "send";
  input.placeholder = pageOrder ? "What went wrong?" : "Type your question";
  const sendBtn = el("button", "sd-send", "Send");
  sendBtn.type = "submit";
  const meta = el("div", "sd-meta");
  const metaRight = el("span", "sd-meta-right");
  const count = el("span");
  const restart = el("button", "sd-restart", "Start over");
  restart.type = "button";
  metaRight.append(count, restart);
  meta.append(el("span", null, "Never share your PIN or seed phrase."), metaRight);
  form.append(label, input, sendBtn, meta);

  panel.append(head, log, working, statusLine, form);
  root.append(panel, launch);
  document.body.append(root);

  /* ————— rendering ————— */
  const greeting = () => pageOrder
    ? `Hi. You're on order #${pageOrder}. Tell me what went wrong and I'll check it on Arc, retry it if the agent failed, or send the USDC back to the wallet that paid if it can't be finished.`
    : "Hi. Tell me what went wrong and give me your order number. I'll check it on Arc, retry it if the agent failed, or send the USDC back to the wallet that paid if it can't be finished. Questions about how Stubly works are fine too.";

  function renderStep(s, animate) {
    const row = el("div", "sd-step");
    row.append(el("span", `sd-stamp sd-${s.tone}${animate ? " sd-fresh" : ""}`, s.title));
    const d = el("div", "sd-step-detail");
    if (s.detail) richText(d, s.detail);
    const u = s.link ? safeUrl(s.link) : null;
    if (u) {
      if (s.detail) d.append(" · ");
      const a = el("a", null, s.linkText || (isOurs(u) ? "open order" : "view on Arc"));
      a.href = u.href;
      if (!isOurs(u)) { a.target = "_blank"; a.rel = "noopener noreferrer"; }
      d.append(a);
    }
    row.append(d);
    return row;
  }

  function renderMsg(m, animate) {
    const user = m.role === "user";
    const wrap = el("div", `sd-msg ${user ? "sd-user" : "sd-agent"}${m.kind === "error" ? " sd-error" : ""}`);
    if (!user) wrap.append(el("span", "sd-who", m.kind === "error" ? "Not delivered" : "Help desk"));
    else wrap.append(el("span", "sd-sr", "You: "));
    const body = el("div", "sd-text");
    richText(body, String(m.text || ""));
    wrap.append(body);
    const steps = cleanSteps(m.steps);
    if (steps.length) {
      const list = el("div", "sd-steps");
      steps.forEach((s) => list.append(renderStep(s, animate)));
      wrap.append(list);
    }
    if (m.retry) {
      const b = el("button", "sd-chip", "Try again");
      b.type = "button";
      b.addEventListener("click", () => {
        if (busy) return;
        state.msgs = state.msgs.filter((x) => x !== m);
        save();
        wrap.remove();
        input.focus(); // the button that had focus is gone
        request();
      });
      wrap.append(b);
    }
    return wrap;
  }

  function starters() {
    const box = el("div", "sd-chips");
    const asks = [
      ...(pageOrder ? [`Check order #${pageOrder}`] : []),
      "My order is stuck",
      "I paid but got nothing",
      "How do I get test USDC?",
      "How does the escrow work?",
    ].slice(0, 4);
    for (const q of asks) {
      const b = el("button", "sd-chip", q);
      b.type = "button";
      b.addEventListener("click", () => {
        if (busy) return;
        send(q);
        input.focus(); // the chips are removed once a message is sent
      });
      box.append(b);
    }
    return box;
  }

  const scrollDown = () => { log.scrollTop = log.scrollHeight; };

  function renderAll() {
    log.setAttribute("aria-live", "off"); // don't read the whole history aloud on open
    log.replaceChildren(renderMsg({ role: "agent", text: greeting() }, false));
    if (!state.msgs.some((m) => m.role === "user")) log.append(starters());
    state.msgs.forEach((m) => log.append(renderMsg(m, false)));
    scrollDown();
    setTimeout(() => log.setAttribute("aria-live", "polite"), 60);
  }

  function append(m, animate) {
    log.querySelector(".sd-chips")?.remove();
    log.append(renderMsg(m, animate));
    scrollDown();
  }

  let unread = 0;
  function bump() {
    if (!panel.hidden) return;
    unread += 1;
    badge.textContent = unread > 9 ? "9+" : String(unread);
    badge.hidden = false;
    unreadNote.textContent = `, ${unread} new ${unread === 1 ? "reply" : "replies"}`;
  }

  function setOpen(open, focus = true) {
    state.open = open;
    save();
    panel.hidden = !open;
    root.classList.toggle("sd-is-open", open);
    launch.setAttribute("aria-expanded", String(open));
    if (open) {
      unread = 0;
      badge.hidden = true;
      unreadNote.textContent = "";
      renderAll();
      if (focus) setTimeout(() => input.focus(), 30);
    } else if (focus) {
      launch.focus();
    }
  }

  /* ————— talking to the agent ————— */
  let busy = false;
  let coolUntil = 0;
  let clock = null;

  const syncSend = () => { sendBtn.disabled = busy || Date.now() < coolUntil || !input.value.trim(); };

  function setWorking(on) {
    busy = on;
    clearInterval(clock);
    working.hidden = !on;
    statusLine.textContent = on ? "The help desk is working on it" : "";
    syncSend();
    if (!on) return;
    const t0 = Date.now();
    const paint = () => {
      const s = Math.floor((Date.now() - t0) / 1000);
      const mmss = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
      working.textContent = `${s < 30 ? "Working on it" : "Still working. Retries and refunds wait for Arc to confirm"} · ${mmss}`;
      if (s % 3 === 0) scrollDown();
    };
    paint();
    clock = setInterval(paint, 1000);
  }

  function send(text) {
    const m = { role: "user", text: text.slice(0, MAX_CHARS) };
    state.msgs.push(m);
    save();
    append(m, false);
    request();
  }

  /* The desk only trusts its own earlier replies, which it signs. Anything else in the history
     is dropped on arrival, so the payload keeps the signature and trims oldest-first to a size
     the desk will always accept. */
  function payload() {
    const enc = new TextEncoder();
    let messages = state.msgs
      .filter((m) => !m.local)
      .slice(-12)
      .map((m) => (m.role === "user"
        ? { role: "user", text: String(m.text || "").slice(0, MAX_CHARS) }
        : { role: "agent", text: String(m.text || ""), sig: typeof m.sig === "string" ? m.sig : "" }));
    const build = () => JSON.stringify({ conversation: state.id, context: { page: location.pathname.slice(0, 60), orderId: pageOrder }, messages });
    while (messages.length > 1 && enc.encode(build()).length > MAX_BYTES) messages = messages.slice(1);
    return build();
  }

  async function request() {
    setWorking(true);
    let reply;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 180_000);
    try {
      const r = await fetch(`${DESK}/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: payload(),
        signal: ctl.signal,
      });
      let j = null;
      try { j = await r.json(); } catch { /* handled below */ }
      const said = j && typeof j.reply === "string" && j.reply.trim() ? j.reply.slice(0, 1500) : null;
      if (r.status === 429) {
        const wait = Math.min(Math.max(Math.round(Number(j && j.retryAfter) || 60), 5), 3600);
        coolUntil = Date.now() + wait * 1000;
        setTimeout(syncSend, wait * 1000 + 50);
        reply = { role: "agent", local: true, text: said || `That's a lot of messages in a short time. You can send again in ${wait} seconds.` };
      } else if (!r.ok || !said) {
        reply = { role: "agent", local: true, kind: "error", retry: true, text: said || "The help desk didn't answer. Try again, or email support@stubly.org with your order number." };
      } else {
        reply = { role: "agent", text: said, sig: typeof j.sig === "string" ? j.sig.slice(0, 128) : "", steps: cleanSteps(j.steps) };
        const w = j.watch;
        if (w && /^\d{1,12}$/.test(String(w.orderId || ""))) startWatch(String(w.orderId), typeof w.status === "string" ? w.status : null, w.since);
      }
    } catch {
      reply = { role: "agent", local: true, kind: "error", retry: true, text: "Couldn't reach the help desk. Check your connection and try again, or email support@stubly.org with your order number." };
    } finally {
      clearTimeout(timer);
    }
    setWorking(false);
    state.msgs.push(reply);
    save();
    append(reply, true);
    bump();
  }

  /* ————— after an answer: follow the order until it settles ————— */
  let watchTimer = null;
  let watchGen = 0; // bumping it retires any poll already in flight

  function startWatch(orderId, status, since) {
    state.watch = { orderId, status, since: Number(since) || 0, until: Date.now() + 20 * 60_000 };
    save();
    const gen = ++watchGen;
    clearTimeout(watchTimer);
    watchTimer = setTimeout(() => pollWatch(gen), 8_000);
  }

  function watchNote(id, st) {
    const page = `https://stubly.org/job?id=${id}`;
    const notes = {
      Submitted: [`Order #${id}: the agent delivered. The judge is checking the work now.`, "Delivered", "blue", "Waiting on the judge"],
      Completed: [`Order #${id} is finished and your report is ready.`, "Completed", "green", "Report ready", "read the report"],
      Rejected: [`Order #${id} was closed, and Circle's escrow returned the USDC to the wallet that paid.`, "Refunded", "green", "Returned by the escrow"],
      Expired: [`Order #${id} passed its deadline, and the USDC went back to the wallet that paid.`, "Expired", "ink", "USDC returned"],
    }[st];
    if (!notes) return null;
    const [text, t, tone, detail, linkText] = notes;
    return { role: "agent", local: true, text, steps: [{ title: t, tone, detail, link: page, linkText: linkText || "open order" }] };
  }

  function push(m) {
    state.msgs.push(m);
    append(m, true);
    bump();
  }

  // Polls the help desk, not the site: it knows what the desk did in the background (a rebuilt report, a refund).
  async function pollWatch(gen) {
    const w = state.watch;
    if (gen !== watchGen || !w) return;
    if (Date.now() > w.until) { state.watch = null; save(); return; }
    let next = 10_000;
    try {
      const r = await fetch(`${DESK}/status?order=${encodeURIComponent(w.orderId)}&since=${w.since}`, { cache: "no-store" });
      if (r.status === 429 || r.status === 503) next = 30_000;
      const j = r.ok ? await r.json() : null;
      if (gen !== watchGen) return;
      if (j && state.watch === w) {
        const events = (Array.isArray(j.events) ? j.events : []).filter((e) => e && Number(e.at) > w.since).slice(0, 6);
        for (const e of events) {
          w.since = Math.max(w.since, Number(e.at));
          const [step] = cleanSteps([e]);
          const text = typeof e.text === "string" && e.text.trim() ? e.text.slice(0, 600) : `Order #${w.orderId}: ${step ? step.title.toLowerCase() : "updated"}.`;
          push({ role: "agent", local: true, text, steps: step ? [step] : [] });
        }
        if (typeof j.status === "string" && j.status !== w.status) {
          const prev = w.status;
          w.status = j.status;
          const note = prev && !events.length ? watchNote(w.orderId, j.status) : null;
          if (note) push(note);
        }
        if (j.settled) state.watch = null;
        save();
        if (!state.watch) return;
      }
    } catch { /* try again on the next tick */ }
    if (gen === watchGen) watchTimer = setTimeout(() => pollWatch(gen), next);
  }

  /* ————— wiring ————— */
  launch.addEventListener("click", () => setOpen(panel.hidden));
  closeBtn.addEventListener("click", () => setOpen(false));
  panel.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.stopPropagation(); setOpen(false); }
  });

  const autosize = () => {
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight + 3, 132)}px`;
  };
  input.addEventListener("input", () => {
    autosize();
    const n = input.value.length;
    count.textContent = n > MAX_CHARS - 150 ? `${n}/${MAX_CHARS}` : "";
    count.className = n >= MAX_CHARS ? "sd-over" : "";
    syncSend();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      if (!sendBtn.disabled) sendBtn.click();
    }
  });
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text || busy || Date.now() < coolUntil) return;
    input.value = "";
    count.textContent = "";
    autosize();
    send(text);
    syncSend();
  });
  restart.addEventListener("click", () => {
    if (busy) return;
    watchGen++;
    clearTimeout(watchTimer);
    state = { ...fresh(), open: true };
    kicker.lastChild.textContent = `No. ${state.no}`;
    save();
    renderAll();
    input.focus();
  });

  // Anything on the page marked data-desk-open opens the panel (the order page uses this).
  document.addEventListener("click", (e) => {
    const t = e.target instanceof Element ? e.target.closest("[data-desk-open]") : null;
    if (!t) return;
    e.preventDefault();
    setOpen(true);
  });

  syncSend();
  if (state.open) setOpen(true, false);
  if (state.watch) pollWatch(watchGen);

  window.StublyDesk = { open: () => setOpen(true) };
})();
