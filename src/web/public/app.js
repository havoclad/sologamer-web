/**
 * B-17 Queen of the Skies — Frontend Application
 * Interactive step-by-step play with visible table lookups.
 */

// ─── State ───
window._compartmentHits = {};
let gameState = null;
let allEvents = [];
let selectedEventId = null;
let currentMapTarget = null;
let currentMapZone = 0;
let currentMapTargetZone = 0;
let autoplayMode = false;
let autoPlayTimer = null;
let pendingRoll = null; // Current roll the engine is waiting for
let pendingChoice = null; // Current choice the engine is waiting for

// ─── DOM refs ───
const $ = id => document.getElementById(id);
const startScreen = $('start-screen');
const gameScreen = $('game-screen');
const btnStart = $('btn-start');
const btnFly = $('btn-fly');
const btnNewMission = $('btn-new-mission');
const btnRestart = $('btn-restart');
const btnAutoplay = $('btn-autoplay');
const eventLog = $('event-log');
const crewGrid = $('crew-grid');
const aircraftStatus = $('aircraft-status');
const detailContent = $('detail-content');
const combatInfo = $('combat-info');
const rollPanel = $('roll-panel');

// ─── Status bar state ───
let statusTarget = '—';
let statusZone = '—';
let statusFighterCover = '—';
let statusWeather = '—';
let statusKills = 0;
let statusLosses = 0;

function updateStatusBar() {
  $('status-target').textContent = `Target: ${statusTarget}`;
  $('status-zone').textContent = `Current: ${statusZone}`;
  $('status-fighter-cover').textContent = `Cover: ${statusFighterCover}`;
  $('status-weather').textContent = `Weather: ${statusWeather}`;
  $('status-kills').textContent = `Kills: ${statusKills}`;
}

function resetStatusBar() {
  statusTarget = '—'; statusZone = '—'; statusFighterCover = '—';
  statusWeather = '—'; statusKills = 0; statusLosses = 0;
  updateStatusBar();
}

function updateStatusFromEvent(evt) {
  const msg = evt.message || '';

  // Target
  if (msg.includes('Target:')) {
    const m = msg.match(/Target:\s*(.+?)(?:\s*\(|$)/);
    if (m) {
      const zoneMatch = msg.match(/zone[:\s]*(\d+)/i);
      statusTarget = m[1].trim() + (zoneMatch ? ` / Zone ${zoneMatch[1]}` : '');
    }
  }

  // Current zone
  if (evt.zone) {
    const dir = evt.direction === 'inbound' ? 'Inbound' : evt.direction === 'outbound' ? 'Outbound' : '';
    statusZone = `Zone ${evt.zone}${dir ? ' ' + dir : ''}`;
  }

  // Fighter cover
  if (msg.toLowerCase().includes('fighter cover') || msg.toLowerCase().includes('escort')) {
    const m = msg.match(/fighter cover[:\s]*(\w+)/i) || msg.match(/escort[:\s]*(\w+)/i);
    if (m) statusFighterCover = m[1];
  }

  // Weather
  if (msg.toLowerCase().includes('weather')) {
    const m = msg.match(/weather[:\s]*(.+?)(?:\.|$)/i);
    if (m) statusWeather = m[1].trim();
  }

  // Kills & losses from crew state snapshots
  if (evt.stateSnapshot?.crew) {
    statusKills = evt.stateSnapshot.crew.reduce((sum, c) => sum + (c.kills || 0), 0);
    statusLosses = evt.stateSnapshot.crew.filter(c => c.wounds === 'kia' || c.status === 'kia').length;
  }

  // Phase-based zone info (ZONE headers)
  if (evt.phase === 'ZONE' && msg.match(/zone\s*(\d+)/i)) {
    const m = msg.match(/zone\s*(\d+)\s*(inbound|outbound)?/i);
    if (m) statusZone = `Zone ${m[1]}${m[2] ? ' ' + m[2].charAt(0).toUpperCase() + m[2].slice(1) : ''}`;
  }

  // Target zone from bombing phase
  if (msg.toLowerCase().includes('over target') || msg.toLowerCase().includes('target zone') || msg.toLowerCase().includes('bombing')) {
    if (evt.zone) statusZone = `Zone ${evt.zone} — Over Target`;
  }

  updateStatusBar();
}

// ─── Position labels ───
const POS_LABELS = {
  pilot: 'Pilot', copilot: 'Co-Pilot', navigator: 'Navigator', bombardier: 'Bombardier',
  engineer: 'Engineer/Top Turret', radioman: 'Radio Operator',
  ball_turret: 'Ball Turret', left_waist: 'Left Waist', right_waist: 'Right Waist', tail_gunner: 'Tail Gunner',
};

const GUN_LABELS = {
  Nose: 'Nose', Port_Cheek: 'Port Cheek', Starboard_Cheek: 'Stbd Cheek',
  Top_Turret: 'Top Turret', Ball_Turret: 'Ball Turret',
  Port_Waist: 'Left Waist', Starboard_Waist: 'Right Waist',
  Radio: 'Radio Room', Tail: 'Tail',
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
  autoplayMode = $('autoplay-toggle')?.checked ?? false;

  const data = await api('POST', '/api/game/new', { seed, bomberName: name, autoplay: autoplayMode });
  if (data.ok) {
    gameState = data.state;
    allEvents = [];
    startScreen.classList.remove('active');
    gameScreen.classList.add('active');
    $('plane-name').textContent = gameState.campaign.planeName;
    $('seed-display').textContent = `Seed: ${data.seed}`;
    updateAutoplayButton();
    updateMissionCount();
    renderCrew();
    renderAircraft();
    renderMap(null, 1, 5);
    eventLog.innerHTML = '';
    btnFly.style.display = '';
    btnFly.disabled = false;
    btnNewMission.style.display = 'none';
    rollPanel.innerHTML = '';
    rollPanel.style.display = 'none';
    resetStatusBar();
  }
});

