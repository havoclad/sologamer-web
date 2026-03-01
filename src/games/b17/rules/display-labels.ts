/**
 * Display labels and formatting helpers for the B-17 game UI.
 */

import type { WoundSeverity } from '../types.js';

export const GUN_LABELS: Record<string, string> = {
  Nose: 'Nose guns',
  Port_Cheek: 'Port cheek gun',
  Starboard_Cheek: 'Starboard cheek gun',
  Top_Turret: 'Top turret',
  Ball_Turret: 'Ball turret',
  Port_Waist: 'Left waist gun',
  Starboard_Waist: 'Right waist gun',
  Radio: 'Radio room gun',
  Tail: 'Tail guns',
};

/** Map wound severity to event severity for emit calls. */
export function woundToEventSeverity(severity: WoundSeverity): 'warn' | 'bad' | 'critical' {
  if (severity === 'kia') return 'critical';
  if (severity === 'serious') return 'bad';
  return 'warn';
}

export function plural(count: number, singular: string, pluralForm?: string): string {
  if (count === 1) return `1 ${singular}`;
  return `${count} ${pluralForm ?? singular + 's'}`;
}
