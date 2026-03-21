// Atlantis Portal JS

let player = null;
let zones = [];
let zoneStatus = [];

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

function escHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

// ============================================================
// Player HUD
// ============================================================

function updateHUD(data) {
  player = data.player;
  zoneStatus = data.zones || [];

  document.getElementById('hud-level').textContent = player.level;
  document.getElementById('hud-name').textContent = player.name;
  document.getElementById('hud-level-text').textContent = 'Level ' + player.level;
  document.getElementById('hud-xp').textContent = player.xp;
  document.getElementById('hud-defeated').textContent = player.defeatedCreatures.length;

  const completedCount = player.completedZones.length;
  document.getElementById('hud-zones').textContent = completedCount + '/5';

  // XP bar
  const xpInLevel = player.xp % 100;
  const pct = Math.min(xpInLevel, 100);
  document.getElementById('xp-fill').style.width = pct + '%';
}

// ============================================================
// Zones
// ============================================================

function renderZones() {
  const grid = document.getElementById('zone-grid');
  let html = '';

  zoneStatus.forEach(z => {
    const cls = z.completed ? 'completed' : (z.unlocked ? '' : 'locked');
    html += '<div class="zone-card ' + cls + '" onclick="' + (z.unlocked ? "openZone('" + z.id + "')" : '') + '">';
    html += '  <div class="zone-name">' + escHtml(z.name) + '</div>';
    html += '  <div class="zone-level">Level ' + z.requiredLevel + '+</div>';
    html += '  <div class="zone-desc" id="zone-desc-' + z.id + '"></div>';
    html += '  <div class="zone-creatures" id="zone-creatures-' + z.id + '"></div>';
    html += '</div>';
  });

  grid.innerHTML = html;

  // Load zone details
  zoneStatus.forEach(z => loadZoneDetail(z.id));
}

async function loadZoneDetail(zoneId) {
  const data = await api('/realm/zone/' + zoneId);
  if (!data.zone) return;

  const descEl = document.getElementById('zone-desc-' + zoneId);
  if (descEl) descEl.textContent = data.zone.description;

  const creaturesEl = document.getElementById('zone-creatures-' + zoneId);
  if (creaturesEl && data.creatures) {
    creaturesEl.innerHTML = data.creatures.map(c =>
      '<span class="creature-tag' + (c.defeated ? ' defeated' : '') + '">' + escHtml(c.name) + '</span>'
    ).join('');
  }
}

async function openZone(zoneId) {
  const data = await api('/realm/zone/' + zoneId);
  if (!data.zone || !data.unlocked) return;

  const zone = data.zone;
  const creatures = data.creatures || [];

  let html = '<div class="modal-title">' + escHtml(zone.name) + '</div>';
  html += '<div class="modal-narrative">' + escHtml(zone.narrative) + '</div>';

  // Show creatures
  const undefeated = creatures.filter(c => !c.defeated);
  const defeated = creatures.filter(c => c.defeated);

  if (defeated.length > 0) {
    html += '<div style="margin-bottom:1rem;font-size:0.85rem;color:var(--pass);">';
    defeated.forEach(c => { html += 'Defeated: ' + escHtml(c.name) + '<br>'; });
    html += '</div>';
  }

  if (undefeated.length > 0) {
    const c = undefeated[0];
    html += renderEncounter(c);
  } else {
    html += '<div style="text-align:center;padding:1rem;color:var(--pass);font-weight:600;">Zone Cleared!</div>';
    html += '<button class="btn" onclick="closeModal()">Close</button>';
  }

  document.getElementById('modal-body').innerHTML = html;
  document.getElementById('modal').classList.add('open');
}

function renderEncounter(creature) {
  let html = '';
  html += '<div style="font-size:1.1rem;font-weight:700;color:var(--warn);margin-bottom:0.5rem;">' + escHtml(creature.name) + '</div>';
  html += '<div style="font-size:0.8rem;color:var(--text-dim);margin-bottom:1rem;">' + escHtml(creature.description) + '</div>';
  html += '<div class="modal-narrative">' + escHtml(creature.encounter) + '</div>';
  html += '<div class="modal-hint">Hint: ' + escHtml(creature.hint) + '</div>';

  // Quiz
  html += '<div class="quiz-question">' + escHtml(creature.quiz.question) + '</div>';
  html += '<div class="quiz-choices" id="quiz-choices">';
  creature.quiz.choices.forEach((choice, i) => {
    html += '<div class="quiz-choice" data-creature="' + escHtml(creature.name) + '" data-index="' + i + '" onclick="submitQuiz(this, \'' + escHtml(creature.name) + '\', ' + i + ')">';
    html += escHtml(choice);
    html += '</div>';
  });
  html += '</div>';
  html += '<div id="quiz-result"></div>';
  html += '<div style="margin-top:1rem;display:flex;gap:0.5rem;">';
  html += '  <button class="btn" onclick="closeModal()">Close</button>';
  html += '</div>';
  return html;
}

