/**
 * Fighter Encounters — determining waves, fighter types, and positions.
 *
 * Per §6.1a, roll for number of waves on Table B-1 (non-target zones)
 * or Table B-2 (target zone).
 *
 * Per §6.1b, for each wave roll on Table B-3 (d6d6) to determine the
 * specific fighters and their attack clock positions.
 *
 * Per §13.1a, out of formation: add 1 Me109 at 12 Level per wave.
 * Per §13.1b, out of formation: ignore squadron position modifier and
 *   ignore lead/tail extra fighter.
 * Per §13.1c, out of formation: every fighter makes 3 attacks regardless
 *   of whether it hits (unless destroyed or FBOA).
 *
 * Per §5.1c, lead/tail bomber: +1 fighter per wave (if in formation).
 *
 * Special positions per B-3 notes:
 *   - Vertical Dive: only Top Turret and Radio Room may fire (must roll 6);
 *     cannot be driven off by fighter cover.
 *   - Vertical Climb: only Ball Turret may fire (must roll 3–6);
 *     CAN be driven off by fighter cover.
 *   - "No Attackers" (rolls 16,26,36,46,56): fighters driven off by other
 *     B-17s. If out of formation, roll again.
 *   - Roll 66: Random Events (optional rule, Table B-7). Treat as "No
 *     Attackers" if not using optional rules.
 */

import type { RNG } from '../../../engine/rng.js';
import type { TableStore } from '../../../engine/tables.js';

// ─── Fighter types ───

export type FighterType = 'Me109' | 'Me110' | 'FW190';

export type AttackPosition =
  | '12 High' | '12 Level' | '12 Low'
  | '1:30 High' | '1:30 Level' | '1:30 Low'
  | '3 High' | '3 Level' | '3 Low'
  | '6 High' | '6 Level' | '6 Low'
  | '9 High' | '9 Level' | '9 Low'
  | '10:30 High' | '10:30 Level' | '10:30 Low'
  | 'Vertical Dive' | 'Vertical Climb';

export interface Fighter {
  id: number;
  type: FighterType;
  position: AttackPosition;
  /** Damage markers: FCA (continues attack -1), FBOA (breaks off), Destroyed */
  damage: ('FCA' | 'FBOA')[];
  /** Number of attacks made this wave (max 3 per §6.5b) */
  attacksMade: number;
  /** Whether fighter scored a hit in current attack */
  scoredHit: boolean;
}

// ─── Wave determination ───

export interface WaveResult {
  waveCount: number;
}

/**
 * Roll for number of fighter waves per §6.1a.
 *
 * Table B-1 for non-target zones, B-2 for target zone.
 * Modifiers from squadron position, gazetteer, weather, etc.
 */
export function rollFighterWaves(
  isTargetZone: boolean,
  modifier: number,
  rng: RNG,
  tables: TableStore,
): WaveResult {
  const tableName = isTargetZone ? 'B-2' : 'B-1';
  const result = tables.lookup(tableName, rng, modifier);
  if (!result) throw new Error(`Failed to look up fighter waves on ${tableName}`);

  return {
    waveCount: (result.entry.fighter_waves as number) ?? 0,
  };
}

/**
 * Roll on Table B-3 to determine attacking fighters for one wave per §6.1b.
 *
 * Returns the fighters for this wave. Handles "No Attackers" results
 * by returning an empty array (caller must handle re-roll if out of formation).
 *
 * Per §13.1a, if out of formation, add 1 Me109 at 12 Level.
 * Per §5.1c, if lead/tail bomber (in formation), add 1 extra fighter
 * (the extra fighter type/position is determined by another B-3 roll per the MC).
 */
export function rollAttackingFighters(
  rng: RNG,
  tables: TableStore,
  outOfFormation: boolean,
  nextFighterId: number,
): { fighters: Fighter[]; isNoAttackers: boolean; isRandomEvent: boolean; roll: number } {
  // B-3 uses d6d6
  const roll = rng.d6d6();
  const entry = tables.lookupValue('B-3', roll);
  if (!entry) throw new Error(`No B-3 entry for roll ${roll}`);

  // Check for special results
  const desc = entry.description as string;
  const isNoAttackers = desc?.includes('NO ATTACKERS') ?? false;
  const isRandomEvent = entry.trigger === 'random_events';

  if (isNoAttackers || isRandomEvent) {
    return { fighters: [], isNoAttackers: true, isRandomEvent, roll };
  }

  const rawFighters = entry.fighters as Array<{
    type: string;
    position: string;
    count: number;
  }>;

  let id = nextFighterId;
  const fighters: Fighter[] = rawFighters.map(f => ({
    id: id++,
    type: f.type as FighterType,
    position: f.position as AttackPosition,
    damage: [],
    attacksMade: 0,
    scoredHit: false,
  }));

  // Per §13.1a: out of formation adds 1 Me109 at 12 Level per wave
  if (outOfFormation) {
    fighters.push({
      id: id++,
      type: 'Me109',
      position: '12 Level',
      damage: [],
      attacksMade: 0,
      scoredHit: false,
    });
  }

  return { fighters, isNoAttackers: false, isRandomEvent: false, roll };
}

/**
 * Roll attacking fighters with re-roll for out-of-formation "No Attackers" results.
 *
 * Per B-3 note (c): "If out of formation, roll again" when No Attackers is rolled.
 * Limits re-rolls to prevent infinite loops (max 10 attempts).
 */
