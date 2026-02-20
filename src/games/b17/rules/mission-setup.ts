/**
 * Mission Setup — target selection, weather, crew & aircraft initialization.
 *
 * Per §5.1, pre-mission steps:
 *   a. Ensure B-17 has name and full crew.
 *   b. Roll for target on G-1 (missions 1–5), G-2 (6–10), or G-3 (11–25).
 *   c. Roll for formation position on G-4 (lead/middle/tail).
 *   d. Roll for squadron position on G-4a (high/middle/low) — missions 6–25 only.
 *   e. Look up zone modifiers from G-11 Flight Log Gazetteer.
 *   f. Place B-17 at base.
 *
 * Per §5.2d, weather is rolled on Table O-1 when entering the target zone
 * and again on Table O-1 when returning to Zone 1 for landing.
 */

import type { RNG } from '../../../engine/rng.js';
import type { TableStore, RollEntry } from '../../../engine/tables.js';
import type {
  MissionState, FormationPosition, CampaignState,
  CrewMember, CrewPosition, AircraftState, Weather,
} from '../types.js';

// ─── Target selection result ───

export interface TargetInfo {
  name: string;
  type: string;
  /** Any table modifiers attached to this target (e.g., increased flak) */
  notes?: Array<{ table: string; modifier: number; why: string }>;
}

/**
 * Select mission target per §5.1b.
 * Missions 1–5 use Table G-1, 6–10 use G-2, 11–25 use G-3.
 */
export function selectTarget(missionNumber: number, rng: RNG, tables: TableStore): TargetInfo {
  let tableName: string;
  if (missionNumber <= 5) {
    tableName = 'G-1';
  } else if (missionNumber <= 10) {
    tableName = 'G-2';
  } else {
    tableName = 'G-3';
  }

  const result = tables.lookup(tableName, rng);
  if (!result) {
    throw new Error(`Failed to look up target on ${tableName}`);
  }

  const entry = result.entry;
  const notes = entry.notes as Array<{ table: string; modifier: string | number; why: string }> | undefined;

  return {
    name: entry.Target as string,
    type: entry.Type as string,
    notes: notes?.map(n => ({
      table: n.table,
      modifier: typeof n.modifier === 'string' ? parseInt(n.modifier, 10) : n.modifier,
      why: n.why,
    })),
  };
}

// ─── Formation position ───

export type SquadronFormationPosition = 'lead' | 'middle' | 'tail';

/**
 * Roll for B-17's position within its squadron per §5.1c.
 * Table G-4: 2D roll → Lead Bomber (2), Middle (3–11), Tail Bomber (12).
 * Per §5.1c, lead/tail bombers get +1 fighter per wave.
 */
export function rollFormationPosition(rng: RNG, tables: TableStore): {
  position: SquadronFormationPosition;
  extraFighterPerWave: boolean;
} {
  const result = tables.lookup('G-4', rng);
  if (!result) throw new Error('Failed to look up formation position on G-4');

  const pos = result.entry.formation_position as string;
  let position: SquadronFormationPosition;
  if (pos === 'Lead Bomber') position = 'lead';
  else if (pos === 'Tail Bomber') position = 'tail';
  else position = 'middle';

  return {
    position,
    extraFighterPerWave: position === 'lead' || position === 'tail',
  };
}

/**
 * Roll for B-17's squadron formation per §5.1d.
 * Table G-4a: 1D roll → High (1–2), Middle (3–4), Low (5–6).
 * Only for missions 6–25. Per §5.1d, low squadron is most prone to attack.
 *
 * Returns modifier to B-1/B-2 rolls:
 *   High: 0, Middle: -1, Low: +1 (per standard rules).
 */
export function rollSquadronPosition(missionNumber: number, rng: RNG, tables: TableStore): {
  position: FormationPosition;
  b1b2Modifier: number;
} | null {
  if (missionNumber <= 5) return null; // Per §5.1d, only missions 6–25

  const result = tables.lookup('G-4a', rng);
  if (!result) throw new Error('Failed to look up squadron position on G-4a');

  const pos = result.entry.squadron_position as string;
  let position: FormationPosition;
  let b1b2Modifier: number;

  switch (pos) {
    case 'High':
      position = 'high';
      b1b2Modifier = 0;
      break;
    case 'Low':
      position = 'low';
      b1b2Modifier = 1; // Low squadron most prone to attack
      break;
    default:
      position = 'lead'; // 'Middle' maps to lead in our type (we'll treat as middle)
      b1b2Modifier = -1; // Middle squadron least prone
      break;
  }

  return { position, b1b2Modifier };
}

