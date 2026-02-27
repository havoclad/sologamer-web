# CrewMember Design — B-17 Queen of the Skies

## 1. CrewMember Interface

```typescript
// ── Enums & Types ──

type CrewPosition =
  | 'pilot' | 'copilot' | 'navigator' | 'bombardier'
  | 'engineer' | 'radioman'
  | 'ball_turret' | 'left_waist' | 'right_waist' | 'tail_gunner';

type GunPosition =
  | 'Nose' | 'Port_Cheek' | 'Starboard_Cheek'
  | 'Top_Turret' | 'Ball_Turret'
  | 'Port_Waist' | 'Starboard_Waist'
  | 'Radio' | 'Tail';

/** Campaign-level crew status. Determines availability for future missions. */
type CrewStatus =
  | 'active'      // available for missions
  | 'hospital'    // recovering from serious wounds (survival roll passed)
  | 'grounded'    // permanent frostbite — cannot fly again
  | 'pow'         // prisoner of war
  | 'mia'         // missing in action
  | 'kia'         // killed in action
  | 'evaded';     // evaded capture, returned via Underground

/** In-mission wound level. Tracks worst single wound received. */
type WoundSeverity = 'none' | 'light' | 'serious' | 'kia';
// 'mortal' is removed — treat as 'kia' immediately per rules.

interface CrewMember {
  // ── Identity ──
  id: string;                    // unique, stable id (e.g., 'crew-001')
  name: string;                  // display name
  position: CrewPosition;        // assigned/natural crew position

  // ── Campaign State (persists across missions) ──
  status: CrewStatus;            // default: 'active'
  missions: number;              // missions completed, default: 0
  kills: number;                 // confirmed fighter kills, default: 0
  isOriginal: boolean;           // true for starting crew, false for replacements

  // ── Mission State (reset at start of each mission) ──
  woundSeverity: WoundSeverity;  // worst wound this mission, default: 'none'
  lightWounds: number;           // count of light wounds, 0–3. At 3 → escalate to serious. default: 0
  frostbite: boolean;            // frostbitten this mission, default: false
  currentGunPosition: GunPosition | null;  // gun currently operating, null = no gun (pilot/copilot or unassigned)
  aceForADay: boolean;           // random event: temporary ace bonus this mission, default: false
}
```

### Default Values (new crew member)

```typescript
const defaults: Omit<CrewMember, 'id' | 'name' | 'position'> = {
  status: 'active',
  missions: 0,
  kills: 0,
  isOriginal: true,       // false for replacements
  woundSeverity: 'none',
  lightWounds: 0,
  frostbite: false,
  currentGunPosition: null, // set during mission setup from NATURAL_GUN_MAP
  aceForADay: false,
};
```

---

## 2. Status Transitions

### In-Mission Wound Accumulation

```
                  light wound
    none ──────────────────────► lightWounds=1, woundSeverity='light'
                                      │
                  light wound          │
                                      ▼
                               lightWounds=2, woundSeverity='light'
                               (combat penalty: must roll 6 to hit,
                                bombardier loses bonus, pilot/copilot lose landing bonus,
                                bailout modifier -1)
                                      │
                  light wound          │
                                      ▼
                               lightWounds=3 → ESCALATE to woundSeverity='serious'
                               (lightWounds stays at 3 for record)

    any state ────serious wound───► woundSeverity='serious'
                                   (if already had light wounds, still serious — not KIA
                                    UNLESS already serious, then → KIA)

    serious ──────any wound────────► woundSeverity='kia'
    kia (no further changes)
```

**Decision table for `applyWound(crew, incomingSeverity)`:**

| Current woundSeverity | Current lightWounds | Incoming | Result |
|----------------------|--------------------|-----------|------------------------------------|
| none                 | 0                  | light     | lightWounds=1, woundSeverity='light' |
| light                | 1                  | light     | lightWounds=2, woundSeverity='light' (penalty applies) |
| light                | 2                  | light     | lightWounds=3, woundSeverity='serious' (escalation) |
| none/light           | any                | serious   | woundSeverity='serious' |
| serious              | any                | light     | woundSeverity='kia' |
| serious              | any                | serious   | woundSeverity='kia' |
| kia                  | any                | any       | no change |