// ─── Fly mission ───
btnFly.addEventListener('click', async () => {
  btnFly.disabled = true;
  eventLog.innerHTML = '';
  allEvents = [];
  selectedEventId = null;
  detailContent.innerHTML = '<p class="placeholder">Click any event to see dice rolls and table lookups.</p>';

  if (autoplayMode) {
    // Autoplay: run entire mission eagerly
    const data = await api('POST', '/api/game/step');
    if (data.ok) {
      gameState = data.state;
      allEvents = data.events;
      autoPlayEventsIndex = 0;
      autoPlayEvents();
    }
  } else {
    // Interactive: start mission, get first pending roll
    const data = await api('POST', '/api/game/start-mission');
    if (data.ok) {
      gameState = data.state;
      btnFly.style.display = 'none';
      // Process initial events
      if (data.events) {
        for (const evt of data.events) {
          allEvents.push(evt);
          appendEvent(evt);
          updateMapFromEvent(evt);
          updateCombatFromEvent(evt);
          if (evt.stateSnapshot) {
            renderCrew(evt.stateSnapshot.crew);
            renderAircraft(evt.stateSnapshot.aircraft);
          }
        }
      }
      // Show pending roll/choice or complete
      if (data.pendingRoll) {
        showPendingRoll(data.pendingRoll);
      } else if (data.pendingChoice) {
        showPendingChoice(data.pendingChoice);
      } else if (data.complete) {
        missionComplete();
      }
    }
  }
});

// ─── Helper: check if a table row is reachable with given modifier ───
function isRowReachable(rangeStr, diceType, modifier) {
  // Get the natural dice range
  let minNat = 1, maxNat = 6;
  if (diceType === '2d6') { minNat = 2; maxNat = 12; }
  else if (diceType === 'd6d6') { return true; } // d6d6 is complex, always allow

  // Parse all values this row covers
  const rowValues = parseRangeValues(rangeStr);
  // Check if any natural roll + modifier lands in this range
  for (let nat = minNat; nat <= maxNat; nat++) {
    const modified = nat + modifier;
    if (rowValues.includes(modified)) return true;
  }
  return false;
}

function parseRangeValues(rangeStr) {
  const values = [];
  const parts = rangeStr.split(',');
  for (const part of parts) {
    const trimmed = part.trim();
    const m = trimmed.match(/^(\d+)-(\d+)$/);
    if (m) {
      const lo = parseInt(m[1], 10);
      const hi = parseInt(m[2], 10);
      for (let v = lo; v <= hi; v++) values.push(v);
    } else {
      const v = parseInt(trimmed, 10);
      if (!isNaN(v)) values.push(v);
    }
  }
  return values;
}

// ─── Helper: pick a natural roll value that maps to this row ───
function pickRollValueForRange(rangeStr, diceType, modifier) {
  let minNat = 1, maxNat = 6;
  if (diceType === '2d6') { minNat = 2; maxNat = 12; }
  else if (diceType === 'd6d6') {
    // For d6d6, parse first value from range and return it directly
    const vals = parseRangeValues(rangeStr);
    return vals.length > 0 ? vals[0] : null;
  }

  const rowValues = parseRangeValues(rangeStr);
  // Find first natural roll that, when modified, falls in range
  for (let nat = minNat; nat <= maxNat; nat++) {
    const modified = nat + modifier;
    if (rowValues.includes(modified)) return nat;
  }
  return null;
}

