/**
 * Landing Resolution — landing in England, Europe, or the sea.
 *
 * Per §16.0, landings are accomplished by rolling 2D on Table G-9 (land)
 * or Table G-10 (water). Damage modifiers affect the roll.
 *
 * Per §16.1, landing location determined by zone & G-11 gazetteer.
 * Per §16.2, Zone 1 = England, roll on G-9.
 * Per §16.3, Europe crash landing = G-9 with -3 modifier. Plane is lost.
 * Per §16.4, Sea ditching = G-10. Plane is lost.
 *
 * Landing modifiers (cumulative):
 *   - §10.3: 1 engine operating → -3 on G-9 and G-10
 *   - §10.4: 0 engines → -7 on G-9, -4 on G-10
 *   - §16.3 / G-9 note j: crash landing in Europe → -3
 *   - §19.2d: BIP → -4
 *   - §14.2c: non-pilot/copilot flying → modifier per G-9 notes
 *   - G-9 notes: tail wheel inop -1, brakes -1, landing gear -1, etc.
 *   - G-10 notes: radio out → -6, pilot/copilot 11-25 missions → +1
 *
 * Per G-9: roll result determines crew/aircraft fate:
 *   ≤ -3: Crew KIA, plane wrecked
 *   -2: Crew rolls for wounds (BL-4 +1), plane wrecked
 *   -1: Crew rolls for wounds (BL-4), plane wrecked
 *   0: Crew safe, plane irreparably damaged
 *   1: Crew safe, plane repairable by next mission
 *   2+: Crew and plane safe
 *
 * Per G-10:
 *   2-3: Crew lost
 *   4-12: Crew rescued
 *   Note: roll of 12 always safe regardless of modifiers
 *
 * Per G-10 notes: if roll ≤ 0 and bombs aboard, roll 1D: 6 = explosion, all destroyed.
 * Per G-10 notes: zones 2-5 rescued crew returned to England; zones 6-7 captured.
 */

import type { RNG } from '../../../engine/rng.js';
import type { TableStore } from '../../../engine/tables.js';
import type { AircraftState, CrewMember, WoundSeverity } from '../types.js';
import { countEnginesOut, rollCrewWound } from './damage.js';

// ─── Landing types ───

export type LandingLocation = 'england' | 'europe' | 'water';

export type LandingOutcome =
  | 'crew_and_plane_safe'
  | 'crew_safe_plane_repairable'
  | 'crew_safe_plane_irreparable'
  | 'crew_wounded_plane_wrecked'
  | 'crew_kia_plane_wrecked'
  | 'crew_rescued'
  | 'crew_lost'
  | 'explosion_all_destroyed';

export interface LandingResult {
  location: LandingLocation;
  roll: number;
  modifiedRoll: number;
  modifier: number;
  outcome: LandingOutcome;
  crewWounds: Array<{ position: string; wound: WoundSeverity }>;
  woundRollModifier: number;
  planeDestroyed: boolean;
  planeLost: boolean;
}

// ─── Landing modifiers ───

export interface LandingModifierInputs {
  enginesOut: number;
  tailWheelInop: boolean;
  controlDamage: { rudder: boolean; elevator: boolean; ailerons: boolean };
  bipDamage: boolean;
  landingInEurope: boolean;
  accumulatedModifiers: number;
  radioOut: boolean;
  pilotCopilotExperienced: boolean; // 11-25 missions
  nonPilotFlying: boolean;
  bombsAboard: boolean;
}

/**
 * Calculate total landing modifier for G-9 (land) per notes.
 */
export function calculateLandModifier(inputs: LandingModifierInputs): number {
  let mod = inputs.accumulatedModifiers;

  // §10.3: 3 engines out (1 operating) → -3
  // §10.4: 4 engines out → -7
  if (inputs.enginesOut >= 4) mod -= 7;
  else if (inputs.enginesOut >= 3) mod -= 3;

  // G-9 note j: crash landing in Europe → -3
  if (inputs.landingInEurope) mod -= 3;

  // BIP → -4
  if (inputs.bipDamage) mod -= 4;

  // Tail wheel inop → -1
  if (inputs.tailWheelInop) mod -= 1;

  // Control damage modifiers
  if (inputs.controlDamage.rudder) mod -= 1;
  if (inputs.controlDamage.elevator) mod -= 1;
  if (inputs.controlDamage.ailerons) mod -= 1;

  // Non-pilot flying → -11 per G-10 notes (applies to G-9 too per §14.2c)
  if (inputs.nonPilotFlying) mod -= 11;

  return mod;
}

/**
 * Calculate total landing modifier for G-10 (water).
 */
export function calculateWaterLandModifier(inputs: LandingModifierInputs): number {
  let mod = inputs.accumulatedModifiers;

  // §10.3: 3 engines out → -3
  // §10.4: 4 engines out → -4 (different from G-9!)
  if (inputs.enginesOut >= 4) mod -= 4;
  else if (inputs.enginesOut >= 3) mod -= 3;

  // Radio out → -6
  if (inputs.radioOut) mod -= 6;

  // BIP → -4
  if (inputs.bipDamage) mod -= 4;

  // Experienced pilot/copilot → +1
  if (inputs.pilotCopilotExperienced) mod += 1;

  // Non-pilot flying → -11
  if (inputs.nonPilotFlying) mod -= 11;

  return mod;
}