### Post-Mission Transitions

```
woundSeverity='serious' + landed safely:
  Roll 1d6:
    1     → status='active' (rapid recovery, may fly next mission)
    2-5   → status='hospital' (cannot fly again — remove from roster)
    6     → status='kia' (wounds fatal)

woundSeverity='kia' (in-mission):
  → status='kia'

frostbite=true + survived mission:
  Roll 1d6:
    1-3   → status='grounded' (permanent, cannot fly again)
    4-6   → frostbite=false, status stays 'active' (recovers)

Bailout fate mapping:
  'rescued'     → status='active'
  'evaded'      → status='evaded' (returned, may fly again)
  'pow'         → status='pow'
  'rescued_pow' → status='pow'
  'drowned'     → status='kia'
  'kia'         → status='kia'
```

---

## 3. Gun Assignment Logic

### Natural Gun Map

```typescript
const NATURAL_GUN_MAP: Record<CrewPosition, GunPosition | null> = {
  pilot:        null,
  copilot:      null,
  bombardier:   'Nose',
  navigator:    'Port_Cheek',   // also operates Starboard_Cheek (see below)
  engineer:     'Top_Turret',
  radioman:     'Radio',
  ball_turret:  'Ball_Turret',
  left_waist:   'Port_Waist',
  right_waist:  'Starboard_Waist',
  tail_gunner:  'Tail',
};
```

### Navigator Special Case

The navigator naturally operates **both** Port_Cheek and Starboard_Cheek. However, per §9.1, only 2 of 3 nose-section guns (Nose, Port_Cheek, Starboard_Cheek) may fire simultaneously per attack. The navigator's `currentGunPosition` should be set to `'Port_Cheek'` by default, but the combat system must allow them to fire either cheek gun (choosing per attack). This is a **combat-phase concern**, not a crew-state concern. The crew object just tracks `currentGunPosition: 'Port_Cheek'`.

### Wrong-Position Detection

A crew member is at their **natural position** when:

```typescript
function isAtNaturalPosition(crew: CrewMember): boolean {
  return crew.currentGunPosition === NATURAL_GUN_MAP[crew.position];
}
```

This is a **computed property**, not a stored field. When `isAtNaturalPosition()` returns false and the crew member is operating a gun, the "wrong position" penalty applies (must roll 6 to hit).

### Reassignment Rules

| Swap | Penalty? | Notes |
|------|----------|-------|
| Left waist ↔ Right waist | **No** | Free swap, no penalty |
| Any crew → any gun | **Yes** (must roll 6) | Wrong position penalty |
| Ball turret ↔ Top turret | **Not allowed** | Cannot swap between these two |

### Reassignment Priority

When a gunner is KIA/incapacitated, reassignment candidates (in order):
1. Waist gunner (if swapping to the other waist gun — no penalty)
2. Pilot or copilot (if available and plane can fly with one pilot)
3. Any other non-essential active crew member

---

## 4. Validation Rules

```typescript
// Invariant checks for CrewMember
function validateCrewMember(crew: CrewMember): string[] {
  const errors: string[] = [];

  // lightWounds range
  if (crew.lightWounds < 0 || crew.lightWounds > 3) {
    errors.push(`lightWounds must be 0-3, got ${crew.lightWounds}`);
  }

  // KIA cannot have non-kia wound severity
  if (crew.status === 'kia' && crew.woundSeverity !== 'kia') {
    // Note: KIA from bailout may have woundSeverity='none', so this is a soft warning
  }

  // woundSeverity consistency with lightWounds
  if (crew.lightWounds > 0 && crew.woundSeverity === 'none') {
    errors.push('lightWounds > 0 but woundSeverity is none');
  }
  if (crew.lightWounds >= 3 && crew.woundSeverity === 'light') {
    errors.push('lightWounds >= 3 but woundSeverity is still light (should be serious or kia)');
  }

  // Serious wound means cannot operate gun
  if (crew.woundSeverity === 'serious' && crew.currentGunPosition !== null) {
    errors.push('Seriously wounded crew cannot operate a gun');
  }

  // KIA means no gun
  if (crew.woundSeverity === 'kia' && crew.currentGunPosition !== null) {
    errors.push('KIA crew cannot operate a gun');
  }

  // Non-active campaign status should not have mission state
  if (crew.status !== 'active' && crew.status !== 'evaded') {
    if (crew.woundSeverity !== 'none' || crew.lightWounds !== 0) {
      errors.push(`Crew with status '${crew.status}' should have reset mission state`);
    }
  }

  // missions and kills are non-negative
  if (crew.missions < 0) errors.push('missions cannot be negative');
  if (crew.kills < 0) errors.push('kills cannot be negative');

  return errors;
}
```

