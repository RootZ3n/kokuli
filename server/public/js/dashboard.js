// Krakzen Dashboard JS

let tests = [];
let results = {};

async function api(path, opts) {
  const res = await fetch('/api' + path, opts);
  return res.json();
}

function toast(msg, type) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast toast-' + (type || 'info') + ' show';
  setTimeout(() => el.classList.remove('show'), 3000);
}

function badgeClass(result) {
  return 'badge badge-' + result.toLowerCase();
}

function escHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function check(val) {
  if (val === true) return '<span style="color:var(--pass);">PRESENT</span>';
  if (val === false) return '<span style="color:var(--fail);">MISSING</span>';
  return '<span style="color:var(--text-dim);">N/A</span>';
}

// ============================================================
// Rendering
// ============================================================

function renderTests() {
  const list = document.getElementById('test-list');
  const count = document.getElementById('test-count');
  count.textContent = tests.length + ' tests';

  const byCategory = {};
  tests.forEach(t => {
    if (!byCategory[t.category]) byCategory[t.category] = [];
    byCategory[t.category].push(t);
  });

  let html = '';
  for (const [cat, catTests] of Object.entries(byCategory)) {
    html += '<div style="padding:0.5rem 1rem;color:var(--text-dim);font-size:0.75rem;text-transform:uppercase;letter-spacing:0.05em;background:var(--surface-2);border-bottom:1px solid var(--border);">' + cat + '</div>';
    catTests.forEach(t => {
      const r = results[t.id];
      const badge = r ? '<span class="' + badgeClass(r.result) + '">' + r.result + '</span>' : '';
      const duration = r ? '<span style="font-size:0.75rem;color:var(--text-dim);">' + r.durationMs + 'ms</span>' : '';

      html += '<div class="test-row" id="row-' + t.id + '">';
      html += '  <div class="test-info">';
      html += '    <div class="test-name">' + escHtml(t.name) + '</div>';
      html += '    <div class="test-meta">' + escHtml(t.purpose) + '</div>';
      html += '  </div>';
      html += '  <div class="test-actions">';
      html += '    ' + badge + ' ' + duration;
      html += '    <button class="btn btn-sm btn-primary" id="btn-' + t.id + '" onclick="runTest(\'' + t.id + '\')">Run</button>';
      if (r) html += '    <button class="btn btn-sm" onclick="toggleDetail(\'' + t.id + '\')">Detail</button>';
      html += '  </div>';
      html += '</div>';
      if (r) {
        html += '<div class="result-panel" id="detail-' + t.id + '">';
        html += renderResultDetail(r);
        html += '</div>';
      }
    });
  }

  list.innerHTML = html;
}

function renderResultDetail(r) {
  const p = r.parsedFields || {};
  const h = p.receiptHealth || {};
  let html = '';

  // Header
  html += '<div class="detail-header">';
  html += '  <div class="detail-title">' + escHtml(r.testName) + '</div>';
  html += '  <span class="' + badgeClass(r.result) + '" style="font-size:0.85rem;">' + r.result + '</span>';
  html += '</div>';

  // Core info grid
  html += '<div class="detail-grid">';
  html += detailCell('HTTP Status', p.httpStatus);
  html += detailCell('Blocked', p.gatewayBlock ? 'true' : 'false');
  html += detailCell('Reason', p.gatewayReason || '-');
  html += detailCell('Model', p.model || '-');
  html += detailCell('Provider', p.provider || '-');
  html += detailCell('Receipt ID', p.receiptId ? p.receiptId.slice(0, 12) + '...' : '-');
  html += detailCell('Tier', p.tier || '-');
  html += detailCell('Response Length', r.rawResponseSnippet ? r.rawResponseSnippet.length + ' chars' : '-');
  html += detailCell('Duration', r.durationMs + 'ms');
  html += '</div>';

  // Explanation
  html += '<div class="detail-section">';
  html += '  <div class="detail-section-title">Explanation</div>';
  html += '  <div class="detail-explanation">' + escHtml(r.observedBehavior) + '</div>';
  html += '</div>';

  // Receipt Health
  html += '<div class="detail-section">';
  html += '  <div class="detail-section-title">Receipt Health</div>';
  html += '  <table class="fields-table">';
  html += '    <tr><th>Field</th><th>Status</th></tr>';
  html += '    <tr><td>receipt_id</td><td>' + check(h.receiptId) + '</td></tr>';
  html += '    <tr><td>provider</td><td>' + check(h.provider) + '</td></tr>';
  html += '    <tr><td>model</td><td>' + check(h.model) + '</td></tr>';
  html += '    <tr><td>blocked (when expected)</td><td>' + check(h.blocked) + '</td></tr>';
  html += '    <tr><td>reason (when blocked)</td><td>' + check(h.reason) + '</td></tr>';
  html += '  </table>';
  html += '</div>';

  // Suggestions
  if (r.suggestedImprovements && r.suggestedImprovements.length) {
    html += '<div class="detail-section">';
    html += '  <div class="detail-section-title">Suggestions</div>';
    html += '  <div class="detail-explanation">';
    r.suggestedImprovements.forEach(s => { html += '- ' + escHtml(s) + '<br>'; });
    html += '  </div>';
    html += '</div>';
  }

  // Raw Response (expandable)
  html += '<div class="detail-section">';
  html += '  <div class="detail-section-title" style="cursor:pointer;" onclick="this.nextElementSibling.classList.toggle(\'open\')">Raw Response (click to expand)</div>';
  html += '  <pre class="raw-response raw-collapsed">' + escHtml(r.rawResponseSnippet || '(empty)') + '</pre>';
  html += '</div>';

  return html;
}