// ─── Weather ───

export interface WeatherResult {
  weather: Weather;
  /** Table modifiers from weather (e.g., B-2 -1, O-6 -2 for bad weather) */
  modifiers: Array<{ table: string; modifier: number; why: string }>;
}

/**
 * Roll for weather per §5.2d on Table O-1.
 * Weather is rolled when entering the target zone and when returning to Zone 1.
 */
export function rollWeather(rng: RNG, tables: TableStore): WeatherResult {
  const result = tables.lookup('O-1', rng);
  if (!result) throw new Error('Failed to look up weather on O-1');

  const entry = result.entry;
  const weatherStr = entry.weather as string;

  let weather: Weather;
  if (weatherStr === 'Bad') weather = 'overcast';
  else if (weatherStr === 'Poor') weather = 'poor';
  else weather = 'clear';

  const notes = entry.notes as Array<{ table: string; modifier: string; why: string }> | undefined;

  return {
    weather,
    modifiers: notes?.map(n => ({
      table: n.table,
      modifier: parseInt(n.modifier, 10),
      why: n.why,
    })) ?? [],
  };
}

// ─── Zone info from Gazetteer ───

export interface ZoneInfo {
  b1Modifier: number;
  over: string[]; // e.g., ['water'], ['France'], ['water', 'Netherlands']
}

/**
 * Look up zone info from the Flight Log Gazetteer (G-11) per §5.1e.
 * Returns the B-1/B-2 modifier and terrain type for a given target and zone.
 */
export function getZoneInfo(targetName: string, zone: number, tables: TableStore): ZoneInfo | null {
  const table = tables.get('G-11');
  if (!table) throw new Error('G-11 table not found');

  const raw = table.raw as any;
  const targetData = raw['target city']?.[targetName];
  if (!targetData) return null;

  const zoneData = targetData.zone?.[String(zone)];
  if (!zoneData) return null;

  return {
    b1Modifier: parseInt(zoneData['B-1 Modifier'] ?? '0', 10),
    over: zoneData.over ?? [],
  };
}

/**
 * Get the target zone number (the highest zone for this target) from G-11.
 */
export function getTargetZone(targetName: string, tables: TableStore): number {
  const table = tables.get('G-11');
  if (!table) throw new Error('G-11 table not found');

  const raw = table.raw as any;
  const targetData = raw['target city']?.[targetName];
  if (!targetData?.zone) throw new Error(`Target ${targetName} not found in G-11`);

  return Math.max(...Object.keys(targetData.zone).map(Number));
}

// ─── Full mission initialization ───

export interface MissionSetupResult {
  target: TargetInfo;
  targetZone: number;
  formationPosition: SquadronFormationPosition;
  extraFighterPerWave: boolean;
  squadronPosition: { position: FormationPosition; b1b2Modifier: number } | null;
  /** Per-zone B-1/B-2 modifiers from G-11 gazetteer */
  zoneModifiers: Map<number, ZoneInfo>;
}

/**
 * Complete pre-mission setup per §5.1.
 * Rolls target, formation position, squadron position, and collects zone modifiers.
 */
export function setupMission(
  missionNumber: number,
  rng: RNG,
  tables: TableStore,
): MissionSetupResult {
  const target = selectTarget(missionNumber, rng, tables);
  const targetZone = getTargetZone(target.name, tables);
  const formation = rollFormationPosition(rng, tables);
  const squadron = rollSquadronPosition(missionNumber, rng, tables);

  // Collect zone modifiers for all zones en route
  const zoneModifiers = new Map<number, ZoneInfo>();
  for (let z = 2; z <= targetZone; z++) {
    const info = getZoneInfo(target.name, z, tables);
    if (info) zoneModifiers.set(z, info);
  }

  return {
    target,
    targetZone,
    formationPosition: formation.position,
    extraFighterPerWave: formation.extraFighterPerWave,
    squadronPosition: squadron,
    zoneModifiers,
  };
}
