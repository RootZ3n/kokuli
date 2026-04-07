let registryTests = [];
let assessment = null;
let targetData = null;
let activeTargetKey = "";
let lastUpdated = null;
let findingSort = "severity";
const localStateOverrides = {};
let runtimeTargetOverride = null;
let runtimeTargetResolved = null;
let targetEditorMode = "new";
let editingTargetId = "";
let serverMeta = null;

const CATEGORIES = {
  "child-safety": { name: "Child Safety", icon: "\u{1F6E1}\uFE0F", desc: "Magister child protection", color: "#ff0055", priority: 1 },
  security: { name: "Security", icon: "\u{1F512}", desc: "Prompt injection & refusal", color: "#ff2d2d", priority: 2 },
  recon: { name: "Reconnaissance", icon: "\u{1F50D}", desc: "Endpoint discovery & info leaks", color: "#ffaa00", priority: 3 },
  auth: { name: "Authentication", icon: "\u{1F511}", desc: "Access control verification", color: "#ffaa00", priority: 4 },
  exfil: { name: "Data Exfiltration", icon: "\u{1F480}", desc: "Data leakage & extraction", color: "#ff2d2d", priority: 5 },
  "multi-turn": { name: "Multi-Turn Attacks", icon: "\u{1F517}", desc: "Multi-step attack chains", color: "#ff6600", priority: 6 },
  fuzzing: { name: "Fuzzing", icon: "\u26A1", desc: "Automated input mutation", color: "#00e5ff", priority: 7 },
  reliability: { name: "Reliability", icon: "\u2699\uFE0F", desc: "Input handling & sanitization", color: "#00e5ff", priority: 8 },
  architecture: { name: "Architecture", icon: "\u{1F3D7}\uFE0F", desc: "Receipt & structure validation", color: "#00e5ff", priority: 9 },
  baseline: { name: "Baseline", icon: "\u{1F4CB}", desc: "Locked baseline gate", color: "#8b5cf6", priority: 10 },
};

const STATE_META = {
  idle: { label: "Not run yet", cls: "state-idle" },
  queued: { label: "Awaiting execution", cls: "state-queued" },
  running: { label: "Running", cls: "state-running" },
  passed: { label: "Passed", cls: "state-passed" },
  failed: { label: "Failed", cls: "state-failed" },
  blocked: { label: "Blocked", cls: "state-blocked" },
  error: { label: "Execution error", cls: "state-error" },
  timeout: { label: "Timed out", cls: "state-timeout" },
  skipped: { label: "Skipped", cls: "state-skipped" },
  stale: { label: "Stale result", cls: "state-stale" },
};

const VERDICT_CLASS = {
  pass: "badge-pass",
  concern: "badge-warn",
  fail: "badge-fail",
  critical: "badge-critical",
  not_comparable: "badge-category",
  accepted_risk: "badge-category",
  muted: "badge-category",
  resolved: "badge-pass",
  inconclusive: "badge-warn",
};

const LIFECYCLE_CLASS = {
  new: "badge-warn",
  recurring: "badge-pass",
  regressed: "badge-critical",
  resolved: "badge-pass",
  muted: "badge-category",
  accepted_risk: "badge-category",
};

const SEVERITY_ORDER = { critical: 4, high: 3, medium: 2, low: 1 };
const EXPLOITABILITY_ORDER = { high: 3, medium: 2, low: 1 };

async function api(path, opts) {
  return window.KrakzenApi.apiFetch(path, opts);
}

function formValue(id) {
  const el = document.getElementById(id);
  return el ? el.value : "";
}

function setFormValue(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = value || "";
}

function escHtml(value) {
  const el = document.createElement("div");
  el.textContent = value == null ? "" : String(value);
  return el.innerHTML;
}

function toast(msg, type) {
  const el = document.getElementById("toast");
  const icon = type === "error" ? "\u2717 " : "\u2713 ";
  el.innerHTML = '<span class="toast-icon">' + icon + "</span>" + escHtml(msg);
  el.className = "toast toast-" + (type || "info") + " show";
  setTimeout(() => el.classList.remove("show"), 3000);
}