---

## 5. Key Methods / Helpers

### Queries

```typescript
/** Can this crew member perform duties this mission? */
function isCrewActive(crew: CrewMember): boolean {
  return crew.status === 'active'
    && crew.woundSeverity !== 'serious'
    && crew.woundSeverity !== 'kia';
}

/** Can this crew member fire a gun? */
function canFireGun(crew: CrewMember): boolean {
  return isCrewActive(crew) && crew.currentGunPosition !== null;
}

/** Does this crew member have the 2-light-wound combat penalty? */
function hasTwoLightWoundPenalty(crew: CrewMember): boolean {
  return crew.lightWounds >= 2 && crew.woundSeverity === 'light';
}

/** Is this crew member experienced (11-25 missions)? */
function isExperienced(crew: CrewMember): boolean {
  return crew.missions >= 11 && crew.missions <= 25;
}

/** Can this crew member bail out? (not seriously wounded or KIA) */
function canBailOut(crew: CrewMember): boolean {
  return crew.woundSeverity !== 'serious' && crew.woundSeverity !== 'kia';
}

/** Is this crew at their natural gun position? */
function isAtNaturalPosition(crew: CrewMember): boolean {
  return crew.currentGunPosition === NATURAL_GUN_MAP[crew.position];
}
```

### Mutations

```typescript
/**
 * Apply a light wound. Increments lightWounds, escalates to serious at 3.
 * If already serious or KIA, escalates to KIA.
 */
function applyLightWound(crew: CrewMember): void {
  if (crew.woundSeverity === 'kia') return;
  if (crew.woundSeverity === 'serious') {
    crew.woundSeverity = 'kia';
    crew.currentGunPosition = null;
    return;
  }
  crew.lightWounds += 1;
  if (crew.lightWounds >= 3) {
    crew.woundSeverity = 'serious';
    crew.currentGunPosition = null;
  } else {
    crew.woundSeverity = 'light';
  }
}

/**
 * Apply a serious wound. If already wounded (light or serious), escalates to KIA.
 */
function applySeriousWound(crew: CrewMember): void {
  if (crew.woundSeverity === 'kia') return;
  if (crew.woundSeverity === 'serious') {
    crew.woundSeverity = 'kia';
  } else {
    crew.woundSeverity = 'serious';
  }
  crew.currentGunPosition = null;
}

/**
 * Apply KIA directly (e.g., from wound severity roll of 6, or 20mm hit).
 */
function applyKia(crew: CrewMember): void {
  crew.woundSeverity = 'kia';
  crew.currentGunPosition = null;
}

/**
 * Apply frostbite to crew member.
 */
function applyFrostbite(crew: CrewMember): void {
  crew.frostbite = true;
}

/**
 * Assign crew member to a gun position.
 * Pass null to unassign (e.g., when seriously wounded or KIA).
 */
function assignGunPosition(crew: CrewMember, gun: GunPosition | null): void {
  crew.currentGunPosition = gun;
}

/**
 * Reset mission-specific state at the start of a new mission.
 */
function resetMissionState(crew: CrewMember): void {
  crew.woundSeverity = 'none';
  crew.lightWounds = 0;
  crew.frostbite = false;
  crew.aceForADay = false;
  crew.currentGunPosition = NATURAL_GUN_MAP[crew.position];
}

/**
 * Apply post-mission serious wound survival roll result.
 */
function applyPostMissionSurvival(crew: CrewMember, roll: number): void {
  if (roll === 1) {
    crew.status = 'active'; // rapid recovery
  } else if (roll >= 2 && roll <= 5) {
    crew.status = 'hospital'; // cannot fly again
  } else {
    crew.status = 'kia'; // wounds fatal
  }
}

/**
 * Apply post-mission frostbite recovery roll result.
 */
function applyFrostbiteRecovery(crew: CrewMember, roll: number): void {
  if (roll <= 3) {
    crew.status = 'grounded';
  } else {
    crew.frostbite = false; // recovers
  }
}

/**
 * Apply bailout fate to campaign status.
 */
function applyBailoutFate(crew: CrewMember, fate: BailoutFate): void {
  const fateMap: Record<BailoutFate, CrewStatus> = {
    'rescued': 'active',
    'evaded': 'evaded',
    'pow': 'pow',
    'rescued_pow': 'pow',
    'drowned': 'kia',
    'kia': 'kia',
  };
  crew.status = fateMap[fate];
}

/**
 * Mark crew member's ace-for-a-day status (random event).
 */
function markAceForADay(crew: CrewMember): void {
  crew.aceForADay = true;
}

/**
 * Increment missions completed (call at end of successful mission).
 */
function incrementMissions(crew: CrewMember): void {
  crew.missions += 1;
}

/**
 * Add a confirmed kill.
 */
function addKill(crew: CrewMember): void {
  crew.kills += 1;
}

/**
 * Create a replacement crew member for a lost position.
 */
function createReplacement(id: string, name: string, position: CrewPosition): CrewMember {
  return {
    id,
    name,
    position,
    status: 'active',
    missions: 0,
    kills: 0,
    isOriginal: false,
    woundSeverity: 'none',
    lightWounds: 0,
    frostbite: false,
    currentGunPosition: NATURAL_GUN_MAP[position],
    aceForADay: false,
  };
}
```

