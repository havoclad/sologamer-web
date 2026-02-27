# Damage Sub-Roll Implementation Plan

## Problem Summary

When compartment damage is rolled (2d6 on tables P-1 through P-6, B1-1, B1-2), many results require a follow-up 1d6 sub-roll to determine the specific effect. Currently:

1. **Sub-rolls are NOT prompted to the player** — the code detects `sub_roll` entries in the JSON but falls through to a generic `follow_up_table` handler that only handles `fuel_tank` and `engine_hit` types. Standard `1d6` sub-rolls emit a generic info message with no player roll prompt.
2. **Effects are not applied to aircraft state** — landing modifiers, gun damage, equipment status, bomb run modifiers, etc. are not tracked.
3. **Aircraft Status panel doesn't reflect damage** — many fields exist in `AircraftState` but are never set by sub-roll results.

---

## Current Code Flow

### Where damage location is determined
- `_resolveCompartmentHitGen()` in `game-session.ts:1846` — the generator that handles all compartment damage
- Called from flak resolution (~line 1256) and fighter attack resolution (~lines 1571, 1580)

### How the roll prompt system works
- Generator yields via `_yieldCombatRoll()` which returns a `MissionYield` with `roll` property
- The engine suspends, UI shows the roll prompt to the player, player rolls, value is sent back via `submitRoll()`
- The generator resumes with the rolled value

### Where sub-rolls should be triggered
- In `_resolveCompartmentHitGen()`, inside the `case 'follow_up_table'` block (line ~1939)
- Currently, `fuel_tank` and `engine_hit` sub-roll types ARE properly handled with player prompts
- Standard `1d6` sub-rolls hit the `else` branch at the end which just emits a generic info message

### Where Aircraft Status state is stored
- `this.state.campaign.aircraft` — `AircraftState` in `types.ts:84`
- `this.state.mission.landingModifiers` — cumulative landing roll modifier

### What state fields already exist but are underused
- `tailWheelInop`, `bombBayDoorsInop`, `radioOut`, `ballTurretInop`
- `controlDamage: { rudder, elevator, ailerons }`
- `guns[]` array with enable/disable
- `oxygenOut`, `heatingOut`, `fuelLeak`, `fuelFire`

---

## Complete Sub-Roll Table Catalog

### P-1 (Nose Compartment)

| 2d6 Roll | Result | Sub-Roll | Effects |
|----------|--------|----------|---------|
| 3 | Armament | 1-2: Nose gun inop; 3-4: Port cheek gun inop; 5-6: Starboard cheek gun inop | Disable specific gun in `aircraft.guns[]` |
| 10 | Nav Equipment / Bomb Controls | 1-3: Navigator equipment inop; 4-6: Bomb controls inop (bomb run -3) | New field `navigatorEquipInop`; or set `bombRunModifier -= 3` |
| 11 | Compartment Heat Out | 1-2: Bombardier heat; 3-4: Navigator heat; 5-6: Both | Track per-crew heat status |
| 12 | Oxygen Supply Hit | 1-2: Bombardier O2; 3-4: Navigator O2; 5: Both O2; 6: Fire + all nose O2 out | Per-crew oxygen tracking + fire resolution |

### P-2 (Pilot Compartment)

| 2d6 Roll | Result | Sub-Roll | Effects |
|----------|--------|----------|---------|
| 8 | Top Turret | 1-2: Guns inop; 3-5: Engineer wound (B1-4); 6: Both | Disable top turret gun + wound roll |
| 10 | Oxygen Supply | 1: Pilot+CoPilot O2; 2: Pilot O2; 3: CoPilot O2; 4-5: Engineer O2; 6: Fire + all cockpit O2 | Per-crew oxygen + fire |

### P-3 (Bomb Bay)

| 2d6 Roll | Result | Sub-Roll | Effects |
|----------|--------|----------|---------|
| 3 (also 9,11) | Bombs | 1-4: No effect; 5-6: B-17 destroyed, all crew KIA | Conditional on `bombsAboard`; game over on 5-6 |
| 5 (also 10) | Bomb Bay Doors | 1-2: Doors inop (no bomb drop); 3-6: No effect | Set `aircraft.bombBayDoorsInop = true` |