function detailCell(label, value) {
  return '<div class="detail-cell"><div class="detail-cell-label">' + label + '</div><div class="detail-cell-value">' + escHtml(String(value)) + '</div></div>';
}

function toggleDetail(id) {
  const el = document.getElementById('detail-' + id);
  if (el) el.classList.toggle('open');
}

function updateStats(data) {
  document.getElementById('stat-total').textContent = data.total || 0;
  document.getElementById('stat-pass').textContent = data.pass || 0;
  document.getElementById('stat-fail').textContent = data.fail || 0;
  document.getElementById('stat-warn').textContent = data.warn || 0;
}

// ============================================================
// Data loading
// ============================================================

async function loadTests() {
  const data = await api('/tests');
  tests = data.tests || [];
  renderTests();
}

async function loadSummary() {
  const data = await api('/reports/summary');
  updateStats(data);
  if (data.results) {
    data.results.forEach(r => { results[r.testId] = r; });
  }
  // Load full reports for detail panels
  const full = await api('/reports/latest');
  if (full.reports) {
    full.reports.forEach(r => { results[r.testId] = r; });
  }
  renderTests();
}

// ============================================================
// Actions
// ============================================================

async function runTest(id) {
  const btn = document.getElementById('btn-' + id);
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>'; }

  toast('Running ' + id + '...');
  try {
    const data = await api('/tests/' + id + '/run', { method: 'POST' });
    if (data.result) {
      results[data.result.testId] = data.result;
      // Update stats immediately
      recomputeStats();
      toast(data.result.testName + ': ' + data.result.result, data.result.result === 'FAIL' ? 'error' : 'info');
    }
  } catch (err) {
    toast('Error: ' + err.message, 'error');
  }

  if (btn) { btn.disabled = false; btn.textContent = 'Run'; }
  renderTests();
}

async function runSuite(category) {
  const btn = document.getElementById('run-all-btn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Running...'; }

  toast('Running suite: ' + category + '...');
  try {
    const data = await api('/suite/' + category, { method: 'POST' });
    if (data.results) {
      data.results.forEach(r => { results[r.testId] = r; });
    }
    if (data.summary) {
      updateStats(data.summary);
      toast('Suite complete: ' + data.summary.pass + ' pass, ' + data.summary.fail + ' fail, ' + data.summary.warn + ' warn');
    }
  } catch (err) {
    toast('Error: ' + err.message, 'error');
  }

  if (btn) { btn.disabled = false; btn.textContent = 'Run All Tests'; }
  renderTests();
}

function recomputeStats() {
  const vals = Object.values(results);
  const pass = vals.filter(r => r.result === 'PASS').length;
  const fail = vals.filter(r => r.result === 'FAIL').length;
  const warn = vals.filter(r => r.result === 'WARN').length;
  updateStats({ total: vals.length, pass, fail, warn });
}

// ============================================================
// Init
// ============================================================

loadTests();
loadSummary();
