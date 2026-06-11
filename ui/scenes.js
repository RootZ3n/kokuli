// ══════════════════════════════════════════════════════════════════════
// KOKULI · ui/scenes.js — per-scene data actions
// ──────────────────────────────────────────────────────────────────────
// Each investigation location (a SCENE_REGISTRY entry → a workspace panel)
// has ONE data action here. An action fetches live evidence from KokuliAPI
// and returns an HTML string for the panel body. Actions never throw: the
// API client returns {ok,data,error}, so every action renders a loading,
// empty, or error state inline.
//
// Mapping (workspace defId → location → backend):
//   theatre-fractures   The Theatre        /api/dashboard  (open findings)
//   depot-pressure      The Train Depot     /api/tests       (suite + run)
//   tower-monitoring    The Radio Tower     /api/ops/status + /api/meta/logs
//   tenements-evidence  The Tenements       /api/reports/latest + /api/transparency
//   plaza-caseboard     The Central Plaza   /api/dashboard  (the full picture)
// The deck (station-overview) is rendered by the world engine; app.js
// injects a live verdict strip into it separately.
// ══════════════════════════════════════════════════════════════════════
(function initKokuliScenes(global) {
  "use strict";

  const esc = (v) =>
    String(v == null ? "" : v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

  // ── Shared noir presentation helpers ─────────────────────────────────
  const S = {
    wrap: "padding:14px 16px;color:#cdd6e6;font:13px/1.5 ui-sans-serif,system-ui,sans-serif",
    h: "margin:0 0 10px;font:600 12px/1.3 ui-sans-serif;letter-spacing:.08em;text-transform:uppercase;color:var(--peh-accent2,#b45309)",
    row: "display:flex;gap:8px;align-items:center;padding:8px 10px;border:1px solid rgba(120,140,180,.18);border-radius:8px;margin-bottom:7px;background:rgba(18,24,40,.5)",
    pill: "font:600 10px/1 ui-sans-serif;letter-spacing:.05em;text-transform:uppercase;padding:4px 7px;border-radius:999px;white-space:nowrap",
    muted: "color:#7a88a0",
    btn: "font:600 12px/1 ui-sans-serif;padding:7px 11px;border-radius:7px;border:1px solid var(--peh-accent,#2563eb);background:transparent;color:#dbe4f5;cursor:pointer",
    metric: "flex:1;min-width:90px;text-align:center;padding:10px 8px;border:1px solid rgba(120,140,180,.18);border-radius:9px;background:rgba(18,24,40,.5)",
    big: "display:block;font:700 22px/1 ui-sans-serif;color:#eef2fb",
  };

  function sevColor(sev) {
    switch (String(sev || "").toLowerCase()) {
      case "critical": return "#ff5470";
      case "high": return "#ff8f5e";
      case "medium": case "moderate": return "#ffd166";
      case "low": return "#7bd88f";
      default: return "#8aa0c4";
    }
  }
  function verdictColor(v) {
    switch (String(v || "").toLowerCase()) {
      case "critical": case "fail": return "#ff5470";
      case "concern": case "not_comparable": return "#ffd166";
      case "pass": return "#7bd88f";
      default: return "#8aa0c4";
    }
  }
  const pill = (text, color) =>
    `<span style="${S.pill};color:${color};border:1px solid ${color}55;background:${color}1a">${esc(text)}</span>`;

  const loading = (label) =>
    `<div style="${S.wrap}"><p style="${S.muted}">⏳ ${esc(label || "Pulling the case file…")}</p></div>`;
  const errorState = (msg) =>
    `<div style="${S.wrap}"><p style="color:#ff8f5e">⚠ ${esc(msg || "The trail went cold.")}</p>
     <p style="${S.muted};font-size:12px">No live evidence right now — the Kokuli server may be offline or this target hasn't been run yet.</p></div>`;
  const empty = (msg) =>
    `<div style="${S.wrap}"><p style="${S.muted}">${esc(msg)}</p></div>`;

  function metricCard(label, value, color) {
    return `<div style="${S.metric}"><span style="${S.big};color:${color || "#eef2fb"}">${esc(value)}</span>
      <span style="font:500 10px/1.3 ui-sans-serif;letter-spacing:.06em;text-transform:uppercase;${S.muted}">${esc(label)}</span></div>`;
  }

  // Findings list — shared by The Theatre and The Central Plaza.
  function findingsList(findings, limit) {
    const list = Array.isArray(findings) ? findings.slice(0, limit || 12) : [];
    if (!list.length) return empty("No open fractures. Either the target held — or nobody's run the pressure yet.");
    return list.map((f) => {
      const title = f.title || f.name || f.id || "Unnamed fracture";
      const sev = f.severity || "unknown";
      const cat = f.category || "general";
      return `<div style="${S.row}">
        <span style="width:8px;height:8px;border-radius:50%;background:${sevColor(sev)};flex:none"></span>
        <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#dbe4f5" title="${esc(title)}">${esc(title)}</span>
        ${pill(cat, "#8aa0c4")}
        ${pill(sev, sevColor(sev))}
      </div>`;
    }).join("");
  }

  // ── The Theatre — fracture analysis (open findings under the lights) ──
  async function fractures(api) {
    const res = await api.dashboard();
    if (!res.ok) return errorState(res.error);
    const a = res.data || {};
    const findings = a.findings || [];
    const m = a.metrics || {};
    return `<div style="${S.wrap}">
      <h4 style="${S.h}">Fracture analysis · ${esc(a.targetName || a.target || "target")}</h4>
      <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap">
        ${metricCard("Verdict", String(a.verdict || "—").toUpperCase(), verdictColor(a.verdict))}
        ${metricCard("Open", findings.length, "#eef2fb")}
        ${metricCard("Critical", m.criticalFindingsCount ?? 0, "#ff5470")}
      </div>
      ${findingsList(findings, 12)}
    </div>`;
  }

  // ── The Central Plaza — the fracture map (the full picture) ───────────
  async function caseboard(api) {
    const res = await api.dashboard();
    if (!res.ok) return errorState(res.error);
    const a = res.data || {};
    const findings = a.findings || [];
    const m = a.metrics || {};
    // Group by category — the red string between threads.
    const byCat = {};
    findings.forEach((f) => { const c = f.category || "general"; byCat[c] = (byCat[c] || 0) + 1; });
    const threads = Object.keys(byCat).sort((x, y) => byCat[y] - byCat[x]);
    const threadRows = threads.length
      ? threads.map((c) => `<div style="${S.row}">
          <span style="flex:1;color:#dbe4f5;text-transform:capitalize">${esc(c)}</span>${pill(byCat[c] + " thread" + (byCat[c] === 1 ? "" : "s"), "#8aa0c4")}</div>`).join("")
      : empty("No threads to connect yet.");
    return `<div style="${S.wrap}">
      <h4 style="${S.h}">The full picture · red string and all</h4>
      <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap">
        ${metricCard("Verdict", String(a.verdict || "—").toUpperCase(), verdictColor(a.verdict))}
        ${metricCard("Findings", findings.length, "#eef2fb")}
        ${metricCard("Public exposure", m.publicExposureCount ?? 0, "#ff8f5e")}
      </div>
      ${threadRows}
      <p style="${S.muted};margin-top:10px;font-style:italic">"See the pattern? Every thread meets at the fountain."</p>
    </div>`;
  }

  // ── The Train Depot — pressure testing (suite + per-test run) ─────────
  async function pressure(api) {
    const res = await api.tests();
    if (!res.ok) return errorState(res.error);
    const tests = (res.data && res.data.tests) || [];
    const byCat = {};
    tests.forEach((t) => { const c = t.category || "other"; (byCat[c] = byCat[c] || []).push(t); });
    const cats = Object.keys(byCat).sort();
    const catRows = cats.length
      ? cats.map((c) => `<div style="${S.row}">
          <span style="flex:1;color:#dbe4f5;text-transform:capitalize">${esc(c)}</span>
          ${pill(byCat[c].length + " tests", "#8aa0c4")}
          <button data-kk-suite="${esc(c)}" style="${S.btn}">Run</button></div>`).join("")
      : empty("No tests on the rails yet.");
    return `<div style="${S.wrap}">
      <h4 style="${S.h}">Pressure testing · ${tests.length} tests on the rails</h4>
      ${catRows}
      <div style="margin-top:12px"><button data-kk-suite="all" style="${S.btn};border-color:var(--peh-accent2,#b45309)">Run the full suite — no mercy</button></div>
      <p style="${S.muted};margin-top:10px;font-size:12px">Runs execute on the server against the active target. Results land in Evidence &amp; the Fracture Map.</p>
    </div>`;
  }

  // ── The Radio Tower — live monitoring (ops status + server logs) ──────
  async function monitoring(api) {
    const [ops, logs] = await Promise.all([api.opsStatus(), api.logs(20)]);
    const opsData = ops.ok ? ops.data || {} : null;
    const statusLine = opsData
      ? `${pill(opsData.state || opsData.status || "idle", verdictColor(opsData.state === "running" ? "concern" : "pass"))}`
      : pill("unknown", "#8aa0c4");
    const entries = logs.ok && logs.data && Array.isArray(logs.data.entries) ? logs.data.entries.slice(-18) : [];
    const fmtLog = (e) => {
      if (typeof e === "string") return e;
      const lvl = e.level ? "[" + e.level + "] " : "";
      const comp = e.component ? e.component + ": " : "";
      return lvl + comp + (e.message != null ? e.message : JSON.stringify(e));
    };
    const logBox = entries.length
      ? `<pre style="margin:0;max-height:220px;overflow:auto;padding:10px;border-radius:8px;background:rgba(8,12,24,.7);border:1px solid rgba(120,140,180,.18);color:#9fb3d4;font:11px/1.5 ui-monospace,monospace;white-space:pre-wrap">${entries.map((e) => esc(fmtLog(e))).join("\n")}</pre>`
      : empty("Airwaves quiet — no recent signals.");
    return `<div style="${S.wrap}">
      <h4 style="${S.h}">Live monitoring · ears on the airwaves</h4>
      <div style="${S.row}"><span style="flex:1;color:#dbe4f5">Armory ops</span>${statusLine}</div>
      <p style="${S.muted};margin:12px 0 6px;font-size:11px;letter-spacing:.06em;text-transform:uppercase">Server log · last signals</p>
      ${logBox}
    </div>`;
  }

  // ── The Tenements — evidence & records (reports + ledger) ─────────────
  async function evidence(api) {
    const [reports, tx] = await Promise.all([api.latestReports(), api.transparency()]);
    const reps = reports.ok && reports.data && Array.isArray(reports.data.reports) ? reports.data.reports : [];
    const ledger = tx.ok && tx.data ? tx.data : null;
    const fileRows = reps.length
      ? reps.slice(0, 14).map((r) => {
          const name = r.testName || r.name || r.testId || r.id || "record";
          const verdict = r.normalizedVerdict || r.verdict || r.result || r.state || "—";
          return `<div style="${S.row}">
            <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#dbe4f5" title="${esc(name)}">${esc(name)}</span>
            ${pill(verdict, verdictColor(verdict))}</div>`;
        }).join("")
      : empty("The files are empty. Run a case to start the record.");
    const ledgerLine = ledger && ledger.summary
      ? `<div style="${S.row}"><span style="flex:1;color:#dbe4f5">Ledger entries</span>${pill(String(ledger.summary.totalEntries ?? (ledger.recentEntries || []).length ?? 0), "#8aa0c4")}</div>`
      : "";
    return `<div style="${S.wrap}">
      <h4 style="${S.h}">Evidence &amp; records · nothing gets destroyed</h4>
      ${ledgerLine}
      <p style="${S.muted};margin:12px 0 6px;font-size:11px;letter-spacing:.06em;text-transform:uppercase">Filed reports</p>
      ${fileRows}
    </div>`;
  }

  // ── Registry: workspace defId → action ───────────────────────────────
  const ACTIONS = {
    "theatre-fractures": fractures,
    "plaza-caseboard": caseboard,
    "depot-pressure": pressure,
    "tower-monitoring": monitoring,
    "tenements-evidence": evidence,
  };

  global.KokuliScenes = {
    esc,
    loading,
    has: (defId) => Object.prototype.hasOwnProperty.call(ACTIONS, defId),
    // Returns the panel-body HTML for a workspace, or null if no live action.
    render: async function render(defId, api) {
      const action = ACTIONS[defId];
      if (!action) return null;
      try {
        return await action(api || global.KokuliAPI);
      } catch (err) {
        return errorState(String((err && err.message) || err));
      }
    },
  };
})(typeof window !== "undefined" ? window : globalThis);