### P-4 (Radio Room)

| 2d6 Roll | Result | Sub-Roll | Effects |
|----------|--------|----------|---------|
| 11 | Oxygen Supply Hit | 1-5: Radio Operator O2 hit; 6: Fire + radio room O2 out | Per-crew oxygen + fire |

### P-5 (Waist)

| 2d6 Roll | Result | Sub-Roll | Effects |
|----------|--------|----------|---------|
| 2 | Oxygen Supply | 1-2: Port Gunner O2; 3-4: Starboard Gunner O2; 5: Ball Gunner O2; 6: Fire + waist O2 | Per-crew oxygen + fire |
| 3 | Armament | 1-3: Port waist gun out; 4-6: Starboard waist gun out | Disable gun in `aircraft.guns[]` |
| 9 | Ball Turret | 1-2: Ball Gunner wound (B1-4); 3: Ball Gunner heat out; 4-5: Ball turret guns out; 6: Turret mechanism inop (trapped) | Multiple effect types |
| 11 | Suit Heaters | 1-3: Port Gunner heat; 4-6: Starboard Gunner heat | Per-crew heat tracking |

### P-6 (Tail)

| 2d6 Roll | Result | Sub-Roll | Effects |
|----------|--------|----------|---------|
| 3 | Tailwheel/Autopilot | 1-3: Tailwheel damaged (landing -1); 4-6: Autopilot inop (bomb run -2) | `landingModifiers -= 1` or `bombRunModifier -= 2` |
| 9, 10 | Tailplane | 1-2: No effect; 3: Port elevator inop; 4: Starboard elevator inop; 5: Port tailplane root; 6: Starboard tailplane root | Cumulative elevator/tailplane tracking |
| 11 | Oxygen Supply | 1-5: Tail Gunner O2 hit; 6: Fire + tail O2 out | Per-crew oxygen + fire |

### B1-1 (Wings)

| 2d6 Roll | Result | Sub-Roll | Effects |
|----------|--------|----------|---------|
| 4 | Wing Flap | 1-3: Flap inop (landing -1); 4-6: No effect | `landingModifiers -= 1`, track per-wing |
| 5 | Aileron | 1-3: Aileron inop (landing -1); 4-6: No effect | `landingModifiers -= 1`, track per-wing |
| 9 | Engines | (Already implemented — 2-step: which engine, then damage type) | ✅ Working |
| 10 | Fuel Tank | (Already implemented — 2-step: tank location, then damage type) | ✅ Working |
| 12 | Landing Gear | 1-3: Brakes out (landing -1); 4-6: Landing gear inop (landing -3) | `landingModifiers -= 1 or -3` |

---

## Implementation Plan

### Phase 1: Data Structures

**File: `src/games/b17/types.ts`**

Add to `AircraftState`:
```typescript
// New fields for damage tracking
navigatorEquipInop: boolean;      // P-1 roll 10 (1-3)
bombControlsInop: boolean;        // P-1 roll 10 (4-6) — bomb run -3
autopilotInop: boolean;           // P-6 roll 3 (4-6) — bomb run -2
tailWheelDamaged: boolean;        // P-6 roll 3 (1-3) — landing -1 (rename existing tailWheelInop)
brakesOut: boolean;               // B1-1 roll 12 (1-3) — landing -1
landingGearInop: boolean;         // B1-1 roll 12 (4-6) — landing -3
ballTurretTrapped: boolean;       // P-5 roll 9 (6) — gunner can't bail, KIA on gear-up landing

// Per-wing tracking
portFlapInop: boolean;            // B1-1 roll 4 (1-3) on port wing
starboardFlapInop: boolean;       // B1-1 roll 4 (1-3) on starboard wing
portAileronInop: boolean;         // B1-1 roll 5 (1-3) on port wing
starboardAileronInop: boolean;    // B1-1 roll 5 (1-3) on starboard wing

// Tail section cumulative
portElevatorInop: boolean;
starboardElevatorInop: boolean;
portTailplaneRootHits: number;    // 3 = rips off
starboardTailplaneRootHits: number;

// Crew-level tracking (move to CrewMember or parallel structure)
// Per-crew oxygen hits and heat-out already partially tracked
```

