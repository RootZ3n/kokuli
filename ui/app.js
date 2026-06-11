// ══════════════════════════════════════════════════════════════════════
// KOKULI · ui/app.js — wires the world engine to the live backend
// ──────────────────────────────────────────────────────────────────────
// The world engine (inline in index.html) owns #app and re-renders it
// wholesale on every interaction. So this orchestrator keeps its own chrome
// — status dot, command bar, journal — OUTSIDE #app (appended to <body>) so
// it survives those re-renders, and uses a MutationObserver to refill the
// engine's placeholder panels with live data from KokuliScenes.
//
// Depends on (load order in index.html): api.js, scenes.js, peh-guide.js.
// ══════════════════════════════════════════════════════════════════════
(function initKokuliApp(global) {
  "use strict";

  const doc = global.document;
  const API = global.KokuliAPI;
  const Scenes = global.KokuliScenes;
  const Peh = global.PehGuide;
  const esc = (Scenes && Scenes.esc) || ((v) => String(v == null ? "" : v));

  // Placeholder panel titles (from WORKSPACE_REGISTRY) → workspace defId.
  // The engine doesn't expose defId in the DOM, so we map by panel title.
  const TITLE_TO_DEF = {
    "Fracture Analysis": "theatre-fractures",
    "Pressure Testing": "depot-pressure",
    "Live Monitoring": "tower-monitoring",
    "Evidence & Records": "tenements-evidence",
    "Fracture Map": "plaza-caseboard",
  };

  // ── Journal — a persisted log of the investigation's actions ──────────
  const JOURNAL_KEY = "kokuli-journal";
  function loadJournal() {
    try { return JSON.parse(global.localStorage.getItem(JOURNAL_KEY) || "[]"); } catch { return []; }
  }
  function saveJournal(list) {
    try { global.localStorage.setItem(JOURNAL_KEY, JSON.stringify(list.slice(-100))); } catch {}
  }
  let journal = loadJournal();
  function logEntry(text, kind) {
    journal.push({ t: new Date().toISOString(), text: String(text), kind: kind || "info" });
    journal = journal.slice(-100);
    saveJournal(journal);
    renderJournal();
  }

  // ── Chrome: status dot + command bar + journal drawer ─────────────────
  let online = null; // tri-state: null=unknown, true, false
  function buildChrome() {
    const style = doc.createElement("style");
    style.textContent = `
      #kk-chrome{position:fixed;left:0;right:0;bottom:0;z-index:9000;display:flex;gap:10px;align-items:center;
        padding:8px 12px;background:rgba(10,14,26,.92);border-top:1px solid rgba(120,140,180,.22);
        backdrop-filter:blur(6px);font:13px/1.4 ui-sans-serif,system-ui,sans-serif;color:#cdd6e6}
      #kk-dot{width:11px;height:11px;border-radius:50%;background:#8aa0c4;flex:none;box-shadow:0 0 0 0 transparent;transition:.3s}
      #kk-dot.on{background:#7bd88f;box-shadow:0 0 10px #7bd88f88}
      #kk-dot.off{background:#ff5470;box-shadow:0 0 10px #ff547088}
      #kk-status{font:600 11px/1 ui-sans-serif;letter-spacing:.06em;text-transform:uppercase;color:#9fb3d4;min-width:64px}
      #kk-cmd{flex:1;background:rgba(8,12,24,.7);border:1px solid rgba(120,140,180,.28);border-radius:8px;
        color:#eef2fb;padding:8px 11px;font:13px ui-monospace,monospace;outline:none}
      #kk-cmd:focus{border-color:var(--peh-accent,#2563eb)}
      #kk-jbtn{background:transparent;border:1px solid rgba(120,140,180,.28);border-radius:8px;color:#cdd6e6;
        padding:8px 11px;cursor:pointer;font:600 12px ui-sans-serif}
      #kk-journal{position:fixed;right:0;bottom:46px;top:60px;width:340px;max-width:88vw;z-index:9001;
        background:rgba(10,14,26,.97);border-left:1px solid rgba(120,140,180,.22);transform:translateX(102%);
        transition:transform .22s ease;display:flex;flex-direction:column}
      #kk-journal.open{transform:translateX(0)}
      #kk-journal h3{margin:0;padding:12px 14px;font:600 12px ui-sans-serif;letter-spacing:.08em;text-transform:uppercase;
        color:var(--peh-accent2,#b45309);border-bottom:1px solid rgba(120,140,180,.18)}
      #kk-jlist{flex:1;overflow:auto;padding:8px 12px}
      .kk-je{padding:7px 9px;margin-bottom:6px;border-radius:7px;background:rgba(18,24,40,.55);
        border-left:3px solid #8aa0c4;font:12px/1.45 ui-sans-serif;color:#cdd6e6}
      .kk-je.peh{border-left-color:var(--peh-accent,#2563eb)} .kk-je.run{border-left-color:#ffd166}
      .kk-je.err{border-left-color:#ff5470} .kk-je time{display:block;color:#6b7a96;font-size:10px;margin-top:2px}`;
    doc.head.appendChild(style);

    const bar = doc.createElement("div");
    bar.id = "kk-chrome";
    bar.innerHTML =
      `<span id="kk-dot" title="Kokuli server status"></span><span id="kk-status">checking…</span>` +
      `<input id="kk-cmd" placeholder="Give Kokuli an order —  help · run <id> · suite <category> · go <area>" autocomplete="off" spellcheck="false">` +
      `<button id="kk-jbtn" type="button">Journal</button>`;
    doc.body.appendChild(bar);

    const drawer = doc.createElement("div");
    drawer.id = "kk-journal";
    drawer.innerHTML = `<h3>Case journal</h3><div id="kk-jlist"></div>`;
    doc.body.appendChild(drawer);

    doc.getElementById("kk-jbtn").addEventListener("click", () => drawer.classList.toggle("open"));
    const cmd = doc.getElementById("kk-cmd");
    cmd.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && cmd.value.trim()) { runCommand(cmd.value.trim()); cmd.value = ""; }
    });
    renderJournal();
  }

  function renderJournal() {
    const list = doc.getElementById("kk-jlist");
    if (!list) return;
    if (!journal.length) { list.innerHTML = `<p style="color:#6b7a96;font-size:12px">No entries yet. Peh's waiting for orders.</p>`; return; }
    list.innerHTML = journal.slice().reverse().map((e) =>
      `<div class="kk-je ${esc(e.kind)}">${esc(e.text)}<time>${esc(formatTime(e.t))}</time></div>`).join("");
  }
  function formatTime(iso) { try { return new Date(iso).toLocaleTimeString(); } catch { return iso; } }

  // ── Status dot heartbeat ──────────────────────────────────────────────
  async function heartbeat() {
    const res = await API.health();
    const nowOnline = !!res.ok;
    const dot = doc.getElementById("kk-dot");
    const label = doc.getElementById("kk-status");
    if (dot) dot.className = nowOnline ? "on" : "off";
    if (label) label.textContent = nowOnline ? "online" : "offline";
    if (online !== nowOnline) {
      online = nowOnline;
      logEntry(Peh.onStatus(nowOnline), "peh");
    }
  }

  // ── Command bar ───────────────────────────────────────────────────────
  async function runCommand(raw) {
    const [verb, ...rest] = raw.split(/\s+/);
    const arg = rest.join(" ").trim();
    const v = verb.toLowerCase();
    logEntry("» " + raw, "info");
    if (v === "help" || v === "?") {
      logEntry("Orders: run <test-id> · suite <category> · go <area> · open <area> · status · clear", "peh");
      return;
    }
    if (v === "clear") { journal = []; saveJournal(journal); renderJournal(); return; }
    if (v === "status") { await heartbeat(); logEntry(Peh.onStatus(online), "peh"); return; }
    if (v === "run" && arg) {
      logEntry(Peh.onRunStart(null), "peh");
      const res = await API.runTest(arg);
      logEntry(Peh.onRunDone(null, res.ok) + (res.ok ? "" : " (" + res.error + ")"), res.ok ? "run" : "err");
      invalidate();
      return;
    }
    if ((v === "suite" || v === "run-suite") && arg) { await runSuite(arg); return; }
    if ((v === "go" || v === "open") && arg) { navigate(v, arg); return; }
    logEntry("Didn't catch that order. Try `help`.", "peh");
  }

  function sceneIdFor(arg) {
    const a = arg.toLowerCase().replace(/[^a-z]/g, "");
    const map = {
      station: "the-station", theatre: "the-theatre", theater: "the-theatre",
      depot: "the-train-depot", train: "the-train-depot", traindepot: "the-train-depot",
      tower: "the-radio-tower", radio: "the-radio-tower", radiotower: "the-radio-tower",
      tenements: "the-tenements", evidence: "the-tenements",
      plaza: "the-central-plaza", central: "the-central-plaza", centralplaza: "the-central-plaza",
    };
    return map[a] || null;
  }
  function navigate(verb, arg) {
    const sceneId = sceneIdFor(arg);
    if (!sceneId) { logEntry("No area by that name. Try station, theatre, depot, tower, tenements, plaza.", "peh"); return; }
    if (typeof global.pehGoScene === "function") global.pehGoScene(sceneId);
    logEntry(Peh.forScene(sceneId), "peh");
  }

  async function runSuite(category) {
    logEntry(Peh.onRunStart(category), "peh");
    const res = await API.runSuite(category);
    logEntry(Peh.onRunDone(category, res.ok) + (res.ok ? "" : " (" + res.error + ")"), res.ok ? "run" : "err");
    invalidate();
  }

  // ── Live panel enhancement ────────────────────────────────────────────
  const cache = new Map(); // defId → { html, at }
  const TTL = 4000;
  function invalidate() { cache.clear(); }

  let observer = null;
  function enhanceAll() {
    if (!observer) return;
    observer.disconnect();
    try {
      enhanceDeck();
      enhancePanels();
    } finally {
      observer.observe(doc.getElementById("app"), { childList: true, subtree: true });
    }
  }

  // Inject a live verdict strip atop the Case Overview deck console.
  function enhanceDeck() {
    const console_ = doc.querySelector(".inv-console:not([data-kk-deck])");
    if (!console_) return;
    console_.setAttribute("data-kk-deck", "1");
    const hero = console_.querySelector(".inv-hero");
    if (!hero) return;
    const strip = doc.createElement("div");
    strip.style.cssText = "margin:10px 0 4px;padding:9px 12px;border-radius:9px;background:rgba(18,24,40,.6);" +
      "border:1px solid rgba(120,140,180,.18);font:12px ui-sans-serif;color:#9fb3d4";
    strip.textContent = "Reading the case file…";
    hero.insertAdjacentElement("afterend", strip);
    API.dashboard().then((res) => {
      if (!res.ok) { strip.innerHTML = `<span style="color:#ff8f5e">No live case yet — run the pressure to open one.</span>`; return; }
      const a = res.data || {}; const m = a.metrics || {};
      strip.innerHTML = `<b style="color:#eef2fb">Active case:</b> ${esc(a.targetName || a.target || "target")} · ` +
        `verdict <b style="color:#eef2fb">${esc(String(a.verdict || "—").toUpperCase())}</b> · ` +
        `${esc((a.findings || []).length)} open fractures · ${esc(m.criticalFindingsCount ?? 0)} critical`;
    });
  }

  function enhancePanels() {
    const panels = doc.querySelectorAll(".peh-panel:not([data-kk-enh]), .peh-tile:not([data-kk-enh])");
    panels.forEach((panel) => {
      const titleEl = panel.querySelector(".peh-panel-title");
      const defId = titleEl ? TITLE_TO_DEF[titleEl.textContent.trim()] : null;
      if (!defId || !Scenes.has(defId)) return;
      const body = panel.querySelector(".peh-panel-body");
      if (!body) return;
      panel.setAttribute("data-kk-enh", "1");
      const hit = cache.get(defId);
      if (hit && Date.now() - hit.at < TTL) { body.innerHTML = hit.html; return; }
      body.innerHTML = Scenes.loading("Pulling the case file…");
      Scenes.render(defId, API).then((html) => {
        if (html == null) return;
        cache.set(defId, { html, at: Date.now() });
        // If a re-render replaced this panel mid-fetch, drop the result —
        // the fresh panel re-enhances itself (and now hits the cache).
        if (body.isConnected) body.innerHTML = html;
      });
    });
  }

  // Delegated handler for the "Run" buttons rendered inside Pressure Testing.
  function bindDelegates() {
    doc.addEventListener("click", (e) => {
      const btn = e.target.closest && e.target.closest("[data-kk-suite]");
      if (!btn) return;
      e.preventDefault();
      runSuite(btn.getAttribute("data-kk-suite"));
    });
  }

  // ── Boot ──────────────────────────────────────────────────────────────
  function boot() {
    if (!API || !Scenes || !Peh) { return; } // dependencies missing — bail quietly
    buildChrome();
    bindDelegates();
    logEntry(Peh.greet(), "peh");
    const appEl = doc.getElementById("app");
    observer = new MutationObserver(() => enhanceAll());
    if (appEl) observer.observe(appEl, { childList: true, subtree: true });
    enhanceAll();
    heartbeat();
    global.setInterval(heartbeat, 10000);
  }

  if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", boot);
  else boot();

  global.KokuliApp = { runCommand, heartbeat, logEntry };
})(typeof window !== "undefined" ? window : globalThis);
