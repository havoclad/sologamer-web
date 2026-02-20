/**
 * Combat Resolution — defensive fire, hit damage, German offensive fire,
 * fighter cover defense, and successive attacks.
 *
 * Per §6.3, B-17 Defensive Fire:
 *   a. Each manned MG fires at one fighter in its field of fire (Table M-1).
 *   b. Roll 1d6 per MG; hit if roll >= required number from M-1.
 *   c. For each hit, roll on M-2 for damage (FCA/FBOA/Destroyed).
 *
 * Per §6.4, German Offensive Fire:
 *   a. Roll on M-3 per surviving fighter. Miss = fighter removed (§13.1c exception).
 *   b. Hit → roll B-4 for number of shell hits.
 *   c. Per shell hit, roll B-5 for hit location (compartment).
 *   d. Roll on P-1..P-6, BL-1, BL-2 for specific damage.
 *
 * Per §6.5, Successive Attacks:
 *   a. Any fighter scoring a hit (even if no effect) attacks again.
 *      Roll B-6 for new position. Then apply fighter cover (M-4 successive number).
 *   b. Max 3 attacks per fighter per wave (1 initial + 2 successive).
 *   c. Per §13.1c, out of formation: fighters make all 3 attacks regardless of hits
 *      (unless destroyed or FBOA).
 *
 * Per §6.2, Fighter Cover Defense:
 *   Roll M-4 per wave. Result format "X(Y)" where X = initial, Y = successive.
 *   Remove that many fighters of player's choice (but not Vertical Dive per B-3).
 */

import type { RNG } from '../../../engine/rng.js';
import type { TableStore } from '../../../engine/tables.js';
import type {
  Fighter, FighterType, AttackPosition,
} from './fighter-encounters.js';
import { canBeDrivenOffByCover, getM3AttackGroup } from './fighter-encounters.js';
import type { FighterCoverLevel } from './zone-movement.js';

// ─── Gun positions and field of fire (Table M-1) ───

export type GunPosition =
  | 'Nose' | 'Port_Cheek' | 'Starboard_Cheek'
  | 'Top_Turret' | 'Ball_Turret'
  | 'Port_Waist' | 'Starboard_Waist'
  | 'Radio' | 'Tail';

/**
 * Determine which guns can fire at a fighter at the given position.
 * Returns a map of gun position → required roll to hit.
 *
 * Per Table M-1, each attack position has specific guns that can fire,
 * each requiring a specific die roll (usually 6, sometimes 4 for tail/ball).
 *
 * Per §9.1, only 2 of 3 nose section guns may fire simultaneously.
 * Per §9.2, Tail can fire at 10:30/12/1:30 positions (resolved last, must roll 6).
 */
export function getFieldOfFire(
  position: AttackPosition,
  tables: TableStore,
): Map<GunPosition, number> {
  const m1 = tables.get('M-1');
  if (!m1) throw new Error('M-1 table not found');

  const raw = m1.raw as any;
  const posKey = position.replace(/ /g, '_').replace(':', ':').toLowerCase();
  // Normalize the key to match M-1 JSON format
  const normalizedKey = normalizeM1Key(position);
  const gunData = raw.gun_positions?.[normalizedKey];

  const result = new Map<GunPosition, number>();
  if (!gunData) return result;

  for (const [gun, hitOn] of Object.entries(gunData)) {
    result.set(gun as GunPosition, hitOn as number);
  }

  return result;
}

/** Normalize attack position to M-1 JSON key format */
function normalizeM1Key(position: AttackPosition): string {
  if (position === 'Vertical Dive') return 'vertical_dive';
  if (position === 'Vertical Climb') return 'vertical_climb';

  return position.replace(/ /g, '_').toLowerCase();
}

/**
 * Check if a specific gun hits a fighter.
 *
 * Per §6.3b, roll 1d6; hit if roll >= required number.
 * Per §9.3, Ace Gunner adds 1 to defensive fire roll.
 * Per §15.1b, evasive action: must roll 6 (ace bonus still applies).
 * Per §14.2b, gunner in wrong position: must roll 6 (except ball↔top, waist↔waist).
 * Per §11.0, frostbitten gunner: must roll 6.
 * Per two light wounds: must roll 6.
 */
export function resolveDefensiveFire(
  requiredRoll: number,
  rng: RNG,
  aceBonus: boolean,
  evasiveAction: boolean,
  wrongPosition: boolean,
  frostbitten: boolean,
  twoLightWounds: boolean,
): { roll: number; hit: boolean } {
  const roll = rng.d6();

  // Determine effective required roll
  let effectiveRequired = requiredRoll;

  // These conditions override to requiring 6
  if (evasiveAction || wrongPosition || frostbitten || twoLightWounds) {
    effectiveRequired = 6;
  }

  // Ace bonus: add 1 to the roll (not when using spray fire per §9.5)
  const effectiveRoll = aceBonus ? roll + 1 : roll;

  return {
    roll,
    hit: effectiveRoll >= effectiveRequired,
  };
}

// ─── Hit damage vs fighters (Table M-2) ───

