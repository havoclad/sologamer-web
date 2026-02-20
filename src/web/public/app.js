/**
 * B-17 Queen of the Skies — Frontend Application
 */

// ─── State ───
let gameState = null;
let allEvents = [];
let selectedEventId = null;
let eventDisplayIndex = 0;
let autoPlayTimer = null;
let currentMapTarget = null;
let currentMapZone = 0;
let currentMapTargetZone = 0;

// ─── DOM refs ───
const $ = id => document.getElementById(id);
const startScreen = $('start-screen');
const gameScreen = $('game-screen');
const btnStart = $('btn-start');
const btnFly = $('btn-fly');
const btnNewMission = $('btn-new-mission');
const btnRestart = $('btn-restart');
const eventLog = $('event-log');
const crewGrid = $('crew-grid');
const aircraftStatus = $('aircraft-status');
const detailContent = $('detail-content');
const combatInfo = $('combat-info');

// ─── Position labels ───
const POS_LABELS = {
  pilot: 'Pilot', copilot: 'Co-Pilot', navigator: 'Navigator', bombardier: 'Bombardier',
  engineer: 'Engineer/Top Turret', radioman: 'Radio Operator',
  ball_turret: 'Ball Turret', left_waist: 'Left Waist', right_waist: 'Right Waist', tail_gunner: 'Tail Gunner',
};

// ─── API helpers ───
async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  return res.json();
}

// ─── Start game ───
btnStart.addEventListener('click', async () => {
  const name = $('bomber-name').value.trim() || 'Memphis Belle';
  const seedVal = $('seed-input').value.trim();
  const seed = seedVal ? parseInt(seedVal, 10) : undefined;

  const data = await api('POST', '/api/game/new', { seed, bomberName: name });
  if (data.ok) {
    gameState = data.state;
    allEvents = [];
    eventDisplayIndex = 0;
    startScreen.classList.remove('active');
    gameScreen.classList.add('active');
    $('plane-name').textContent = gameState.campaign.planeName;
    $('seed-display').textContent = `Seed: ${data.seed}`;
    updateMissionCount();
    renderCrew();
    renderAircraft();
    renderMap(null, 1, 5);
    eventLog.innerHTML = '';
    btnFly.style.display = '';
    btnNewMission.style.display = 'none';
    btnFly.disabled = false;
  }
});

// ─── Fly mission ───
btnFly.addEventListener('click', async () => {
  btnFly.disabled = true;
  eventLog.innerHTML = '';
  allEvents = [];
  eventDisplayIndex = 0;
  selectedEventId = null;
  detailContent.innerHTML = '<p class="placeholder">Click any event to see dice rolls and table lookups.</p>';

  const data = await api('POST', '/api/game/step');
  if (data.ok) {
    gameState = data.state;
    allEvents = data.events;
    // Animate events appearing one by one
    eventDisplayIndex = 0;
    autoPlayEvents();
  }
});

btnNewMission.addEventListener('click', () => {
  btnFly.style.display = '';
  btnNewMission.style.display = 'none';
  btnFly.disabled = false;
  eventLog.innerHTML = '';
  allEvents = [];
  detailContent.innerHTML = '<p class="placeholder">Click any event to see dice rolls and table lookups.</p>';
});

btnRestart.addEventListener('click', () => {
  gameScreen.classList.remove('active');
  startScreen.classList.add('active');
  gameState = null;
  allEvents = [];
  if (autoPlayTimer) clearTimeout(autoPlayTimer);
});

// ─── Auto-play events with delay ───
function autoPlayEvents() {
  if (eventDisplayIndex >= allEvents.length) {
    // Done
    btnFly.style.display = 'none';
    btnNewMission.style.display = '';
    updateMissionCount();
    renderCrewFromState();
    renderAircraftFromState();
    return;
  }

  const evt = allEvents[eventDisplayIndex];
  appendEvent(evt);
  updateMapFromEvent(evt);
  updateCombatFromEvent(evt);

  // Update crew/aircraft from snapshot if present
  if (evt.stateSnapshot) {
    renderCrew(evt.stateSnapshot.crew);
    renderAircraft(evt.stateSnapshot.aircraft);
  }

  eventDisplayIndex++;

  // Variable delay based on event severity
  let delay = 40;
  if (evt.severity === 'critical') delay = 200;
  else if (evt.severity === 'bad') delay = 100;
  else if (evt.category === 'combat') delay = 60;
  else if (evt.phase === 'ZONE') delay = 120;

  autoPlayTimer = setTimeout(autoPlayEvents, delay);
}

