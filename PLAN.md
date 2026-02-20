# B-17: Queen of the Skies — Implementation Plan

## Goal

A **faithful digital reproduction** of the Avalon Hill board game (base game, Nov 1942–May 1943). Every mechanic must trace to the PDF rulebook or official errata. No invented features, no hallucinated rules.

---

## 1. Tech Stack

| Layer | Choice | Why |
|-------|--------|-----|
| Language | **TypeScript** (strict mode) | Full type safety, discriminated unions for game states, excellent tooling |
| Runtime | **Node.js** (Bun or Node 22+) | Fast, cross-platform |
| RNG | **Seedable PRNG** (e.g., `seedrandom` or custom xoshiro256) | Deterministic replay, testing |
| State | **Immutable snapshots** with transition functions | Undo, replay, analysis |
| UI (Phase 1) | **CLI / Terminal** | Ship fast, test fast |
| UI (Phase 2) | **Web (React/Preact)** or **Discord bot** | Visual board, crew management |
| Testing | **Vitest** | Fast, TypeScript-native |
| Build | **tsup** or **esbuild** | Simple bundling |
| Data | **JSON** (reuse Pat's format where verified) | Proven, portable |

---

## 2. Architecture

### 2.1 Core Design: Typed State Machine + Event Log

```
┌─────────────────────────────────────────────┐
│                  Game Engine                 │
│                                             │
│  GameState ──transition()──> GameState       │
│       │                          │          │
│       ▼                          ▼          │
│   EventLog                   EventLog       │
│  (what happened)            (what happened) │
└──────────┬──────────────────────┬───────────┘
           │                      │
     ┌─────▼──────┐        ┌─────▼──────┐
     │  RNG Svc   │        │  Table Svc │
     │ (seedable) │        │  (JSON)    │
     └────────────┘        └────────────┘
```

**GameState** is an immutable snapshot containing:
- Campaign state (mission number, bomber history, crew roster)
- Mission state (current zone, direction, formation, weather)
- Aircraft state (engines, fuel, controls, guns, ammo, damage)
- Crew state (positions, wounds, frostbite, kills, ace status)
- Combat state (current wave, fighters, phase within combat)

**Transitions** are pure functions: `(state, action) → { newState, events[] }`

**Events** are typed discriminated unions describing what happened (for UI rendering, logging, replay).

### 2.2 State Machine Phases

```
PRE_MISSION
  → ZONE_ENTER
    → FIGHTER_COVER_CHECK (zones 2-4 only)
    → DETERMINE_ATTACKERS
    → WAVE_START
      → FIGHTER_COVER_DEFENSE
      → DEFENSIVE_FIRE_ALLOCATION (player decision)
      → DEFENSIVE_FIRE_RESOLUTION
      → GERMAN_OFFENSIVE_FIRE
      → SHELL_HIT_RESOLUTION
      → DAMAGE_RESOLUTION
      → SUCCESSIVE_ATTACK_CHECK
      → (loop back to DEFENSIVE_FIRE_ALLOCATION if successive)
    → NEXT_WAVE (or)
    → TARGET_ZONE_FLAK (if target zone)
    → BOMB_RUN (if target zone, outbound)
    → ZONE_EXIT
  → LANDING
  → POST_MISSION
```

### 2.3 Key Interfaces

```typescript
interface GameState {
  campaign: CampaignState;
  mission: MissionState | null;
  phase: GamePhase;
}

interface MissionState {
  missionNumber: number;
  target: Target;
  zone: number;
  direction: 'outbound' | 'inbound';
  formation: FormationPosition;
  squadron: SquadronPosition;
  weather: Weather;
  aircraft: AircraftState;
  crew: CrewState;
  combat: CombatState | null;
  ammo: AmmoState;
  landingModifiers: number;
  outOfFormation: boolean;
  altitude: 20000 | 10000;
  bombsAbroad: boolean;
  bombsDropped: boolean;
  aborted: boolean;
  evasiveAction: boolean;
}

type GameEvent =
  | { type: 'DICE_ROLL'; dice: number[]; table: string; result: string }
  | { type: 'FIGHTER_APPEARS'; fighterType: FighterType; position: AttackPosition }
  | { type: 'GUN_FIRES'; gun: GunPosition; target: FighterRef; hit: boolean }
  | { type: 'FIGHTER_DESTROYED'; fighter: FighterRef; by: GunPosition }
  | { type: 'SHELL_HIT'; area: B17Area; damage: DamageResult }
  | { type: 'CREW_WOUND'; crewMember: CrewPosition; severity: WoundSeverity }
  | { type: 'ENGINE_OUT'; engine: 1 | 2 | 3 | 4; cause: string }
  // ... etc
  ;

// The only player decision point in the game
interface DefensiveFireAllocation {
  assignments: Array<{
    gun: GunPosition;
    target: FighterRef;
    sprayFire?: boolean;
  }>;
}
```

---

## 3. Module Breakdown

```
src/
├── index.ts                    # CLI entry point
├── engine/
│   ├── game.ts                 # Top-level game loop, phase transitions
│   ├── state.ts                # GameState type + creation
│   ├── transitions/
│   │   ├── pre-mission.ts      # Target roll, formation, setup
│   │   ├── zone-movement.ts    # Zone enter/exit, direction
│   │   ├── combat.ts           # Full combat procedure (§6.0)
│   │   ├── defensive-fire.ts   # Gun allocation + resolution (§9.0)
│   │   ├── german-fire.ts      # German offensive fire (§6.4)
│   │   ├── damage.ts           # Shell hit → area → specific damage
│   │   ├── flak.ts             # Anti-aircraft fire (§19.0)
│   │   ├── bomb-run.ts         # Bombing accuracy (O-6, O-7)
│   │   ├── landing.ts          # All landing types (§16.0)
│   │   ├── bailout.ts          # G-6, G-7, G-8
│   │   ├── crew.ts             # Wounds, replacement, frostbite
│   │   ├── engines.ts          # Engine damage effects (§10.0)
│   │   ├── abort.ts            # Abort logic (§8.0)
│   │   └── post-mission.ts     # Debriefing, survival rolls
│   ├── rules/
│   │   ├── fields-of-fire.ts   # M-1 gun coverage by attack position
│   │   ├── evasive-action.ts   # §15.0 restrictions and effects
│   │   ├── formation.ts        # Out of formation effects (§13.0)
│   │   ├── oxygen.ts           # Oxygen tracking (§12.0)
│   │   ├── heat.ts             # Heat/frostbite (§11.0)
│   │   └── ammo.ts             # Ammunition management (§9.4)
│   └── rng.ts                  # Seedable RNG, dice rolling
├── data/
│   ├── tables/                 # JSON table files (ported from Pat's)
│   │   ├── B-1.json ... B-7.json
│   │   ├── BL-1.json ... BL-5.json
│   │   ├── G-1.json ... G-11.json
│   │   ├── M-1.json ... M-6.json
│   │   ├── O-1.json ... O-7.json
│   │   └── P-1.json ... P-6.json
│   ├── schema.ts               # TypeScript interfaces for JSON table format
│   └── loader.ts               # JSON → typed table objects
├── types/
│   ├── aircraft.ts             # AircraftState, damage enums
│   ├── crew.ts                 # CrewState, positions, wounds
│   ├── combat.ts               # Fighters, attack positions, waves
│   ├── campaign.ts             # Campaign tracking
│   └── events.ts               # GameEvent discriminated union
├── ui/
│   ├── cli.ts                  # Terminal output renderer
│   ├── prompts.ts              # Player decision prompts (gun allocation)
│   └── mission-log.ts          # Mission chart text output
└── __tests__/
    ├── combat.test.ts
    ├── damage.test.ts
    ├── tables.test.ts          # Verify all table lookups
    ├── scenarios.test.ts       # Full mission replays with seeded RNG
    └── rules.test.ts           # Specific rule edge cases
```

---

## 4. Data Strategy

### 4.1 Reuse Pat's JSON
Pat's SoloGamer has **42 JSON table files** covering all game tables. These are well-structured and tested through actual gameplay. Strategy:

1. **Copy all JSON files** into `src/data/tables/`
2. **Define TypeScript schemas** matching the JSON structure
3. **Validate at load time** — any schema mismatch is a build error
4. **Verify against visual extraction** — spot-check 5-10 random entries per table

### 4.2 Fix Known Issues in Pat's Data
- **M-1**: Pat's JSON uses a single hit number per position. The original table has per-fighter-type columns. Need to expand M-1.json to include fighter-type differentiation (FW190/ME110/ME109).
- **Errata**: Apply all 37 errata items to the JSON data.
- **B-5**: Pat has some B-5 sub-tables hardcoded in Perl rather than JSON. Move to JSON.

### 4.3 Handle Obscured/Unclear Entries
For the ~15 [obscured] cells in the visual extraction of M-1:
1. **Cross-reference with Pat's Perl code** (has working values)
2. **Cross-reference with the VB6 emulator** (Hawke's B17QoTS) if accessible
3. **Apply logical inference** — most obscured cells follow clear patterns (e.g., symmetric port/starboard values)
4. **Flag remaining uncertainties** in code comments with `// VERIFY:` tags
5. If still uncertain, **use Pat's values** and note them as "unverified against original"

---

## 5. Testing Strategy

### 5.1 Unit Tests: Table Lookups
For every table, verify that roll X produces result Y:
```typescript
test('B-1: roll 3 with no modifier = 1 wave', () => {
  const result = lookupTable('B-1', { roll: 3, modifiers: 0 });
  expect(result).toBe('1 wave');
});
```

### 5.2 Deterministic Scenario Tests
Seed the RNG, replay the sample mission from the rulebook (Part II), and verify every step matches:
```typescript
test('Sample Mission: Miss Cue (Mission 11 to Paris)', () => {
  const game = createGame({ seed: MISS_CUE_SEED });
  // Pre-determined dice sequence that produces the sample mission outcomes
  // Verify zone-by-zone that events match the rulebook walkthrough
});
```

### 5.3 Edge Case Tests
- All 4 engines out → forced landing/bailout
- BIP in each compartment type
- Full successive attack chain (3 attacks)
- Out of formation + low altitude + light flak
- Fuel leak countdown
- Wing root 5-hit destruction
- Crew replacement cascade (pilot + copilot KIA → engineer flies)
- Ammo transfer between twin mounts only

### 5.4 Statistical Validation
Run 10,000 seeded missions and verify:
- Average missions survived ≈ 7-8 (matching historical ~30% survival rate for 25 missions)
- Bomb accuracy distribution matches O-7 probabilities
- Fighter encounter rates match B-1/B-2 distributions

---

## 6. Phase Plan

### Phase 1: Core Engine (Week 1-2)
- [ ] Project setup (TypeScript, Vitest, tsup)
- [ ] RNG service (seedable, dice helpers: 1d6, 2d6, d6d6)
- [ ] JSON table loader with TypeScript schema validation
- [ ] Port all 42 JSON table files, apply errata
- [ ] GameState type definitions
- [ ] Basic table lookup system (roll → result)
- [ ] Unit tests for all table lookups

### Phase 2: Mission Flow (Week 2-3)
- [ ] Pre-mission setup (target, formation, gazetteer)
- [ ] Zone movement (outbound/inbound)
- [ ] Fighter wave determination (B-1, B-2, B-3)
- [ ] Fighter cover (G-5, M-4)
- [ ] Combat procedure skeleton (§6.0 full flow)
- [ ] Defensive fire with field-of-fire validation (M-1)
- [ ] German offensive fire (M-3)
- [ ] Shell hit resolution (B-4, B-5 → P-1 through P-6, BL-1, BL-2)
- [ ] Successive attacks (B-6)
- [ ] Scenario test: replay sample mission

### Phase 3: Damage & Special Rules (Week 3-4)
- [ ] Full damage resolution for all 8 damage tables
- [ ] Engine damage system (§10.0, all 4 states)
- [ ] Crew wound system (light/serious/KIA, cascading effects)
- [ ] Oxygen system (§12.0, two-hit knockout)
- [ ] Heat/frostbite system (§11.0)
- [ ] Fire system (oxygen fires + engine fires + fuel fires)
- [ ] Out of formation effects (§13.0, all sub-rules)
- [ ] Evasive action (§15.0, all restrictions)
- [ ] Crew movement and replacement (§14.0)

### Phase 4: Target Zone & Landing (Week 4-5)
- [ ] Weather (O-1)
- [ ] Flak system (O-2 through O-5)
- [ ] BIP effects (§19.0)
- [ ] Bomb run (O-6, O-7)
- [ ] Abort logic (§8.0, mandatory vs optional)
- [ ] Landing system (G-9, G-10, all modifiers)
- [ ] Bailout system (G-6, G-7, G-8)
- [ ] Ammunition management (§9.4)

### Phase 5: Campaign & Polish (Week 5-6)
- [ ] 25-mission campaign loop
- [ ] Post-mission debriefing (§17.0)
- [ ] Crew replacement between missions
- [ ] Ace tracking (5 kills)
- [ ] Victory conditions (§7.0)
- [ ] Performance ratings (§7.3)
- [ ] CLI interface (interactive gun allocation)
- [ ] Mission log output (formatted like the Mission Chart)
- [ ] Optional rules: Random Events (§18.0), German Fighter Pilot Status (§20.0), Area Spray Fire (§9.5)
- [ ] Nose section gun restrictions (§9.1)
- [ ] Tail gun passing shots (§9.2)

### Phase 6: Verification & UI (Week 6+)
- [ ] Statistical validation (10k missions)
- [ ] Full errata audit (all 37 items verified in code)
- [ ] Composite Mission Record output
- [ ] Web UI or Discord bot (stretch goal)

---

## 7. Faithfulness Principles

1. **No invented mechanics.** If a rule isn't in the PDF or errata, it doesn't exist in our implementation.
2. **Table data is sacred.** Every number in every table must match the original. When in doubt, flag with `// VERIFY:` and use the most authoritative source.
3. **Player decisions are minimal.** The only real decision is gun allocation during defensive fire. Everything else is dice-driven.
4. **Errata supersedes rules text.** The 37-item errata list takes precedence over the base rulebook where they conflict.
5. **Pat's Perl is a reference, not gospel.** His implementation is excellent but has simplifications (M-1 fighter-type flattening, some hardcoded B-5 data). Verify against the original tables.
6. **Two-player rules (§21.0) are out of scope** for initial implementation (solitaire focus).
7. **The sample mission is our acceptance test.** If we can replay "Miss Cue" and get the same results, the core engine is correct.