export type FighterDamageResult = 'FCA' | 'FBOA' | 'Destroyed';

/**
 * Roll on Table M-2 to determine damage to a hit fighter per §6.3c.
 *
 * Per M-2 notes:
 *   - Twin guns (Ball, Top Turret, Tail) add +1 to M-2 roll.
 *   - FCA: fighter damaged, continues attack with -1 to M-3 roll.
 *   - FBOA: fighter breaks off, removed from play.
 *   - Destroyed: fighter destroyed, removed from play.
 *   - 2+ FCA = FBOA; 2+ FBOA = Destroyed; FCA + FBOA = FBOA.
 */
export function rollFighterDamage(
  rng: RNG,
  tables: TableStore,
  isTwinGun: boolean,
): FighterDamageResult {
  const modifier = isTwinGun ? 1 : 0;
  const roll = Math.min(6, rng.d6() + modifier);

  // M-2: 1–3 = FCA, 4–5 = FBOA, 6 = Destroyed
  if (roll <= 3) return 'FCA';
  if (roll <= 5) return 'FBOA';
  return 'Destroyed';
}

/**
 * Check if a gun position is a twin mount.
 * Per M-2 notes: Ball Turret, Top Turret, and Tail are twin mounts.
 */
export function isTwinGunMount(gun: GunPosition): boolean {
  return gun === 'Ball_Turret' || gun === 'Top_Turret' || gun === 'Tail';
}

/**
 * Apply cumulative damage to a fighter per M-2 notes.
 *
 * Per M-2: "2 or more FCA = FBOA", "2 or more FBOA = Destroyed",
 *          "FCA + FBOA = FBOA"
 */
export function applyFighterDamage(
  fighter: Fighter,
  newDamage: FighterDamageResult,
): { status: 'active' | 'breaks_off' | 'destroyed' } {
  if (newDamage === 'Destroyed') {
    return { status: 'destroyed' };
  }

  fighter.damage.push(newDamage === 'FCA' ? 'FCA' : 'FBOA');

  const fcaCount = fighter.damage.filter(d => d === 'FCA').length;
  const fboaCount = fighter.damage.filter(d => d === 'FBOA').length;

  // 2+ FBOA = Destroyed
  if (fboaCount >= 2) return { status: 'destroyed' };
  // 2+ FCA = FBOA
  if (fcaCount >= 2) return { status: 'breaks_off' };
  // FCA + FBOA = FBOA
  if (fcaCount >= 1 && fboaCount >= 1) return { status: 'breaks_off' };
  // Single FBOA
  if (fboaCount >= 1) return { status: 'breaks_off' };

  return { status: 'active' };
}

// ─── German Offensive Fire (Table M-3) ───

/**
 * Roll on Table M-3 for a fighter's offensive fire against the B-17 per §6.4a.
 *
 * Per M-3: the hit number depends on attack position group and fighter type.
 * Per M-3 notes: "Regardless of any modifiers in effect, a roll of 6 is always a hit."
 * Per §10.2: two+ engines out → fighters add +1 to M-3 roll.
 * Per §15.1a: evasive action → fighters subtract 1 from M-3 roll (but 6 always hits).
 * Per M-2: FCA modifier → -1 to M-3 roll.
 */
export function resolveGermanOffensiveFire(
  fighter: Fighter,
  rng: RNG,
  tables: TableStore,
  engineModifier: number,
  evasiveActionModifier: number,
): { roll: number; hit: boolean } {
  const raw = (tables.get('M-3')?.raw as any)?.attack_position;
  if (!raw) throw new Error('M-3 attack_position data not found');

  const attackGroup = getM3AttackGroup(fighter.position);
  const groupData = raw[attackGroup];
  if (!groupData) throw new Error(`M-3 attack group ${attackGroup} not found`);

  // Get fighter type key for M-3 lookup
  const typeKey = fighter.type === 'Me109' ? '109' :
                  fighter.type === 'Me110' ? '110' : '190';
  const hitNumbers: number[] = groupData[typeKey]?.hit_on;
  if (!hitNumbers) throw new Error(`M-3 hit numbers for ${typeKey} at ${attackGroup} not found`);

  const roll = rng.d6();

  // Apply modifiers
  const fcaDamage = fighter.damage.filter(d => d === 'FCA').length;
  const totalModifier = engineModifier + evasiveActionModifier - fcaDamage;
  const modifiedRoll = roll + totalModifier;

  // Per M-3: "a roll of 6 is always a hit"
  const hit = roll === 6 || hitNumbers.includes(modifiedRoll);

  return { roll, hit };
}

// ─── Fighter Cover Defense (Table M-4) ───

export interface FighterCoverResult {
  /** Fighters driven off before initial attack */
  initialDrivenOff: number;
  /** Fighters driven off during successive attack phase */
  successiveDrivenOff: number;
}

/**
 * Roll for fighter cover defense per §6.2 on Table M-4.
 *
 * Per §6.2: only in Zones 2–4. Roll once per wave.
 * Result format "X(Y)" where X = initial, Y = successive.
 * Player chooses which fighters to remove (but not Vertical Dive per B-3).
 *
 * Per O-1 notes: bad/poor weather → M-4 modifier -1.
 */
