/**
 * Game registry — games register themselves with the engine.
 */

import type { PhaseDefinition } from './state-machine.js';

export interface GameModule<TPhase extends string = string, TState = unknown> {
  id: string;
  name: string;
  description: string;
  /** Path to the directory containing JSON table files */
  tableDirectory: string;
  /** Phase definitions for the state machine */
  phases: PhaseDefinition<TPhase>[];
  /** Which phase to start in */
  initialPhase: TPhase;
  /** Factory to create initial game state */
  createInitialState: () => TState;
}

class GameRegistry {
  private games = new Map<string, GameModule>();

  register<TPhase extends string, TState>(module: GameModule<TPhase, TState>): void {
    this.games.set(module.id, module as unknown as GameModule);
  }

  get(id: string): GameModule | undefined {
    return this.games.get(id);
  }

  list(): GameModule[] {
    return [...this.games.values()];
  }

  has(id: string): boolean {
    return this.games.has(id);
  }
}

/** Singleton registry */
export const registry = new GameRegistry();