// ─── Land landing (Table G-9) ───

/**
 * Resolve landing on land per Table G-9 (§16.2, §16.3).
 */
export function resolveLandLanding(
  modifier: number,
  crew: CrewMember[],
  rng: RNG,
  tables: TableStore,
): LandingResult {
  const roll = rng.twod6();
  const modifiedRoll = roll + modifier;

  let outcome: LandingOutcome;
  let crewWounds: Array<{ position: string; wound: WoundSeverity }> = [];
  let woundRollModifier = 0;
  let planeDestroyed = false;

  if (modifiedRoll <= -3) {
    outcome = 'crew_kia_plane_wrecked';
    planeDestroyed = true;
  } else if (modifiedRoll === -2) {
    outcome = 'crew_wounded_plane_wrecked';
    woundRollModifier = 1; // BL-4 +1 per G-9
    planeDestroyed = true;
    crewWounds = rollLandingWounds(crew, rng, tables, woundRollModifier);
  } else if (modifiedRoll === -1) {
    outcome = 'crew_wounded_plane_wrecked';
    planeDestroyed = true;
    crewWounds = rollLandingWounds(crew, rng, tables, 0);
  } else if (modifiedRoll === 0) {
    outcome = 'crew_safe_plane_irreparable';
  } else if (modifiedRoll === 1) {
    outcome = 'crew_safe_plane_repairable';
  } else {
    outcome = 'crew_and_plane_safe';
  }

  return {
    location: modifier <= -3 && modifiedRoll <= 0 ? 'europe' : 'england',
    roll,
    modifiedRoll,
    modifier,
    outcome,
    crewWounds,
    woundRollModifier,
    planeDestroyed,
    planeLost: modifiedRoll <= 0,
  };
}

/**
 * Roll wounds for crew during crash landing per G-9.
 */
function rollLandingWounds(
  crew: CrewMember[],
  rng: RNG,
  tables: TableStore,
  woundMod: number,
): Array<{ position: string; wound: WoundSeverity }> {
  const wounds: Array<{ position: string; wound: WoundSeverity }> = [];

  for (const member of crew) {
    if (member.status !== 'active') continue;
    if (member.wounds === 'kia') continue;

    // Roll on BL-4 with modifier
    const wound = rollCrewWound(rng, tables);
    if (wound !== 'none') {
      wounds.push({ position: member.position, wound });
    }
  }

  return wounds;
}

// ─── Water landing / ditching (Table G-10) ───

/**
 * Resolve ditching at sea per Table G-10 (§16.4).
 *
 * Per G-10 notes:
 *   - Roll of 12 always safe
 *   - If result ≤ 0 and bombs aboard: 1D, 6 = explosion
 *   - Zones 2-5 rescued = returned to England
 *   - Zones 6-7 rescued = captured
 */
export function resolveWaterLanding(
  modifier: number,
  zone: number,
  bombsAboard: boolean,
  rng: RNG,
  tables: TableStore,
): LandingResult {
  const roll = rng.twod6();

  // Per G-10: roll of 12 always safe regardless of modifiers
  const effectiveRoll = roll === 12 ? 12 : roll + modifier;

  let outcome: LandingOutcome;
  const crewWounds: Array<{ position: string; wound: WoundSeverity }> = [];

  // Check for explosion if result ≤ 0 and bombs aboard
  if (effectiveRoll <= 0 && bombsAboard) {
    const explosionRoll = rng.d6();
    if (explosionRoll === 6) {
      return {
        location: 'water',
        roll,
        modifiedRoll: effectiveRoll,
        modifier,
        outcome: 'explosion_all_destroyed',
        crewWounds: [],
        woundRollModifier: 0,
        planeDestroyed: true,
        planeLost: true,
      };
    }
  }

  if (effectiveRoll <= 3) {
    outcome = 'crew_lost';
  } else {
    outcome = 'crew_rescued';
  }

  return {
    location: 'water',
    roll,
    modifiedRoll: effectiveRoll,
    modifier,
    outcome,
    crewWounds,
    woundRollModifier: 0,
    planeDestroyed: true,
    planeLost: true, // B-17 in water is always lost
  };
}

// ─── Determine landing location ───

/**
 * Determine landing location from zone and terrain per §16.1.
 *
 * @param zone - current zone number
 * @param over - terrain types from G-11 gazetteer
 * @returns possible landing locations
 */
export function determineLandingLocation(
  zone: number,
  over: string[],
): LandingLocation[] {
  if (zone === 1) return ['england'];

  const locations: LandingLocation[] = [];
  for (const terrain of over) {
    if (terrain === 'water') {
      locations.push('water');
    } else if (terrain === 'England') {
      locations.push('england');
    } else {
      locations.push('europe');
    }
  }

  return locations.length > 0 ? locations : ['europe'];
}

/**
 * Check if rescued crew in water are captured per G-10 notes.
 * Zones 6-7: captured. Zones 2-5: returned to England.
 */
export function isWaterRescueCaptured(zone: number): boolean {
  return zone >= 6;
}