// ─── Show pending roll panel ───
function showPendingRoll(roll) {
  pendingRoll = roll;
  rollPanel.style.display = 'block';

  // Determine valid range for manual input
  let minVal = 1, maxVal = 6;
  if (roll.diceType === '2d6') { minVal = 2; maxVal = 12; }
  else if (roll.diceType === 'd6d6') { minVal = 11; maxVal = 66; }

  let html = `
    <div class="roll-prompt">
      <div class="roll-purpose">🎲 Roll ${roll.diceType} on Table ${roll.tableId}: ${escapeHtml(roll.tableName)}</div>
      <div class="roll-description">${escapeHtml(roll.purpose)}</div>
      ${roll.modifier ? `<div class="roll-modifier">Modifier: ${roll.modifier >= 0 ? '+' : ''}${roll.modifier}</div>` : ''}
    </div>
    <div class="roll-table-display">
      <table class="lookup-table roll-lookup-table">
        <thead><tr><th>Roll</th>`;

  // Expand comma-separated and range entries into individual sequential rows
  const expandedRows = [];
  for (const row of roll.tableRows) {
    // Strip "(b)" from column values (e.g. B-2 descriptions)
    const cleanColumns = {};
    for (const [k, v] of Object.entries(row.columns)) {
      cleanColumns[k] = v.replace(/\s*\(b\)/g, '').trim();
    }
    const values = parseRangeValues(row.roll);
    for (const v of values) {
      expandedRows.push({ roll: String(v), columns: cleanColumns, _sortKey: v });
    }
  }
  // Sort numerically and deduplicate
  expandedRows.sort((a, b) => a._sortKey - b._sortKey);
  const sortedRows = expandedRows;

  // Collect column headers from first row
  const colHeaders = new Set();
  for (const row of sortedRows) {
    for (const k of Object.keys(row.columns)) {
      colHeaders.add(k);
    }
  }
  for (const h of colHeaders) {
    html += `<th>${escapeHtml(formatColumnHeader(h))}</th>`;
  }
  html += `</tr></thead><tbody>`;

  for (const row of sortedRows) {
    // Determine if this row is reachable given the modifier
    const reachable = isRowReachable(row.roll, roll.diceType, roll.modifier || 0);
    const rowClass = reachable ? 'clickable-row' : 'greyed-out-row';
    html += `<tr data-roll="${escapeHtml(row.roll)}" class="${rowClass}">`;
    html += `<td class="roll-value">${escapeHtml(row.roll)}</td>`;
    for (const h of colHeaders) {
      html += `<td>${escapeHtml(row.columns[h] || '—')}</td>`;
    }
    html += `</tr>`;
  }
  html += `</tbody></table></div>`;

  html += `
    <div class="roll-input-area">
      <div class="roll-manual">
        <label for="manual-roll-input">Your roll:</label>
        <input type="number" id="manual-roll-input" min="${minVal}" max="${maxVal}" 
               placeholder="${roll.diceType}" class="roll-input-field">
        <button id="btn-submit-roll" class="btn btn-primary btn-roll-submit">Submit Roll</button>
      </div>
      <div class="roll-divider">or</div>
      <div class="roll-auto">
        <button id="btn-auto-roll" class="btn btn-roll-auto">🎲 Roll for me</button>
      </div>
    </div>
  `;

  rollPanel.innerHTML = html;

  // Wire up buttons
  $('btn-submit-roll').addEventListener('click', () => submitManualRoll());
  $('btn-auto-roll').addEventListener('click', () => submitAutoRoll());

  // Enter key submits manual roll
  $('manual-roll-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitManualRoll();
  });

  // Wire up clickable table rows
  const clickableRows = rollPanel.querySelectorAll('.roll-lookup-table tbody tr.clickable-row');
  for (const row of clickableRows) {
    row.addEventListener('click', () => {
      const rollRange = row.dataset.roll;
      // Pick a valid roll value for this range (first valid value)
      const rollValue = pickRollValueForRange(rollRange, roll.diceType, roll.modifier || 0);
      if (rollValue !== null) {
        submitRollValue(rollValue);
      }
    });
  }

  // Focus the input
  $('manual-roll-input').focus();

  // Scroll roll panel into view
  rollPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ─── Submit manual roll ───
async function submitManualRoll() {
  const input = $('manual-roll-input');
  const value = parseInt(input.value, 10);
  if (isNaN(value)) {
    input.classList.add('invalid');
    setTimeout(() => input.classList.remove('invalid'), 500);
    return;
  }

  // Validate range
  let minVal = 1, maxVal = 6;
  if (pendingRoll.diceType === '2d6') { minVal = 2; maxVal = 12; }
  else if (pendingRoll.diceType === 'd6d6') { minVal = 11; maxVal = 66; }

  if (value < minVal || value > maxVal) {
    input.classList.add('invalid');
    setTimeout(() => input.classList.remove('invalid'), 500);
    return;
  }

  // For d6d6, validate both digits are 1-6
  if (pendingRoll.diceType === 'd6d6') {
    const tens = Math.floor(value / 10);
    const ones = value % 10;
    if (tens < 1 || tens > 6 || ones < 1 || ones > 6) {
      input.classList.add('invalid');
      setTimeout(() => input.classList.remove('invalid'), 500);
      return;
    }
  }

  await submitRollValue(value);
}

