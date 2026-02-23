/**
 * Damage Resolution — shell hit locations, compartment damage, engine damage,
 * fuel, oxygen, fire, crew wounds and casualties.
 *
 * Per §6.4c, for each shell hit roll on Table B-5 to find which compartment
 * is hit, then roll on the appropriate damage table (P-1 through P-6, BL-1, BL-2).
 *
 * Per §6.4d, resolve specific damage for each hit.
 *
 * Per §10.0, engine damage has progressive effects:
 *   - 1 engine out: jettison bombs to stay in formation (§10.1)
 *   - 2–3 engines out: must drop out of formation, 10k ft (§10.2)
 *   - 3 engines out (1 operating): can go 1 more zone then crash/bail (§10.3)
 *   - All 4 out: immediate crash land or bail out (§10.4)
 *
 * Per §12.0, oxygen system: 2 cumulative hits to a compartment's oxygen → knockout.
 * Per §12.2, oxygen fires: must be fought with extinguishers (Table BL-3).
 * Per §11.0, heat out: roll for frostbite each zone (1–3 = frostbite, 4–6 = ok).
 */

import type { RNG } from '../../../engine/rng.js';
import type { TableStore } from '../../../engine/tables.js';
import type { AircraftState, CrewPosition, WoundSeverity } from '../types.js';
import type { AttackPosition } from './fighter-encounters.js';
import { getB5AttackKey } from './fighter-encounters.js';

// ─── Hit location (Table B-5) ───

export type HitLocation =
  | 'Nose' | 'Pilot Compt.' | 'Bomb Bay' | 'Radio Room'
  | 'Waist' | 'Tail' | 'Port Wing' | 'Starboard Wing'
  | 'Wings' | 'Superficial' | 'Walking Hits/Fuselage';

export interface ShellHitLocation {
  location: HitLocation;
  damageTable?: string; // P-1 through P-6, BL-1, BL-2
  isWalkingHits?: boolean;
  isSuperificial?: boolean;
}

/**
 * Roll on Table B-5 to determine where a shell hit lands per §6.4c.
 *
 * B-5 is indexed by attack position group and altitude.
 * For "Wings" results, roll 1d6: 1–3 = Port, 4–6 = Starboard.
 * For "Walking Hits", 1 hit in each compartment along the fuselage.
 */
export function rollHitLocation(
  position: AttackPosition,
  rng: RNG,
  tables: TableStore,
): ShellHitLocation {
  const b5 = tables.get('B-5');
  if (!b5) throw new Error('B-5 table not found');

  const raw = b5.raw as any;
  const { group, altitude } = getB5AttackKey(position);

  const posData = raw.attack_positions?.[group];
  if (!posData) throw new Error(`B-5 position group ${group} not found`);

  // For vertical positions, they have a single altitude mapping
  let altitudeData: Record<string, any>;
  if (altitude === 'all') {
    // Vertical positions might not have altitude sub-keys
    altitudeData = posData.high ?? posData; // fallback
  } else {
    altitudeData = posData[altitude];
    if (!altitudeData) throw new Error(`B-5 altitude ${altitude} not found for group ${group}`);
  }

  const roll = rng.twod6();

  // Find the matching entry (keys may be ranges like "2-4", "5", etc.)
  const entry = findB5Entry(altitudeData, roll);
  if (!entry) {
    return { location: 'Superficial', isSuperificial: true };
  }

  const location = entry.location as string;

  // Handle special cases
  if (location === 'Superficial' || location === 'Superficial Damage') {
    return { location: 'Superficial', isSuperificial: true };
  }

  if (location === 'Walking Hits/Fuselage') {
    return { location: 'Walking Hits/Fuselage', isWalkingHits: true };
  }

  if (location === 'Wings') {
    // Per B-5: "Roll 1D: 1-3 = Port, 4-6 = Starboard"
    const wingRoll = rng.d6();
    const wing = wingRoll <= 3 ? 'Port Wing' : 'Starboard Wing';
    return { location: wing as HitLocation, damageTable: 'BL-1' };
  }

  return {
    location: location as HitLocation,
    damageTable: entry.table as string | undefined,
  };
}

function findB5Entry(data: Record<string, any>, roll: number): any | null {
  for (const [key, value] of Object.entries(data)) {
    if (typeof value !== 'object' || value === null) continue;

    // Parse key as range or single value
    const match = key.match(/^(\d+)(?:-(\d+))?$/);
    if (!match) continue;

    const lo = parseInt(match[1], 10);
    const hi = match[2] ? parseInt(match[2], 10) : lo;

    if (roll >= lo && roll <= hi) return value;
  }
  return null;
}

// ─── Walking Hits ───

/**
 * Walking Hits per B-5: 1 shell hit in each fuselage compartment.
 * Per B-5 note: "1 shell hit in each: Nose, Pilot Compt, Bomb Bay,
 * Radio Room, Waist, Tail"
 */