// ─── Append event to log ───
function appendEvent(evt) {
  // Zone headers
  if (evt.phase === 'ZONE' || evt.phase === 'SETUP' && evt.message.includes('Mission #')) {
    const header = document.createElement('div');
    header.className = 'log-zone-header';
    header.textContent = evt.message;
    eventLog.appendChild(header);
    eventLog.scrollTop = eventLog.scrollHeight;
    return;
  }

  const el = document.createElement('div');
  el.className = `log-entry sev-${evt.severity} new`;
  if (evt.details && evt.details.length > 0) el.classList.add('has-details');
  el.dataset.eventId = evt.id;

  const zoneStr = evt.zone ? `Z${evt.zone}${evt.direction === 'inbound' ? '←' : '→'}` : '';

  el.innerHTML = `
    <span class="log-phase">${evt.phase}</span>
    ${zoneStr ? `<span class="log-zone">${zoneStr}</span>` : ''}
    <span class="log-msg">${escapeHtml(evt.message)}</span>
  `;

  el.addEventListener('click', () => selectEvent(evt));
  eventLog.appendChild(el);
  eventLog.scrollTop = eventLog.scrollHeight;

  // Remove 'new' animation class after animation completes
  setTimeout(() => el.classList.remove('new'), 800);
}

// ─── Select event (show details) ───
function selectEvent(evt) {
  selectedEventId = evt.id;

  // Highlight in log
  document.querySelectorAll('.log-entry.selected').forEach(el => el.classList.remove('selected'));
  const el = document.querySelector(`.log-entry[data-event-id="${evt.id}"]`);
  if (el) el.classList.add('selected');

  // Show details
  if (!evt.details || evt.details.length === 0) {
    detailContent.innerHTML = `
      <div style="margin-bottom:8px; color:var(--text-bright);">${escapeHtml(evt.message)}</div>
      <p class="placeholder">No table lookups for this event.</p>
    `;
    return;
  }

  let html = `<div style="margin-bottom:10px; color:var(--text-bright); font-weight:bold;">${escapeHtml(evt.message)}</div>`;

  for (const d of evt.details) {
    html += `<div class="detail-roll">`;
    html += `<span class="detail-table">${d.table || '—'}</span>`;
    html += `<span class="detail-type">${d.rollType || ''}</span>`;
    if (d.rolled) {
      html += `<div class="detail-dice">Roll: ${d.rollType} = ${d.rolled}`;
      if (d.modifier) html += ` ${d.modifier >= 0 ? '+' : ''}${d.modifier}`;
      if (d.modifiedRoll !== undefined) html += ` = ${d.modifiedRoll}`;
      html += `</div>`;
    }
    html += `<div class="detail-result">→ ${escapeHtml(d.result)}</div>`;
    if (d.description) html += `<div class="detail-desc">${escapeHtml(d.description)}</div>`;
    html += `</div>`;
  }

  detailContent.innerHTML = html;
}

// ─── Crew rendering ───
function renderCrew(crew) {
  if (!crew) {
    crew = gameState?.campaign?.crew;
    if (!crew) return;
  }
  crewGrid.innerHTML = crew.map(c => {
    const cls = c.wounds === 'kia' ? 'kia' :
      c.wounds === 'serious' || c.wounds === 'mortal' ? 'serious' :
      c.wounds === 'light' ? 'wounded' : '';
    const statusCls = c.wounds === 'none' && c.status === 'active' ? 'ok' :
      c.wounds === 'kia' || c.status === 'kia' ? 'down' :
      c.wounds !== 'none' ? 'wound' : 'ok';
    const statusText = c.wounds === 'kia' ? 'KIA' :
      c.status === 'pow' ? 'POW' :
      c.wounds === 'serious' ? 'SERIOUS WOUND' :
      c.wounds === 'light' ? 'LIGHT WOUND' :
      c.frostbite ? 'FROSTBITE' : 'OK';
    return `
      <div class="crew-card ${cls}">
        <div class="crew-pos">${POS_LABELS[c.position] || c.position}</div>
        <div class="crew-name">${escapeHtml(c.name)}</div>
        <div class="crew-status ${statusCls}">${statusText} · ${c.missions}m ${c.kills}k</div>
      </div>
    `;
  }).join('');
}

