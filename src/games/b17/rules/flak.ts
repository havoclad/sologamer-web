/**
 * Flak Resolution — anti-aircraft fire over target and light flak in non-target zones.
 *
 * Per §5.2d, when entering the target zone, resolve anti-aircraft fire
 * by consulting Tables O-2 through O-5.
 *
 * Per §13.2 / Table O-2, flak intensity is rolled on O-2 with modifiers
 * for certain heavily defended targets (+1 for Brest, Lorient, St. Nazaire,
 * Wilhelmshaven, Vegesack, La Rochelle, Kiel).
 *
 * Per §13.1d, out of formation at 10,000 ft over land (not England):
 * roll 2D twice on Light Flak column of O-3 per zone.
 *
 * Flak resolution chain:
 *   O-2 → flak intensity → O-3 (flak to hit, 3 rolls) → O-4 (shell hits per flak hit)
 *   → O-5 (area affected per shell hit) → damage tables (P-1..P-6, B1-1, B1-2)
 */

import type { RNG } from '../../../engine/rng.js';
import type { TableStore } from '../../../engine/tables.js';
import type { AircraftState } from '../types.js';
import type { HitLocation } from './damage.js';

// ─── Flak intensity ───

export type FlakIntensity = 'No flak' | 'Light flak' | 'Medium flak' | 'Heavy flak';

/** Targets that get +1 on O-2 per the roll_modifier in the table */
const HEAVY_FLAK_TARGETS = [
  'Brest', 'Lorient', 'St. Nazaire', 'Wilhelmshaven', 'Vegesack', 'La Rochelle', 'Kiel',
];

/**
 * Roll for flak intensity over the target zone per Table O-2 (§13.2).
 */
export function rollFlakIntensity(
  targetName: string,
  rng: RNG,
  tables: TableStore,
): FlakIntensity {
  const modifier = HEAVY_FLAK_TARGETS.includes(targetName) ? 1 : 0;
  const result = tables.lookup('O-2', rng, modifier);
  if (!result) return 'No flak';
  return result.entry.Flak as FlakIntensity;
}

// ─── Flak to hit (Table O-3) ───

export interface FlakHitResult {
  flakHits: number;
}

/**
 * Roll on Table O-3 to determine if flak hits the B-17.
 *
 * Per O-3, roll 2D three times for the given flak intensity.
 * Each roll may produce 0 or 1 flak hit.
 * For light flak (§13.1d), roll 2D twice on Light flak column.
 */
export function rollFlakToHit(
  intensity: FlakIntensity,
  rollCount: number,
  rng: RNG,
  tables: TableStore,
): FlakHitResult {
  if (intensity === 'No flak') return { flakHits: 0 };

  const o3 = tables.getRoll('O-3');
  if (!o3) throw new Error('O-3 table not found');

  let totalHits = 0;

  for (let i = 0; i < rollCount; i++) {
    const roll = rng.twod6();
    const clamped = Math.max(o3.minRoll, Math.min(o3.maxRoll, roll));
    const entry = o3.entries.get(String(clamped));
    if (!entry) continue;

    const flakData = (entry as any)[intensity];
    if (!flakData) continue;

    const hits = parseInt(flakData.flak_hits ?? '0', 10);
    totalHits += hits;
  }

  return { flakHits: totalHits };
}

// ─── Shell hits per flak hit (Table O-4) ───

/**
 * Roll on Table O-4 for number of shell hits per flak hit.
 * Per O-4, roll 2D for each flak hit.
 */
export function rollFlakShellHits(
  flakHits: number,
  rng: RNG,
  tables: TableStore,
): number {
  if (flakHits === 0) return 0;

  const o4 = tables.getRoll('O-4');
  if (!o4) throw new Error('O-4 table not found');

  let totalShells = 0;

  for (let i = 0; i < flakHits; i++) {
    const roll = rng.twod6();
    const clamped = Math.max(o4.minRoll, Math.min(o4.maxRoll, roll));
    const entry = o4.entries.get(String(clamped));
    if (!entry) continue;

    totalShells += parseInt((entry as any).shell_hits ?? '0', 10);
  }

  return totalShells;
}

// ─── Area affected per shell hit (Table O-5) ───

/**
 * Roll on Table O-5 for area affected by each shell hit.
 * Per O-5, roll 2D for each shell hit.
 */
export function rollFlakArea(
  shellHits: number,
  rng: RNG,
  tables: TableStore,
): HitLocation[] {
  if (shellHits === 0) return [];

  const o5 = tables.getRoll('O-5');
  if (!o5) throw new Error('O-5 table not found');

  const areas: HitLocation[] = [];

  for (let i = 0; i < shellHits; i++) {
    const roll = rng.twod6();
    const clamped = Math.max(o5.minRoll, Math.min(o5.maxRoll, roll));
    const entry = o5.entries.get(String(clamped));
    if (!entry) continue;

    const area = (entry as any).area_affected as string;
    // Normalize "Pilot Compartment" to "Pilot Compt." to match damage tables
    const normalized = area === 'Pilot Compartment' ? 'Pilot Compt.' : area;
    areas.push(normalized as HitLocation);
  }

  return areas;
}

// ─── Complete flak resolution ───

export interface FlakResolutionResult {
  intensity: FlakIntensity;
  flakHits: number;
  shellHits: number;
  areasHit: HitLocation[];
}

/**
 * Resolve complete flak over target per §5.2d.
 * Chain: O-2 → O-3 (3 rolls) → O-4 → O-5.
 */
export function resolveTargetFlak(
  targetName: string,
  rng: RNG,
  tables: TableStore,
): FlakResolutionResult {
  const intensity = rollFlakIntensity(targetName, rng, tables);
  if (intensity === 'No flak') {
    return { intensity, flakHits: 0, shellHits: 0, areasHit: [] };
  }

  const { flakHits } = rollFlakToHit(intensity, 3, rng, tables);
  const shellHits = rollFlakShellHits(flakHits, rng, tables);
  const areasHit = rollFlakArea(shellHits, rng, tables);

  return { intensity, flakHits, shellHits, areasHit };
}

/**
 * Resolve light flak for out-of-formation B-17 at 10,000 ft per §13.1d.
 * Roll 2D twice on Light Flak column of O-3.
 */
export function resolveLightFlak(
  rng: RNG,
  tables: TableStore,
): FlakResolutionResult {
  const intensity: FlakIntensity = 'Light flak';
  const { flakHits } = rollFlakToHit(intensity, 2, rng, tables);
  const shellHits = rollFlakShellHits(flakHits, rng, tables);
  const areasHit = rollFlakArea(shellHits, rng, tables);

  return { intensity, flakHits, shellHits, areasHit };
}