function animateValue(el, start, end, duration) {
  if (start === end) {
    el.textContent = end;
    return;
  }
  const startTime = performance.now();
  function step(now) {
    const progress = Math.min((now - startTime) / duration, 1);
    const eased = 1 - (1 - progress) * (1 - progress);
    el.textContent = Math.round(start + (end - start) * eased);
    if (progress < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

function updateTimestamp() {
  lastUpdated = new Date();
  const el = document.getElementById("last-updated");
  if (el) el.textContent = "Last updated: " + lastUpdated.toLocaleTimeString();
  const metaEl = document.getElementById("server-meta");
  if (metaEl && serverMeta) {
    metaEl.textContent = "Server v" + serverMeta.version + " | started " + formatDateTime(serverMeta.serverStartedAt) + " | pid " + serverMeta.pid;
  }
}

function formatDateTime(value) {
  if (!value) return "Not run yet";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function formatDuration(value) {
  if (value == null) return "n/a";
  if (value < 1000) return value + "ms";
  return (value / 1000).toFixed(2) + "s";
}

function getCategoryMeta(category) {
  return CATEGORIES[category] || { name: category, icon: "\u{1F4C1}", desc: "", color: "#666", priority: 99 };
}

function stateBadge(state) {
  const meta = STATE_META[state] || STATE_META.idle;
  return '<span class="state-badge ' + meta.cls + '">' + escHtml(meta.label) + "</span>";
}

function severityBadge(severity) {
  if (!severity) return "";
  return '<span class="severity-badge severity-' + escHtml(severity) + '">' + escHtml(severity) + "</span>";
}

function resultBadge(result) {
  if (!result) return stateBadge("idle");
  const cls = result === "PASS" ? "badge-pass" : result === "FAIL" ? "badge-fail" : "badge-warn";
  return '<span class="badge ' + cls + '">' + escHtml(result) + "</span>";
}

function verdictLabel(verdict) {
  if (!verdict) return "Inconclusive";
  return verdict.replace(/_/g, " ");
}

function verdictBadge(verdict) {
  const cls = VERDICT_CLASS[verdict] || "badge-category";
  return '<span class="badge ' + cls + '">' + escHtml(verdictLabel(verdict)) + "</span>";
}

function deriveLegacyVerdict(summary) {
  if ((summary.fail || 0) > 0) return "fail";
  if ((summary.warn || 0) > 0) return "concern";
  if ((summary.pass || 0) > 0) return "pass";
  return "inconclusive";
}

function deriveLegacyFindings(reports) {
  return (reports || [])
    .filter((report) => report.result === "FAIL" || report.result === "WARN")
    .map((report) => {
      const severity = report.category === "child-safety" ? "critical"
        : report.category === "security" || report.category === "exfil" ? "high"
          : report.category === "recon" || report.category === "auth" ? "medium"
            : "low";
      const verdict = report.result === "FAIL" ? (severity === "critical" ? "critical" : "fail") : "concern";
      return {
        id: report.testId,
        title: report.testName,
        category: report.category,
        severity: severity,
        target: report.target || activeTargetKey || "active-target",
        test_id: report.testId,
        status: report.result === "FAIL" ? "open" : "open",
        lifecycle: "new",
        workflow_state: "detected",
        verdict: verdict,
        exploitability: ["recon", "auth", "exfil", "child-safety"].includes(report.category) ? "high" : "medium",
        impact: severity === "critical" ? "critical" : severity === "high" ? "high" : severity === "medium" ? "moderate" : "low",
        confidence: report.result === "FAIL" ? "high" : "medium",
        confidence_reason: report.result === "FAIL" ? "Deterministic failure reported in legacy result." : "Legacy warning result reconstructed client-side.",
        evidence_summary: report.observedBehavior || "Legacy report evidence unavailable.",
        evidence_snapshot: {
          attackSummary: (report.threatProfile && report.threatProfile.intent) || report.purpose || report.testName,
          responseSummary: report.rawResponseSnippet || report.observedBehavior || "No response excerpt available.",
          evaluatorSummary: (report.evaluatorRules && report.evaluatorRules[0] && report.evaluatorRules[0].label) || "Legacy evaluator rule detail unavailable.",
          confidenceSummary: report.result === "FAIL" ? "Deterministic failure carried from persisted report." : "Warning carried from persisted report.",
          whyItMatters: (report.remediationBlock && report.remediationBlock.whyItMatters) || "Legacy report reconstructed because /api/dashboard is unavailable on the running server.",
        },
        remediation_summary: (report.remediationBlock && report.remediationBlock.whatToChange) || (report.remediationGuidance && report.remediationGuidance[0]) || (report.suggestedImprovements && report.suggestedImprovements[0]) || "Review the failing test and rerun against an updated server.",
        remediation_block: report.remediationBlock || {
          whatToChange: (report.remediationGuidance && report.remediationGuidance[0]) || (report.suggestedImprovements && report.suggestedImprovements[0]) || "Review the failing test and rerun against an updated server.",
          whyItMatters: "This finding was reconstructed from legacy report endpoints because the newer assessment endpoint was unavailable.",
          attackerBenefitIfUnfixed: "The underlying issue remains actionable until the failing deterministic test no longer reproduces.",
          retestSuggestion: "Restart the current Krakzen web server and rerun the affected suite.",
        },
        provenance: report.evaluatorRules || [],
        first_seen_at: report.timestamp || new Date().toISOString(),
        last_seen_at: report.timestamp || new Date().toISOString(),
        regression: false,
        occurrences: 1,
      };
    });
}

function buildLegacyAssessment(summaryData, latestData) {
  const reports = (latestData && latestData.reports) || [];
  const summary = {
    total: summaryData.total || reports.length,
    pass: summaryData.pass || 0,
    fail: summaryData.fail || 0,
    warn: summaryData.warn || 0,
  };
  const findings = deriveLegacyFindings(reports);
  const targetName = targetData && targetData.targets && targetData.targets[activeTargetKey] ? targetData.targets[activeTargetKey].name : activeTargetKey;
  const highestSeverity = findings.some((finding) => finding.severity === "critical") ? "critical"
    : findings.some((finding) => finding.severity === "high") ? "high"
      : findings.some((finding) => finding.severity === "medium") ? "medium"
        : findings.some((finding) => finding.severity === "low") ? "low"
          : "none";
  const suites = Object.keys(CATEGORIES).map((category) => {
    const categoryReports = reports.filter((report) => report.category === category);
    const pass = categoryReports.filter((report) => report.result === "PASS").length;
    const fail = categoryReports.filter((report) => report.result === "FAIL").length;
    const warn = categoryReports.filter((report) => report.result === "WARN").length;
    return {
      suiteId: category,
      suiteName: category,
      category: category,
      state: fail > 0 ? "failed" : warn > 0 ? "stale" : pass > 0 ? "passed" : "idle",
      total: categoryReports.length,
      counts: {
        idle: 0,
        queued: 0,
        running: 0,
        passed: pass,
        failed: fail,
        blocked: 0,
        error: 0,
        timeout: 0,
        skipped: 0,
        stale: warn,
      },
      lastRunAt: categoryReports[0] ? categoryReports[0].timestamp : undefined,
      durationMs: categoryReports.reduce((sum, report) => sum + (report.durationMs || 0), 0),
    };
  }).filter((suite) => suite.total > 0);

  return {
    generatedAt: summaryData.timestamp || new Date().toISOString(),
    target: activeTargetKey || "active-target",
    targetName: targetName,
    summary: summary,
    verdict: deriveLegacyVerdict(summary),
    riskSummary: {
      overallVerdict: findings.some((finding) => finding.severity === "critical") ? "Critical" : summary.fail > 0 ? "Fail" : summary.warn > 0 ? "Warning" : "Pass",
      highestSeverityObserved: highestSeverity,
      exploitableFindingsCount: findings.filter((finding) => finding.exploitability !== "low").length,
      publicExposureFindingsCount: findings.filter((finding) => ["recon", "auth", "exfil"].includes(finding.category)).length,
      childSafetyFailuresCount: findings.filter((finding) => finding.category === "child-safety").length,
      recommendedFirstFix: findings[0] ? findings[0].remediation_summary : "Restart the current Krakzen server to restore the richer assessment endpoint.",
    },
    operatorSummary: {
      overallVerdict: deriveLegacyVerdict(summary),
      highestSeverity: highestSeverity,
      criticalFindingsCount: findings.filter((finding) => finding.severity === "critical").length,
      newRegressionsCount: 0,
      publicExposureCount: findings.filter((finding) => ["recon", "auth", "exfil"].includes(finding.category)).length,
      childSafetyFailuresCount: findings.filter((finding) => finding.category === "child-safety").length,
      recommendedFirstFix: findings[0] ? findings[0].remediation_summary : "Restart the current Krakzen server to restore the richer assessment endpoint.",
      keyEvidenceHighlights: findings.slice(0, 3).map((finding) => finding.evidence_snapshot.responseSummary),
      trustSignals: reports.length ? ["partially_executed"] : ["inconclusive_due_to_target_variance"],
      exportActions: [],
    },
    metrics: {
      totalRunDurationMs: reports.reduce((sum, report) => sum + (report.durationMs || 0), 0),
      perSuiteDurationMs: suites.reduce((acc, suite) => { acc[suite.category] = suite.durationMs || 0; return acc; }, {}),
      perTestDurationMs: reports.reduce((acc, report) => { acc[report.testId] = report.durationMs || 0; return acc; }, {}),
      timeoutCount: 0,
      blockedCount: reports.filter((report) => report.parsedFields && report.parsedFields.gatewayBlock).length,
      errorCount: 0,
      averageResponseLatencyMs: reports.length ? Math.round(reports.reduce((sum, report) => sum + (report.durationMs || 0), 0) / reports.length) : 0,
      totalEstimatedCostUsd: undefined,
      criticalFindingsCount: findings.filter((finding) => finding.severity === "critical").length,
      newRegressionsCount: 0,
      publicExposureCount: findings.filter((finding) => ["recon", "auth", "exfil"].includes(finding.category)).length,
      childSafetyFailuresCount: findings.filter((finding) => finding.category === "child-safety").length,
    },
    coverage: {
      runTrustSignals: [reports.length ? "partially_executed" : "inconclusive_due_to_target_variance"],
      suiteTrustSignals: suites.reduce((acc, suite) => { acc[suite.category] = [suite.state === "failed" ? "partially_executed" : "fully_executed"]; return acc; }, {}),
    },
    integrity: {
      sequence: 0,
      checksum: "",
      chainHash: "",
      status: "warning",
      warning: "Running server does not expose /api/dashboard; dashboard is using legacy report endpoints.",
    },
    targetFingerprint: undefined,
    gates: [],
    findings: findings,
    suites: suites,
    tests: reports,
    comparison: {
      newFindings: findings,
      recurringFindings: [],
      resolvedFindings: [],
      regressedFindings: [],
      unchangedFindings: [],
      notComparableFindings: findings,
      previousRunAt: undefined,
      comparabilityWarning: "Running server does not expose /api/dashboard; comparison is limited.",
    },
  };
}

function updateRuntimeTargetNote() {
  const el = document.getElementById("target-runtime-note");
  if (!el) return;
  if (runtimeTargetResolved) {
    el.innerHTML = 'Temporary target armed: <strong>' + escHtml(runtimeTargetResolved.name) + "</strong> :: " + escHtml(runtimeTargetResolved.baseUrl) + " :: " + escHtml(runtimeTargetResolved.pathMode) + ' <button class="btn btn-sm" onclick="clearTemporaryTarget()">Use Saved Target</button>';
    return;
  }
  const selected = targetData && targetData.targets && targetData.targets[activeTargetKey];
  el.textContent = selected ? ("Saved target: " + selected.name + " :: " + selected.baseUrl) : "No active target selected.";
}

function collectTargetFormConfig() {
  return window.KrakzenTargetForm.normalizeTargetPayload({
    id: targetEditorMode === "edit" ? editingTargetId : formValue("target-form-id").trim(),
    name: formValue("target-form-name").trim(),
    baseUrl: formValue("target-form-base-url").trim(),
    payloadFormat: formValue("target-form-payload-format") || "messages",
    pathMode: formValue("target-form-path-mode") || "explicit_plus_defaults",
    endpoints: {
      chat: formValue("target-form-chat").trim(),
      health: formValue("target-form-health").trim(),
      search: formValue("target-form-search").trim(),
      memory: formValue("target-form-memory").trim(),
      receipts: formValue("target-form-receipts").trim(),
      runs: formValue("target-form-runs").trim(),
      sessions: formValue("target-form-sessions").trim(),
      tools: formValue("target-form-tools").trim(),
      version: formValue("target-form-version").trim(),
    },
    auth: {
      headerName: formValue("target-form-auth-header").trim(),
      token: formValue("target-form-auth-token"),
    },
    notes: formValue("target-form-notes").trim(),
    enabled: true,
  }, { includeId: true });
}

function openTargetEditor(mode) {
  targetEditorMode = mode || "new";
  editingTargetId = activeTargetKey || "";
  const selected = targetData && targetData.targets && targetData.targets[activeTargetKey];
  const source = mode === "quick" && runtimeTargetOverride ? runtimeTargetOverride : selected;
  setFormValue("target-form-id", mode === "new" ? "" : (editingTargetId || ""));
  setFormValue("target-form-name", source && source.name || "");
  setFormValue("target-form-base-url", source && source.baseUrl || "");
  setFormValue("target-form-payload-format", source && source.payloadFormat || "messages");
  setFormValue("target-form-path-mode", source && source.pathMode || "explicit_plus_defaults");
  setFormValue("target-form-chat", source && source.endpoints && source.endpoints.chat || source && source.chatPath || "");
  setFormValue("target-form-health", source && source.endpoints && source.endpoints.health || "");
  setFormValue("target-form-search", source && source.endpoints && source.endpoints.search || "");
  setFormValue("target-form-memory", source && source.endpoints && source.endpoints.memory || "");
  setFormValue("target-form-receipts", source && source.endpoints && source.endpoints.receipts || "");
  setFormValue("target-form-runs", source && source.endpoints && source.endpoints.runs || "");
  setFormValue("target-form-sessions", source && source.endpoints && source.endpoints.sessions || "");
  setFormValue("target-form-tools", source && source.endpoints && source.endpoints.tools || "");
  setFormValue("target-form-version", source && source.endpoints && source.endpoints.version || "");
  setFormValue("target-form-auth-header", source && source.auth && source.auth.headerName || "");
  setFormValue("target-form-auth-token", "");
  setFormValue("target-form-notes", source && source.notes || "");
  const help = document.getElementById("target-form-help");
  if (help) {
    help.textContent = mode === "edit"
      ? "Leave auth token blank to keep the stored secret unchanged."
      : "Temporary targets are visible in run metadata but are not saved unless you choose Save Target.";
  }
  const modal = document.getElementById("target-modal");
  if (modal) modal.style.display = "flex";
}

function closeTargetEditor() {
  const modal = document.getElementById("target-modal");
  if (modal) modal.style.display = "none";
}

async function saveTargetConfig() {
  try {
    const isEdit = targetEditorMode === "edit";
    const payload = collectTargetFormConfig();
    const validationError = window.KrakzenTargetForm.validateTargetPayload(payload, { requireId: !isEdit });
    if (validationError) {
      toast("Error: " + validationError, "error");
      return;
    }
    if (!isEdit && !payload.id) {
      toast("Error: Target id is required.", "error");
      return;
    }
    const path = isEdit ? "/targets/" + encodeURIComponent(editingTargetId) : "/targets";
    await api(path, {
      method: isEdit ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    closeTargetEditor();
    await loadTargets();
    if (!isEdit && payload.id) {
      await switchTarget(payload.id);
    }
    toast("Target configuration saved.");
  } catch (err) {
    toast("Error: " + err.message, "error");
  }
}

function renderProbeResults(data) {
  const panel = document.getElementById("probe-panel");
  if (!panel) return;
  panel.innerHTML = [
    '<div class="probe-results">',
    '<span class="probe-title">' + escHtml(data.target) + " — " + data.reachable + "/" + data.total + " endpoints :: " + escHtml(data.pathMode || "explicit_plus_defaults") + "</span>",
    '<span class="probe-endpoint probe-up">source ' + escHtml(data.source || "saved") + "</span>",
    '<span class="probe-endpoint probe-up">auth header ' + escHtml(data.authHeaderConfigured || "none") + "</span>",
    ...(data.endpoints || []).map((ep) => {
      let cls = "probe-down";
      if (ep.status >= 200 && ep.status < 300) cls = "probe-up";
      else if (ep.status === 404) cls = "probe-404";
      else if (ep.status > 0) cls = "probe-up";
      return '<span class="probe-endpoint ' + cls + '"><span class="probe-status">' + escHtml(ep.status || "---") + "</span> " + escHtml(ep.label + " :: " + ep.path) + "</span>";
    }),
    '<span class="probe-close" onclick="document.getElementById(\'probe-panel\').style.display=\'none\'">&times;</span>',
    "</div>",
  ].join("");
  panel.style.display = "block";
}

async function probeDraftTarget() {
  try {
    const payload = collectTargetFormConfig();
    const validationError = window.KrakzenTargetForm.validateTargetPayload(payload, { requireId: false });
    if (validationError) {
      toast("Error: " + validationError, "error");
      return;
    }
    const data = await api("/targets/probe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target: payload }),
    });
    renderProbeResults(data);
    toast("Probe complete");
  } catch (err) {
    toast("Error: " + err.message, "error");
  }
}

async function useTemporaryTarget() {
  try {
    const payload = collectTargetFormConfig();
    const validationError = window.KrakzenTargetForm.validateTargetPayload(payload, { requireId: false });
    if (validationError) {
      toast("Error: " + validationError, "error");
      return;
    }
    payload.id = payload.id || "temporary-ui-target";
    const resolved = await api("/targets/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target: payload }),
    });
    runtimeTargetOverride = payload;
    runtimeTargetResolved = resolved.target;
    closeTargetEditor();
    updateRuntimeTargetNote();
    toast("Temporary target armed for the next run.");
  } catch (err) {
    toast("Error: " + err.message, "error");
  }
}

function clearTemporaryTarget() {
  runtimeTargetOverride = null;
  runtimeTargetResolved = null;
  updateRuntimeTargetNote();
}

function getRunsForBaseTest(testId) {
  if (!assessment || !assessment.tests) return [];
  return assessment.tests.filter((run) => run.testId === testId || run.testId.startsWith(testId + "-"));
}

function aggregateBaseState(test) {
  if (localStateOverrides[test.id]) return localStateOverrides[test.id];
  const runs = getRunsForBaseTest(test.id);
  const execution = test.execution || {};
  if (!runs.length) {
    return {
      state: test.state || "idle",
      result: null,
      durationMs: execution.durationMs,
      lastRunAt: execution.lastRunAt,
      attemptCount: execution.attemptCount || 0,
      runs: [],
    };
  }

  const latestRun = [...runs].sort((a, b) => (b.execution?.lastRunAt || b.timestamp || "").localeCompare(a.execution?.lastRunAt || a.timestamp || ""))[0];
  const result = runs.some((run) => run.result === "FAIL") ? "FAIL" : runs.some((run) => run.result === "WARN") ? "WARN" : "PASS";
  const state = runs.some((run) => (run.execution?.state || run.state) === "failed") ? "failed"
    : runs.some((run) => (run.execution?.state || run.state) === "blocked") ? "blocked"
    : runs.some((run) => (run.execution?.state || run.state) === "error") ? "error"
    : runs.some((run) => (run.execution?.state || run.state) === "timeout") ? "timeout"
    : runs.some((run) => (run.execution?.state || run.state) === "running") ? "running"
    : runs.some((run) => (run.execution?.state || run.state) === "queued") ? "queued"
    : latestRun.execution?.state || latestRun.state || "stale";

  return {
    state,
    result,
    durationMs: runs.reduce((sum, run) => sum + (run.durationMs || 0), 0),
    lastRunAt: latestRun.execution?.lastRunAt || latestRun.timestamp,
    attemptCount: Math.max(...runs.map((run) => (run.execution?.attemptCount || 1)), execution.attemptCount || 0),
    runs,
  };
}

function updateStats(summary) {
  const fields = [
    { id: "stat-total", key: "total" },
    { id: "stat-pass", key: "pass" },
    { id: "stat-fail", key: "fail" },
    { id: "stat-warn", key: "warn" },
  ];

  fields.forEach((field) => {
    const el = document.getElementById(field.id);
    if (!el) return;
    const prev = parseInt(el.textContent, 10) || 0;
    animateValue(el, prev, summary[field.key] || 0, 500);
  });
  updateTimestamp();
}

function renderCategorySummary() {
  let container = document.getElementById("category-summary");
  if (!container) {
    const statsEl = document.querySelector(".stats-strip");
    if (!statsEl) return;
    container = document.createElement("div");
    container.id = "category-summary";
    container.className = "category-summary-bar";
    statsEl.parentNode.insertBefore(container, statsEl.nextSibling);
  }

  const suitesByCategory = {};
  (assessment && assessment.suites ? assessment.suites : []).forEach((suite) => {
    suitesByCategory[suite.category] = suite;
  });

  const html = Object.keys(CATEGORIES)
    .sort((a, b) => getCategoryMeta(a).priority - getCategoryMeta(b).priority)
    .map((category) => {
      const meta = getCategoryMeta(category);
      const suite = suitesByCategory[category];
      if (!suite) {
        return '<div class="summary-bar-item"><div class="summary-bar-label">' + meta.icon + " " + escHtml(meta.name) + '</div><div class="summary-bar-track"><div class="summary-bar-empty">No active target data</div></div></div>';
      }
      return [
        '<div class="summary-bar-item">',
        '  <div class="summary-bar-label">' + meta.icon + " " + escHtml(meta.name) + "</div>",
        '  <div class="suite-state-inline">' + stateBadge(suite.state) + "</div>",
        '  <div class="summary-bar-nums">' + suite.counts.passed + " pass / " + suite.counts.failed + " fail / " + suite.counts.stale + " stale</div>",
        "</div>",
      ].join("");
    })
    .join("");

  container.innerHTML = '<div class="summary-bar-title">Category Overview</div><div class="summary-bar-grid">' + html + "</div>";
}

function renderRiskSummary() {
  const el = document.getElementById("risk-summary");
  if (!el) return;
  if (!assessment) {
    el.innerHTML = '<div class="empty-state">No active target data.</div>';
    return;
  }

  const risk = assessment.riskSummary;
  el.innerHTML = [
    '<div class="risk-grid">',
    '  <div class="risk-verdict">' + verdictBadge(assessment.verdict) + "</div>",
    '  <div class="risk-item"><span class="risk-label">Highest Severity</span><span class="risk-value">' + escHtml(risk.highestSeverityObserved) + "</span></div>",
    '  <div class="risk-item"><span class="risk-label">Exploitable Findings</span><span class="risk-value">' + escHtml(risk.exploitableFindingsCount) + "</span></div>",
    '  <div class="risk-item"><span class="risk-label">Public Exposure</span><span class="risk-value">' + escHtml(risk.publicExposureFindingsCount) + "</span></div>",
    '  <div class="risk-item"><span class="risk-label">Child Safety Failures</span><span class="risk-value critical-value">' + escHtml(risk.childSafetyFailuresCount) + "</span></div>",
    '  <div class="risk-first-fix"><span class="risk-label">Recommended First Fix</span><span class="risk-text">' + escHtml(risk.recommendedFirstFix) + "</span></div>",
    "</div>",
  ].join("");
}

function renderOperatorSummary() {
  const el = document.getElementById("operator-summary");
  if (!el) return;
  if (!assessment || !assessment.operatorSummary) {
    el.innerHTML = '<div class="empty-state">No active target data.</div>';
    return;
  }
  const summary = assessment.operatorSummary;
  const targetConfig = assessment.targetConfigSnapshot;
  el.innerHTML = [
    '<div class="risk-grid">',
    '  <div class="risk-verdict">' + verdictBadge(summary.overallVerdict) + '<span class="risk-text">Critical findings ' + summary.criticalFindingsCount + ' | regressions ' + summary.newRegressionsCount + '</span></div>',
    '  <div class="risk-item"><span class="risk-label">Highest Severity</span><span class="risk-value">' + escHtml(summary.highestSeverity) + "</span></div>",
    '  <div class="risk-item"><span class="risk-label">Public Exposure</span><span class="risk-value">' + escHtml(summary.publicExposureCount) + "</span></div>",
    '  <div class="risk-item"><span class="risk-label">Child Safety Failures</span><span class="risk-value critical-value">' + escHtml(summary.childSafetyFailuresCount) + "</span></div>",
    '  <div class="risk-item"><span class="risk-label">Run Duration</span><span class="risk-value">' + escHtml(formatDuration(assessment.metrics.totalRunDurationMs)) + "</span></div>",
    '  <div class="risk-first-fix"><span class="risk-label">Target Config</span><span class="risk-text">' + escHtml(targetConfig ? (targetConfig.source + " | " + targetConfig.pathMode + " | auth header " + (targetConfig.auth.headerName || "none")) : "No target config snapshot.") + "</span></div>",
    '  <div class="risk-first-fix"><span class="risk-label">Resolved Paths</span><span class="risk-text">' + escHtml(targetConfig ? Object.entries(targetConfig.resolvedEndpoints || {}).map(([key, value]) => key + "=" + value).join(" | ") : "No resolved endpoint map.") + "</span></div>",
    '  <div class="risk-first-fix"><span class="risk-label">Trust Signals</span><span class="risk-text">' + escHtml((summary.trustSignals || []).join(", ") || "none") + "</span></div>",
    '  <div class="risk-first-fix"><span class="risk-label">Recommended First Fix</span><span class="risk-text">' + escHtml(summary.recommendedFirstFix) + "</span></div>",
    '  <div class="risk-first-fix"><span class="risk-label">Key Evidence Highlights</span><span class="risk-text">' + escHtml((summary.keyEvidenceHighlights || []).join(" | ") || "No highlighted evidence.") + "</span></div>",
    '  <div class="risk-first-fix"><span class="risk-label">Exports</span><span class="risk-text">' + summary.exportActions.map((action) => '<a href="' + escHtml(action.path) + '" target="_blank" rel="noreferrer">' + escHtml(action.label) + "</a>").join(" | ") + "</span></div>",
    "</div>",
  ].join("");
}

function renderScreenshotSummary() {
  const el = document.getElementById("screenshot-summary");
  if (!el) return;
  if (!assessment) {
    el.innerHTML = '<div class="empty-state">No active target data.</div>';
    return;
  }
  el.innerHTML = [
    '<div class="comparison-grid">',
    '  <div class="comparison-item"><span class="risk-label">Target</span><span class="risk-text">' + escHtml((assessment.targetName || assessment.target) + " :: " + (assessment.targetFingerprint && assessment.targetFingerprint.baseUrl || "n/a") + " :: " + ((assessment.targetConfigSnapshot && assessment.targetConfigSnapshot.source) || "saved")) + "</span></div>",
    '  <div class="comparison-item"><span class="risk-label">Overall Verdict</span><span class="risk-text">' + verdictBadge(assessment.verdict) + "</span></div>",
    '  <div class="comparison-item"><span class="risk-label">Critical Findings</span><span class="risk-value">' + assessment.metrics.criticalFindingsCount + "</span></div>",
    '  <div class="comparison-item"><span class="risk-label">Regressions</span><span class="risk-value critical-value">' + assessment.metrics.newRegressionsCount + "</span></div>",
    '  <div class="comparison-item"><span class="risk-label">Public Exposure</span><span class="risk-value">' + assessment.metrics.publicExposureCount + "</span></div>",
    '  <div class="comparison-item"><span class="risk-label">Child Safety Failures</span><span class="risk-value critical-value">' + assessment.metrics.childSafetyFailuresCount + "</span></div>",
    '  <div class="comparison-item"><span class="risk-label">Integrity / Comparability</span><span class="risk-text">' + escHtml((assessment.integrity && assessment.integrity.status || "n/a") + " | " + (assessment.comparison.comparabilityWarning || "comparable")) + "</span></div>",
    "</div>",
  ].join("");
}

function renderGateSummary() {
  const el = document.getElementById("gate-summary");
  if (!el) return;
  if (!assessment || !assessment.gates) {
    el.innerHTML = '<div class="empty-state">No active target data.</div>';
    return;
  }

  el.innerHTML = assessment.gates.map((gate) => [
    '<div class="gate-card gate-' + escHtml(gate.status) + '">',
    '  <div class="gate-header-line"><span class="gate-title-text">' + escHtml(gate.title) + '</span><span class="state-badge state-' + escHtml(gate.status === "pass" ? "passed" : gate.status === "fail" ? "failed" : "stale") + '">' + escHtml(gate.status.toUpperCase()) + "</span></div>",
    '  <div class="gate-copy">' + escHtml(gate.explanation) + "</div>",
    '  <div class="gate-counts">pass ' + gate.counts.passed + " / fail " + gate.counts.failed + " / warn " + gate.counts.warned + " / not run " + gate.counts.notRun + "</div>",
    "</div>",
  ].join("")).join("");
}

function sortedFindings() {
  const findings = assessment && assessment.findings ? [...assessment.findings] : [];
  if (findingSort === "exploitability") {
    return findings.sort((a, b) => {
      const delta = (EXPLOITABILITY_ORDER[b.exploitability] || 0) - (EXPLOITABILITY_ORDER[a.exploitability] || 0);
      if (delta !== 0) return delta;
      return (SEVERITY_ORDER[b.severity] || 0) - (SEVERITY_ORDER[a.severity] || 0);
    });
  }
  if (findingSort === "recency") {
    return findings.sort((a, b) => (b.last_seen_at || "").localeCompare(a.last_seen_at || ""));
  }
  return findings.sort((a, b) => {
    const delta = (SEVERITY_ORDER[b.severity] || 0) - (SEVERITY_ORDER[a.severity] || 0);
    if (delta !== 0) return delta;
    return (EXPLOITABILITY_ORDER[b.exploitability] || 0) - (EXPLOITABILITY_ORDER[a.exploitability] || 0);
  });
}

function renderFindings() {
  const el = document.getElementById("findings-panel");
  if (!el) return;
  const findings = sortedFindings();
  if (!findings.length) {
    el.innerHTML = '<div class="empty-state">No findings in the latest target assessment.</div>';
    return;
  }

  const rows = findings.map((finding) => [
    "<tr>",
    "  <td>" + severityBadge(finding.severity) + " " + escHtml(finding.title) + "</td>",
    "  <td>" + verdictBadge(finding.verdict || "concern") + '<div class="finding-confidence">' + escHtml("lifecycle " + finding.lifecycle + " | workflow " + (finding.workflow_state || "detected")) + "</div></td>",
    "  <td>" + escHtml(getCategoryMeta(finding.category).name) + "</td>",
    "  <td>" + escHtml(finding.exploitability) + "</td>",
    "  <td>" + escHtml(finding.target) + "</td>",
    "  <td>" + escHtml(formatDateTime(finding.last_seen_at)) + "</td>",
    "  <td>" + escHtml(finding.evidence_snapshot.attackSummary + " | " + finding.evidence_snapshot.responseSummary) + "<div class=\"finding-confidence\">confidence " + escHtml(finding.confidence + " :: " + finding.confidence_reason) + "</div></td>",
    "</tr>",
  ].join("")).join("");

  el.innerHTML = [
    '<table class="fields-table findings-table">',
    "  <tr><th>Finding</th><th>Verdict / Workflow</th><th>Category</th><th>Exploitability</th><th>Target</th><th>Last Seen</th><th>Evidence Snapshot</th></tr>",
    rows,
    "</table>",
  ].join("");
}

function renderRunComparison() {
  const el = document.getElementById("run-comparison");
  if (!el) return;
  if (!assessment) {
    el.innerHTML = '<div class="empty-state">No active target data.</div>';
    return;
  }
  const comparison = assessment.comparison;
  el.innerHTML = [
    '<div class="comparison-grid">',
    '  <div class="comparison-item"><span class="risk-label">Previous Comparable Run</span><span class="risk-text">' + escHtml(comparison.previousRunAt ? formatDateTime(comparison.previousRunAt) : "No prior run on this target") + "</span></div>",
    '  <div class="comparison-item"><span class="risk-label">New Findings</span><span class="risk-value">' + comparison.newFindings.length + "</span></div>",
    '  <div class="comparison-item"><span class="risk-label">Recurring Findings</span><span class="risk-value">' + comparison.recurringFindings.length + "</span></div>",
    '  <div class="comparison-item"><span class="risk-label">Resolved Findings</span><span class="risk-value">' + comparison.resolvedFindings.length + "</span></div>",
    '  <div class="comparison-item"><span class="risk-label">Regressed Findings</span><span class="risk-value">' + comparison.regressedFindings.length + "</span></div>",
    '  <div class="comparison-item"><span class="risk-label">Unchanged Findings</span><span class="risk-value">' + comparison.unchangedFindings.length + "</span></div>",
    '  <div class="comparison-item"><span class="risk-label">Not Directly Comparable</span><span class="risk-value">' + comparison.notComparableFindings.length + "</span></div>",
    '  <div class="comparison-item"><span class="risk-label">Fingerprint Comparability</span><span class="risk-text">' + escHtml(comparison.comparabilityWarning || "Fingerprint stable across comparable runs.") + "</span></div>",
    '  <div class="comparison-item"><span class="risk-label">Audit Integrity</span><span class="risk-text">' + escHtml((assessment.integrity && (assessment.integrity.status + (assessment.integrity.warning ? " :: " + assessment.integrity.warning : ""))) || "n/a") + "</span></div>",
    "</div>",
  ].join("");
}

function detailCell(label, value) {
  return '<div class="detail-cell"><div class="detail-cell-label">' + escHtml(label) + '</div><div class="detail-cell-value">' + escHtml(value) + "</div></div>";
}

function renderTimeline(events) {
  if (!events || !events.length) return '<div class="empty-state">No evidence timeline recorded.</div>';
  return '<div class="timeline">' + events.map((event) => [
    '<div class="timeline-item">',
    '  <div class="timeline-head"><span class="timeline-title">' + escHtml(event.title) + '</span><span class="timeline-time">' + escHtml(formatDateTime(event.timestamp)) + "</span></div>",
    '  <div class="timeline-phase">' + escHtml(event.phase) + "</div>",
    '  <div class="timeline-detail">' + escHtml(event.detail) + "</div>",
    "</div>",
  ].join("")).join("") + "</div>";
}

function renderRunArtifact(run, index) {
  const request = run.request || {};
  const response = run.response || {};
  const rules = run.evaluatorRules || [];
  const evidence = run.evidence || [];
  const remediation = run.remediationGuidance || run.suggestedImprovements || [];
  const comparison = run.priorRunComparison;
  const fingerprint = run.targetFingerprint || assessment.targetFingerprint;
  const targetConfig = run.targetConfigSnapshot || assessment.targetConfigSnapshot;

  return [
    '<div class="detail-run">',
    '  <div class="detail-header"><div class="detail-title">' + escHtml(run.testName || ("Run " + (index + 1))) + '</div>' + stateBadge(run.execution?.state || run.state || "idle") + " " + verdictBadge(run.normalizedVerdict || "inconclusive") + "</div>",
    '  <div class="detail-grid">',
    detailCell("State", STATE_META[run.execution?.state || run.state || "idle"].label),
    detailCell("Last Run", formatDateTime(run.execution?.lastRunAt || run.timestamp)),
    detailCell("Duration", formatDuration(run.durationMs)),
    detailCell("Attempts", String(run.execution?.attemptCount || 1)),
    detailCell("HTTP Status", String(run.parsedFields?.httpStatus || response.status || "n/a")),
    detailCell("Provider", run.transparency?.provider || run.parsedFields?.provider || "-"),
    detailCell("Model", run.transparency?.model || run.parsedFields?.model || run.parsedFields?.activeModel || "-"),
    detailCell("Receipt ID", run.transparency?.receiptId || run.parsedFields?.receiptId || "-"),
    detailCell("Token Counts", (run.transparency?.tokensIn || 0) + " in / " + (run.transparency?.tokensOut || 0) + " out"),
    detailCell("Estimated Cost", run.transparency?.estimatedCostUsd != null ? "$" + run.transparency.estimatedCostUsd.toFixed(4) : "n/a"),
    detailCell("Gateway Signal", run.transparency?.gatewayBlocked ? (run.transparency.gatewayReason || "blocked") : "none"),
    detailCell("Latency", formatDuration(run.transparency?.latencyMs || run.durationMs)),
    "  </div>",
    '  <div class="detail-section"><div class="detail-section-title">Confidence Reasoning</div><div class="detail-explanation">' + escHtml((run.confidenceReason && run.confidenceReason.explanation) || "No confidence explanation recorded.") + "</div></div>",
    '  <div class="detail-section"><div class="detail-section-title">Evidence Snapshot</div><div class="detail-explanation">' + escHtml(run.evidenceSnapshot ? (run.evidenceSnapshot.attackSummary + " | " + run.evidenceSnapshot.responseSummary + " | " + run.evidenceSnapshot.evaluatorSummary + " | " + run.evidenceSnapshot.confidenceSummary + " | " + run.evidenceSnapshot.whyItMatters) : "No compact evidence snapshot recorded.") + "</div></div>",
    '  <div class="detail-section"><div class="detail-section-title">Target Fingerprint</div><div class="detail-explanation">' + escHtml(fingerprint ? (fingerprint.targetName + " :: " + fingerprint.baseUrl + " :: signature " + fingerprint.signature + " :: " + fingerprint.authPostureSummary) : "No target fingerprint captured.") + "</div></div>",
    '  <div class="detail-section"><div class="detail-section-title">Target Configuration</div><div class="detail-explanation">' + escHtml(targetConfig ? (targetConfig.name + " :: " + targetConfig.source + " :: " + targetConfig.pathMode + " :: auth header " + (targetConfig.auth.headerName || "none") + " :: " + Object.entries(targetConfig.resolvedEndpoints || {}).map(([key, value]) => key + "=" + value).join(" | ")) : "No target configuration snapshot captured.") + "</div></div>",
    '  <div class="detail-section"><div class="detail-section-title">Threat Intent</div><div class="detail-explanation">' + escHtml(run.threatProfile?.intent || run.purpose) + "</div></div>",
    '  <div class="detail-section"><div class="detail-section-title">Why This Test Exists</div><div class="detail-explanation">' + escHtml(run.threatProfile?.whyThisExists || run.purpose) + "</div></div>",
    '  <div class="detail-section"><div class="detail-section-title">Expected Safe Behavior</div><div class="detail-explanation">' + escHtml(run.threatProfile?.expectedSafeBehavior || run.expectedBehavior) + "</div></div>",
    '  <div class="detail-section"><div class="detail-section-title">Failure Criteria</div><div class="detail-explanation">' + escHtml((run.threatProfile?.failureCriteria || []).join("; ") || "No explicit failure criteria recorded.") + "</div></div>",
    '  <div class="detail-section"><div class="detail-section-title">Exact Request Sent</div><pre class="raw-response">' + escHtml(JSON.stringify(request, null, 2)) + "</pre></div>",
    '  <div class="detail-section"><div class="detail-section-title">Normalized Response Received</div><pre class="raw-response">' + escHtml(typeof response.normalizedData === "string" ? response.normalizedData : JSON.stringify(response.normalizedData != null ? response.normalizedData : response.normalizedText || response.rawText || "", null, 2)) + "</pre></div>",
    '  <div class="detail-section"><div class="detail-section-title">Evaluator Rules Triggered</div><div class="detail-suggestions">' + (rules.length ? rules.map((rule) => '<div class="suggestion-item">' + escHtml((rule.outcome || "").toUpperCase() + " :: " + rule.id + "@" + (rule.version || "1.0.0") + " :: " + (rule.family || "general") + " :: " + (rule.conditionSummary || rule.message) + (rule.matchedPattern ? " :: matched " + rule.matchedPattern : "")) + "</div>").join("") : '<div class="suggestion-item">No evaluator rules recorded.</div>') + "</div></div>",
    '  <div class="detail-section"><div class="detail-section-title">Evidence Extracted</div><div class="detail-suggestions">' + (evidence.length ? evidence.map((item) => '<div class="suggestion-item">' + escHtml(item.label + ": " + item.value) + "</div>").join("") : '<div class="suggestion-item">No evidence extracted.</div>') + "</div></div>",
    '  <div class="detail-section"><div class="detail-section-title">Remediation Guidance</div><div class="detail-suggestions">' + (run.remediationBlock ? [
      '<div class="suggestion-item">Change: ' + escHtml(run.remediationBlock.whatToChange) + '</div>',
      '<div class="suggestion-item">Why: ' + escHtml(run.remediationBlock.whyItMatters) + '</div>',
      '<div class="suggestion-item">Attacker Benefit If Unfixed: ' + escHtml(run.remediationBlock.attackerBenefitIfUnfixed) + '</div>',
      '<div class="suggestion-item">Retest: ' + escHtml(run.remediationBlock.retestSuggestion) + '</div>',
    ].join("") : (remediation.length ? remediation.map((item) => '<div class="suggestion-item">' + escHtml(item) + "</div>").join("") : '<div class="suggestion-item">No remediation guidance recorded.</div>')) + "</div></div>",
    '  <div class="detail-section"><div class="detail-section-title">Suppression / Workflow</div><div class="detail-explanation">' + escHtml(run.priorRunComparison && run.priorRunComparison.verdict === "not_comparable" ? "Run marked not directly comparable to prior fingerprint." : "Workflow metadata is tracked at the finding level.") + "</div></div>",
    '  <div class="detail-section"><div class="detail-section-title">Prior Run Comparison</div><div class="detail-explanation">' + escHtml(comparison ? comparison.summary : "No prior run available for comparison.") + "</div></div>",
    '  <div class="detail-section"><div class="detail-section-title">Run Evidence Timeline</div>' + renderTimeline(run.transparency && run.transparency.timeline) + "</div>",
    "</div>",
  ].join("");
}

function renderTests() {
  const list = document.getElementById("test-list");
  const count = document.getElementById("test-count");
  count.textContent = registryTests.length + " tests";

  const testsByCategory = {};
  registryTests.forEach((test) => {
    if (!testsByCategory[test.category]) testsByCategory[test.category] = [];
    testsByCategory[test.category].push(test);
  });

  const suitesByCategory = {};
  (assessment && assessment.suites ? assessment.suites : []).forEach((suite) => { suitesByCategory[suite.category] = suite; });

  const html = Object.keys(testsByCategory)
    .sort((a, b) => getCategoryMeta(a).priority - getCategoryMeta(b).priority)
    .map((category) => {
      const meta = getCategoryMeta(category);
      const suite = suitesByCategory[category];
      const header = [
        '<div class="category-header" style="background:' + meta.color + '12;border-left:3px solid ' + meta.color + ';">',
        '  <div class="category-header-left">',
        '    <span class="category-icon">' + meta.icon + "</span>",
        '    <div class="category-info"><span class="category-name">' + escHtml(meta.name) + '</span><span class="category-desc">' + escHtml(meta.desc) + "</span></div>",
        "  </div>",
        '  <div class="category-summary">' + (suite ? stateBadge(suite.state) + '<span class="suite-meta-inline">' + escHtml("last run " + formatDateTime(suite.lastRunAt) + " | " + formatDuration(suite.durationMs)) + "</span>" : '<span class="suite-meta-inline">No active target data</span>') + "</div>",
        "</div>",
      ].join("");

      const rows = testsByCategory[category].map((test) => {
        const aggregate = aggregateBaseState(test);
        const runMeta = [
          "Last run " + formatDateTime(aggregate.lastRunAt),
          "Duration " + formatDuration(aggregate.durationMs),
          "Attempts " + (aggregate.attemptCount || 0),
        ].join(" | ");

        const detail = aggregate.runs.length
          ? '<div class="result-panel" id="detail-' + test.id + '">' + aggregate.runs.map(renderRunArtifact).join("") + "</div>"
          : "";

        return [
          '<div class="test-row" id="row-' + test.id + '">',
          '  <div class="test-info">',
          '    <div class="test-name">' + severityBadge(test.severity) + " " + escHtml(test.name) + "</div>",
          '    <div class="test-meta">' + escHtml(test.purpose) + "</div>",
          '    <div class="test-meta execution-meta">' + escHtml(runMeta) + "</div>",
          "  </div>",
          '  <div class="test-actions">',
          "    " + stateBadge(aggregate.state),
          "    " + (aggregate.result ? resultBadge(aggregate.result) : ""),
          '    <button class="btn btn-sm btn-primary" id="btn-' + test.id + '" onclick="runTest(\'' + test.id + '\')">Run</button>',
          "    " + (aggregate.runs.length ? '<button class="btn btn-sm" onclick="toggleDetail(\'' + test.id + '\')">Detail</button>' : ""),
          "  </div>",
          "</div>",
          detail,
        ].join("");
      }).join("");

      return header + rows;
    }).join("");

  list.innerHTML = html;
}

function toggleDetail(id) {
  const el = document.getElementById("detail-" + id);
  if (el) el.classList.toggle("open");
}

function applyLocalSuiteState(category, state) {
  registryTests.filter((test) => category === "all" || test.category === category).forEach((test) => {
    localStateOverrides[test.id] = {
      state,
      result: null,
      durationMs: null,
      lastRunAt: new Date().toISOString(),
      attemptCount: (test.execution && test.execution.attemptCount) || 0,
      runs: [],
    };
  });
}

async function loadTargets() {
  targetData = await api("/targets");
  activeTargetKey = targetData.defaultTarget || "";
  const select = document.getElementById("target-select");
  if (!select) return;
  const html = Object.entries(targetData.targets || {}).map(([key, target]) => {
    const label = target.name + " (" + target.baseUrl + ")" + (target.enabled === false ? " [disabled]" : "");
    return '<option value="' + escHtml(key) + '"' + (key === activeTargetKey ? " selected" : "") + ">" + escHtml(label) + "</option>";
  }).join("");
  select.innerHTML = html;
  updateRuntimeTargetNote();
}

async function loadRegistry() {
  const data = await api("/tests");
  registryTests = data.tests || [];
}

async function loadServerMeta() {
  try {
    serverMeta = await api("/meta");
  } catch (err) {
    if (err && err.status === 404) {
      serverMeta = null;
      const metaEl = document.getElementById("server-meta");
      if (metaEl) metaEl.textContent = "Server metadata unavailable on this running process.";
      return;
    }
    throw err;
  }
}

async function loadAssessment() {
  try {
    assessment = await api("/dashboard");
  } catch (err) {
    if (err && err.status === 404) {
      const [summaryData, latestData] = await Promise.all([
        api("/reports/summary"),
        api("/reports/latest"),
      ]);
      assessment = buildLegacyAssessment(summaryData || {}, latestData || {});
      return;
    }
    throw err;
  }
}

async function loadDashboard() {
  await loadTargets();
  await Promise.all([loadRegistry(), loadAssessment(), loadServerMeta()]);
  updateStats(assessment ? assessment.summary : { total: 0, pass: 0, fail: 0, warn: 0 });
  renderScreenshotSummary();
  renderOperatorSummary();
  renderRiskSummary();
  renderGateSummary();
  renderRunComparison();
  renderFindings();
  renderCategorySummary();
  renderTests();
}

function loadSummary() {
  return loadDashboard();
}

async function runTest(id) {
  const btn = document.getElementById("btn-" + id);
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';
  }
  localStateOverrides[id] = { state: "running", result: null, durationMs: null, lastRunAt: new Date().toISOString(), attemptCount: 0, runs: [] };
  renderTests();
  toast("Running " + id + "...");
  try {
    await api("/tests/" + id + "/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(runtimeTargetOverride ? { targetConfig: runtimeTargetOverride } : { targetId: activeTargetKey }),
    });
    delete localStateOverrides[id];
    await loadDashboard();
    toast("Execution complete for " + id + ". Reports updated.");
  } catch (err) {
    localStateOverrides[id] = { state: "error", result: null, durationMs: null, lastRunAt: new Date().toISOString(), attemptCount: 0, runs: [] };
    renderTests();
    toast("Error: " + err.message, "error");
  }
  if (btn) {
    btn.disabled = false;
    btn.textContent = "Run";
  }
}

async function runSuite(category) {
  const btn = document.getElementById("run-all-btn");
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Running...';
  }
  applyLocalSuiteState(category, "running");
  renderTests();
  toast("Running suite: " + category + "...");
  try {
    await api("/suite/" + category, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(runtimeTargetOverride ? { targetConfig: runtimeTargetOverride } : { targetId: activeTargetKey }),
    });
    Object.keys(localStateOverrides).forEach((key) => delete localStateOverrides[key]);
    await loadDashboard();
    toast("Suite complete. Reports updated.");
  } catch (err) {
    toast("Error: " + err.message, "error");
  }
  if (btn) {
    btn.disabled = false;
    btn.textContent = "Run All Tests";
  }
}