---

## 6. Relationship to Gun Object

### Current Gun Object (from guns.ts)

```typescript
interface Gun {
  id: GunPosition;           // e.g., 'Nose', 'Top_Turret'
  crewPosition: CrewPosition; // natural operator, e.g., 'bombardier' for Nose
  ammo: number;
  jammed: boolean;
  destroyed: boolean;
  twin: boolean;
}
```

### How They Connect

The **Gun** object owns the physical weapon state (ammo, jammed, destroyed, twin mount). The **CrewMember** object owns the operator state (who's at which gun).

```
Gun.id ←──matches──→ CrewMember.currentGunPosition
Gun.crewPosition ←──matches──→ CrewMember.position (natural mapping)
```

**To determine if a gun can fire:**

```typescript
function canGunFire(gun: Gun, crew: CrewMember[]): boolean {
  if (gun.destroyed || gun.jammed || gun.ammo <= 0) return false;
  const operator = crew.find(c => c.currentGunPosition === gun.id);
  if (!operator) return false;
  return isCrewActive(operator);
}
```

**To determine who operates a gun:**

```typescript
function getGunOperator(gun: Gun, crew: CrewMember[]): CrewMember | undefined {
  return crew.find(c => c.currentGunPosition === gun.id);
}
```

**To determine wrong-position penalty for a gun:**

```typescript
function hasWrongPositionPenalty(gun: Gun, crew: CrewMember[]): boolean {
  const operator = getGunOperator(gun, crew);
  if (!operator) return false;
  return !isAtNaturalPosition(operator);
}
```

### Key Principle

- **Gun** knows nothing about who's operating it — it's pure hardware state.
- **CrewMember.currentGunPosition** is the single source of truth for crew-to-gun assignment.
- The `Gun.crewPosition` field is now **reference data only** — it tells you who the _natural_ operator is, useful for `isAtNaturalPosition()` checks and for `resetMissionState()`.

### Migration Note

The existing `isGunEligible(member, gun)` function in `guns.ts` currently checks `member.status === 'active' && member.wounds !== 'serious' && member.wounds !== 'kia'`. This should be replaced with `canGunFire(gun, crew)` which uses `isCrewActive()` and checks the gun's own state. The wound field names change: `wounds` → `woundSeverity`, and `lightWounds` is new.
