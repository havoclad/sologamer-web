/**
 * Zone Movement — moving through strategic zones, formation checks, fighter cover.
 *
 * Per §5.2a, each turn the B-17 moves one zone closer to target (outbound) or
 * base (inbound). Speed may be reduced by damage (§10.1–10.4).
 *
 * Per §5.2b, fighter cover is rolled on Table G-5 when entering Zones 2, 3, and 4.
 *
 * Per §6.2, fighter cover defense (Table M-4) applies only in Zones 2–4.
 *
 * Per §10.1, one engine out with bombs = 2 turns per zone (out of formation).
 * Per §10.2, two+ engines out = 2 turns per zone, drop to 10,000 ft.
 * Per §2.2, regardless of damage, B-17 never spends more than 2 turns in a zone.
 */

import type { RNG } from '../../../engine/rng.js';
import type { TableStore } from '../../../engine/tables.js';
import type { MissionState, AircraftState } from '../types.js';
import { getZoneInfo, type ZoneInfo } from './mission-setup.js';

// ─── Fighter Cover ───

export type FighterCoverLevel = 'Poor' | 'Fair' | 'Good';

/**
 * Roll for fighter cover per §5.2b on Table G-5.
 * Only applicable in Zones 2, 3, and 4.
 */
export function rollFighterCover(rng: RNG, tables: TableStore): FighterCoverLevel {
  const result = tables.lookup('G-5', rng);
  if (!result) throw new Error('Failed to look up fighter cover on G-5');
  return result.entry.fighter_cover as FighterCoverLevel;
}

// ─── Zone movement logic ───

/**
 * Determine if the B-17 has fighter cover in this zone.
 * Per §6.2, fighter cover is available in Zones 2, 3, and 4 only.
 */
export function hasFighterCover(zone: number): boolean {
  return zone >= 2 && zone <= 4;
}

/**
 * Count how many engines are out.
 */
export function enginesOut(aircraft: AircraftState): number {
  return aircraft.engines.filter(e => e === 'out').length;
}

/**
 * Determine how many turns the B-17 must spend in this zone.
 *
 * Per §10.1, one engine out + bombs aboard = 2 turns/zone.
 * Per §10.2, two+ engines out = 2 turns/zone (must jettison bombs).
 * Per §19.2d, BIP in certain compartments = 2 turns/zone.
 * Per §2.2, maximum is always 2 turns per zone.
 */
export function turnsInZone(aircraft: AircraftState, bombsAboard: boolean): number {
  const out = enginesOut(aircraft);
  if (out >= 2) return 2;
  if (out === 1 && bombsAboard) return 2;
  return 1;
}

/**
 * Calculate the next zone number based on direction.
 * Outbound: zone increases toward target.
 * Inbound: zone decreases toward base (zone 1).
 */
export function nextZone(currentZone: number, direction: 'outbound' | 'inbound'): number {
  return direction === 'outbound' ? currentZone + 1 : currentZone - 1;
}

/**
 * Check if B-17 must be out of formation.
 *
 * Per §10.1, one engine out without jettisoning bombs → out of formation.
 * Per §10.2, two+ engines out → always out of formation.
 * Per §12.1, oxygen out for crewman (at 20k ft) → out of formation (drop to 10k).
 * Per §11.0, heat out for crewman (staying at 20k) → risk frostbite or drop out.
 */
export function mustBeOutOfFormation(
  aircraft: AircraftState,
  bombsAboard: boolean,
  oxygenOutForCrew: boolean,
  heatOutForCrew: boolean,
  droppedTo10k: boolean,
): boolean {
  const out = enginesOut(aircraft);
  if (out >= 2) return true;
  if (out === 1 && bombsAboard) return true;
  if (oxygenOutForCrew && droppedTo10k) return true;
  if (heatOutForCrew && droppedTo10k) return true;
  return false;
}

/**
 * Get the B-1/B-2 roll modifier for fighter waves in a given zone.
 *
 * Per §5.1e, modifiers come from:
 *   - G-11 gazetteer (zone-specific)
 *   - Squadron position (§5.1d): low +1, middle -1, high 0
 *   - Weather effects on B-2 (bad/poor weather -1 per O-1 notes)
 *   - Out of formation: squadron position modifier set to 0 per §13.1b
 *
 * Per §13.1b, out of formation → ignore squadron position modifier
 * and ignore lead/tail extra fighter.
 */
export function getFighterWaveModifier(
  zoneInfo: ZoneInfo | null,
  squadronModifier: number,
  outOfFormation: boolean,
  weatherModifier: number,
): number {
  const gazetteerMod = zoneInfo?.b1Modifier ?? 0;
  const squadMod = outOfFormation ? 0 : squadronModifier;
  return gazetteerMod + squadMod + weatherModifier;
}

/** Build a human-readable reason string for fighter wave modifiers. */
export function getFighterWaveModifierReason(
  zoneInfo: ZoneInfo | null,
  squadronModifier: number,
  outOfFormation: boolean,
  weatherModifier: number,
): string {
  const parts: string[] = [];
  const gazetteerMod = zoneInfo?.b1Modifier ?? 0;
  if (gazetteerMod !== 0) parts.push(`Zone ${gazetteerMod >= 0 ? '+' : ''}${gazetteerMod}`);
  const squadMod = outOfFormation ? 0 : squadronModifier;
  if (squadMod !== 0) parts.push(`Formation position ${squadMod >= 0 ? '+' : ''}${squadMod}`);
  if (weatherModifier !== 0) parts.push(`Weather ${weatherModifier >= 0 ? '+' : ''}${weatherModifier}`);
  return parts.join(', ');
}

/**
 * Determine if the B-17 must abort per §8.0 mandatory conditions.
 *
 * Mandatory abort conditions:
 *   - §8.0d: Navigator seriously wounded/KIA AND out of formation.
 *   - §8.0e: Both Pilot and Copilot seriously wounded/KIA AND out of formation.
 *   - §8.0h: Two or more engines out (must abort).
 */
export function mustAbort(
  aircraft: AircraftState,
  outOfFormation: boolean,
  navigatorDown: boolean,
  bothPilotsDown: boolean,
): boolean {
  if (enginesOut(aircraft) >= 2) return true;
  if (outOfFormation && navigatorDown) return true;
  if (outOfFormation && bothPilotsDown) return true;
  return false;
}

/**
 * Check if B-17 is subject to light flak in this zone.
 *
 * Per §13.1d, out of formation + 10,000 ft + over land (not England) = light flak.
 */
export function isSubjectToLightFlak(
  outOfFormation: boolean,
  altitude: number,
  over: string[],
): boolean {
  if (!outOfFormation) return false;
  if (altitude !== 10000) return false;
  // Over land that isn't England
  return over.some(terrain => terrain !== 'water' && terrain !== 'England');
}