async function submitQuiz(el, creatureName, answerIndex) {
  // Disable all choices
  document.querySelectorAll('.quiz-choice').forEach(c => c.classList.add('disabled'));
  el.classList.add('selected');

  const data = await api('/realm/quiz', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ creatureName, answerIndex }),
  });

  // Highlight correct/incorrect
  document.querySelectorAll('.quiz-choice').forEach((c, i) => {
    if (data.correct && i === answerIndex) c.classList.add('correct');
    else if (!data.correct && i === answerIndex) c.classList.add('incorrect');
  });

  const resultEl = document.getElementById('quiz-result');
  if (data.correct) {
    let msg = 'Correct! ' + escHtml(data.explanation);
    if (data.xpGain > 0) msg = '+' + data.xpGain + ' XP! ' + msg;
    if (data.alreadyDefeated) msg = 'Already defeated. ' + escHtml(data.explanation);
    resultEl.innerHTML = '<div class="quiz-result correct-result">' + msg + '</div>';
    toast(creatureName + ' defeated! +' + (data.xpGain || 0) + ' XP');
  } else {
    resultEl.innerHTML = '<div class="quiz-result incorrect-result">Incorrect. ' + escHtml(data.explanation) + '</div>';
  }

  // Update HUD
  if (data.player) updateHUD({ player: data.player, zones: zoneStatus });
  await refreshStatus();
}

function closeModal() {
  document.getElementById('modal').classList.remove('open');
}

// Close modal on overlay click
document.getElementById('modal').addEventListener('click', function (e) {
  if (e.target === this) closeModal();
});

// ============================================================
// Curriculum
// ============================================================

async function loadCurriculum() {
  const data = await api('/learn/modules');
  const list = document.getElementById('module-list');

  let html = '';
  (data.modules || []).forEach(m => {
    html += '<div class="module-card" onclick="openModule(\'' + m.id + '\')">';
    html += '  <div class="module-title">' + m.order + '. ' + escHtml(m.title) + '</div>';
    html += '  <div class="module-concept">' + escHtml(m.concept) + '</div>';
    html += '  <div class="module-objectives">';
    m.objectives.forEach(o => { html += '- ' + escHtml(o) + '<br>'; });
    html += '  </div>';
    html += '</div>';
  });

  list.innerHTML = html;
}

async function openModule(id) {
  const data = await api('/learn/' + id);
  if (!data.module) return;
  const m = data.module;

  const el = document.getElementById('module-content');
  document.getElementById('module-list').style.display = 'none';
  el.style.display = 'block';

  let html = '<button class="btn btn-sm" onclick="backToModules()" style="margin-bottom:1rem;">Back to modules</button>';
  html += '<div class="section-title" style="margin-bottom:0.5rem;">' + escHtml(m.title) + '</div>';
  html += '<div class="content-panel" style="margin-bottom:1.5rem;">' + escHtml(m.content) + '</div>';

  if (m.quiz && m.quiz.length > 0) {
    html += '<div class="card"><div class="card-title" style="margin-bottom:1rem;">Quiz</div>';
    m.quiz.forEach((q, qi) => {
      html += '<div class="quiz-question" style="margin-top:1rem;">' + escHtml(q.question) + '</div>';
      html += '<div class="quiz-choices" id="curriculum-quiz-' + qi + '">';
      q.choices.forEach((choice, ci) => {
        html += '<div class="quiz-choice" onclick="submitCurriculumQuiz(\'' + m.id + '\', ' + qi + ', ' + ci + ', this)">' + escHtml(choice) + '</div>';
      });
      html += '</div>';
      html += '<div id="curriculum-result-' + qi + '"></div>';
    });
    html += '</div>';
  }

  el.innerHTML = html;
}

async function submitCurriculumQuiz(moduleId, questionIndex, answerIndex, el) {
  const container = document.getElementById('curriculum-quiz-' + questionIndex);
  container.querySelectorAll('.quiz-choice').forEach(c => c.classList.add('disabled'));
  el.classList.add('selected');

  const data = await api('/learn/' + moduleId + '/quiz', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ questionIndex, answerIndex }),
  });

  container.querySelectorAll('.quiz-choice').forEach((c, i) => {
    if (data.correct && i === answerIndex) c.classList.add('correct');
    else if (!data.correct && i === answerIndex) c.classList.add('incorrect');
  });

  const resultEl = document.getElementById('curriculum-result-' + questionIndex);
  if (data.correct) {
    resultEl.innerHTML = '<div class="quiz-result correct-result">Correct! +' + data.xpGain + ' XP. ' + escHtml(data.explanation) + '</div>';
    toast('+' + data.xpGain + ' XP');
  } else {
    resultEl.innerHTML = '<div class="quiz-result incorrect-result">Incorrect. ' + escHtml(data.explanation) + '</div>';
  }

  if (data.player) updateHUD({ player: data.player, zones: zoneStatus });
}

function backToModules() {
  document.getElementById('module-list').style.display = 'block';
  document.getElementById('module-content').style.display = 'none';
}

// ============================================================
// Tabs
// ============================================================

function switchTab(tab) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.getElementById('tab-realm').style.display = tab === 'realm' ? 'block' : 'none';
  document.getElementById('tab-curriculum').style.display = tab === 'curriculum' ? 'block' : 'none';
  document.querySelectorAll('.tab')[tab === 'realm' ? 0 : 1].classList.add('active');

  if (tab === 'curriculum') loadCurriculum();
}

// ============================================================
// Init
// ============================================================

async function refreshStatus() {
  const data = await api('/realm/status');
  updateHUD(data);
  zoneStatus = data.zones || [];
  renderZones();
}

refreshStatus();