// ─── Submit auto-roll ───
async function submitAutoRoll() {
  // Generate random roll client-side for visual feedback, but server does the actual roll
  const data = await api('POST', '/api/game/auto-step');
  processStepResult(data);
}

// ─── Submit a specific roll value ───
async function submitRollValue(value) {
  // Highlight the matching row in the table
  highlightTableRow(value);

  // Brief delay to show the highlight before advancing
  await new Promise(r => setTimeout(r, 300));

  const data = await api('POST', '/api/game/submit-roll', { value });
  processStepResult(data);
}

// ─── Highlight matching row in the roll table ───
function highlightTableRow(value) {
  const rows = rollPanel.querySelectorAll('.roll-lookup-table tbody tr');
  for (const row of rows) {
    const rollRange = row.dataset.roll;
    if (rollMatchesRange(value, rollRange)) {
      row.classList.add('highlighted');
    }
  }
}

function rollMatchesRange(value, rangeStr) {
  // Handle comma-separated: "2,12"
  if (rangeStr.includes(',')) {
    return rangeStr.split(',').some(s => rollMatchesRange(value, s.trim()));
  }
  // Handle range: "3-11"
  const m = rangeStr.match(/^(\d+)-(\d+)$/);
  if (m) {
    const lo = parseInt(m[1], 10);
    const hi = parseInt(m[2], 10);
    return value >= lo && value <= hi;
  }
  // Single value
  return parseInt(rangeStr, 10) === value;
}

// ─── Process step result from server ───
function processStepResult(data) {
  if (!data.ok) return;

  gameState = data.state;

  // Process events
  if (data.events) {
    for (const evt of data.events) {
      allEvents.push(evt);
      appendEvent(evt);
      updateMapFromEvent(evt);
      updateCombatFromEvent(evt);
      if (evt.stateSnapshot) {
        renderCrew(evt.stateSnapshot.crew);
        renderAircraft(evt.stateSnapshot.aircraft);
      }
      selectEvent(evt);
    }
  }

  // Next step
  if (data.pendingRoll) {
    showPendingRoll(data.pendingRoll);
  } else if (data.pendingChoice) {
    showPendingChoice(data.pendingChoice);
  } else if (data.complete) {
    missionComplete();
  }
}

// ─── Autoplay toggle ───
btnAutoplay.addEventListener('click', async () => {
  autoplayMode = !autoplayMode;
  await api('POST', '/api/game/autoplay', { enabled: autoplayMode });
  updateAutoplayButton();
});

function updateAutoplayButton() {
  btnAutoplay.textContent = autoplayMode ? '⏩ Auto' : '🎲 Manual';
  btnAutoplay.title = autoplayMode ? 'Autoplay mode — click to switch to manual' : 'Manual mode — click to switch to autoplay';
  btnAutoplay.classList.toggle('active', autoplayMode);
}

