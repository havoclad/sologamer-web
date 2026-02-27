/**
 * Bailout & Survival — controlled and uncontrolled bailout, POW/evade, ditching.
 *
 * Per §9.0 / Table G-6, controlled bailout:
 *   Roll 1D per crewman: 1 = KIA in accident, 2-6 = Bailout OK.
 *   Per G-6 notes: seriously wounded may not bail out.
 *   Per G-6 notes: roll of 6 always OK even with light wound modifier.
 *
 * Per Table G-7, uncontrolled bailout (plane diving/destroyed):
 *   Roll 1D per crewman: 1-5 = goes down with plane (KIA), 6 = Bailout OK.
 *   Per G-7 notes: lightly wounded crewmen die roll -1.
 *
 * Per G-6/G-7 notes, capture/evade after successful bailout:
 *   Over Germany or Netherlands: automatically captured (POW).
 *   Over France or Belgium: 1D per crewman: 1-5 = captured, 6 = returned by Underground.
 *   Per G-7 notes: seriously wounded are automatically captured.
 *
 * Per Table G-8, bailout over water:
 *   Roll 1D per crewman: 1-4 = drowns, 5-6 = rescued.
 *   Per G-8 notes: if radio not operating, all crew bailing over water die.
 *
 * Per §16.4 / G-10 notes: zones 2-5 rescued returned to England;
 *   zones 6-7 rescued are captured.
 */

import type { RNG } from '../../../engine/rng.js';
import type { TableStore } from '../../../engine/tables.js';
import type { CrewMember, WoundSeverity } from '../types.js';

// ─── Types ───

export type BailoutType = 'controlled' | 'uncontrolled';

export type CrewFate =
  | 'kia'           // Killed in bailout or went down with plane
  | 'drowned'       // Died in water
  | 'pow'           // Captured as POW
  | 'evaded'        // Returned by Underground
  | 'rescued'       // Rescued from water, returned to England
  | 'rescued_pow';  // Rescued from water but captured (zones 6-7)

export interface BailoutCrewResult {
  position: string;
  name: string;
  bailedOut: boolean;
  fate: CrewFate;
  rolls: number[];
}

export interface BailoutResult {
  type: BailoutType;
  overTerrain: string;
  zone: number;
  crewResults: BailoutCrewResult[];
  radioOperating: boolean;
}

// ─── Bailout resolution ───

/**
 * Resolve controlled bailout per Table G-6 (§9.0).
 *
 * Per G-6: 1D per crewman. 1 = KIA, 2-6 = OK.
 * Seriously wounded may not bail out (go down with plane).
 * Per G-6 notes: 6 always succeeds even with modifiers.
 */
export function resolveControlledBailout(
  crew: CrewMember[],
  overTerrain: string,
  zone: number,
  radioOperating: boolean,
  rng: RNG,
): BailoutResult {
  const crewResults: BailoutCrewResult[] = [];

  for (const member of crew) {
    if (member.woundSeverity === 'kia' || member.status === 'kia') {
      crewResults.push({
        position: member.position,
        name: member.name,
        bailedOut: false,
        fate: 'kia',
        rolls: [],
      });
      continue;
    }

    // Seriously wounded may not bail out per G-6 notes
    if (member.woundSeverity === 'serious') {
      crewResults.push({
        position: member.position,
        name: member.name,
        bailedOut: false,
        fate: 'kia', // goes down with plane
        rolls: [],
      });
      continue;
    }

    const roll = rng.d6();
    const bailedOut = roll >= 2; // 1 = KIA, 2-6 = OK

    if (!bailedOut) {
      crewResults.push({
        position: member.position,
        name: member.name,
        bailedOut: false,
        fate: 'kia',
        rolls: [roll],
      });
      continue;
    }

    // Successful bailout — determine fate based on terrain
    const fate = resolveBailoutFate(overTerrain, zone, radioOperating, member.woundSeverity, rng);
    crewResults.push({
      position: member.position,
      name: member.name,
      bailedOut: true,
      fate: fate.fate,
      rolls: [roll, ...fate.rolls],
    });
  }

  return { type: 'controlled', overTerrain, zone, crewResults, radioOperating };
}

/**
 * Resolve uncontrolled bailout per Table G-7.
 *
 * Per G-7: 1D per crewman. 1-5 = KIA (goes down), 6 = OK.
 * Lightly wounded: die roll -1 (but 6 still always succeeds per common interpretation).
 */
