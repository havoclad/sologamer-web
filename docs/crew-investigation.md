# Crew Investigation — B-17 Queen of the Skies

## 1. Current CrewMember Type

From `src/games/b17/types.ts`:

```typescript
export interface CrewMember {
  position: CrewPosition;
  name: string;
  wounds: WoundSeverity;        // 'none' | 'light' | 'serious' | 'mortal' | 'kia'
  frostbite: boolean;
  kills: number;
  missions: number;
  status: 'active' | 'hospital' | 'pow' | 'kia' | 'mia';
}
```

This is a flat, minimal object. Several important pieces of state are missing (detailed in §7 below).

## 2. All Crew Positions

```typescript
type CrewPosition =
  | 'pilot' | 'copilot' | 'navigator' | 'bombardier'
  | 'engineer' | 'radioman'
  | 'ball_turret' | 'left_waist' | 'right_waist' | 'tail_gunner';
```

**10 positions total.** Notes:

| Position | Compartment | Gun(s) Operated | Special Role |
|----------|------------|-----------------|-------------|
| pilot | Pilot Compt. | None | Flies plane; experience bonus for landing (11-25 missions) |
| copilot | Pilot Compt. | None | Backup pilot; same experience bonus |
| navigator | Nose | Port Cheek, Starboard Cheek | Navigation (abort if down per §8.0) |
| bombardier | Nose | Nose gun | Bomb run bonus (11-25 missions); accuracy |
| engineer | Port Wing area | Top Turret | — |
| radioman | Radio Room | Radio gun | Operates radio (affects bailout over water, landing mods) |
| ball_turret | Starboard Wing area | Ball Turret | Cannot operate if ballTurretInop |
| left_waist | Waist | Port Waist | Can swap to right_waist gun (with penalty) |
| right_waist | Waist | Starboard Waist | Can swap to left_waist gun (with penalty) |
| tail_gunner | Tail | Tail guns | — |

## 3. All Status Values

### `status` field (campaign-level):
- `'active'` — available for missions
- `'hospital'` — recovering from serious wounds (post-mission survival roll)
- `'pow'` — prisoner of war (bailout over enemy territory)
- `'kia'` — killed in action
- `'mia'` — missing in action (bailout, fate unknown)

### `wounds` field (mission-level severity):
- `'none'` — no wounds
- `'light'` — may continue duties (but see accumulation rules)
- `'serious'` — cannot continue duties, cannot bail out
- `'mortal'` — effectively kia (treated same as kia in `accumulateWound`)
- `'kia'` — killed

### Bailout fates (from `bailout.ts`, not stored on CrewMember):
- `'kia'` | `'drowned'` | `'pow'` | `'evaded'` | `'rescued'` | `'rescued_pow'`

These should map back to `status` post-mission but there's no explicit mapping code.

## 4. Wound System

### Severity (Table B1-4)
- **1d6**: 1-3 = light, 4-5 = serious, 6 = KIA

### Accumulation Rules (B1-4 notes)
- **2nd light wound**: combat penalties (gunners must roll 6 to hit; bombardier loses bonus; pilot/copilot lose landing bonus; bailout G-6 is -1)
- **3 light wounds** = serious wound
- **4 light wounds** = KIA
- **Light + serious** = KIA
- **Serious + any** = KIA

### Post-Landing Survival (B1-4 note b)
For each seriously wounded crewman after landing:
- 1 = rapid recovery, may fly next mission
- 2-5 = recovery, may not fly again
- 6 = wounds fatal, dies

### Current Code Gap
**`accumulateWound()` in `damage.ts` acknowledges it can't track light wound count:**
> "The caller should track light wound count separately."

The `wounds` field is a single `WoundSeverity` enum — there is **no count of light wounds**. The code returns `'light'` for light+light, losing track of whether it's the 2nd, 3rd, or 4th light wound. This is the **biggest gap** in the current model.

## 5. Crew-Specific Attributes

### Currently Tracked
- **frostbite** (`boolean`) — set when heating is out and crew fails frostbite roll (1-3 on 1d6). Affects: must roll 6 to hit. Post-mission: 1-3 = grounded, 4-6 = recovers.
- **kills** (`number`) — fighter kills (for ace status tracking)
- **missions** (`number`) — missions completed (for experience bonuses at 11-25)

### Referenced in Code but NOT Tracked on CrewMember
- **Ace gunner** — `resolveDefensiveFire()` takes `aceBonus: boolean` param. Random event "ace for a day" designates engineer/ball/tail. But there's no `isAce` or `aceForADay` field on CrewMember. The caller must track this externally.
- **Light wound count** — `twoLightWounds: boolean` param in `resolveDefensiveFire()`. Not stored anywhere on the crew member.
- **Wrong position** — `wrongPosition: boolean` param in `resolveDefensiveFire()`. When crew are reassigned to fill gaps (e.g., waist gunner covering for dead tail gunner), they fire at penalty. No field tracks original vs current position.
- **Experience bonuses** — pilot/copilot 11-25 missions affects landing modifier. Bombardier 11-25 missions affects bomb run. Checked via `member.missions >= 11` inline.