export function rollFighterCoverDefense(
  coverLevel: FighterCoverLevel,
  rng: RNG,
  tables: TableStore,
  modifier: number,
): FighterCoverResult {
  const m4 = tables.getRoll('M-4');
  if (!m4) throw new Error('M-4 table not found');

  const roll = Math.max(1, Math.min(6, rng.d6() + modifier));
  const entry = m4.entries.get(String(roll));
  if (!entry) throw new Error(`M-4 entry for roll ${roll} not found`);

  const coverData = (entry as any)[coverLevel];
  if (!coverData) throw new Error(`M-4 cover level ${coverLevel} not found for roll ${roll}`);

  const resultStr = coverData.result as string; // e.g., "2(1)"
  const match = resultStr.match(/^(\d+)\((\d+)\)$/);
  if (!match) throw new Error(`Cannot parse M-4 result: ${resultStr}`);

  return {
    initialDrivenOff: parseInt(match[1], 10),
    successiveDrivenOff: parseInt(match[2], 10),
  };
}

/**
 * Remove fighters driven off by fighter cover.
 * Per §6.2: player chooses which fighters to remove.
 * Per B-3 notes: Vertical Dive fighters cannot be driven off by fighter cover.
 *
 * Strategy: remove highest-threat fighters first (most guns, front attackers).
 */
export function removeDrivenOffFighters(
  fighters: Fighter[],
  count: number,
): { remaining: Fighter[]; removed: Fighter[] } {
  const removable = fighters.filter(f => canBeDrivenOffByCover(f.position));
  const nonRemovable = fighters.filter(f => !canBeDrivenOffByCover(f.position));

  const toRemove = Math.min(count, removable.length);
  const removed = removable.slice(0, toRemove);
  const remaining = [...removable.slice(toRemove), ...nonRemovable];

  return { remaining, removed };
}

// ─── Successive Attacks (Table B-6) ───

/**
 * Roll for successive attack position on Table B-6 per §6.5a.
 */
export function rollSuccessiveAttackPosition(
  rng: RNG,
  tables: TableStore,
): AttackPosition {
  const result = tables.lookup('B-6', rng);
  if (!result) throw new Error('Failed to look up successive attack on B-6');

  return result.entry.position as AttackPosition;
}

/**
 * Determine which fighters make successive attacks per §6.5.
 *
 * Per §6.5a: any fighter that scored a hit makes a successive attack.
 * Per §6.5b: max 3 attacks total (1 initial + 2 successive).
 * Per §13.1c: out of formation → all fighters make 3 attacks regardless
 *   of hitting (unless destroyed or FBOA).
 */
export function getSuccessiveAttackers(
  fighters: Fighter[],
  outOfFormation: boolean,
): Fighter[] {
  return fighters.filter(f => {
    // Fighter must still be active (not destroyed or FBOA)
    const fboaCount = f.damage.filter(d => d === 'FBOA').length;
    if (fboaCount > 0) return false;

    // Max 3 attacks per wave
    if (f.attacksMade >= 3) return false;

    // Out of formation: always attacks again (per §13.1c)
    if (outOfFormation) return true;

    // In formation: only if scored a hit
    return f.scoredHit;
  });
}

// ─── Shell hits (Table B-4) ───

/**
 * Roll for number of shell hits on Table B-4 per §6.4b.
 *
 * Per B-4 notes:
 *   - FW190: multiply shell hits by 1.5 (round down).
 *   - Me110: add +1 to shell hits.
 */
export function rollShellHits(
  fighter: Fighter,
  rng: RNG,
  tables: TableStore,
): number {
  const b4 = tables.get('B-4');
  if (!b4) throw new Error('B-4 table not found');

  const raw = b4.raw as any;

  // Get the correct attack position group
  const { clock } = parseAttackPositionForB4(fighter.position);
  const posData = raw.attack_positions?.[clock];
  if (!posData) throw new Error(`B-4 position group ${clock} not found`);

  const roll = rng.twod6();
  const hits = posData.rolls?.[String(roll)] ?? 0;

  // Apply fighter type modifiers per B-4 notes
  let modifiedHits = hits;
  if (fighter.type === 'FW190') {
    modifiedHits = Math.floor(hits * 1.5);
  } else if (fighter.type === 'Me110') {
    modifiedHits = hits + 1;
  }

  return modifiedHits;
}

function parseAttackPositionForB4(position: AttackPosition): { clock: string } {
  if (position === 'Vertical Dive') return { clock: 'vertical_dive' };
  if (position === 'Vertical Climb') return { clock: 'vertical_climb' };

  const parts = position.split(' ');
  const clockPart = parts.slice(0, -1).join(' ');

  switch (clockPart) {
    case '12':
    case '1:30':
    case '10:30': return { clock: '12_1:30_10:30' };
    case '3':
    case '9': return { clock: '3_9' };
    case '6': return { clock: '6' };
    default: return { clock: '12_1:30_10:30' };
  }
}