Add to `MissionState`:
```typescript
bombRunModifier: number;          // Cumulative modifier to O-6 bomb run roll
```

Add to `CrewMember` (or new parallel structure):
```typescript
oxygenHits: number;               // 2 cumulative = knockout
heatOut: boolean;                  // Frostbite risk each zone
```

**File: `src/games/b17/rules/damage.ts`**

No changes needed to `rollCompartmentDamage()` — it already detects `sub_roll` and emits `follow_up_table` with `table: 'sub_roll'`. The fix is entirely in how `game-session.ts` handles these.

### Phase 2: Generic Sub-Roll Handler (Core Fix)

**File: `src/web/game-session.ts`**

In `_resolveCompartmentHitGen()`, inside the `case 'follow_up_table'` block, **replace the final `else` branch** (the generic fallback at ~line 2139) with a proper sub-roll handler:

```typescript
} else if (subRoll && subRoll.type === '1d6') {
  // ── Generic 1d6 sub-roll ──
  yield* this._resolveGenericSubRoll(
    damageTable, dmgDiceType, dmgRollValue, dmg,
    location, subRoll, rollEntry,
    zone, direction,
  );
} else {
  // True generic fallback (no sub-roll data)
  this.emit('DAMAGE', `${location}: ${dmg.description || dmg.result}`, 'damage', 'info', zone, direction,
    [{ table: damageTable, rollType: dmgDiceType, rolled: dmgRollValue, result: dmg.result }]);
}
```

**New method `_resolveGenericSubRoll()`:**

This is the heart of the fix. It:
1. Builds row data from the `sub_roll` JSON keys (e.g. `"1-3"`, `"4-6"`)
2. Yields a roll prompt to the player
3. Matches the rolled value to the correct sub-roll outcome
4. Applies the effect to aircraft state
5. Emits a detailed log event

```typescript
private *_resolveGenericSubRoll(
  damageTable: string, dmgDiceType: string, dmgRollValue: number,
  dmg: DamageResult, location: string,
  subRoll: Record<string, string>, rollEntry: any,
  zone: number, direction: 'outbound' | 'inbound',
): Generator<MissionYield, void, number | number[] | undefined> {

  // Build display rows from sub_roll keys
  const rows = Object.entries(subRoll)
    .filter(([k]) => k !== 'type')
    .map(([k, v]) => ({ roll: k, columns: { result: v as string } }));

  // Prompt player for the 1d6 sub-roll
  const subRollValue: number = yield* this._yieldCombatRoll(
    damageTable, `${dmg.result}`,
    `${location}: ${dmg.result} — roll for specific effect`, '1d6',
    rows,
  );

  // Find matching outcome
  const outcome = this._matchSubRollOutcome(subRoll, subRollValue);

  // Apply effect to state
  this._applySubRollEffect(damageTable, dmgRollValue, location, subRollValue, outcome, zone, direction);
}
```

**New method `_matchSubRollOutcome()`:**

```typescript
private _matchSubRollOutcome(subRoll: Record<string, string>, value: number): string {
  for (const [key, result] of Object.entries(subRoll)) {
    if (key === 'type') continue;
    const match = key.match(/^(\d+)(?:-(\d+))?$/);
    if (!match) continue;
    const lo = parseInt(match[1]);
    const hi = match[2] ? parseInt(match[2]) : lo;
    if (value >= lo && value <= hi) return result;
  }
  return 'No effect';
}
```

### Phase 3: Effect Application (Table-Driven)

**New method `_applySubRollEffect()`:**

This is where each sub-roll outcome maps to concrete state changes. Use a **table-driven approach** keyed by `damageTable + dmgRollValue` to avoid a massive switch statement:

