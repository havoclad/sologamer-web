/**
 * Crew helpers — queries, mutations, gun assignment, and factory functions.
 *
 * Per B1-4 wound accumulation rules:
 *   - 2nd light wound: combat penalty (must roll 6 to hit)
 *   - 3 light wounds → escalate to serious
 *   - serious + any wound → KIA
 */

import type { CrewMember, CrewPosition, CrewStatus, WoundSeverity } from '../types.js';
import type { GunPosition } from './combat.js';
import type { Gun } from './guns.js';
import type { CrewFate } from './bailout.js';

// ─── Constants ───

/** Maps each crew position to their natural gun assignment (null = no gun). */
export const NATURAL_GUN_MAP: Record<CrewPosition, GunPosition | null> = {
  pilot:        null,
  copilot:      null,
  bombardier:   'Nose',
  navigator:    'Port_Cheek',   // also operates Starboard_Cheek (combat-phase concern)
  engineer:     'Top_Turret',
  radioman:     'Radio',
  ball_turret:  'Ball_Turret',
  left_waist:   'Port_Waist',
  right_waist:  'Starboard_Waist',
  tail_gunner:  'Tail',
};

/** Human-readable labels for crew positions. */
export const POSITION_LABELS: Record<CrewPosition, string> = {
  pilot: 'Pilot',
  copilot: 'Co-Pilot',
  navigator: 'Navigator',
  bombardier: 'Bombardier',
  engineer: 'Engineer/Top Turret',
  radioman: 'Radio Operator',
  ball_turret: 'Ball Turret Gunner',
  left_waist: 'Left Waist Gunner',
  right_waist: 'Right Waist Gunner',
  tail_gunner: 'Tail Gunner',
};

// ─── Queries ───

/** Can this crew member perform duties this mission? */
export function isCrewActive(crew: CrewMember): boolean {
  return crew.status === 'active'
    && crew.woundSeverity !== 'serious'
    && crew.woundSeverity !== 'kia';
}

/** Can this crew member fire a gun? */
export function canFireGun(crew: CrewMember): boolean {
  return isCrewActive(crew) && crew.currentGunPosition !== null;
}

/** Does this crew member have the 2-light-wound combat penalty? */
export function hasTwoLightWoundPenalty(crew: CrewMember): boolean {
  return crew.lightWounds >= 2 && crew.woundSeverity === 'light';
}

/** Is this crew member experienced (11-25 missions)? */
export function isExperienced(crew: CrewMember): boolean {
  return crew.missions >= 11 && crew.missions <= 25;
}

/** Can this crew member bail out? (not seriously wounded or KIA) */
export function canBailOut(crew: CrewMember): boolean {
  return crew.woundSeverity !== 'serious' && crew.woundSeverity !== 'kia';
}

/** Is this crew at their natural gun position? */
export function isAtNaturalPosition(crew: CrewMember): boolean {
  return crew.currentGunPosition === NATURAL_GUN_MAP[crew.position];
}

// ─── Mutations ───

/**
 * Apply a light wound. Increments lightWounds, escalates to serious at 3.
 * If already serious or KIA, escalates to KIA.
 */
export function applyLightWound(crew: CrewMember): void {
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
 * Apply a serious wound. If already wounded (serious), escalates to KIA.
 */
export function applySeriousWound(crew: CrewMember): void {
  if (crew.woundSeverity === 'kia') return;
  if (crew.woundSeverity === 'serious') {
    crew.woundSeverity = 'kia';
  } else {
    crew.woundSeverity = 'serious';
  }
  crew.currentGunPosition = null;
}

/** Apply KIA directly (e.g., from wound severity roll of 6, or 20mm hit). */
export function applyKia(crew: CrewMember): void {
  crew.woundSeverity = 'kia';
  crew.currentGunPosition = null;
}

/** Apply a wound of given severity using accumulation rules. */
export function applyWound(crew: CrewMember, severity: WoundSeverity): void {
  switch (severity) {
    case 'light': applyLightWound(crew); break;
    case 'serious': applySeriousWound(crew); break;
    case 'kia': applyKia(crew); break;
    default: break; // 'none' — no-op
  }
}

/** Reset mission-specific state at the start of a new mission. */
export function resetMissionState(crew: CrewMember): void {
  crew.woundSeverity = 'none';
  crew.lightWounds = 0;
  crew.frostbite = false;
  crew.aceForADay = false;
  crew.currentGunPosition = NATURAL_GUN_MAP[crew.position];
}

/** Apply post-mission serious wound survival roll result. */
export function applyPostMissionSurvival(crew: CrewMember, roll: number): void {
  if (roll === 1) {
    crew.status = 'active'; // rapid recovery
  } else if (roll >= 2 && roll <= 5) {
    crew.status = 'hospital'; // cannot fly again
  } else {
    crew.status = 'kia'; // wounds fatal
  }
}

/** Apply post-mission frostbite recovery roll result. */
export function applyFrostbiteRecovery(crew: CrewMember, roll: number): void {
  if (roll <= 3) {
    crew.status = 'grounded';
  } else {
    crew.frostbite = false; // recovers
  }
}

/** Apply bailout fate to campaign status. */
export function applyBailoutFate(crew: CrewMember, fate: CrewFate): void {
  const fateMap: Record<CrewFate, CrewStatus> = {
    'rescued': 'active',
    'evaded': 'evaded',
    'pow': 'pow',
    'rescued_pow': 'pow',
    'drowned': 'kia',
    'kia': 'kia',
  };
  crew.status = fateMap[fate];
}

/** Create a replacement crew member for a lost position. */
export function createReplacement(id: string, name: string, position: CrewPosition): CrewMember {
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

/** Create a new crew member (for initial crew setup). */
export function createCrewMember(id: string, name: string, position: CrewPosition): CrewMember {
  return {
    id,
    name,
    position,
    status: 'active',
    missions: 0,
    kills: 0,
    isOriginal: true,
    woundSeverity: 'none',
    lightWounds: 0,
    frostbite: false,
    currentGunPosition: NATURAL_GUN_MAP[position],
    aceForADay: false,
  };
}

// ─── Gun Assignment ───

/** Find the crew member currently operating a gun. */
export function getGunOperator(crew: CrewMember[], gunId: GunPosition): CrewMember | undefined {
  return crew.find(c => c.currentGunPosition === gunId);
}

/** Check if a gun can fire (gun is operational AND has an active operator). */
export function canGunFire(gun: Gun, crew: CrewMember[]): boolean {
  if (gun.disabled || gun.jammed || gun.ammo <= 0) return false;
  const operator = getGunOperator(crew, gun.id);
  if (!operator) return false;
  return isCrewActive(operator);
}

/** Check if a gun's current operator has the wrong-position penalty. */
export function hasWrongPositionPenalty(gun: Gun, crew: CrewMember[]): boolean {
  const operator = getGunOperator(crew, gun.id);
  if (!operator) return false;
  return !isAtNaturalPosition(operator);
}