export function rollAttackingFightersWithReroll(
  rng: RNG,
  tables: TableStore,
  outOfFormation: boolean,
  nextFighterId: number,
  maxRerolls = 10,
): { fighters: Fighter[]; rolls: number[] } {
  const rolls: number[] = [];
  let attempt = 0;

  while (attempt < maxRerolls) {
    const result = rollAttackingFighters(rng, tables, outOfFormation, nextFighterId);
    rolls.push(result.roll);

    if (!result.isNoAttackers || !outOfFormation) {
      return { fighters: result.fighters, rolls };
    }

    attempt++;
  }

  // After max rerolls, return empty (extremely unlikely)
  return { fighters: [], rolls };
}

/**
 * Add the extra fighter for lead/tail bomber per §5.1c.
 * Per §13.1b, this extra fighter is NOT added when out of formation.
 *
 * The extra fighter is always Me109 at 12 Level (standard practice).
 */
export function addLeadTailExtraFighter(
  fighters: Fighter[],
  nextFighterId: number,
): Fighter[] {
  return [
    ...fighters,
    {
      id: nextFighterId,
      type: 'Me109' as FighterType,
      position: '12 Level' as AttackPosition,
      damage: [],
      attacksMade: 0,
      scoredHit: false,
    },
  ];
}

// ─── Fighter position helpers ───

/**
 * Check if a fighter position is Vertical Dive.
 * Per B-3 notes: B-17 cannot fire at Vertical Dive fighter (except Top Turret
 * and Radio Room at 6 to hit), nor may it be driven off by fighter cover.
 */
export function isVerticalDive(position: AttackPosition): boolean {
  return position === 'Vertical Dive';
}

/**
 * Check if a fighter position is Vertical Climb.
 * Per B-3 notes: only Ball Turret may fire (3–6 to hit),
 * and this fighter CAN be driven off by fighter cover.
 */
export function isVerticalClimb(position: AttackPosition): boolean {
  return position === 'Vertical Climb';
}

/**
 * Check if fighter can be driven off by fighter cover.
 * Per B-3 notes: Vertical Dive cannot be driven off. All others can.
 */
export function canBeDrivenOffByCover(position: AttackPosition): boolean {
  return position !== 'Vertical Dive';
}

/**
 * Parse attack position into clock and altitude components.
 */
export function parsePosition(position: AttackPosition): {
  clock: string;
  altitude: 'High' | 'Level' | 'Low' | 'Vertical Dive' | 'Vertical Climb';
} {
  if (position === 'Vertical Dive') return { clock: 'vertical', altitude: 'Vertical Dive' };
  if (position === 'Vertical Climb') return { clock: 'vertical', altitude: 'Vertical Climb' };

  const parts = position.split(' ');
  const altitude = parts[parts.length - 1] as 'High' | 'Level' | 'Low';
  const clock = parts.slice(0, -1).join(' ');
  return { clock, altitude };
}

/**
 * Get the M-3 attack group for an attack position.
 * Per Table M-3 structure:
 *   - 12 (any altitude) → "12_high_level_low"
 *   - 10:30/1:30 (any altitude) → "10:30_1:30_high_level_low"
 *   - 3/9 (any altitude) → "3_9_high_level_low"
 *   - 6 (any altitude) → "6_high_level_low"
 *   - Vertical Dive → "vertical_dive"
 *   - Vertical Climb → "vertical_climb"
 */
export function getM3AttackGroup(position: AttackPosition): string {
  if (position === 'Vertical Dive') return 'vertical_dive';
  if (position === 'Vertical Climb') return 'vertical_climb';

  const { clock } = parsePosition(position);
  switch (clock) {
    case '12': return '12_high_level_low';
    case '10:30':
    case '1:30': return '10:30_1:30_high_level_low';
    case '3':
    case '9': return '3_9_high_level_low';
    case '6': return '6_high_level_low';
    default: return '12_high_level_low'; // fallback
  }
}

/**
 * Get the B-4 attack group for shell hit determination.
 * Per Table B-4 structure:
 *   - 12/1:30/10:30 → "12_1:30_10:30"
 *   - 3/9 → "3_9"
 *   - 6 → "6"
 *   - Vertical Dive → "vertical_dive"
 *   - Vertical Climb → "vertical_climb"
 */
export function getB4AttackGroup(position: AttackPosition): string {
  if (position === 'Vertical Dive') return 'vertical_dive';
  if (position === 'Vertical Climb') return 'vertical_climb';

  const { clock } = parsePosition(position);
  switch (clock) {
    case '12':
    case '1:30':
    case '10:30': return '12_1:30_10:30';
    case '3':
    case '9': return '3_9';
    case '6': return '6';
    default: return '12_1:30_10:30';
  }
}

/**
 * Get the B-5 attack group and altitude for compartment hit location.
 * B-5 is keyed by attack position group + altitude.
 */
export function getB5AttackKey(position: AttackPosition): {
  group: string;
  altitude: string;
} {
  if (position === 'Vertical Dive') return { group: 'vertical_dive', altitude: 'all' };
  if (position === 'Vertical Climb') return { group: 'vertical_climb', altitude: 'all' };

  const { clock, altitude } = parsePosition(position);
  let group: string;
  switch (clock) {
    case '12':
    case '1:30':
    case '10:30': group = '12_1:30_10:30'; break;
    case '3':
    case '9': group = '3_9'; break;
    case '6': group = '6'; break;
    default: group = '12_1:30_10:30'; break;
  }

  return { group, altitude: altitude.toLowerCase() };
}