```typescript
// Define effect handlers as a map
private static readonly SUB_ROLL_EFFECTS: Record<string, Record<string, (gs: GameSession, outcome: string, location: string) => { severity: 'info' | 'warn' | 'bad' | 'critical'; isImportant: boolean }>> = {
  // P-1 roll 3: Armament
  'P-1:3': {
    'Nose gun inoperable': (gs) => { disableGun(gs.state.campaign.aircraft.guns, 'Nose'); return { severity: 'bad', isImportant: true }; },
    'Port cheek gun inoperable': (gs) => { disableGun(gs.state.campaign.aircraft.guns, 'Port Cheek'); return { severity: 'bad', isImportant: true }; },
    'Starboard cheek gun inoperable': (gs) => { disableGun(gs.state.campaign.aircraft.guns, 'Starboard Cheek'); return { severity: 'bad', isImportant: true }; },
  },
  // P-6 roll 3: Tailwheel/Autopilot
  'P-6:3': {
    'Tailwheel damaged': (gs) => { gs.state.campaign.aircraft.tailWheelDamaged = true; gs.state.mission!.landingModifiers -= 1; return { severity: 'bad', isImportant: true }; },
    'Autopilot mechanism inoperable': (gs) => { gs.state.campaign.aircraft.autopilotInop = true; gs.state.mission!.bombRunModifier -= 2; return { severity: 'bad', isImportant: true }; },
  },
  // B1-1 roll 12: Landing Gear
  'B1-1:12': {
    'Brakes out': (gs) => { gs.state.campaign.aircraft.brakesOut = true; gs.state.mission!.landingModifiers -= 1; return { severity: 'bad', isImportant: true }; },
    'Landing gear inoperable': (gs) => { gs.state.campaign.aircraft.landingGearInop = true; gs.state.mission!.landingModifiers -= 3; return { severity: 'critical', isImportant: true }; },
  },
  // ... etc for all sub-roll entries
};
```

The `_applySubRollEffect()` method:
1. Looks up `SUB_ROLL_EFFECTS[`${damageTable}:${dmgRollValue}`]`
2. Finds the matching entry by checking if the outcome string starts with or contains the key
3. Calls the handler function to mutate state
4. Emits the appropriate log event with full roll chain

**However**, a static map won't work cleanly because outcome text varies and some outcomes trigger further rolls (wounds, fire extinguishing). A better approach:

### Phase 3 (Revised): Pattern-Matching Effect Applier

Instead of exact string matching, use **keyword pattern matching** on the outcome text:

