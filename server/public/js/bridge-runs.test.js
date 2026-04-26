const test = require("node:test");
const assert = require("node:assert/strict");
const ui = require("./bridge-runs.js");

test("escHtml escapes html-meaningful characters", () => {
  assert.equal(ui.escHtml("<script>alert(1)</script>"), "&lt;script&gt;alert(1)&lt;/script&gt;");
  assert.equal(ui.escHtml(`a "b" 'c' & <d>`), "a &quot;b&quot; &#39;c&#39; &amp; &lt;d&gt;");
  assert.equal(ui.escHtml(null), "");
  assert.equal(ui.escHtml(undefined), "");
});

test("formatDuration handles ms / s / m units", () => {
  assert.equal(ui.formatDuration(0), "0ms");
  assert.equal(ui.formatDuration(125), "125ms");
  assert.equal(ui.formatDuration(8200), "8.2s");
  assert.equal(ui.formatDuration(137_000), "2m17s");
  assert.equal(ui.formatDuration(null), "—");
  assert.equal(ui.formatDuration(NaN), "—");
});

test("statusClass returns the expected status pill class", () => {
  assert.equal(ui.statusClass("passed"),      "br-status br-status-passed");
  assert.equal(ui.statusClass("failed"),      "br-status br-status-failed");
  assert.equal(ui.statusClass("blocked"),     "br-status br-status-blocked");
  assert.equal(ui.statusClass("error"),       "br-status br-status-error");
  assert.equal(ui.statusClass("timeout"),     "br-status br-status-timeout");
  assert.equal(ui.statusClass("unreachable"), "br-status br-status-unreachable");
  assert.equal(ui.statusClass("queued"),      "br-status br-status-other");
  assert.equal(ui.statusClass(undefined),     "br-status br-status-other");
});

test("modeSuite renders mode + suite or mode + testId or mode alone", () => {
  assert.equal(ui.modeSuite({ mode: "smoke" }), "smoke");
  assert.equal(ui.modeSuite({ mode: "suite", suite: "security" }), "suite / security");
  assert.equal(ui.modeSuite({ mode: "test", testId: "baseline-chat" }), "test / baseline-chat");
  assert.equal(ui.modeSuite(null), "");
});

test("buildQueryString omits unset filters and encodes values", () => {
  assert.equal(ui.buildQueryString({}), "");
  assert.equal(ui.buildQueryString({ caller: "ricky" }), "?caller=ricky");
  assert.equal(
    ui.buildQueryString({ caller: "ricky", status: "passed", since: "1d", limit: 25 }),
    "?caller=ricky&status=passed&since=1d&limit=25"
  );
  assert.equal(ui.buildQueryString({ caller: "a&b" }), "?caller=a%26b");
});

test("renderRows renders an empty-state row when no data", () => {
  const html = ui.renderRows([]);
  assert.match(html, /No bridge runs yet/);
});

test("renderRows renders one tr per row with a runId data attribute", () => {
  const html = ui.renderRows([
    {
      runId: "20260426T120000Z-manual-smoke-aaaaaa",
      caller: "manual",
      target: "mushin-local",
      mode: "smoke",
      status: "passed",
      startedAt: "2026-04-26T12:00:00.000Z",
      finishedAt: "2026-04-26T12:00:01.000Z",
      durationMs: 1500,
      summary: { totalTests: 1, passed: 1, failed: 0, findings: 0, critical: 0, high: 0 },
    },
  ]);
  assert.match(html, /class="br-row" data-run-id="20260426T120000Z-manual-smoke-aaaaaa"/);
  assert.match(html, /br-status-passed/);
  assert.match(html, /1\.5s/);
});

test("renderRows escapes hostile input in fields", () => {
  const html = ui.renderRows([
    {
      runId: "20260426T120000Z-evil-smoke-aaaaaa",
      caller: '<img src=x onerror="alert(1)">',
      target: "mushin-local",
      mode: "smoke",
      status: "passed",
      startedAt: "2026-04-26T12:00:00.000Z",
      finishedAt: "2026-04-26T12:00:01.000Z",
      durationMs: 1,
      summary: { totalTests: 0, passed: 0, failed: 0, findings: 0, critical: 0, high: 0 },
    },
  ]);
  assert.equal(html.includes("<img src=x"), false);
  assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
});

test("renderDetail handles missing run gracefully", () => {
  const html = ui.renderDetail({ row: null });
  assert.match(html, /Run not found/);
});

test("renderDetail surfaces evidence pointers and never includes forbidden field labels", () => {
  const html = ui.renderDetail({
    row: {
      runId: "20260426T120000Z-ricky-smoke-aaaaaa",
      caller: "ricky",
      target: "mushin-local",
      mode: "smoke",
      status: "passed",
      startedAt: "2026-04-26T12:00:00.000Z",
      finishedAt: "2026-04-26T12:00:01.000Z",
      durationMs: 1234,
      summary: { totalTests: 1, passed: 1, failed: 0, findings: 0, critical: 0, high: 0 },
      reportDir: "reports/bridge/2026-04-26/20260426T120000Z-ricky-smoke-aaaaaa",
      reportPath: "reports/bridge/2026-04-26/20260426T120000Z-ricky-smoke-aaaaaa/ASSESSMENT.json",
      latestReportPath: "reports/latest/ASSESSMENT.json",
    },
    files: { bridgeResult: true, assessment: true, summaryMd: true, summaryJson: true, executiveSummaryMd: true },
    bridgeResult: { runId: "x", request: { caller: "ricky", reasonLength: 12 }, archive: { files: [], missingFiles: [] }, exitCode: 0, signal: null, timedOut: false },
    assessmentSummary: { findingsCount: 2, summary: { total: 9, pass: 7, fail: 2, warn: 0 }, verdict: "low" },
  });
  assert.match(html, /reports\/bridge\/2026-04-26\/20260426T120000Z-ricky-smoke-aaaaaa/);
  assert.match(html, /reports\/latest\/ASSESSMENT\.json/);
  assert.match(html, /jq -c/);

  for (const banned of ["stdoutTail", "stderrTail", '"command":', "reason:"]) {
    assert.equal(html.includes(banned), false, `leaked: ${banned}`);
  }
});
