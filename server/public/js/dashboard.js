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
      html += '    <div class="test-name">' + t.name + '</div>';
      html += '    <div class="test-meta">' + t.purpose + '</div>';
      html += '  </div>';
      html += '  <div class="test-actions">';
      html += '    ' + badge + ' ' + duration;
      html += '    <button class="btn btn-sm btn-primary" id="btn-' + t.id + '" onclick="runTest(\'' + t.id + '\')">Run</button>';
      html += '    ' + (r ? '<button class="btn btn-sm" onclick="toggleDetail(\'' + t.id + '\')">Detail</button>' : '');
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
  let html = '';
  html += '<div class="result-field"><div class="result-label">Observed</div><div class="result-value">' + escHtml(r.observedBehavior) + '</div></div>';

  if (r.parsedFields) {
    html += '<div class="result-field"><div class="result-label">Parsed Fields</div>';
    html += '<table class="fields-table">';
    const p = r.parsedFields;
    html += row('HTTP Status', p.httpStatus);
    html += row('Output', p.hasOutput);
    html += row('Receipt ID', p.receiptId || '-');
    if (p.provider) html += row('Provider', p.provider);
    if (p.model) html += row('Model', p.model);
    if (p.tier) html += row('Tier', p.tier);
    if (p.gatewayBlock) html += row('Gateway Block', 'true');
    if (p.gatewayReason) html += row('Gateway Reason', p.gatewayReason);
    html += '</table></div>';
  }

  if (r.suggestedImprovements && r.suggestedImprovements.length) {
    html += '<div class="result-field"><div class="result-label">Suggestions</div><div class="result-value">';
    r.suggestedImprovements.forEach(s => { html += '- ' + escHtml(s) + '<br>'; });
    html += '</div></div>';
  }

  html += '<div class="result-field"><div class="result-label">Raw Response</div>';
  html += '<pre class="raw-response">' + escHtml(r.rawResponseSnippet || '(empty)') + '</pre></div>';
  return html;
}

function row(label, value) {
  return '<tr><th>' + label + '</th><td>' + escHtml(String(value)) + '</td></tr>';
}

function escHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
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
  // Also load full reports for detail panels
  const full = await api('/reports/latest');
  if (full.reports) {
    full.reports.forEach(r => { results[r.testId] = r; });
  }
  renderTests();
}

async function runTest(id) {
  const btn = document.getElementById('btn-' + id);
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>'; }

  toast('Running ' + id + '...');
  try {
    const data = await api('/tests/' + id + '/run', { method: 'POST' });
    if (data.result) {
      results[data.result.testId] = data.result;
      toast(data.result.testName + ': ' + data.result.result, data.result.result === 'FAIL' ? 'error' : 'info');
    }
  } catch (err) {
    toast('Error: ' + err.message, 'error');
  }

  if (btn) { btn.disabled = false; btn.textContent = 'Run'; }
  await loadSummary();
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

// Init
loadTests();
loadSummary();