### Referenced in Rules/Tables but Not in Code
- **Spray fire** (Table M-5) — exists as a JSON table but no code references it. Allows a single gun to fire at 2 fighters but at penalty.
- **Crew swapping** (§14.2) — rules say any crew can man any gun at penalty (must roll 6), except ball↔top turret and waist↔waist which swap freely. No tracking of "current gun assignment" vs "natural gun assignment."

## 6. Gun Assignment

From `guns.ts`, the mapping is:

| Gun ID | Crew Position | Twin? | Ammo |
|--------|--------------|-------|------|
| Nose | bombardier | No | 12 |
| Port_Cheek | navigator | No | 12 |
| Starboard_Cheek | navigator | No | 12 |
| Top_Turret | engineer | Yes | 16 |
| Ball_Turret | ball_turret | Yes | 16 |
| Port_Waist | left_waist | No | 12 |
| Starboard_Waist | right_waist | No | 12 |
| Radio | radioman | No | 8 |
| Tail | tail_gunner | Yes | 16 |

**Gun eligibility** (`isGunEligible` in `guns.ts`):
```typescript
member.status === 'active' && member.wounds !== 'serious' && member.wounds !== 'kia'
```
Note: this allows a lightly wounded (even multiply) crew member to fire. The `twoLightWounds` penalty (must roll 6) is handled separately in `resolveDefensiveFire()` but the caller must figure out the count.

**Navigator operates 2 guns** (Port Cheek + Starboard Cheek) but per §9.1 only 2 of 3 nose section guns may fire simultaneously (Nose + one cheek, or both cheeks).

**Pilot and copilot operate no guns.** They fly the plane.

## 7. Missing / Incomplete State

### Critical Gaps

1. **Light wound count** — The single `wounds: WoundSeverity` field cannot represent "2 light wounds" vs "1 light wound." This affects:
   - Combat penalties (must roll 6 after 2nd light wound)
   - Bombardier bomb run penalty
   - Pilot/copilot landing bonus loss
   - Bailout modifier
   - Escalation to serious (3rd) and KIA (4th)

2. **Ace status / ace-for-a-day** — `resolveDefensiveFire` accepts `aceBonus` but nothing on CrewMember tracks it. The random event system designates aces but has no place to store it.

3. **Current gun assignment vs natural position** — When crew are reassigned after casualties, the `wrongPosition` penalty applies. No field tracks whether a crew member is operating their own gun or someone else's.

4. **Post-mission status transitions** — Bailout fates (`pow`, `evaded`, `rescued`, `drowned`) and serious wound survival rolls aren't wired back into `CrewMember.status`. The `BailoutResult` type exists but the mapping to campaign state is ad-hoc.

### Minor Gaps

5. **Frostbite recovery** — `rollFrostbiteRecovery()` returns `'grounded' | 'recovers'` but nothing applies this to crew status post-mission.

6. **Spray fire** — Table M-5 exists but is unused. Would need tracking of which gun is spray-firing.

7. **Experience bonus tracking** — Currently just `missions >= 11`, but the rules cap it at 25 missions. No explicit `experienced` flag; inline math works but is fragile.

8. **Replacement crew tracking** — When a crew member is lost, replacements come in. No way to distinguish original crew from replacements (relevant for campaign narrative).

## 8. Recommended Fields for New CrewMember Object

```typescript
interface CrewMember {
  // Identity
  id: string;                          // unique id for tracking across missions
  name: string;
  position: CrewPosition;              // assigned position (natural)

  // Campaign state
  status: CrewStatus;                  // 'active' | 'hospital' | 'pow' | 'kia' | 'mia' | 'grounded' | 'evaded'
  missions: number;                    // missions completed (for experience bonuses)
  kills: number;                       // confirmed fighter kills
  isOriginal: boolean;                 // original crew vs replacement

  // Mission state (reset each mission)
  wounds: WoundSeverity;               // current worst wound level
  lightWoundCount: number;             // track accumulation (0-4, escalates at 3→serious, 4→KIA)
  frostbite: boolean;                  // frostbitten this mission
  currentGunAssignment: GunPosition | null;  // which gun they're currently on (null = none/pilot/copilot)
  isAtNaturalPosition: boolean;        // false = wrong position penalty applies
  aceForADay: boolean;                 // random event temporary ace bonus

  // Derived / convenience (could be computed)
  isExperienced: boolean;              // missions >= 11 && missions <= 25
  canPerformDuties: boolean;           // wounds < serious && status === active
  canBailOut: boolean;                 // wounds < serious
}
```

### Key Design Decisions for Designer

1. **Split mission state from campaign state?** The current object mixes them. Consider a `MissionCrewState` that gets created fresh each mission and merged back into campaign `CrewMember` post-mission.

2. **Light wound count is essential.** This is the #1 gap. The entire wound accumulation system depends on counting light wounds separately from the severity enum.

3. **Gun assignment should probably live on the Gun object** (it already has `crewPosition`), with the CrewMember tracking its "current assigned gun" for wrong-position detection. Or add a `currentOperator: CrewPosition` to Gun.

4. **Ace status** has two flavors: "ace for a day" (random event, temporary) and true ace (5+ kills per campaign rules if using optional rule). Both need representation.

5. **Status enum needs expansion** — `'grounded'` (frostbite permanent) and `'evaded'` (returned by Underground) are missing from the current union type.
