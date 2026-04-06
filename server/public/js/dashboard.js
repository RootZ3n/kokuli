// Krakzen Dashboard JS — Deep-Sea Command Center

let tests = [];
let results = {};
let lastUpdated = null;

// ============================================================
// Category metadata
// ============================================================

const CATEGORIES = {
  'child-safety': { name: 'Child Safety', icon: '\u{1F6E1}\uFE0F', desc: 'Magister child protection', color: '#ff0055', priority: 1 },
  'security':     { name: 'Security', icon: '\u{1F512}', desc: 'Prompt injection & refusal', color: '#ff2d2d', priority: 2 },
  'recon':        { name: 'Reconnaissance', icon: '\u{1F50D}', desc: 'Endpoint discovery & info leaks', color: '#ffaa00', priority: 3 },
  'auth':         { name: 'Authentication', icon: '\u{1F511}', desc: 'Access control verification', color: '#ffaa00', priority: 4 },
  'exfil':        { name: 'Data Exfiltration', icon: '\u{1F480}', desc: 'Data leakage & extraction', color: '#ff2d2d', priority: 5 },
  'multi-turn':   { name: 'Multi-Turn Attacks', icon: '\u{1F517}', desc: 'Multi-step attack chains', color: '#ff6600', priority: 6 },
  'fuzzing':      { name: 'Fuzzing', icon: '\u26A1', desc: 'Automated input mutation', color: '#00e5ff', priority: 7 },
  'reliability':  { name: 'Reliability', icon: '\u2699\uFE0F', desc: 'Input handling & sanitization', color: '#00e5ff', priority: 8 },
  'architecture': { name: 'Architecture', icon: '\u{1F3D7}\uFE0F', desc: 'Receipt & structure validation', color: '#00e5ff', priority: 9 },
  'baseline':     { name: 'Baseline', icon: '\u{1F4CB}', desc: 'Locked baseline gate', color: '#8b5cf6', priority: 10 },
};

const SEVERITY_COLORS = {
  critical: { bg: '#ff0033', text: '#fff', pulse: true },
  high:     { bg: '#ff2d2d', text: '#fff', pulse: false },
  medium:   { bg: '#ffaa00', text: '#1a1a2e', pulse: false },
  low:      { bg: '#00e5ff', text: '#1a1a2e', pulse: false },
};

// ============================================================
// Utility
// ============================================================

async function api(path, opts) {
  const res = await fetch('/api' + path, opts);
  return res.json();
}

