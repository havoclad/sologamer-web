/**
 * Table row builders — pure functions that extract display data from TableStore.
 *
 * These are used by the web UI to show table contents alongside pending rolls.
 */

import type { TableStore } from '../engine/tables.js';
import type { PendingRoll } from './types.js';
import { getM3AttackGroup } from '../games/b17/rules/fighter-encounters.js';

/** Build display rows for M-4 filtered by a specific cover level */
export function buildM4Rows(tables: TableStore, coverLevel: string): PendingRoll['tableRows'] {
  const table = tables.getRoll('M-4');
  if (!table?.raw?.rolls) return [];
  const rows: PendingRoll['tableRows'] = [];
  for (const [key, entry] of Object.entries(table.raw.rolls as Record<string, any>)) {
    const levelData = entry[coverLevel];
    if (levelData) {
      rows.push({ roll: key, columns: { result: String(levelData.result ?? ''), description: String(levelData.description ?? '') } });
    }
  }
  return rows;
}

/** Build display rows for M-3 based on fighter's attack position.
 *  totalModifier = engineMod + evasiveMod - fcaDamage (net modifier applied to roll).
 *  Only show "(always)" on roll 6 when modifiers would cause it to miss otherwise. */
export function buildM3Rows(tables: TableStore, fighterPosition: string, totalModifier: number = 0): PendingRoll['tableRows'] {
  const raw = (tables.get('M-3')?.raw as any)?.attack_positions;
  if (!raw) return [
    { roll: '1-5', columns: { result: 'Depends on position' } },
    { roll: '6', columns: { result: 'Hit' } },
  ];
  const attackGroup = getM3AttackGroup(fighterPosition as any);
  const groupData = raw[attackGroup];
  if (!groupData?.hit_on) return [
    { roll: '1-5', columns: { result: 'Depends on position' } },
    { roll: '6', columns: { result: 'Hit' } },
  ];
  const hitNumbers: number[] = groupData.hit_on;
  const minHit = Math.min(...hitNumbers);
  const rows: PendingRoll['tableRows'] = [];
  if (minHit > 1) {
    rows.push({ roll: minHit > 2 ? `1-${minHit - 1}` : '1', columns: { result: 'Miss' } });
  }
  for (let i = minHit; i <= 5; i++) {
    if (hitNumbers.includes(i)) {
      rows.push({ roll: String(i), columns: { result: 'Hit' } });
    } else {
      rows.push({ roll: String(i), columns: { result: 'Miss' } });
    }
  }
  // A natural 6 always hits per M-3 rules. Only annotate "(always)" when
  // the net modifier is negative enough that 6 + modifier would miss.
  const modifiedSix = 6 + totalModifier;
  const sixWouldMissWithMods = !hitNumbers.includes(modifiedSix);
  rows.push({ roll: '6', columns: { result: sixWouldMissWithMods ? 'Hit (always)' : 'Hit' } });
  return rows;
}

/** Map fighter position string to attack group key used in B-4/B-5 tables. */
function positionToGroupKey(fighterPosition: string): string {
  const posLower = fighterPosition.toLowerCase();
  if (posLower.includes('vertical dive')) return 'vertical_dive';
  if (posLower.includes('vertical climb')) return 'vertical_climb';
  if (posLower.startsWith('3 ') || posLower.startsWith('9 ')) return '3_9';
  if (posLower.startsWith('6 ')) return '6';
  return '12_1:30_10:30';
}

/** Build display rows for B-4 filtered by fighter attack position group */
export function buildB4Rows(tables: TableStore, fighterPosition: string): PendingRoll['tableRows'] {
  const raw = (tables.get('B-4')?.raw as any)?.attack_positions;
  if (!raw) return [];

  const group = raw[positionToGroupKey(fighterPosition)];
  if (!group?.rolls) return [];

  const rows: PendingRoll['tableRows'] = [];
  for (const [roll, hits] of Object.entries(group.rolls as Record<string, number>)) {
    rows.push({ roll, columns: { 'Shell Hits': String(hits) } });
  }
  return rows;
}

/** Build display rows for B-5 filtered by fighter attack position and altitude */
export function buildB5Rows(tables: TableStore, fighterPosition: string): PendingRoll['tableRows'] {
  const raw = (tables.get('B-5')?.raw as any)?.attack_positions;
  if (!raw) return [];

  const group = raw[positionToGroupKey(fighterPosition)];
  if (!group) return [];

  // Determine altitude sub-key (high/level/low from position, or flat for vertical)
  const posLower = fighterPosition.toLowerCase();
  let altKey: string | null = null;
  if (posLower.includes('high')) altKey = 'high';
  else if (posLower.includes('low')) altKey = 'low';
  else if (posLower.includes('level')) altKey = 'level';

  const data = altKey && group[altKey] ? group[altKey] : group;
  const rows: PendingRoll['tableRows'] = [];
  for (const [roll, entry] of Object.entries(data as Record<string, any>)) {
    if (roll === 'name' || typeof entry !== 'object') continue;
    rows.push({ roll, columns: { Location: entry.location ?? '—', Description: entry.description ?? '' } });
  }
  return rows;
}

/** Build display rows for O-3 filtered by a specific flak level */
export function buildO3Rows(tables: TableStore, flakLevel: string): PendingRoll['tableRows'] {
  const table = tables.getRoll('O-3');
  if (!table?.raw?.rolls) return [];
  const rows: PendingRoll['tableRows'] = [];
  for (const [key, entry] of Object.entries(table.raw.rolls as Record<string, any>)) {
    const levelData = entry[flakLevel];
    if (levelData) {
      const hits = parseInt(levelData.flak_hits ?? '0', 10);
      rows.push({ roll: key, columns: { result: hits > 0 ? 'Hit' : 'Miss' } });
    }
  }
  return rows;
}