export function resolveUncontrolledBailout(
  crew: CrewMember[],
  overTerrain: string,
  zone: number,
  radioOperating: boolean,
  rng: RNG,
): BailoutResult {
  const crewResults: BailoutCrewResult[] = [];

  for (const member of crew) {
    if (member.woundSeverity === 'kia' || member.status === 'kia') {
      crewResults.push({
        position: member.position,
        name: member.name,
        bailedOut: false,
        fate: 'kia',
        rolls: [],
      });
      continue;
    }

    // Seriously wounded may not bail out
    if (member.woundSeverity === 'serious') {
      crewResults.push({
        position: member.position,
        name: member.name,
        bailedOut: false,
        fate: 'kia',
        rolls: [],
      });
      continue;
    }

    const roll = rng.d6();
    // Light wound modifier: -1 per G-7 notes
    const modifier = member.woundSeverity === 'light' ? -1 : 0;
    const effectiveRoll = roll + modifier;

    // 6 always succeeds (natural 6)
    const bailedOut = roll === 6 || effectiveRoll >= 6;

    if (!bailedOut) {
      crewResults.push({
        position: member.position,
        name: member.name,
        bailedOut: false,
        fate: 'kia',
        rolls: [roll],
      });
      continue;
    }

    const fate = resolveBailoutFate(overTerrain, zone, radioOperating, member.woundSeverity, rng);
    crewResults.push({
      position: member.position,
      name: member.name,
      bailedOut: true,
      fate: fate.fate,
      rolls: [roll, ...fate.rolls],
    });
  }

  return { type: 'uncontrolled', overTerrain, zone, crewResults, radioOperating };
}

// ─── Post-bailout fate ───

/**
 * Determine crew fate after successful bailout based on terrain.
 *
 * Per G-6/G-7 notes:
 *   - Germany/Netherlands: automatically captured
 *   - France/Belgium: 1D: 1-5 = captured, 6 = evaded (returned by Underground)
 *   - Water: Table G-8 (1D: 1-4 = drowned, 5-6 = rescued)
 *   - Water + radio out: all die
 *   - England: safe (shouldn't happen in bailout but handle gracefully)
 */
function resolveBailoutFate(
  terrain: string,
  zone: number,
  radioOperating: boolean,
  wounds: WoundSeverity,
  rng: RNG,
): { fate: CrewFate; rolls: number[] } {
  const t = terrain.toLowerCase();

  // Over water
  if (t === 'water') {
    // Per G-8 notes: radio out = all die
    if (!radioOperating) {
      return { fate: 'drowned', rolls: [] };
    }

    const roll = rng.d6();
    if (roll <= 4) {
      return { fate: 'drowned', rolls: [roll] };
    }
    // Rescued — but zone 6-7 means captured
    if (zone >= 6) {
      return { fate: 'rescued_pow', rolls: [roll] };
    }
    return { fate: 'rescued', rolls: [roll] };
  }

  // Over England
  if (t === 'england') {
    return { fate: 'rescued', rolls: [] };
  }

  // Over Germany or Netherlands: automatically captured
  if (t === 'germany' || t === 'netherlands') {
    return { fate: 'pow', rolls: [] };
  }

  // Over France or Belgium: roll for evade
  if (t === 'france' || t === 'belgium') {
    // Seriously wounded automatically captured per G-7 notes
    if (wounds === 'serious') {
      return { fate: 'pow', rolls: [] };
    }

    const roll = rng.d6();
    if (roll >= 6) {
      return { fate: 'evaded', rolls: [roll] };
    }
    return { fate: 'pow', rolls: [roll] };
  }

  // Default: captured
  return { fate: 'pow', rolls: [] };
}

// ─── Ditching survival ───

/**
 * Resolve ditching survival for crew after water landing per G-10.
 *
 * Per G-10 notes:
 *   - Rescued crew in zones 2-5: returned to England
 *   - Rescued crew in zones 6-7: captured
 *   - If radio out: survival chances greatly reduced (handled by G-10 modifier -6)
 *
 * This resolves individual crew survival after the G-10 landing roll
 * has already determined "crew rescued" or "crew lost".
 */
export function resolveDitchingSurvival(
  crew: CrewMember[],
  zone: number,
  crewRescued: boolean,
): BailoutCrewResult[] {
  const results: BailoutCrewResult[] = [];

  for (const member of crew) {
    if (member.woundSeverity === 'kia' || member.status === 'kia') {
      results.push({
        position: member.position,
        name: member.name,
        bailedOut: false,
        fate: 'kia',
        rolls: [],
      });
      continue;
    }

    if (!crewRescued) {
      results.push({
        position: member.position,
        name: member.name,
        bailedOut: false,
        fate: 'drowned',
        rolls: [],
      });
      continue;
    }

    // Rescued — check zone for capture
    const captured = zone >= 6;
    results.push({
      position: member.position,
      name: member.name,
      bailedOut: false,
      fate: captured ? 'rescued_pow' : 'rescued',
      rolls: [],
    });
  }

  return results;
}