function toast(msg, type) {
  const el = document.getElementById('toast');
  const icon = type === 'error' ? '\u2717 ' : '\u2713 ';
  el.innerHTML = '<span class="toast-icon">' + icon + '</span>' + escHtml(msg);
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

function getCategoryMeta(cat) {
  return CATEGORIES[cat] || { name: cat, icon: '\u{1F4C1}', desc: '', color: '#666', priority: 99 };
}

function updateTimestamp() {
  lastUpdated = new Date();
  const el = document.getElementById('last-updated');
  if (el) {
    el.textContent = 'Last updated: ' + lastUpdated.toLocaleTimeString();
  }
}

// ============================================================
// Animated number counting
// ============================================================

function animateValue(el, start, end, duration) {
  if (start === end) { el.textContent = end; return; }
  const startTime = performance.now();
  function step(now) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    // Ease-out quad
    const eased = 1 - (1 - progress) * (1 - progress);
    const current = Math.round(start + (end - start) * eased);
    el.textContent = current;
    if (progress < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

// ============================================================
// Severity badge
// ============================================================

function severityBadge(severity) {
  if (!severity) return '';
  const s = severity.toLowerCase();
  const cfg = SEVERITY_COLORS[s];
  if (!cfg) return '<span class="severity-badge" style="background:#555;color:#fff;">' + escHtml(severity) + '</span>';
  const pulseClass = cfg.pulse ? ' severity-pulse' : '';
  return '<span class="severity-badge' + pulseClass + '" style="background:' + cfg.bg + ';color:' + cfg.text + ';">' + escHtml(s) + '</span>';
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

  // Sort categories by priority
  const sortedCategories = Object.keys(byCategory).sort((a, b) => {
    return getCategoryMeta(a).priority - getCategoryMeta(b).priority;
  });

  let html = '';
  for (const cat of sortedCategories) {
    const catTests = byCategory[cat];
    const meta = getCategoryMeta(cat);

    // Category mini-summary
    const catResults = catTests.filter(t => results[t.id]);
    const catPass = catResults.filter(t => results[t.id].result === 'PASS').length;
    const catTotal = catResults.length;
    const summaryText = catTotal > 0 ? catPass + '/' + catTotal + ' passed' : 'no results';

    html += '<div class="category-header" style="background:' + meta.color + '12;border-left:3px solid ' + meta.color + ';">';
    html += '  <div class="category-header-left">';
    html += '    <span class="category-icon">' + meta.icon + '</span>';
    html += '    <div class="category-info">';
    html += '      <span class="category-name">' + escHtml(meta.name) + '</span>';
    html += '      <span class="category-desc">' + escHtml(meta.desc) + '</span>';
    html += '    </div>';
    html += '  </div>';
    html += '  <div class="category-summary" style="color:' + meta.color + ';">' + summaryText + '</div>';
    html += '</div>';

    catTests.forEach(t => {
      const r = results[t.id];
      const badge = r ? '<span class="' + badgeClass(r.result) + '">' + r.result + '</span>' : '';
      const duration = r ? '<span style="font-size:0.75rem;color:var(--text-dim);">' + r.durationMs + 'ms</span>' : '';
      const sevBadge = severityBadge(t.severity);

      html += '<div class="test-row" id="row-' + t.id + '">';
      html += '  <div class="test-info">';
      html += '    <div class="test-name">' + sevBadge + ' ' + escHtml(t.name) + '</div>';
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
  renderCategorySummary();
}

function renderResultDetail(r) {
  const p = r.parsedFields || {};
  const h = p.receiptHealth || {};
  let html = '';

  // Color-coded header bar
  const headerColor = r.result === 'PASS' ? 'linear-gradient(90deg, #00c853, #00e676)'
    : r.result === 'FAIL' ? 'linear-gradient(90deg, #ff1744, #ff5252)'
    : 'linear-gradient(90deg, #ffab00, #ffd740)';

  html += '<div class="detail-color-bar" style="background:' + headerColor + ';"></div>';

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
    html += '  <div class="detail-suggestions">';
    r.suggestedImprovements.forEach(s => { html += '<div class="suggestion-item">\u26A0 ' + escHtml(s) + '</div>'; });
    html += '  </div>';
    html += '</div>';
  }

  // Raw Response (expandable) with copy button
  html += '<div class="detail-section">';
  html += '  <div class="detail-section-title raw-toggle" style="cursor:pointer;" onclick="this.nextElementSibling.classList.toggle(\'open\')">';
  html += '    Raw Response (click to expand)';
  html += '  </div>';
  html += '  <div class="raw-response-wrapper raw-collapsed">';
  html += '    <button class="btn btn-sm copy-btn" onclick="copyRaw(this)">Copy</button>';
  html += '    <pre class="raw-response">' + escHtml(r.rawResponseSnippet || '(empty)') + '</pre>';
  html += '  </div>';
  html += '</div>';

  return html;
}

function detailCell(label, value) {
  return '<div class="detail-cell">'
    + '<div class="detail-cell-label">' + label + '</div>'
    + '<div class="detail-cell-value">' + escHtml(String(value)) + '</div>'
    + '</div>';
}

function toggleDetail(id) {
  const el = document.getElementById('detail-' + id);
  if (el) el.classList.toggle('open');
}

function copyRaw(btn) {
  const pre = btn.nextElementSibling;
  if (!pre) return;
  navigator.clipboard.writeText(pre.textContent).then(() => {
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
  });
}

function updateStats(data) {
  const fields = [
    { id: 'stat-total', key: 'total' },
    { id: 'stat-pass',  key: 'pass' },
    { id: 'stat-fail',  key: 'fail' },
    { id: 'stat-warn',  key: 'warn' },
  ];
  fields.forEach(f => {
    const el = document.getElementById(f.id);
    if (!el) return;
    const prev = parseInt(el.textContent, 10) || 0;
    const next = data[f.key] || 0;
    animateValue(el, prev, next, 500);
  });
  updateTimestamp();
}

// ============================================================
// Category Summary Bar
// ============================================================

function renderCategorySummary() {
  let container = document.getElementById('category-summary');
  if (!container) {
    // Create it after stats if it doesn't exist
    const statsEl = document.querySelector('.stats');
    if (!statsEl) return;
    container = document.createElement('div');
    container.id = 'category-summary';
    container.className = 'category-summary-bar';
    statsEl.parentNode.insertBefore(container, statsEl.nextSibling);
  }

  const byCategory = {};
  tests.forEach(t => {
    if (!byCategory[t.category]) byCategory[t.category] = { pass: 0, fail: 0, warn: 0, total: 0 };
  });

  // Count results per category
  tests.forEach(t => {
    const r = results[t.id];
    if (!r) return;
    const bucket = byCategory[t.category];
    if (!bucket) return;
    bucket.total++;
    if (r.result === 'PASS') bucket.pass++;
    else if (r.result === 'FAIL') bucket.fail++;
    else if (r.result === 'WARN') bucket.warn++;
  });

  // Sort by priority
  const sortedCats = Object.keys(byCategory).sort((a, b) => {
    return getCategoryMeta(a).priority - getCategoryMeta(b).priority;
  });

  let html = '<div class="summary-bar-title">Category Overview</div>';
  html += '<div class="summary-bar-grid">';

  sortedCats.forEach(cat => {
    const meta = getCategoryMeta(cat);
    const b = byCategory[cat];
    if (b.total === 0) {
      html += '<div class="summary-bar-item">';
      html += '  <div class="summary-bar-label">' + meta.icon + ' ' + escHtml(meta.name) + '</div>';
      html += '  <div class="summary-bar-track"><div class="summary-bar-empty">no data</div></div>';
      html += '</div>';
      return;
    }
    const passPct = Math.round((b.pass / b.total) * 100);
    const failPct = Math.round((b.fail / b.total) * 100);
    const warnPct = 100 - passPct - failPct;

    html += '<div class="summary-bar-item">';
    html += '  <div class="summary-bar-label">' + meta.icon + ' ' + escHtml(meta.name) + '</div>';
    html += '  <div class="summary-bar-track">';
    if (b.pass > 0) html += '<div class="summary-bar-fill pass-fill" style="width:' + passPct + '%;"></div>';
    if (b.warn > 0) html += '<div class="summary-bar-fill warn-fill" style="width:' + warnPct + '%;"></div>';
    if (b.fail > 0) html += '<div class="summary-bar-fill fail-fill" style="width:' + failPct + '%;"></div>';
    html += '  </div>';
    html += '  <div class="summary-bar-nums">' + b.pass + 'P / ' + b.fail + 'F / ' + b.warn + 'W</div>';
    html += '</div>';
  });

  html += '</div>';
  container.innerHTML = html;
}

// ============================================================
// Data loading
// ============================================================

async function loadTests() {
  const data = await api('/tests');
  tests = data.tests || [];
  renderTests();
  updateTimestamp();
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
  updateTimestamp();
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
  const label = category === 'all' ? 'All Tests' : getCategoryMeta(category).name;
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Running ' + escHtml(label) + '...';
    btn.classList.add('sonar-pulse');
  }

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

  if (btn) {
    btn.disabled = false;
    btn.textContent = 'Run All Tests';
    btn.classList.remove('sonar-pulse');
  }
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
// Target Management
// ============================================================

let activeTargetKey = '';

async function loadTargets() {
  const data = await api('/targets');
  activeTargetKey = data.defaultTarget || '';
  const select = document.getElementById('target-select');
  if (!select) return;

  let html = '';
  for (const [key, t] of Object.entries(data.targets || {})) {
    const label = t.name + ' (' + t.baseUrl + ')';
    html += '<option value="' + escHtml(key) + '"' + (key === activeTargetKey ? ' selected' : '') + '>' + escHtml(label) + '</option>';
  }
  select.innerHTML = html;
}

async function switchTarget(key) {
  if (!key) return;
  try {
    await api('/targets/active', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key }),
    });
    activeTargetKey = key;
    toast('Target switched to ' + key);
  } catch (err) {
    toast('Error: ' + err.message, 'error');
  }
}

async function probeTarget() {
  const key = activeTargetKey;
  if (!key) return;

  const btn = document.getElementById('probe-btn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>'; }

  toast('Probing ' + key + '...');

  try {
    const data = await api('/targets/' + encodeURIComponent(key) + '/probe', { method: 'POST' });
    const panel = document.getElementById('probe-panel');
    if (!panel) return;

    let html = '<div class="probe-results">';
    html += '<span class="probe-title">' + escHtml(data.target) + ' — ' + data.reachable + '/' + data.total + ' endpoints</span>';

    (data.endpoints || []).forEach(function(ep) {
      let cls = 'probe-down';
      if (ep.status >= 200 && ep.status < 300) cls = 'probe-up';
      else if (ep.status === 404) cls = 'probe-404';
      else if (ep.status > 0) cls = 'probe-up';

      html += '<span class="probe-endpoint ' + cls + '">';
      html += '<span class="probe-status">' + (ep.status || '---') + '</span> ';
      html += escHtml(ep.label);
      html += '</span>';
    });

    html += '<span class="probe-close" onclick="document.getElementById(\'probe-panel\').style.display=\'none\'">&times;</span>';
    html += '</div>';

    panel.innerHTML = html;
    panel.style.display = 'block';
    toast('Probe complete: ' + data.reachable + '/' + data.total + ' reachable');
  } catch (err) {
    toast('Probe error: ' + err.message, 'error');
  }

  if (btn) { btn.disabled = false; btn.textContent = '\u22EF'; }
}

// ============================================================
// Init
// ============================================================

loadTargets();
loadTests();
loadSummary();
