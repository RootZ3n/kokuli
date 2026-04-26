(function (globalScope) {
  "use strict";

  // ── Pure helpers (also exposed for unit tests) ────────────────────────────

  function escHtml(value) {
    if (value == null) return "";
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatDuration(ms) {
    if (ms == null || !isFinite(ms)) return "—";
    if (ms < 1000) return ms + "ms";
    if (ms < 60_000) return (ms / 1000).toFixed(1) + "s";
    return Math.floor(ms / 60_000) + "m" + Math.floor((ms % 60_000) / 1000) + "s";
  }

  function formatTime(iso) {
    if (!iso) return "—";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "—";
    var pad = function (n) { return n < 10 ? "0" + n : "" + n; };
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) +
      " " + pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
  }

  function statusClass(status) {
    switch (status) {
      case "passed":      return "br-status br-status-passed";
      case "failed":      return "br-status br-status-failed";
      case "blocked":     return "br-status br-status-blocked";
      case "error":       return "br-status br-status-error";
      case "timeout":     return "br-status br-status-timeout";
      case "unreachable": return "br-status br-status-unreachable";
      default:            return "br-status br-status-other";
    }
  }

  function modeSuite(row) {
    if (!row) return "";
    if (row.suite) return row.mode + " / " + row.suite;
    if (row.testId) return row.mode + " / " + row.testId;
    return row.mode || "";
  }

  function numCell(n, type) {
    var cls = "";
    if (n === 0) cls = "br-num-zero";
    else if (type === "warn") cls = "br-num-warn";
    else if (type === "fail") cls = "br-num-fail";
    return '<span class="' + cls + '">' + escHtml(n) + "</span>";
  }

  function buildQueryString(filters) {
    var parts = [];
    if (filters.caller) parts.push("caller=" + encodeURIComponent(filters.caller));
    if (filters.status) parts.push("status=" + encodeURIComponent(filters.status));
    if (filters.mode)   parts.push("mode="   + encodeURIComponent(filters.mode));
    if (filters.since)  parts.push("since="  + encodeURIComponent(filters.since));
    if (filters.limit)  parts.push("limit="  + encodeURIComponent(filters.limit));
    return parts.length ? "?" + parts.join("&") : "";
  }

  // ── Rendering ────────────────────────────────────────────────────────────

  function renderRows(rows) {
    if (!rows || rows.length === 0) {
      return '<tr><td colspan="9" class="br-empty">No bridge runs yet.</td></tr>';
    }
    return rows.map(function (r) {
      var summary = r.summary || {};
      return (
        '<tr class="br-row" data-run-id="' + escHtml(r.runId) + '">' +
          "<td>" + escHtml(formatTime(r.startedAt)) + "</td>" +
          "<td>" + escHtml(r.caller || "") + "</td>" +
          "<td>" + escHtml(modeSuite(r)) + "</td>" +
          '<td><span class="' + statusClass(r.status) + '">' + escHtml(r.status || "") + "</span></td>" +
          "<td>" + escHtml(formatDuration(r.durationMs)) + "</td>" +
          "<td>" + numCell(summary.passed | 0) + " / " + numCell(summary.totalTests | 0) + "</td>" +
          "<td>" + numCell(summary.findings | 0, summary.findings ? "warn" : "") + "</td>" +
          "<td>" + numCell(summary.critical | 0, summary.critical ? "fail" : "") + " / " +
                  numCell(summary.high | 0, summary.high ? "warn" : "") + "</td>" +
          '<td title="' + escHtml(r.runId) + '">' + escHtml(String(r.runId).slice(0, 24)) + (String(r.runId).length > 24 ? "…" : "") + "</td>" +
        "</tr>"
      );
    }).join("");
  }

  function renderDetail(detail) {
    if (!detail || !detail.row) {
      return '<div class="br-detail"><div class="br-error">Run not found in INDEX.jsonl.</div></div>';
    }
    var row = detail.row;
    var f = detail.files || {};
    var br = detail.bridgeResult;
    var as = detail.assessmentSummary;

    var fileLine = function (label, present) {
      return '<span class="br-file-pill' + (present ? "" : " missing") + '">' + escHtml(label) + "</span>";
    };

    var html = '<div class="br-detail">';
    html += '<div class="br-section-title">Run</div>';
    html += '<div class="br-detail-row"><div class="br-detail-key">runId</div><div class="br-detail-val">' + escHtml(row.runId) + "</div></div>";
    html += '<div class="br-detail-row"><div class="br-detail-key">caller</div><div class="br-detail-val">' + escHtml(row.caller) + "</div></div>";
    html += '<div class="br-detail-row"><div class="br-detail-key">target</div><div class="br-detail-val">' + escHtml(row.target) + "</div></div>";
    html += '<div class="br-detail-row"><div class="br-detail-key">mode / suite</div><div class="br-detail-val">' + escHtml(modeSuite(row)) + "</div></div>";
    html += '<div class="br-detail-row"><div class="br-detail-key">status</div><div class="br-detail-val"><span class="' + statusClass(row.status) + '">' + escHtml(row.status) + "</span></div></div>";
    html += '<div class="br-detail-row"><div class="br-detail-key">started / finished</div><div class="br-detail-val">' + escHtml(row.startedAt) + " &rarr; " + escHtml(row.finishedAt) + "</div></div>";
    html += '<div class="br-detail-row"><div class="br-detail-key">duration</div><div class="br-detail-val">' + escHtml(formatDuration(row.durationMs)) + "</div></div>";

    html += '<div class="br-section-title">Evidence pointers</div>';
    html += '<div class="br-detail-row"><div class="br-detail-key">reportDir</div><div class="br-detail-val">' + escHtml(row.reportDir || "—") + "</div></div>";
    html += '<div class="br-detail-row"><div class="br-detail-key">reportPath</div><div class="br-detail-val">' + escHtml(row.reportPath || "—") + "</div></div>";
    html += '<div class="br-detail-row"><div class="br-detail-key">latestReportPath</div><div class="br-detail-val">' + escHtml(row.latestReportPath || "(not set for this mode)") + "</div></div>";

    html += '<div class="br-section-title">Files in archive</div>';
    html += '<div class="br-files">';
    html += fileLine("BRIDGE_RESULT.json",  !!f.bridgeResult);
    html += fileLine("ASSESSMENT.json",     !!f.assessment);
    html += fileLine("SUMMARY.md",          !!f.summaryMd);
    html += fileLine("SUMMARY.json",        !!f.summaryJson);
    html += fileLine("EXECUTIVE_SUMMARY.md", !!f.executiveSummaryMd);
    html += "</div>";

    if (br) {
      html += '<div class="br-section-title">Bridge result</div>';
      html += '<div class="br-detail-row"><div class="br-detail-key">exit / signal</div><div class="br-detail-val">' + escHtml(br.exitCode) + " / " + escHtml(br.signal || "—") + (br.timedOut ? " (timed out)" : "") + "</div></div>";
      if (br.error) html += '<div class="br-detail-row"><div class="br-detail-key">error</div><div class="br-detail-val">' + escHtml(br.error) + "</div></div>";
      html += '<div class="br-detail-row"><div class="br-detail-key">archived files</div><div class="br-detail-val">' + escHtml((br.archive && br.archive.files || []).join(", ") || "—") + "</div></div>";
      if (br.archive && br.archive.missingFiles && br.archive.missingFiles.length) {
        html += '<div class="br-detail-row"><div class="br-detail-key">missing files</div><div class="br-detail-val" style="opacity:.55">' + escHtml(br.archive.missingFiles.join(", ")) + "</div></div>";
      }
      html += '<div class="br-detail-row"><div class="br-detail-key">reasonLength</div><div class="br-detail-val">' + escHtml((br.request && br.request.reasonLength) || 0) + " (text not stored)</div></div>";
    }

    if (as) {
      html += '<div class="br-section-title">Assessment summary</div>';
      if (as.summary) {
        html += '<div class="br-detail-row"><div class="br-detail-key">total / pass / fail / warn</div><div class="br-detail-val">' +
          escHtml(as.summary.total | 0) + " / " + escHtml(as.summary.pass | 0) + " / " + escHtml(as.summary.fail | 0) + " / " + escHtml(as.summary.warn | 0) + "</div></div>";
      }
      if (as.verdict) {
        html += '<div class="br-detail-row"><div class="br-detail-key">verdict</div><div class="br-detail-val">' + escHtml(as.verdict) + "</div></div>";
      }
      if (as.operatorSummary) {
        html += '<div class="br-detail-row"><div class="br-detail-key">critical / regressions</div><div class="br-detail-val">' +
          escHtml(as.operatorSummary.criticalFindingsCount | 0) + " / " + escHtml(as.operatorSummary.newRegressionsCount | 0) + "</div></div>";
      }
      html += '<div class="br-detail-row"><div class="br-detail-key">findings (count)</div><div class="br-detail-val">' + escHtml(as.findingsCount | 0) + "</div></div>";
    }

    html += '<div class="br-section-title">jq query</div>';
    html += '<div class="br-jq">jq -c \'select(.runId == "' + escHtml(row.runId) + '")\' reports/bridge/INDEX.jsonl</div>';

    html += "</div>";
    return html;
  }

  // ── DOM-bound entry points ────────────────────────────────────────────────

  function readFiltersFromDom(doc) {
    var el = function (id) { return doc.getElementById(id); };
    return {
      caller: (el("filter-caller") || {}).value || "",
      status: (el("filter-status") || {}).value || "",
      mode:   (el("filter-mode")   || {}).value || "",
      since:  (el("filter-since")  || {}).value || "",
      limit:  parseInt(((el("filter-limit") || {}).value || ""), 10) || undefined,
    };
  }

  function setWarning(doc, message) {
    var el = doc.getElementById("br-warn");
    if (!el) return;
    if (!message) {
      el.style.display = "none";
      el.textContent = "";
    } else {
      el.style.display = "block";
      el.textContent = message;
    }
  }

  function setSubtitle(doc, listResult) {
    var el = doc.getElementById("br-subtitle");
    if (!el) return;
    el.textContent = listResult.empty
      ? "reports/bridge/INDEX.jsonl (not yet created)"
      : "reports/bridge/INDEX.jsonl (" + listResult.totalRows + " runs total)";
  }

  function attachRowHandlers(doc) {
    var rows = doc.querySelectorAll(".br-row");
    rows.forEach(function (tr) {
      tr.addEventListener("click", function () {
        var runId = tr.getAttribute("data-run-id");
        if (!runId) return;
        rows.forEach(function (r) { r.classList.remove("active"); });
        tr.classList.add("active");
        loadDetail(doc, runId);
      });
    });
  }

  function loadDetail(doc, runId) {
    var host = doc.getElementById("br-detail-host");
    if (!host) return;
    host.innerHTML = '<div class="br-detail"><div class="br-empty">Loading detail…</div></div>';
    fetch("/api/bridge/runs/" + encodeURIComponent(runId))
      .then(function (r) {
        if (r.status === 404) return { row: null, files: {}, bridgeResult: null, assessmentSummary: null };
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(function (detail) {
        host.innerHTML = renderDetail(detail);
      })
      .catch(function () {
        host.innerHTML = '<div class="br-detail"><div class="br-error">Could not load detail.</div></div>';
      });
  }

  function refresh(doc) {
    var filters = readFiltersFromDom(doc);
    var tbody = doc.getElementById("br-tbody");
    if (tbody) tbody.innerHTML = '<tr><td colspan="9" class="br-empty">Loading…</td></tr>';
    setWarning(doc, "");

    fetch("/api/bridge/runs" + buildQueryString(filters))
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(function (data) {
        if (tbody) tbody.innerHTML = renderRows(data.rows || []);
        setSubtitle(doc, data);
        if (data.malformedCount && data.malformedCount > 0) {
          setWarning(doc, data.malformedCount + " malformed line(s) in INDEX.jsonl were skipped.");
        }
        attachRowHandlers(doc);
      })
      .catch(function () {
        if (tbody) tbody.innerHTML = '<tr><td colspan="9" class="br-error">Could not load bridge runs. Make sure Verum is running and the API is reachable.</td></tr>';
      });
  }

  var api = {
    escHtml: escHtml,
    formatDuration: formatDuration,
    formatTime: formatTime,
    statusClass: statusClass,
    modeSuite: modeSuite,
    buildQueryString: buildQueryString,
    renderRows: renderRows,
    renderDetail: renderDetail,
    refresh: refresh,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  globalScope.BridgeRunsUI = api;
})(typeof window !== "undefined" ? window : globalThis);