export const WALKING_HIT_COMPARTMENTS: { location: HitLocation; damageTable: string }[] = [
  { location: 'Nose', damageTable: 'P-1' },
  { location: 'Pilot Compt.', damageTable: 'P-2' },
  { location: 'Bomb Bay', damageTable: 'P-3' },
  { location: 'Radio Room', damageTable: 'P-4' },
  { location: 'Waist', damageTable: 'P-5' },
  { location: 'Tail', damageTable: 'P-6' },
];

// ─── Compartment damage tables (P-1 through P-6) ───

export interface DamageResult {
  result: string;
  description: string;
  effects: DamageEffect[];
}

export interface DamageEffect {
  type: 'gun_damage' | 'equipment_damage' | 'crew_wound' | 'engine_damage'
    | 'fire' | 'oxygen_hit' | 'heat_damage' | 'control_damage'
    | 'wing_root_hit' | 'destroyed' | 'superficial' | 'landing_modifier'
    | 'follow_up_table' | 'system_damage';
  position?: string;
  severity?: string;
  damageType?: string;
  engine?: number;
  table?: string;
  modifier?: number;
  target?: string;
}

/**
 * Roll for specific compartment damage per §6.4d.
 * Rolls on the appropriate P-1..P-6 or BL-1/BL-2 table.
 */
export function rollCompartmentDamage(
  damageTable: string,
  rng: RNG,
  tables: TableStore,
): DamageResult {
  const result = tables.lookup(damageTable, rng);
  if (!result) {
    return {
      result: 'Superficial',
      description: 'No effect',
      effects: [{ type: 'superficial' }],
    };
  }

  const entry = result.entry;
  const effects: DamageEffect[] = [];

  // Extract damage_effects if present in the JSON
  if (entry.damage_effects) {
    for (const de of entry.damage_effects as any[]) {
      effects.push({
        type: de.type,
        position: de.position,
        severity: de.severity,
        damageType: de.damage_type,
        engine: de.engine,
        table: de.table,
        target: de.target,
      });
    }
  }

  // Check for follow-up table rolls
  if ((entry as any).follow_up?.table) {
    effects.push({
      type: 'follow_up_table',
      table: (entry as any).follow_up.table,
      target: (entry as any).follow_up.target,
    });
  }

  // Check for destruction effects
  if ((entry as any).effect === 'destroyed') {
    effects.push({ type: 'destroyed' });
  }

  // Check for sub-rolls that need resolution
  if ((entry as any).sub_roll) {
    // Sub-rolls need to be resolved by the caller with another d6
    effects.push({
      type: 'follow_up_table',
      table: 'sub_roll',
      target: (entry as any).result,
    });
  }

  // Check for cumulative hit tracking (e.g. wing root hits on BL-1)
  if ((entry as any).cumulative) {
    const cum = (entry as any).cumulative;
    effects.push({
      type: 'wing_root_hit',
      target: cum.type,
    });
  }

  // Only mark as superficial if the table entry explicitly says so.
  // Any other unrecognized entry is real damage — use a generic 'system_damage'
  // effect so the UI displays the actual result text instead of "Superficial".
  if (effects.length === 0) {
    const resultText = ((entry.result as string) ?? '').toLowerCase();
    const descText = ((entry.description as string) ?? '').toLowerCase();
    const isSuperificial = resultText.includes('superficial') || descText === 'no effect';
    if (isSuperificial) {
      effects.push({ type: 'superficial' });
    } else {
      effects.push({ type: 'system_damage' });
    }
  }

  return {
    result: (entry.result as string) ?? 'Unknown',
    description: (entry.description as string) ?? '',
    effects,
  };
}

// ─── Crew Wounds (Table BL-4) ───

/**
 * Roll for crew wound severity on Table BL-4 per damage table follow-ups.
 *
 * Per BL-4:
 *   1–3 = Light wound (may continue duties)
 *   4–5 = Serious wound (cannot continue, cannot bail out)
 *   6 = KIA
 *
 * Per BL-4 notes:
 *   - 2nd light wound: gunners must roll 6 to hit; bombardier loses bonus; etc.
 *   - 3 light wounds = serious wound
 *   - 4 light wounds = KIA
 *   - Light + serious = KIA
 */
export function rollCrewWound(
  rng: RNG,
  tables: TableStore,
): WoundSeverity {
  const result = tables.lookup('BL-4', rng);
  if (!result) return 'light';

  const severity = (result.entry as any).severity as string;
  switch (severity) {
    case 'light': return 'light';
    case 'serious': return 'serious';
    case 'kia': return 'kia';
    default: return 'light';
  }
}

