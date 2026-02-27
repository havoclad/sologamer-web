# AGENTS.md — B-17 Queen of the Skies

## How to Deploy

The server runs as a live `tsx` process (no Docker, no build step required).

**To redeploy after code changes:**
```bash
# Find and kill the running server
pkill -f "tsx src/web/server.ts" || pkill -f "b17-queen.*server"

# Restart it in the background
cd /Users/clawbot/.openclaw/workspace/b17-queen
npm exec tsx src/web/server.ts &
```

Wait a second, then verify it's up:
```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000
```
Should return `200`.

The site is served via Caddy at **https://b17.pal** → `localhost:3000`.

## After Every Code Change

1. Run tests: `npm test` (should pass — currently 249 tests)
2. Commit with a clear message
3. Push: `git push origin main`
4. Restart the server (see above)
5. Verify: `curl http://localhost:3000` returns 200

## Project Structure

- `src/web/server.ts` — Express server entry point
- `src/web/game-session.ts` — Core game logic, combat events, emit messages
- `src/web/public/app.js` — Frontend UI logic
- `src/games/b17/` — B-17 game module (rules, types)
- `src/engine/` — Generic wargame engine

## Notes

- No Docker. No build step. `tsx` runs TypeScript directly.
- Do NOT use `docker compose` — it does not apply here.
- The server process was started manually and persists across sessions.
- Pat knows the rules cold — flag anything rules-related for his review.
