/**
 * Bomb Run — bombing procedure, accuracy, evasive action, target of opportunity.
 *
 * Per §5.2d, after resolving flak in the target zone:
 *   - Resolve the Bomb Run by consulting Tables O-6 and O-7.
 *
 * Per Table O-6, roll 1D to determine if the bomb run is on or off target.
 *   Modifiers: flak hits (-1 per O-3 notes), evasive action, weather, etc.
 *
 * Per Table O-7, roll 2D to determine bombing accuracy percentage.
 *   Result depends on whether bomb run was On or Off target.
 *
 * Per §7.0, victory conditions depend on bombing results:
 *   - On Target + returned safely = 8th AF Victory
 *   - Off Target or no bomb = Draw (if survived)
 *   - B-17 destroyed/crashed = German Victory
 *
 * Per §15.0, evasive action is only for out-of-formation B-17s with restrictions.
 * Per §15.2, no evasive action if: in formation, 2+ engines out, control cables out,
 *   3+ negative landing modifiers, non-pilot flying, or damage disallows it.
 *
 * Per §13.2c, bombs may be jettisoned at any time when out of formation.
 *
 * Target of Opportunity: Per §8.0, if a B-17 aborts but still has bombs,
 * it may bomb a target of opportunity (off-target bombing with reduced accuracy).
 */

import type { RNG } from '../../../engine/rng.js';
import type { TableStore } from '../../../engine/tables.js';
import type { AircraftState, MissionState } from '../types.js';
import { countEnginesOut } from './damage.js';

// ─── Evasive Action ───

/**
 * Check if evasive action is allowed per §15.2.
 */
export function canTakeEvasiveAction(
  aircraft: AircraftState,
  outOfFormation: boolean,
  landingModifiers: number,
  pilotOrCopilotFlying: boolean,
  evasiveActionDisallowed: boolean,
): boolean {
  // §15.2a: must be out of formation
  if (!outOfFormation) return false;
  // §15.2b: not with 2+ engines out
  if (countEnginesOut(aircraft) >= 2) return false;
  // §15.2c: control cables must be intact
  if (aircraft.controlDamage.rudder || aircraft.controlDamage.elevator || aircraft.controlDamage.ailerons) return false;
  // §15.2d: not with 3+ negative landing modifiers
  if (landingModifiers <= -3) return false;
  // §15.2e: pilot or copilot must be flying
  if (!pilotOrCopilotFlying) return false;
  // §15.2f: specific damage disallows
  if (evasiveActionDisallowed) return false;

  return true;
}

// ─── Bomb Run Resolution ───

export type BombRunResult = 'On' | 'Off';

/**
 * Roll on Table O-6 for bomb run on/off target per §5.2d.
 *
 * Per O-6: 1D roll. 1-2 = Off, 3-6 = On.
 * Modifiers applied: flak (-1 per hit), weather effects, etc.
 */
export function rollBombRun(
  rng: RNG,
  tables: TableStore,
  modifier: number,
): { roll: number; result: BombRunResult } {
  const result = tables.lookup('O-6', rng, modifier);
  if (!result) throw new Error('Failed to look up bomb run on O-6');

  const onTarget = result.entry.bomb_run_on_target as string;
  return {
    roll: result.roll,
    result: onTarget === 'On' ? 'On' : 'Off',
  };
}

// ─── Bombing Accuracy ───

export interface BombingAccuracyResult {
  roll: number;
  onTarget: BombRunResult;
  accuracyPercent: number;
}

/**
 * Roll on Table O-7 for bombing accuracy per §5.2d.
 *
 * Per O-7: 2D roll, result depends on On/Off target from O-6.
 * Returns accuracy as a percentage (0–75%).
 */
export function rollBombingAccuracy(
  onTarget: BombRunResult,
  rng: RNG,
  tables: TableStore,
): BombingAccuracyResult {
  const o7 = tables.getRoll('O-7');
  if (!o7) throw new Error('O-7 table not found');

  const roll = rng.twod6();
  const clamped = Math.max(o7.minRoll, Math.min(o7.maxRoll, roll));
  const entry = o7.entries.get(String(clamped));
  if (!entry) throw new Error(`O-7 entry for roll ${clamped} not found`);

  const data = (entry as any)[onTarget];
  if (!data) throw new Error(`O-7 entry missing ${onTarget} column`);

  const accuracy = parseInt(data.bombing_accuracy ?? '0', 10);

  return {
    roll: clamped,
    onTarget,
    accuracyPercent: accuracy,
  };
}

// ─── Complete Bomb Run ───

export interface CompleteBombRunResult {
  bombRunResult: BombRunResult;
  bombRunRoll: number;
  accuracyPercent: number;
  accuracyRoll: number;
  bombsDropped: boolean;
}

/**
 * Resolve the complete bomb run: O-6 then O-7.
 *
 * Per §5.2d, the bomb run is resolved after flak.
 * Per §10.1, if B-17 has 1 engine out and kept bombs to reach target,
 * it may still bomb from the target zone.
 *
 * @param bombRunModifier - cumulative modifier from flak hits, weather, etc.
 */
export function resolveBombRun(
  rng: RNG,
  tables: TableStore,
  bombRunModifier: number,
  bombsAboard: boolean,
): CompleteBombRunResult {
  if (!bombsAboard) {
    return {
      bombRunResult: 'Off',
      bombRunRoll: 0,
      accuracyPercent: 0,
      accuracyRoll: 0,
      bombsDropped: false,
    };
  }

  const { roll: bombRunRoll, result: bombRunResult } = rollBombRun(rng, tables, bombRunModifier);
  const { accuracyPercent, roll: accuracyRoll } = rollBombingAccuracy(bombRunResult, rng, tables);

  return {
    bombRunResult,
    bombRunRoll,
    accuracyPercent,
    accuracyRoll,
    bombsDropped: true,
  };
}

/**
 * Resolve target of opportunity bombing per §8.0.
 * Aborting B-17 with bombs may bomb a target of opportunity.
 * Always treated as Off target.
 */
export function resolveTargetOfOpportunity(
  rng: RNG,
  tables: TableStore,
): CompleteBombRunResult {
  const { accuracyPercent, roll: accuracyRoll } = rollBombingAccuracy('Off', rng, tables);

  return {
    bombRunResult: 'Off',
    bombRunRoll: 0,
    accuracyPercent,
    accuracyRoll,
    bombsDropped: true,
  };
}