function renderCrewFromState() {
  renderCrew(gameState?.campaign?.crew);
}

// ─── Aircraft rendering ───
function renderAircraft(ac) {
  if (!ac) {
    ac = gameState?.campaign?.aircraft;
    if (!ac) return;
  }

  let html = '';
  for (let i = 0; i < 4; i++) {
    const status = ac.engines[i];
    const cls = status === 'ok' ? 'ok' : 'out';
    html += `<div class="engine-row">
      <span class="engine-indicator ${cls}"></span>
      Engine #${i + 1}: ${status.toUpperCase()}
    </div>`;
  }

  const damages = [];
  if (ac.fuelLeak) damages.push('Fuel Leak');
  if (ac.fuelFire) damages.push('Fuel Fire');
  if (ac.oxygenOut) damages.push('Oxygen Out');
  if (ac.heatingOut) damages.push('Heating Out');
  if (ac.ballTurretInop) damages.push('Ball Turret Inop');
  if (ac.radioOut) damages.push('Radio Out');
  if (ac.tailWheelInop) damages.push('Tail Wheel Inop');
  if (ac.controlDamage?.rudder) damages.push('Rudder Damage');
  if (ac.controlDamage?.elevator) damages.push('Elevator Damage');
  if (ac.controlDamage?.ailerons) damages.push('Aileron Damage');

  if (damages.length > 0) {
    html += `<div class="system-damage">⚠ ${damages.join(' · ')}</div>`;
  } else {
    html += `<div style="color:var(--good); margin-top:4px">All systems operational</div>`;
  }

  aircraftStatus.innerHTML = html;
}

function renderAircraftFromState() {
  renderAircraft(gameState?.campaign?.aircraft);
}

// ─── Strategic Map ───
function renderMap(target, currentZone, targetZone) {
  const svg = $('strategic-map');
  const zones = targetZone || 5;
  const w = 700, h = 200;
  const margin = 60;
  const zoneW = (w - margin * 2) / zones;

  let html = '';

  // Background
  html += `<rect x="0" y="0" width="${w}" height="${h}" fill="#1a1a14" rx="4"/>`;

  // Water (first zone area)
  html += `<rect x="${margin}" y="40" width="${zoneW}" height="120" fill="#1a2a3a" rx="2" opacity="0.5"/>`;
  html += `<text x="${margin + zoneW/2}" y="170" text-anchor="middle" fill="#4a6a8a" font-size="9" font-family="monospace">ENGLAND</text>`;

  // Zone markers
  for (let z = 1; z <= zones; z++) {
    const x = margin + (z - 1) * zoneW;
    const isTarget = z === zones;
    const isCurrent = z === (currentZone || 0);

    // Zone background
    if (z > 1 && z < zones) {
      html += `<rect x="${x}" y="40" width="${zoneW}" height="120" fill="#2a2a1a" rx="2" stroke="#3a3a2a" stroke-width="1"/>`;
    }
    if (isTarget) {
      html += `<rect x="${x}" y="40" width="${zoneW}" height="120" fill="#3a2020" rx="2" stroke="#5a3030" stroke-width="1"/>`;
      html += `<text x="${x + zoneW/2}" y="170" text-anchor="middle" fill="#c04030" font-size="9" font-family="monospace" font-weight="bold">${target ? target.toUpperCase() : 'TARGET'}</text>`;
    }

    // Zone number
    html += `<text x="${x + zoneW/2}" y="56" text-anchor="middle" fill="#6a6a4a" font-size="10" font-family="monospace">ZONE ${z}</text>`;

    // Current position marker
    if (isCurrent) {
      const cx = x + zoneW / 2;
      html += `<g>
        <circle cx="${cx}" cy="100" r="12" fill="none" stroke="#b89b4a" stroke-width="2"/>
        <text x="${cx}" y="104" text-anchor="middle" fill="#b89b4a" font-size="14" font-family="monospace">✈</text>
      </g>`;
    }

    // Flight path dots
    if (z < zones) {
      const x1 = x + zoneW/2 + 15;
      const x2 = x + zoneW + zoneW/2 - 15;
      html += `<line x1="${x1}" y1="100" x2="${x2}" y2="100" stroke="#3a3a2a" stroke-width="1" stroke-dasharray="4,4"/>`;
    }
  }

  svg.innerHTML = html;
}

