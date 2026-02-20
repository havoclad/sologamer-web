/**
 * Generic game phase/state machine.
 * Games define phases and transitions; the engine manages flow and snapshots.
 */

export interface PhaseDefinition<TPhase extends string = string> {
  name: TPhase;
  /** Which phases can follow this one */
  next: TPhase[];
  /** If true, this is a terminal state */
  terminal?: boolean;
}

export interface StateMachineConfig<TPhase extends string, TState> {
  phases: PhaseDefinition<TPhase>[];
  initialPhase: TPhase;
  /** Create initial game state */
  createInitialState: () => TState;
}

export interface Snapshot<TPhase extends string, TState> {
  phase: TPhase;
  state: TState;
  index: number;
}

export class StateMachine<TPhase extends string, TState> {
  private phase: TPhase;
  private state: TState;
  private phaseMap: Map<TPhase, PhaseDefinition<TPhase>>;
  private snapshots: Snapshot<TPhase, TState>[] = [];
  private snapshotIndex = 0;

  constructor(private config: StateMachineConfig<TPhase, TState>) {
    this.phaseMap = new Map(config.phases.map(p => [p.name, p]));
    this.phase = config.initialPhase;
    this.state = config.createInitialState();
    this.takeSnapshot();
  }

  getPhase(): TPhase { return this.phase; }
  getState(): TState { return this.state; }

  /** Check if current phase is terminal */
  isTerminal(): boolean {
    return this.phaseMap.get(this.phase)?.terminal === true;
  }

  /** Get valid next phases from current */
  validTransitions(): TPhase[] {
    return this.phaseMap.get(this.phase)?.next ?? [];
  }

  /** Transition to a new phase, optionally updating state */
  transition(nextPhase: TPhase, stateUpdate?: Partial<TState> | ((s: TState) => TState)): void {
    const current = this.phaseMap.get(this.phase);
    if (!current) throw new Error(`Unknown current phase: ${this.phase}`);
    if (!current.next.includes(nextPhase)) {
      throw new Error(`Invalid transition: ${this.phase} → ${nextPhase}. Valid: ${current.next.join(', ')}`);
    }

    this.phase = nextPhase;
    if (stateUpdate) {
      if (typeof stateUpdate === 'function') {
        this.state = stateUpdate(this.state);
      } else {
        this.state = { ...this.state, ...stateUpdate };
      }
    }
    this.takeSnapshot();
  }

  /** Force-set state without transition (for game-specific mutations) */
  updateState(update: Partial<TState> | ((s: TState) => TState)): void {
    if (typeof update === 'function') {
      this.state = update(this.state);
    } else {
      this.state = { ...this.state, ...update };
    }
  }

  private takeSnapshot(): void {
    this.snapshots.push({
      phase: this.phase,
      state: structuredClone(this.state),
      index: this.snapshotIndex++,
    });
  }

  /** Undo to previous snapshot */
  undo(): boolean {
    if (this.snapshots.length <= 1) return false;
    this.snapshots.pop();
    const prev = this.snapshots[this.snapshots.length - 1];
    this.phase = prev.phase;
    this.state = structuredClone(prev.state);
    return true;
  }

  /** Get all snapshots (for replay) */
  getSnapshots(): readonly Snapshot<TPhase, TState>[] {
    return this.snapshots;
  }
}