```typescript
private *_applySubRollEffect(
  damageTable: string, dmgDiceType: string, dmgRollValue: number,
  location: string, subRollValue: number, outcome: string,
  zone: number, direction: 'outbound' | 'inbound',
): Generator<MissionYield, void, number | number[] | undefined> {
  const outcomeLower = outcome.toLowerCase();
  let severity: 'info' | 'warn' | 'bad' | 'critical' = 'warn';
  let isImportant = false;

  // ── Gun damage ──
  if (outcomeLower.includes('gun') && outcomeLower.includes('inoperable') || outcomeLower.includes('guns out')) {
    const gunName = this._extractGunName(outcome, location);
    disableGun(this.state.campaign.aircraft.guns, gunName);
    severity = 'bad'; isImportant = true;
  }
  // ── Landing modifier ──
  else if (outcomeLower.includes('landing roll')) {
    const mod = this._extractLandingModifier(outcome); // parse "-1", "-3" from text
    if (this.state.mission) this.state.mission.landingModifiers += mod;
    // Set specific state flags
    if (outcomeLower.includes('tailwheel')) this.state.campaign.aircraft.tailWheelDamaged = true;
    if (outcomeLower.includes('brakes')) this.state.campaign.aircraft.brakesOut = true;
    if (outcomeLower.includes('landing gear inop')) this.state.campaign.aircraft.landingGearInop = true;
    if (outcomeLower.includes('flap')) { /* set port/starboard flap based on location */ }
    if (outcomeLower.includes('aileron')) { /* set port/starboard aileron based on location */ }
    severity = mod <= -3 ? 'critical' : 'bad'; isImportant = true;
  }
  // ── Bomb run modifier ──
  else if (outcomeLower.includes('bomb run') || outcomeLower.includes('bomb controls')) {
    const mod = this._extractModifier(outcome);
    if (this.state.mission) this.state.mission.bombRunModifier += mod;
    if (outcomeLower.includes('autopilot')) this.state.campaign.aircraft.autopilotInop = true;
    if (outcomeLower.includes('bomb controls')) this.state.campaign.aircraft.bombControlsInop = true;
    severity = 'bad'; isImportant = true;
  }
  // ── Crew wound (requires further B1-4 roll) ──
  else if (outcomeLower.includes('wound') || outcomeLower.includes('b1-4')) {
    const crewPos = this._extractCrewPosition(outcome);
    if (crewPos) {
      yield* this._resolveCrewWound(crewPos, damageTable, dmgDiceType, dmgRollValue, location, zone, direction);
    }
    return; // wound handler emits its own event
  }
  // ── Fire ──
  else if (outcomeLower.includes('fire')) {
    severity = 'critical'; isImportant = true;
    // TODO: trigger fire extinguish sequence (B1-3)
  }
  // ── Heat out ──
  else if (outcomeLower.includes('heat out')) {
    // Set crew heat out status
    severity = 'warn';
  }
  // ── Oxygen ──
  else if (outcomeLower.includes('oxygen')) {
    this.state.campaign.aircraft.oxygenOut = true;
    severity = 'warn';
  }
  // ── Bomb bay doors ──
  else if (outcomeLower.includes('bomb bay doors inoperable')) {
    this.state.campaign.aircraft.bombBayDoorsInop = true;
    severity = 'bad'; isImportant = true;
  }
  // ── B-17 destroyed ──
  else if (outcomeLower.includes('destroyed') || outcomeLower.includes('detonate')) {
    severity = 'critical'; isImportant = true;
    // End mission — all crew KIA
  }
  // ── Ball turret trapped ──
  else if (outcomeLower.includes('trapped')) {
    this.state.campaign.aircraft.ballTurretTrapped = true;
    severity = 'critical'; isImportant = true;
  }
  // ── Elevator ──
  else if (outcomeLower.includes('elevator inoperable')) {
    if (outcomeLower.includes('port')) this.state.campaign.aircraft.portElevatorInop = true;
    else this.state.campaign.aircraft.starboardElevatorInop = true;
    // Both inop = landing -1
    if (this.state.campaign.aircraft.portElevatorInop && this.state.campaign.aircraft.starboardElevatorInop) {
      if (this.state.mission) this.state.mission.landingModifiers -= 1;
    }
    severity = 'bad'; isImportant = true;
  }
  // ── Tailplane root ──
  else if (outcomeLower.includes('tailplane root')) {
    const side = outcomeLower.includes('port') ? 'port' : 'starboard';
    // Increment cumulative hits
    severity = 'bad'; isImportant = true;
  }
  // ── No effect ──
  else if (outcomeLower.includes('no effect') || outcomeLower.includes('superficial')) {
    severity = 'info';
  }
  // ── Navigator equipment ──
  else if (outcomeLower.includes('navigator') && outcomeLower.includes('inoperable')) {
    this.state.campaign.aircraft.navigatorEquipInop = true;
    severity = 'bad'; isImportant = true;
  }

  // Emit the result
  this.emit('DAMAGE', `${location}: ${outcome}`, 'damage', severity, zone, direction,
    [
      { table: damageTable, rollType: dmgDiceType, rolled: dmgRollValue, result: dmg.result, description: `${location} damage` },
      { table: damageTable, rollType: '1d6', rolled: subRollValue, result: outcome, description: 'Sub-roll result' },
    ], isImportant);
}
```

### Phase 4: Aircraft Status Panel UI

**File: `src/web/public/app.js`**

The Aircraft Status panel should display all damage state. Add/update a `renderAircraftStatus()` function that reads from game state and shows:

- **Engines**: #1–#4 status (OK / Out / Runaway / Fire)
- **Landing Modifiers**: Total accumulated value (sum of all penalties)
- **Bomb Run Modifiers**: Total accumulated value
- **Systems**: List of damaged/inoperable systems with icons
  - Norden Sight ❌, Bomb Controls ❌, Autopilot ❌, Intercom ❌, Radio ❌
  - Bomb Bay Doors ❌, Tailwheel ❌, Brakes ❌, Landing Gear ❌
  - Navigator Equipment ❌, Ball Turret Mechanism ❌
- **Control Surfaces**: Flaps (L/R), Ailerons (L/R), Elevators (L/R), Rudder
- **Guns**: Per-position status (operational / inoperable)
- **Crew**: Per-position status (OK / Light wound / Serious / KIA / Heat out / O2 out)
- **Fuel**: Normal / Leak / Fire
- **Oxygen**: Normal / Hit / Out