// ─── Mission complete ───
// ─── Show pending choice panel ───
function showPendingChoice(choice) {
  pendingChoice = choice;
  pendingRoll = null;
  rollPanel.style.display = 'block';

  // Gun allocation mode — completely different UI
  if (choice.choiceType === 'gun-allocation' && choice.allocations) {
    showGunAllocationChoice(choice);
    return;
  }

  const selectedIds = new Set();

  let html = `
    <div class="roll-prompt">
      <div class="roll-purpose">✋ ${escapeHtml(choice.purpose)}</div>
      <div class="roll-description">${escapeHtml(choice.prompt)}</div>
    </div>
    <div class="choice-options">
  `;

  for (const opt of choice.options) {
    const disabledAttr = opt.disabled ? 'disabled' : '';
    const disabledClass = opt.disabled ? 'choice-disabled' : '';
    const reason = opt.reason ? ` <span class="choice-reason">(${escapeHtml(opt.reason)})</span>` : '';
    html += `
      <label class="choice-option ${disabledClass}">
        <input type="checkbox" class="choice-checkbox" data-id="${opt.id}" ${disabledAttr}>
        <span class="choice-label">${escapeHtml(opt.label)}${reason}</span>
      </label>
    `;
  }

  html += `
    </div>
    <div class="roll-input-area">
      <button id="btn-submit-choice" class="btn btn-primary btn-roll-submit" disabled>
        Select ${choice.minSelections} fighter${choice.minSelections > 1 ? 's' : ''}
      </button>
    </div>
  `;

  rollPanel.innerHTML = html;

  const checkboxes = rollPanel.querySelectorAll('.choice-checkbox');
  const submitBtn = document.getElementById('btn-submit-choice');

  function updateSubmitState() {
    const checked = rollPanel.querySelectorAll('.choice-checkbox:checked:not(:disabled)');
    const count = checked.length;
    submitBtn.disabled = count < choice.minSelections || count > choice.maxSelections;
    if (count >= choice.minSelections && count <= choice.maxSelections) {
      submitBtn.textContent = `Confirm (${count} selected)`;
    } else {
      submitBtn.textContent = `Select ${choice.minSelections} fighter${choice.minSelections > 1 ? 's' : ''} (${count} selected)`;
    }
  }

  for (const cb of checkboxes) {
    cb.addEventListener('change', () => {
      // Enforce max selections
      const checked = rollPanel.querySelectorAll('.choice-checkbox:checked:not(:disabled)');
      if (checked.length > choice.maxSelections) {
        cb.checked = false;
      }
      updateSubmitState();
    });
  }

  submitBtn.addEventListener('click', async () => {
    const checked = rollPanel.querySelectorAll('.choice-checkbox:checked:not(:disabled)');
    const ids = Array.from(checked).map(cb => parseInt(cb.dataset.id, 10));
    const data = await api('POST', '/api/game/submit-choice', { selectedIds: ids });
    processStepResult(data);
  });

  rollPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ─── Gun Allocation UI (Rule 6.3a) ───
function showGunAllocationChoice(choice) {
  const allocs = choice.allocations;

  let html = `
    <div class="roll-prompt">
      <div class="roll-purpose">🎯 ${escapeHtml(choice.purpose)}</div>
      <div class="roll-description">${escapeHtml(choice.prompt)}</div>
    </div>
    <div class="gun-allocation-grid">
  `;

  for (let i = 0; i < allocs.length; i++) {
    const gun = allocs[i];
    const delayedNote = gun.isTailSpecial ? ' <span class="gun-delayed-note">⏳ Fires after German attack</span>' : '';
    html += `
      <div class="gun-allocation-row">
        <div class="gun-info">
          <span class="gun-name">${escapeHtml(gun.gunLabel)}</span>
          <span class="gun-crew">${escapeHtml(gun.crewName)}</span>
          <span class="gun-ammo">Ammo: ${gun.ammoRemaining}</span>
          ${delayedNote}
        </div>
        <select class="gun-target-select" data-gun-index="${i}">
          <option value="-1">— Hold fire —</option>
    `;
    for (const t of gun.targets) {
      html += `<option value="${t.fighterId}">${escapeHtml(t.label)}</option>`;
    }
    html += `
        </select>
      </div>
    `;
  }

  html += `
    </div>
    <div class="roll-input-area">
      <button id="btn-submit-allocation" class="btn btn-primary btn-roll-submit">Confirm Allocations</button>
      <button id="btn-fire-all" class="btn btn-roll-auto">🔫 Auto-assign all</button>
    </div>
  `;

  rollPanel.innerHTML = html;

  // Auto-assign: for each gun, pick the first target (not hold fire)
  document.getElementById('btn-fire-all').addEventListener('click', () => {
    const selects = rollPanel.querySelectorAll('.gun-target-select');
    for (const sel of selects) {
      if (sel.options.length > 1) {
        sel.selectedIndex = 1; // First actual target
      }
    }
  });

  // Submit allocations
  document.getElementById('btn-submit-allocation').addEventListener('click', async () => {
    const selects = rollPanel.querySelectorAll('.gun-target-select');
    const selectedIds = [];
    for (const sel of selects) {
      selectedIds.push(parseInt(sel.value, 10));
    }
    const data = await api('POST', '/api/game/submit-choice', { selectedIds });
    processStepResult(data);
  });

  rollPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function missionComplete() {
  rollPanel.innerHTML = '';
  rollPanel.style.display = 'none';
  pendingRoll = null;
  pendingChoice = null;
  btnFly.style.display = 'none';
  btnNewMission.style.display = '';
  updateMissionCount();
  renderCrewFromState();
  renderAircraftFromState();
}

btnNewMission.addEventListener('click', () => {
  btnFly.style.display = '';
  btnNewMission.style.display = 'none';
  btnFly.disabled = false;
  eventLog.innerHTML = '';
  allEvents = [];
  window._compartmentHits = {};
  rollPanel.innerHTML = '';
  rollPanel.style.display = 'none';
  detailContent.innerHTML = '<p class="placeholder">Click any event to see dice rolls and table lookups.</p>';
  updateMissionCount();
  resetStatusBar();
});

$('btn-debug-log').addEventListener('click', async () => {
  try {
    const a = document.createElement('a');
    a.href = '/api/game/debug-log';
    a.click();
  } catch (e) {
    console.error('Failed to download debug log:', e);
  }
});

btnRestart.addEventListener('click', () => {
  gameScreen.classList.remove('active');
  startScreen.classList.add('active');
  gameState = null;
  allEvents = [];
  if (autoPlayTimer) clearTimeout(autoPlayTimer);
  rollPanel.innerHTML = '';
  rollPanel.style.display = 'none';
});

// ─── Auto-play events with delay (for autoplay mode) ───
let autoPlayEventsIndex = 0;
function autoPlayEvents() {
  if (autoPlayEventsIndex >= allEvents.length) {
    missionComplete();
    return;
  }

  const evt = allEvents[autoPlayEventsIndex];
  appendEvent(evt);
  updateMapFromEvent(evt);
  updateCombatFromEvent(evt);
  if (evt.stateSnapshot) {
    renderCrew(evt.stateSnapshot.crew);
    renderAircraft(evt.stateSnapshot.aircraft);
  }
  autoPlayEventsIndex++;

  let delay = 40;
  if (evt.severity === 'critical') delay = 200;
  else if (evt.severity === 'bad') delay = 100;
  else if (evt.category === 'combat') delay = 60;
  else if (evt.phase === 'ZONE') delay = 120;

  autoPlayTimer = setTimeout(autoPlayEvents, delay);
}

// ─── Append event to log ───
function trackDamageFromEvent(evt) {
  if (evt.category !== 'damage' || !evt.message) return;
  const hitAreas = ['Nose', 'Pilot Compt.', 'Pilot Compartment', 'Bomb Bay', 'Radio Room', 'Waist', 'Tail',
    'Port Wing', 'Starboard Wing', 'Wings'];
  for (const area of hitAreas) {
    if (evt.message.includes(area) && (evt.message.includes('Hit to') || evt.message.includes('hit in') || evt.message.includes('shell'))) {
      const key = area === 'Pilot Compartment' ? 'Pilot Compt.' : area === 'Starboard Wing' ? 'Stbd Wing' : area;
      window._compartmentHits[key] = (window._compartmentHits[key] || 0) + 1;
    }
  }
  // Engine/system damage
  if (evt.message.includes('Engine #') && evt.message.includes('knocked out')) {
    // Already tracked via aircraft state
  }
}

function appendEvent(evt) {
  updateStatusFromEvent(evt);
  trackDamageFromEvent(evt);
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

  setTimeout(() => el.classList.remove('new'), 800);
}

// ─── Select event (show details) ───
function selectEvent(evt) {
  selectedEventId = evt.id;

  document.querySelectorAll('.log-entry.selected').forEach(el => el.classList.remove('selected'));
  const el = document.querySelector(`.log-entry[data-event-id="${evt.id}"]`);
  if (el) el.classList.add('selected');

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
    html += `<span class="detail-table">${d.table || '—'}${d.tableTitle ? ` (${d.tableTitle})` : ''}</span>`;
    html += `<span class="detail-type">${d.rollType || ''}</span>`;
    if (d.rolled) {
      html += `<div class="detail-dice">Roll: ${d.rollType} = ${d.rolled}`;
      if (d.modifiers && d.modifiers.length > 0) {
        for (const m of d.modifiers) {
          html += ` <span class="modifier">${m.value >= 0 ? '+' : ''}${m.value} (${escapeHtml(m.source)})</span>`;
        }
      } else if (d.modifier) {
        html += ` ${d.modifier >= 0 ? '+' : ''}${d.modifier}`;
      }
      if (d.modifiedRoll !== undefined) html += ` = ${d.modifiedRoll}`;
      html += `</div>`;
    }
    html += `<div class="detail-result">→ ${escapeHtml(d.result)}</div>`;
    if (d.description) html += `<div class="detail-desc">${escapeHtml(d.description)}</div>`;
    if (d.tableData) {
      html += `<details class="table-lookup"><summary>View full table</summary><table class="lookup-table">`;
      for (const [k, v] of Object.entries(d.tableData)) {
        html += `<tr><td>${escapeHtml(k)}</td><td>${escapeHtml(String(v))}</td></tr>`;
      }
      html += `</table></details>`;
    }
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

function renderCrewFromState() { renderCrew(gameState?.campaign?.crew); }

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

  // ─── Compartment damage tracking ───
  const compartments = [
    { name: 'Nose', key: 'nose' },
    { name: 'Pilot Compt.', key: 'pilot' },
    { name: 'Bomb Bay', key: 'bombBay' },
    { name: 'Radio Room', key: 'radio' },
    { name: 'Waist', key: 'waist' },
    { name: 'Tail', key: 'tail' },
    { name: 'Port Wing', key: 'portWing' },
    { name: 'Stbd Wing', key: 'stbdWing' },
  ];
  // Count damage from recent events — track hits per area
  if (window._compartmentHits) {
    const hasAnyDamage = Object.values(window._compartmentHits).some(v => v > 0);
    if (hasAnyDamage) {
      html += `<div class="damage-section"><div class="ammo-header">Damage Tracking</div>`;
      for (const comp of compartments) {
        const hits = window._compartmentHits[comp.name] || 0;
        if (hits === 0) continue;
        const maxHits = 5;
        const filled = Math.min(hits, maxHits);
        const bar = '█'.repeat(filled) + '░'.repeat(maxHits - filled);
        const cls = hits >= 4 ? 'dmg-critical' : hits >= 2 ? 'dmg-warn' : 'dmg-light';
        html += `<div class="damage-row ${cls}"><span class="damage-area">${comp.name}</span><span class="damage-bar">${bar}</span><span class="damage-count">${hits}</span></div>`;
      }
      html += `</div>`;
    }
  }

  if (ac.ammo) {
    html += `<div class="ammo-section"><div class="ammo-header">Ammunition</div><div class="ammo-grid">`;
    for (const [gun, remaining] of Object.entries(ac.ammo)) {
      const maxAmmo = {
        Nose: 12, Port_Cheek: 12, Starboard_Cheek: 12, Top_Turret: 16,
        Ball_Turret: 16, Port_Waist: 12, Starboard_Waist: 12, Radio: 8, Tail: 16,
      }[gun] || 12;
      const pct = Math.round((remaining / maxAmmo) * 100);
      const barCls = pct > 50 ? 'ammo-ok' : pct > 20 ? 'ammo-low' : 'ammo-critical';
      html += `<div class="ammo-row">
        <span class="ammo-gun">${GUN_LABELS[gun] || gun}</span>
        <div class="ammo-bar-bg"><div class="ammo-bar ${barCls}" style="width:${pct}%"></div></div>
        <span class="ammo-count">${remaining}</span>
      </div>`;
    }
    html += `</div></div>`;
  }

  aircraftStatus.innerHTML = html;
}

function renderAircraftFromState() { renderAircraft(gameState?.campaign?.aircraft); }

// ─── Strategic Map ───
function renderMap(target, currentZone, targetZone) {
  const svg = $('strategic-map');
  const zones = targetZone || 5;
  const w = 700, h = 200;
  const margin = 60;
  const zoneW = (w - margin * 2) / zones;

  let html = '';
  html += `<rect x="0" y="0" width="${w}" height="${h}" fill="#1a1a14" rx="4"/>`;
  html += `<rect x="${margin}" y="40" width="${zoneW}" height="120" fill="#1a2a3a" rx="2" opacity="0.5"/>`;
  html += `<text x="${margin + zoneW/2}" y="170" text-anchor="middle" fill="#4a6a8a" font-size="9" font-family="monospace">ENGLAND</text>`;

  for (let z = 1; z <= zones; z++) {
    const x = margin + (z - 1) * zoneW;
    const isTarget = z === zones;
    const isCurrent = z === (currentZone || 0);

    if (z > 1 && z < zones) {
      html += `<rect x="${x}" y="40" width="${zoneW}" height="120" fill="#2a2a1a" rx="2" stroke="#3a3a2a" stroke-width="1"/>`;
    }
    if (isTarget) {
      html += `<rect x="${x}" y="40" width="${zoneW}" height="120" fill="#3a2020" rx="2" stroke="#5a3030" stroke-width="1"/>`;
      html += `<text x="${x + zoneW/2}" y="170" text-anchor="middle" fill="#c04030" font-size="9" font-family="monospace" font-weight="bold">${target ? target.toUpperCase() : 'TARGET'}</text>`;
    }

    html += `<text x="${x + zoneW/2}" y="56" text-anchor="middle" fill="#6a6a4a" font-size="10" font-family="monospace">ZONE ${z}</text>`;

    if (isCurrent) {
      const cx = x + zoneW / 2;
      html += `<g>
        <circle cx="${cx}" cy="100" r="12" fill="none" stroke="#b89b4a" stroke-width="2"/>
        <text x="${cx}" y="104" text-anchor="middle" fill="#b89b4a" font-size="14" font-family="monospace">✈</text>
      </g>`;
    }

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
    if (evt.zone) currentMapZone = evt.zone;
  }
  if (evt.phase === 'SETUP' && evt.message.includes('Target zone:')) {
    const match = evt.message.match(/zone:\s*(\d+)/);
    if (match) currentMapTargetZone = parseInt(match[1], 10);
  }
  if (evt.zone) currentMapZone = evt.zone;
  if (currentMapTargetZone > 0) renderMap(currentMapTarget, currentMapZone, currentMapTargetZone);
}

// ─── Combat View ───
function updateCombatFromEvent(evt) {
  if (evt.category !== 'combat' || !evt.message) return;
  if (evt.message.includes('fighter:') || evt.message.includes('fighters:') || evt.message.includes('fighter attacking') || evt.message.includes('fighters attacking')) {
    renderCombatDiagram(evt.message);
  }
}

function renderCombatDiagram(msg) {
  const svg = $('combat-svg');
  const cx = 150, cy = 150, r = 100;
  let html = '';
  html += `<rect x="${cx-25}" y="${cy-8}" width="50" height="16" fill="#5a5a3a" rx="4"/>`;
  html += `<rect x="${cx-40}" y="${cy-3}" width="80" height="6" fill="#4a4a2a" rx="2"/>`;
  html += `<text x="${cx}" y="${cy+4}" text-anchor="middle" fill="#b89b4a" font-size="10" font-family="monospace">B-17</text>`;

  const clockPositions = {
    '12': -90, '1:30': -45, '3': 0, '4:30': 45,
    '6': 90, '7:30': 135, '9': 180, '10:30': -135,
  };

  for (const [label, angle] of Object.entries(clockPositions)) {
    const rad = angle * Math.PI / 180;
    const lx = cx + Math.cos(rad) * (r + 20);
    const ly = cy + Math.sin(rad) * (r + 20);
    html += `<text x="${lx}" y="${ly + 3}" text-anchor="middle" fill="#5a5a3a" font-size="8" font-family="monospace">${label}</text>`;
  }

  const posPattern = /at\s+([\d:]+\s+(?:High|Level|Low))/g;
  let match;
  const fighterPositions = [];
  while ((match = posPattern.exec(msg)) !== null) {
    fighterPositions.push(match[1]);
  }

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
    ? `${fighterPositions.length} ${fighterPositions.length === 1 ? 'fighter' : 'fighters'} engaging`
    : 'No active combat';
}

// ─── Mission count ───
function updateMissionCount() {
  if (!gameState) return;
  const c = gameState.campaign;
  const nextMission = c.missionsCompleted + 1;
  const currentMission = Math.min(c.missionsCompleted + 1, c.missionsTotal);
  $('mission-count').textContent = `Mission ${currentMission}/${c.missionsTotal}`;
  // Update fly button text
  if (nextMission <= c.missionsTotal) {
    btnFly.textContent = `✈ Fly Mission ${nextMission}`;
  } else {
    btnFly.textContent = `✈ Tour Complete!`;
    btnFly.disabled = true;
  }
}

// ─── Utility ───
function escapeHtml(s) {
  if (!s) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatColumnHeader(key) {
  return key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// ─── Session restore on page load ───
(async function restoreSession() {
  try {
    const data = await api('GET', '/api/game/state');
    if (!data.ok || !data.inProgress) return; // No active game, show start screen

    // Restore game state
    gameState = data.state;
    autoplayMode = data.autoplay || false;

    // Switch to game screen
    startScreen.classList.remove('active');
    gameScreen.classList.add('active');
    $('plane-name').textContent = data.bomberName || gameState.campaign.planeName;
    $('seed-display').textContent = `Seed: ${data.seed}`;
    updateAutoplayButton();
    updateMissionCount();
    renderCrew();
    renderAircraft();
    renderMap(null, 1, 5);
    resetStatusBar();

    // Replay all events into the log
    allEvents = [];
    eventLog.innerHTML = '';
    if (data.events && data.events.length > 0) {
      for (const evt of data.events) {
        allEvents.push(evt);
        appendEvent(evt);
        updateMapFromEvent(evt);
        updateCombatFromEvent(evt);
        if (evt.stateSnapshot) {
          renderCrew(evt.stateSnapshot.crew);
          renderAircraft(evt.stateSnapshot.aircraft);
        }
      }
    }

    // Restore UI controls based on mission state
    if (data.missionInProgress) {
      btnFly.style.display = 'none';
      btnNewMission.style.display = 'none';
      if (data.pendingRoll) {
        showPendingRoll(data.pendingRoll);
      } else if (data.pendingChoice) {
        showPendingChoice(data.pendingChoice);
      }
    } else {
      // Game exists but mission is not in progress — show "Fly" or "New Mission"
      btnFly.style.display = '';
      btnFly.disabled = false;
      btnNewMission.style.display = 'none';
      rollPanel.innerHTML = '';
      rollPanel.style.display = 'none';
      // If missions have been completed, show new mission button instead
      if (allEvents.length > 0) {
        btnFly.style.display = '';
        btnNewMission.style.display = 'none';
      }
    }
  } catch (e) {
    // Network error or server not ready — just show start screen
    console.warn('Session restore failed:', e);
  }
})();
