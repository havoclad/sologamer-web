/**
 * B-17 Queen of the Skies — Web Server
 * Express backend serving API + static frontend.
 */

import express from 'express';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { GameSession } from './game-session.js';

const __dirname_resolved = typeof __dirname !== 'undefined'
  ? __dirname
  : dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.json());
app.use(express.static(join(__dirname_resolved, 'public')));

// ─── Game session store (single-player for now) ───
let session: GameSession | null = null;

// ─── API Routes ───

/** Start a new campaign */
app.post('/api/game/new', (req, res) => {
  const { seed, bomberName, autoplay } = req.body ?? {};
  session = new GameSession(
    seed ? Number(seed) : undefined,
    bomberName || undefined,
  );
  if (autoplay) session.setAutoplay(true);
  res.json({
    ok: true,
    seed: session.getSeed(),
    state: session.getState(),
    autoplay: session.isAutoplay(),
  });
});

/** Toggle autoplay mode */
app.post('/api/game/autoplay', (req, res) => {
  if (!session) {
    return res.status(400).json({ error: 'No active game.' });
  }
  const { enabled } = req.body ?? {};
  session.setAutoplay(!!enabled);
  res.json({ ok: true, autoplay: session.isAutoplay() });
});

/** Start a mission — returns first pending roll or events */
app.post('/api/game/start-mission', (_req, res) => {
  if (!session) {
    return res.status(400).json({ error: 'No active game. POST /api/game/new first.' });
  }
  const result = session.startMission();
  res.json({
    ok: true,
    events: result.events,
    pendingRoll: result.pendingRoll,
    pendingChoice: result.pendingChoice,
    complete: result.complete,
    state: session.getState(),
  });
});

/** Submit a roll value — advances the mission */
app.post('/api/game/submit-roll', (req, res) => {
  if (!session) {
    return res.status(400).json({ error: 'No active game.' });
  }
  const { value } = req.body ?? {};
  if (value === undefined || value === null) {
    return res.status(400).json({ error: 'Missing roll value.' });
  }
  const result = session.submitRoll(Number(value));
  res.json({
    ok: true,
    events: result.events,
    pendingRoll: result.pendingRoll,
    pendingChoice: result.pendingChoice,
    complete: result.complete,
    state: session.getState(),
  });
});

/** Submit a choice selection — advances the mission */
app.post('/api/game/submit-choice', (req, res) => {
  if (!session) {
    return res.status(400).json({ error: 'No active game.' });
  }
  const { selectedIds } = req.body ?? {};
  if (!Array.isArray(selectedIds)) {
    return res.status(400).json({ error: 'Missing selectedIds array.' });
  }
  const result = session.submitChoice(selectedIds.map(Number));
  res.json({
    ok: true,
    events: result.events,
    pendingRoll: result.pendingRoll,
    pendingChoice: result.pendingChoice,
    complete: result.complete,
    state: session.getState(),
  });
});

/** Auto-step — auto-roll and advance */
app.post('/api/game/auto-step', (_req, res) => {
  if (!session) {
    return res.status(400).json({ error: 'No active game.' });
  }
  const result = session.autoStep();
  res.json({
    ok: true,
    events: result.events,
    pendingRoll: result.pendingRoll,
    pendingChoice: result.pendingChoice,
    complete: result.complete,
    state: session.getState(),
  });
});

/** Backward compat: run full mission eagerly */
app.post('/api/game/step', (_req, res) => {
  if (!session) {
    return res.status(400).json({ error: 'No active game. POST /api/game/new first.' });
  }
  const result = session.runMission();
  res.json({
    ok: true,
    events: result.events,
    complete: result.complete,
    state: session.getState(),
  });
});

/** Backward compat: auto-run */
app.post('/api/game/auto', (_req, res) => {
  if (!session) {
    return res.status(400).json({ error: 'No active game.' });
  }
  const result = session.runMission();
  res.json({
    ok: true,
    events: result.events,
    complete: result.complete,
    state: session.getState(),
  });
});

/** Get current state — always 200, used for session reconnect on refresh */
app.get('/api/game/state', (_req, res) => {
  if (!session) {
    return res.json({ ok: true, inProgress: false });
  }
  res.json({
    ok: true,
    inProgress: true,
    state: session.getState(),
    events: session.getEvents(),
    missionInProgress: session.isMissionInProgress(),
    pendingRoll: session.getCurrentPendingRoll(),
    pendingChoice: session.getCurrentPendingChoice(),
    seed: session.getSeed(),
    bomberName: session.getState().campaign.planeName,
    autoplay: session.isAutoplay(),
  });
});

/** Get full event log */
app.get('/api/game/log', (req, res) => {
  if (!session) {
    return res.status(400).json({ error: 'No active game.' });
  }
  const fromId = req.query.from ? Number(req.query.from) : 0;
  res.json({
    ok: true,
    events: session.getEventsFrom(fromId),
  });
});

app.get('/api/game/debug-log', (_req, res) => {
  if (!session) {
    return res.status(400).json({ error: 'No active game.' });
  }
  const log = session.getDebugLog();
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="b17-debug-m${log.missionNumber}-${log.seed}.json"`);
  res.json(log);
});

// ─── Start ───

const PORT = parseInt(process.env.PORT || '3000', 10);
app.listen(PORT, () => {
  console.log(`\n  ╔══════════════════════════════════════════════╗`);
  console.log(`  ║  B-17: Queen of the Skies — Web Interface    ║`);
  console.log(`  ║  http://localhost:${PORT}                       ║`);
  console.log(`  ╚══════════════════════════════════════════════╝\n`);
});
