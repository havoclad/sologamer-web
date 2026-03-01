/**
 * Web-specific types for the B-17 game session UI.
 */

import type { RNG } from '../engine/rng.js';
import type { CrewMember, AircraftState, MissionState } from '../games/b17/types.js';

// ─── Rich event types for the frontend ───

export interface RollModifier {
  source: string;
  value: number;
}

export interface RollDetail {
  table: string;
  tableTitle?: string;
  rollType: string;
  rolled: number;
  modifier?: number;
  modifiedRoll?: number;
  modifiers?: RollModifier[];
  result: string;
  description?: string;
  /** Full table data for expandable lookup */
  tableData?: Record<string, string>;
}

/** Structured combat state attached to combat events so the UI can render
 *  without parsing message strings. */
export interface CombatViewState {
  fighters: Array<{ id: number; type: string; position: string }>;
}

export interface GameEvent {
  id: number;
  phase: string;
  zone?: number;
  direction?: 'outbound' | 'inbound';
  category: 'setup' | 'movement' | 'combat' | 'damage' | 'flak' | 'bombing' | 'landing' | 'debrief' | 'system';
  severity: 'info' | 'good' | 'warn' | 'bad' | 'critical';
  message: string;
  details?: RollDetail[];
  /** Structured combat state for the UI combat diagram */
  combatState?: CombatViewState;
  /** Snapshot of crew/aircraft state at this point */
  stateSnapshot?: {
    crew: CrewMember[];
    aircraft: AircraftState;
    mission: Partial<MissionState> | null;
  };
}

/** Pending choice — the engine is waiting for the player to select items */
export interface PendingChoice {
  id: number;
  type: 'choice';
  choiceType?: 'selection' | 'gun-allocation';
  purpose: string;        // Human-readable description
  prompt: string;         // What the player should do
  options: Array<{ id: number; label: string; disabled?: boolean; reason?: string }>;
  minSelections: number;
  maxSelections: number;
  /** Gun allocation data — present when choiceType === 'gun-allocation' */
  allocations?: Array<{
    gunId: string;
    gunLabel: string;
    crewName: string;
    ammoRemaining: number;
    isTailSpecial: boolean;
    targets: Array<{ fighterId: number; label: string; hitReq: number }>;
  }>;
}

/** Pending roll — the engine is waiting for the player to provide a dice result */
export interface PendingRoll {
  id: number;
  tableId: string;
  tableName: string;
  diceType: string;       // '1d6', '2d6', 'd6d6'
  purpose: string;        // Human-readable: "Target for Mission 1"
  modifier: number;
  /** Full table rows for display */
  tableRows: Array<{ roll: string; columns: Record<string, string> }>;
}

/** Yield type for the mission generator */
export type MissionYield =
  | { type: 'events'; events: GameEvent[] }
  | { type: 'pending'; roll: PendingRoll; events: GameEvent[] }
  | { type: 'choice'; choice: PendingChoice; events: GameEvent[] };

// ─── Pure utility functions ───

/** Normalize dice type from JSON format to display format. */
export function normalizeDiceType(rolltype: string): string {
  switch (rolltype) {
    case 'd6': return '1d6';
    case '1d6': return '1d6';
    case '2d6': return '2d6';
    case 'd6d6': return 'd6d6';
    default: return rolltype;
  }
}

/** Generate a random roll value for a given dice type. */
export function autoRoll(diceType: string, rng: RNG): number {
  switch (diceType) {
    case '2d6': return rng.twod6();
    case 'd6d6': return rng.d6d6();
    default: return rng.d6();
  }
}
