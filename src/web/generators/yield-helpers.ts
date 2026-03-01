/**
 * Shared yield helpers for generator functions.
 */

import type { PendingRoll, MissionYield } from '../types.js';
import { normalizeDiceType, autoRoll } from '../types.js';
import type { GeneratorContext } from './generator-context.js';

/**
 * Create a PendingRoll from table metadata.
 * Looks up the table's display data (title, roll type, rows) from the TableStore.
 */
export function createPendingRoll(
  ctx: GeneratorContext,
  tableId: string, purpose: string, modifier = 0, subKey?: string,
  modifierReason?: string,
): PendingRoll {
  const tableDisplay = ctx.tables.getTableDisplayData(tableId, subKey);
  const table = ctx.tables.getRoll(tableId);
  return {
    id: ctx.pendingRollId++,
    tableId,
    tableName: tableDisplay?.title ?? tableId,
    diceType: normalizeDiceType(tableDisplay?.rolltype ?? table?.rolltype ?? '1d6'),
    purpose,
    modifier,
    ...(modifierReason ? { modifierReason } : {}),
    tableRows: tableDisplay?.rows ?? [],
  };
}

/**
 * Yield a combat roll to the player and return the result.
 * This is the shared helper used by all extracted generators.
 */
export function* yieldCombatRoll(
  ctx: GeneratorContext,
  tableId: string, tableName: string, purpose: string, diceType: string,
  tableRows: PendingRoll['tableRows'] = [], modifier = 0, modifierReason?: string,
): Generator<MissionYield, number, number | number[] | undefined> {
  const pending: PendingRoll = {
    id: ctx.pendingRollId++,
    tableId, tableName, diceType, purpose, modifier,
    ...(modifierReason ? { modifierReason } : {}),
    tableRows,
  };
  // Flush accumulated events WITH this yield
  const eventsToSend = ctx.eventBuffer;
  ctx.eventBuffer = [];
  const raw = yield { type: 'pending', roll: pending, events: eventsToSend };
  const value: number = (typeof raw === 'number' ? raw : undefined) ?? autoRoll(diceType, ctx.rng);
  ctx.eventBuffer = [];
  return value;
}
