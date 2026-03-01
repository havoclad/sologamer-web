/**
 * GeneratorContext — dependency interface for extracted generator functions.
 *
 * Instead of accessing `this` from the GameSession class, extracted generators
 * receive a context object that provides the same capabilities. GameSession
 * creates a context adapter from `this` and passes it to extracted generators.
 */

import type { RNG } from '../../engine/rng.js';
import type { TableStore } from '../../engine/tables.js';
import type {
  B17GameState, CrewMember, AircraftState, MissionState,
} from '../../games/b17/types.js';
import type {
  GameEvent, RollDetail, CombatViewState, PendingRoll, MissionYield,
} from '../types.js';

export interface GeneratorContext {
  rng: RNG;
  tables: TableStore;
  state: B17GameState;

  /** Emit a game event and return it. */
  emit(
    phase: string, message: string, category: GameEvent['category'],
    severity: GameEvent['severity'], zone?: number,
    direction?: 'outbound' | 'inbound', details?: RollDetail[],
    includeSnapshot?: boolean,
    combatState?: CombatViewState,
  ): GameEvent;

  /** Event buffer — accumulated events between yields. */
  eventBuffer: GameEvent[];

  /** Next pending roll ID. */
  pendingRollId: number;

  /** Create a fixed RNG that returns a given value on first call. */
  createFixedRng(value: number): RNG;
}