function updateMapFromEvent(evt) {
  if (evt.phase === 'ZONE' || evt.phase === 'SETUP') {
    if (evt.message.includes('Target:')) {
      const match = evt.message.match(/Target:\s*(.+?)\s*\(/);
      if (match) currentMapTarget = match[1];
    }
    if (evt.zone) {
      currentMapZone = evt.zone;
    }
  }
  if (evt.phase === 'SETUP' && evt.message.includes('Target zone:')) {
    const match = evt.message.match(/zone:\s*(\d+)/);
    if (match) currentMapTargetZone = parseInt(match[1], 10);
  }
  if (evt.zone) currentMapZone = evt.zone;

  if (currentMapTargetZone > 0) {
    renderMap(currentMapTarget, currentMapZone, currentMapTargetZone);
  }
}

// ─── Combat View ───
function updateCombatFromEvent(evt) {
  if (evt.category !== 'combat' || !evt.message) return;

  // Parse fighter positions from events
  if (evt.message.includes('fighter(s):') || evt.message.includes('fighter(s) attacking')) {
    renderCombatDiagram(evt.message);
  }
}

function renderCombatDiagram(msg) {
  const svg = $('combat-svg');
  const cx = 150, cy = 150, r = 100;

  let html = '';

  // B-17 silhouette (center)
  html += `<rect x="${cx-25}" y="${cy-8}" width="50" height="16" fill="#5a5a3a" rx="4"/>`;
  html += `<rect x="${cx-40}" y="${cy-3}" width="80" height="6" fill="#4a4a2a" rx="2"/>`;
  html += `<text x="${cx}" y="${cy+4}" text-anchor="middle" fill="#b89b4a" font-size="10" font-family="monospace">B-17</text>`;

  // Clock positions
  const clockPositions = {
    '12': -90, '1:30': -45, '3': 0, '4:30': 45,
    '6': 90, '7:30': 135, '9': 180, '10:30': -135,
  };

  // Draw clock labels
  for (const [label, angle] of Object.entries(clockPositions)) {
    const rad = angle * Math.PI / 180;
    const lx = cx + Math.cos(rad) * (r + 20);
    const ly = cy + Math.sin(rad) * (r + 20);
    html += `<text x="${lx}" y="${ly + 3}" text-anchor="middle" fill="#5a5a3a" font-size="8" font-family="monospace">${label}</text>`;
  }

  // Parse fighter positions from message
  const posPattern = /at\s+([\d:]+\s+(?:High|Level|Low))/g;
  let match;
  const fighterPositions = [];
  while ((match = posPattern.exec(msg)) !== null) {
    fighterPositions.push(match[1]);
  }

  // Place fighters
  for (let i = 0; i < fighterPositions.length; i++) {
    const pos = fighterPositions[i];
    const clockMatch = pos.match(/([\d:]+)/);
    if (!clockMatch) continue;
    const clock = clockMatch[1];
    const baseAngle = clockPositions[clock] ?? 0;
    const rad = (baseAngle + i * 5) * Math.PI / 180;
    const fx = cx + Math.cos(rad) * r;
    const fy = cy + Math.sin(rad) * r;

    html += `<circle cx="${fx}" cy="${fy}" r="6" fill="#c04030" stroke="#ff6050" stroke-width="1"/>`;
    html += `<text x="${fx}" y="${fy + 3}" text-anchor="middle" fill="white" font-size="7" font-family="monospace">✕</text>`;
  }

  svg.innerHTML = html;
  combatInfo.textContent = fighterPositions.length > 0
    ? `${fighterPositions.length} fighter(s) engaging`
    : 'No active combat';
}

// ─── Mission count ───
function updateMissionCount() {
  if (!gameState) return;
  const c = gameState.campaign;
  $('mission-count').textContent = `Mission ${c.missionsCompleted}/${c.missionsTotal}`;
}

// ─── Utility ───
function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