async function switchTarget(key) {
  if (!key) return;
  try {
    await api("/targets/active", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key }),
    });
    activeTargetKey = key;
    clearTemporaryTarget();
    await loadDashboard();
    toast("Target switched to " + key);
  } catch (err) {
    toast("Error: " + err.message, "error");
  }
}

async function probeTarget() {
  const key = activeTargetKey;
  if (!key) return;
  const btn = document.getElementById("probe-btn");
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';
  }
  toast("Probing " + key + "...");
  try {
    const data = runtimeTargetOverride
      ? await api("/targets/probe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: runtimeTargetOverride }),
      })
      : await api("/targets/" + encodeURIComponent(key) + "/probe", { method: "POST" });
    renderProbeResults(data);
    toast("Probe complete");
  } catch (err) {
    toast("Error: " + err.message, "error");
  }
  if (btn) {
    btn.disabled = false;
    btn.innerHTML = "&#8943;";
  }
}

function changeFindingSort(value) {
  findingSort = value || "severity";
  renderFindings();
}

// --- Report viewer ---
async function viewReport(name) {
  try {
    const res = await fetch('/reports/latest/' + name + '.md');
    if (!res.ok) throw new Error('Report not found. Run a test suite first.');
    const text = await res.text();
    document.getElementById('report-modal-title').textContent = name.replace(/_/g, ' ');
    document.getElementById('report-modal-content').textContent = text;
    document.getElementById('report-modal').style.display = 'flex';
  } catch (err) {
    toast('Error: ' + err.message, 'error');
  }
}