/**
 * Apply wound accumulation rules per BL-4 notes.
 *
 * Per BL-4: "3 light wounds = serious wound. 4 light wounds = KIA.
 * Light wound + serious wound = KIA."
 */
export function accumulateWound(
  currentWound: WoundSeverity,
  newWound: WoundSeverity,
): WoundSeverity {
  if (currentWound === 'kia' || currentWound === 'mortal') return 'kia';
  if (newWound === 'kia') return 'kia';

  if (currentWound === 'serious' && newWound === 'light') return 'kia';
  if (currentWound === 'light' && newWound === 'serious') return 'kia';
  if (currentWound === 'serious' && newWound === 'serious') return 'kia';

  // Count effective light wounds
  // Current 'none' + light = light
  // Current 'light' + light = still light (2nd light wound has combat penalties)
  // We need a count, so this function works with simple severity states.
  // The caller should track light wound count separately.

  if (currentWound === 'none') return newWound;

  // Both light: return light (caller tracks count for 3rd/4th escalation)
  return newWound;
}

// ─── Engine Damage ───

/**
 * Count engines out from aircraft state.
 */
export function countEnginesOut(aircraft: AircraftState): number {
  return aircraft.engines.filter(e => e === 'out').length;
}

/**
 * Check if B-17 is destroyed (all engines out + no more zones).
 * Per §10.4, no engines = must immediately crash land or bail out.
 */
export function isAllEnginesOut(aircraft: AircraftState): boolean {
  return aircraft.engines.every(e => e === 'out');
}

/**
 * Get landing modifiers from engine damage per §10.2–§10.4.
 *
 * Per §10.3: one engine operating → landing roll -3.
 * Per §10.4: no engines → landing roll -7 (G-9) or -4 (G-10).
 */
export function getEngineLandingModifier(aircraft: AircraftState): number {
  const out = countEnginesOut(aircraft);
  if (out >= 4) return -7; // Per §10.4
  if (out >= 3) return -3; // Per §10.3
  return 0;
}

// ─── Fire Resolution (Table BL-3) ───

/**
 * Attempt to extinguish a fire using Table BL-3 per §12.2.
 *
 * Per §12.2: crew member uses one fire extinguisher per attempt.
 * BL-3: 1–4 = fire out, 5–6 = fire continues.
 * Max 3 attempts (3 extinguishers). If fire still burning → bail out on G-6.
 */
export function attemptExtinguishFire(
  rng: RNG,
  tables: TableStore,
): boolean {
  const result = tables.lookup('BL-3', rng);
  if (!result) return false;

  return (result.entry.result as string) === 'Fire out';
}

// ─── Frostbite check ───

/**
 * Roll for frostbite per §11.0.
 * Roll 1D: 1–3 = frostbite, 4–6 = no frostbite.
 */
export function rollFrostbite(rng: RNG): boolean {
  return rng.d6() <= 3;
}

/**
 * Post-landing frostbite effects per §11.0.
 * Roll 1D: 1–2 = serious injury (may not fly again), 3–6 = recovers.
 *
 * Per Errata #5: correct values from BL-5 note (b):
 * 1–3 = may not fly again, 4–6 = recovers.
 */
export function rollFrostbiteRecovery(rng: RNG): 'grounded' | 'recovers' {
  return rng.d6() <= 3 ? 'grounded' : 'recovers';
}

// ─── BIP (Burst Inside Plane) ───

/**
 * Handle BIP (Burst Inside Plane) effects per §19.2.
 *
 * Per §19.2a: all crewmen in compartment KIA.
 * Per §19.2b: Wing/Tail/Pilot Compt → B-17 dives, crew bails on G-7.
 * Per §19.2c: Bomb Bay with bombs → B-17 destroyed.
 * Per §19.2d: Nose/empty Bomb Bay/Radio Room/Waist → out of formation,
 *   2 turns/zone, all damage from that table assumed, landing -4, no evasive.
 */
export type BIPResult =
  | { type: 'b17_destroyed' }
  | { type: 'crew_bailout'; table: 'G-7' }
  | { type: 'heavy_damage'; compartment: string; allDamageApplied: true };

export function resolveBIP(
  compartment: HitLocation,
  bombsAboard: boolean,
): BIPResult {
  // §19.2b: Wing, Tail, or Pilot Compartment
  if (compartment === 'Port Wing' || compartment === 'Starboard Wing'
    || compartment === 'Tail' || compartment === 'Pilot Compt.') {
    return { type: 'crew_bailout', table: 'G-7' };
  }

  // §19.2c: Bomb Bay with bombs
  if (compartment === 'Bomb Bay' && bombsAboard) {
    return { type: 'b17_destroyed' };
  }

  // §19.2d: Everything else (Nose, empty Bomb Bay, Radio Room, Waist)
  return { type: 'heavy_damage', compartment: compartment as string, allDamageApplied: true };
}