The state should be sent to the client as part of the regular game state update payload. The `getState()` or equivalent method should include `aircraft` and `mission.landingModifiers` / `mission.bombRunModifier`.

### Phase 5: Landing Roll Integration

**File: `src/web/game-session.ts`** (landing section, ~line 1080)

When the landing roll is prompted:
1. Calculate total landing modifier = `mission.landingModifiers` + `getEngineLandingModifier(aircraft)`
2. Display the modifier breakdown to the player before the roll
3. Apply modifier to the landing roll result
4. If `ballTurretTrapped && landingGearInop`, Ball Gunner is automatically KIA

**File: `src/games/b17/rules/landing.ts`** — ensure it accepts and applies the accumulated modifier.

### Phase 6: Bomb Run Integration

**File: `src/web/game-session.ts`** (bomb run section)

When the O-6 bomb run roll is made:
1. Apply `mission.bombRunModifier` to the roll
2. If Norden Sight is out, bomb run is automatically off target (skip roll)

---

## Suggested Implementation Order

### Commit 1: Data structure changes
- Add new fields to `AircraftState` and `MissionState` in `types.ts`
- Add `oxygenHits` and `heatOut` to `CrewMember` or create parallel tracking
- Update `createInitialAircraftState()` (or equivalent) with defaults
- Add `bombRunModifier` to `MissionState` initialization

### Commit 2: Generic sub-roll prompting
- Add `_resolveGenericSubRoll()` and `_matchSubRollOutcome()` to `game-session.ts`
- Wire it into the `case 'follow_up_table'` branch for `subRoll.type === '1d6'`
- Initially just prompt and emit — no state application yet
- **Test**: Verify sub-rolls are prompted for P-6 roll 3, B1-1 roll 12, etc.

### Commit 3: Effect application (state mutations)
- Add `_applySubRollEffect()` with pattern matching
- Add helper methods: `_extractLandingModifier()`, `_extractGunName()`, `_extractCrewPosition()`
- Wire crew wound sub-roll outcomes (P-2 roll 8, P-5 roll 9) to existing wound resolution
- Wire fire outcomes to existing fire resolution (B1-3)
- **Test**: Verify state changes after sub-rolls

### Commit 4: Aircraft Status panel
- Update `app.js` to render damage state in the Aircraft Status panel
- Include accumulated landing/bomb run modifiers with breakdown
- Show all system statuses
- **Test**: Visual verification of panel updates after damage

### Commit 5: Landing & bomb run modifier integration
- Apply accumulated `landingModifiers` to landing roll
- Apply `bombRunModifier` to O-6 roll
- Handle special cases (ball turret trapped + gear inop = KIA)
- **Test**: End-to-end mission with damage through landing

### Commit 6: Edge cases & polish
- Handle `see` references in damage tables (P-3 rolls 9/10/11 reference other rolls)
- Handle cumulative tracking (rudder hits, tailplane root hits, window hits)
- Handle `condition: "bombs_aboard"` checks
- Oxygen cumulative hits (2 = knockout per §12.0)
- Fire extinguish sequence integration for oxygen fire results

---

## Key Design Decisions

1. **Pattern matching vs. lookup table**: Use keyword pattern matching on outcome text. The sub-roll outcome strings are already descriptive enough to parse reliably, and this avoids maintaining a parallel data structure that could drift from the JSON tables.

2. **Generator-based sub-rolls**: The existing generator/yield pattern (`_yieldCombatRoll`) is perfect for sub-rolls. Each sub-roll is just another yield point — the player sees a roll prompt, rolls, and the generator resumes.

3. **`_applySubRollEffect` should also be a generator**: Some sub-roll outcomes trigger further rolls (crew wounds via B1-4, fire extinguishing via B1-3). Making it a generator allows seamless chaining.

4. **Landing modifiers are cumulative on `MissionState`**: They accumulate during the mission and reset between missions. The `AircraftState` boolean flags persist across missions for the campaign's aircraft status display, but the numeric modifier is mission-scoped.

5. **Bomb run modifier is new**: Add `bombRunModifier` to `MissionState`, apply it wherever O-6 is rolled.