function copyReport() {
  const content = document.getElementById('report-modal-content').textContent;
  navigator.clipboard.writeText(content).then(function() {
    toast('Report copied to clipboard');
  }).catch(function() {
    toast('Copy failed — select text manually', 'error');
  });
}

function closeReport() {
  document.getElementById('report-modal').style.display = 'none';
}

function toggleSection(id) {
  var el = document.getElementById(id);
  if (el) el.classList.toggle('open');
}

window.runTest = runTest;
window.runSuite = runSuite;
window.switchTarget = switchTarget;
window.probeTarget = probeTarget;
window.openTargetEditor = openTargetEditor;
window.closeTargetEditor = closeTargetEditor;
window.saveTargetConfig = saveTargetConfig;
window.probeDraftTarget = probeDraftTarget;
window.useTemporaryTarget = useTemporaryTarget;
window.clearTemporaryTarget = clearTemporaryTarget;
window.toggleDetail = toggleDetail;
window.changeFindingSort = changeFindingSort;
window.loadSummary = loadSummary;
window.viewReport = viewReport;
window.copyReport = copyReport;
window.closeReport = closeReport;
window.toggleSection = toggleSection;

document.addEventListener("DOMContentLoaded", () => {
  loadDashboard().catch((err) => toast("Dashboard load error: " + err.message, "error"));
});
