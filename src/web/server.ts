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
  const { seed, bomberName } = req.body ?? {};
  session = new GameSession(
    seed ? Number(seed) : undefined,
    bomberName || undefined,
  );
  res.json({
    ok: true,
    seed: session.getSeed(),
    state: session.getState(),
  });
});

/** Advance one step (runs full mission, returns all events) */
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

/** Auto-run (same as step for now) */
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

/** Get current state */
app.get('/api/game/state', (_req, res) => {
  if (!session) {
    return res.status(400).json({ error: 'No active game.' });
  }
  res.json({
    ok: true,
    state: session.getState(),
    missionInProgress: session.isMissionInProgress(),
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

// ─── Start ───

const PORT = parseInt(process.env.PORT || '3000', 10);
app.listen(PORT, () => {
  console.log(`\n  ╔══════════════════════════════════════════════╗`);
  console.log(`  ║  B-17: Queen of the Skies — Web Interface    ║`);
  console.log(`  ║  http://localhost:${PORT}                       ║`);
  console.log(`  ╚══════════════════════════════════════════════╝\n`);
});
