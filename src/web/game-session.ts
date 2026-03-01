/**
 * Game Session — wraps the B-17 engine for step-by-step web play.
 *
 * Uses a generator-based architecture: the mission execution yields
 * PendingRoll objects at each table lookup. The player provides a roll
 * value (manual or auto-generated), and the generator resumes.
 */

import { createRNG, type RNG } from '../engine/rng.js';
import { TableStore } from '../engine/tables.js';
import { b17Module, createInitialB17State } from '../games/b17/index.js';
import type { B17GameState, AircraftState } from '../games/b17/types.js';
import { cloneGuns, gunsToAmmo } from '../games/b17/rules/guns.js';
import { cloneCrew } from '../games/b17/rules/crew.js';
import { generateCrewName } from '../games/b17/rules/crew-names.js';
import {
  type RollModifier, type RollDetail, type CombatViewState, type GameEvent,
  type PendingChoice, type PendingRoll, type MissionYield,
  autoRoll,
} from './types.js';
import type { GeneratorContext } from './generators/generator-context.js';
import { executeMission } from './generators/mission-generator.js';

// Re-export types so existing consumers of game-session.ts don't break
export type { RollModifier, RollDetail, CombatViewState, GameEvent, PendingChoice, PendingRoll, MissionYield };

function cloneAircraft(ac: AircraftState): AircraftState {
  const guns = cloneGuns(ac.guns);
  return {
    ...ac,
    engines: [...ac.engines] as AircraftState['engines'],
    wingSurfaceDamage: { ...ac.wingSurfaceDamage },
    controlDamage: { ...ac.controlDamage },
    guns,
    ammo: gunsToAmmo(guns) as any,
  };
}

// ─── Fixed RNG for player-provided rolls ───

import type { RNGState } from '../engine/rng.js';

/**
 * Create an RNG that returns a fixed value for the first random call,
 * then delegates to the fallback RNG for subsequent calls.
 * This lets us pass a player-provided roll value to existing helper functions.
 */
function createFixedRng(value: number, fallback: RNG): RNG {
  let used = false;
  return {
    next() { return fallback.next(); },
    int(min: number, max: number) { if (!used) { used = true; return value; } return fallback.int(min, max); },
    roll(count: number, sides: number) { if (!used) { used = true; return value; } return fallback.roll(count, sides); },
    d6() { if (!used) { used = true; return value; } return fallback.d6(); },
    twod6() { if (!used) { used = true; return value; } return fallback.twod6(); },
    d6d6() { if (!used) { used = true; return value; } return fallback.d6d6(); },
    percentile() { return fallback.percentile(); },
    getState() { return fallback.getState(); },
    setState(s: RNGState) { fallback.setState(s); },
  };
}

// ─── Session ───

export class GameSession {
  private state: B17GameState;
  private rng: RNG;
  private tables: TableStore;
  private events: GameEvent[] = [];
  private eventId = 0;
  private seed: number;
  private missionInProgress = false;
  private autoplay = false;
  private pendingRollId = 0;

  /** Generator for step-by-step mission execution */
  private missionGen: Generator<MissionYield, void, number | number[] | undefined> | null = null;
  /** Current pending roll waiting for player input */
  private currentPendingRoll: PendingRoll | null = null;
  /** Current pending choice waiting for player input */
  private currentPendingChoice: PendingChoice | null = null;
  /** Events buffered since last yield */
  private eventBuffer: GameEvent[] = [];

  /** Debug replay log: records every player input for deterministic replay */
  private inputLog: Array<{
    seq: number;
    type: 'roll' | 'choice' | 'auto_roll' | 'auto_choice';
    value: number | number[];
    context?: string;  // table/description from pending roll/choice
  }> = [];
  private inputSeq = 0;

  constructor(seed?: number, bomberName?: string) {
    this.seed = seed ?? Date.now();
    this.rng = createRNG(this.seed);
    this.tables = new TableStore();
    this.tables.loadDirectory(b17Module.tableDirectory);
    this.state = createInitialB17State();
    this.state.campaign.planeName = bomberName ?? 'Memphis Belle';
    for (const crew of this.state.campaign.crew) {
      crew.name = generateCrewName(this.rng);
    }
  }

  /** Create a GeneratorContext adapter from this session. */
  private get _ctx(): GeneratorContext {
    const session = this;
    return {
      rng: this.rng,
      tables: this.tables,
      state: this.state,
      emit: this.emit.bind(this),
      get eventBuffer() { return session.eventBuffer; },
      set eventBuffer(v) { session.eventBuffer = v; },
      get pendingRollId() { return session.pendingRollId; },
      set pendingRollId(v) { session.pendingRollId = v; },
      createFixedRng: (value: number) => createFixedRng(value, this.rng),
    };
  }

  getSeed(): number { return this.seed; }
  getState(): B17GameState { return this.state; }
  getEvents(): GameEvent[] { return this.events; }
  getEventsFrom(fromId: number): GameEvent[] { return this.events.filter(e => e.id >= fromId); }
  isMissionInProgress(): boolean { return this.missionInProgress; }
  isAutoplay(): boolean { return this.autoplay; }
  setAutoplay(val: boolean): void { this.autoplay = val; }
  getCurrentPendingRoll(): PendingRoll | null { return this.currentPendingRoll; }
  getCurrentPendingChoice(): PendingChoice | null { return this.currentPendingChoice; }

  /** Get the debug replay log for the current mission */
  getDebugLog(): {
    seed: number;
    bomberName: string;
    missionNumber: number;
    inputs: typeof this.inputLog;
  } {
    return {
      seed: this.seed,
      bomberName: this.state.campaign.planeName,
      missionNumber: this.state.campaign.missionsCompleted + 1,
      inputs: [...this.inputLog],
    };
  }

  private emit(
    phase: string, message: string, category: GameEvent['category'],
    severity: GameEvent['severity'], zone?: number,
    direction?: 'outbound' | 'inbound', details?: RollDetail[],
    includeSnapshot = false,
    combatState?: CombatViewState,
  ): GameEvent {
    const event: GameEvent = {
      id: this.eventId++,
      phase, zone, direction, category, severity, message, details,
    };
    if (combatState) {
      event.combatState = combatState;
    }
    if (includeSnapshot) {
      event.stateSnapshot = {
        crew: cloneCrew(this.state.campaign.crew),
        aircraft: cloneAircraft(this.state.campaign.aircraft),
        mission: this.state.mission ? { ...this.state.mission } : null,
      };
    }
    this.events.push(event);
    this.eventBuffer.push(event);
    return event;
  }

  /** Start a new mission — returns first pending roll or all events if autoplay */
  startMission(): { events: GameEvent[]; pendingRoll: PendingRoll | null; pendingChoice: PendingChoice | null; complete: boolean } {
    if (this.missionInProgress) {
      return { events: [], pendingRoll: this.currentPendingRoll, pendingChoice: this.currentPendingChoice, complete: false };
    }

    this.missionInProgress = true;
    this.eventBuffer = [];
    this.inputLog = [];
    this.inputSeq = 0;
    this.missionGen = executeMission(this._ctx);

    return this._advanceMission();
  }

  /** Submit a roll value and advance to next step */
  submitRoll(value: number): { events: GameEvent[]; pendingRoll: PendingRoll | null; pendingChoice: PendingChoice | null; complete: boolean } {
    if (!this.missionGen || !this.currentPendingRoll) {
      return { events: [], pendingRoll: null, pendingChoice: null, complete: true };
    }

    this.inputLog.push({
      seq: this.inputSeq++,
      type: 'roll',
      value,
      context: `${this.currentPendingRoll.tableId} (${this.currentPendingRoll.purpose})`,
    });

    this.eventBuffer = [];
    this.currentPendingRoll = null;
    this.currentPendingChoice = null;

    const result = this.missionGen.next(value);
    return this._processGeneratorResult(result);
  }

  /** Submit a choice selection and advance to next step */
  submitChoice(selectedIds: number[]): { events: GameEvent[]; pendingRoll: PendingRoll | null; pendingChoice: PendingChoice | null; complete: boolean } {
    if (!this.missionGen || !this.currentPendingChoice) {
      return { events: [], pendingRoll: null, pendingChoice: null, complete: true };
    }

    this.inputLog.push({
      seq: this.inputSeq++,
      type: 'choice',
      value: selectedIds,
      context: this.currentPendingChoice.purpose,
    });

    this.eventBuffer = [];
    this.currentPendingRoll = null;
    this.currentPendingChoice = null;

    const result = this.missionGen.next(selectedIds);
    return this._processGeneratorResult(result);
  }

  /** Auto-roll and advance (for autoplay mode) */
  autoStep(): { events: GameEvent[]; pendingRoll: PendingRoll | null; pendingChoice: PendingChoice | null; complete: boolean } {
    if (!this.missionGen || (!this.currentPendingRoll && !this.currentPendingChoice)) {
      return { events: [], pendingRoll: null, pendingChoice: null, complete: true };
    }

    // Auto-resolve choices: pick first N enabled options
    if (this.currentPendingChoice) {
      const choice = this.currentPendingChoice;
      const enabled = choice.options.filter(o => !o.disabled);
      const autoSelected = enabled.slice(0, choice.maxSelections).map(o => o.id);
      const result = this.submitChoice(autoSelected);
      // Mark last input as auto
      if (this.inputLog.length > 0) this.inputLog[this.inputLog.length - 1].type = 'auto_choice';
      return result;
    }

    const diceType = this.currentPendingRoll!.diceType;
    const rollValue = autoRoll(diceType, this.rng);
    const result = this.submitRoll(rollValue);
    // Mark last input as auto
    if (this.inputLog.length > 0) this.inputLog[this.inputLog.length - 1].type = 'auto_roll';
    return result;
  }

  /** Run entire mission eagerly (for backwards compat / autoplay) */
  runMission(): { events: GameEvent[]; complete: boolean } {
    const startResult = this.startMission();
    const allEvents = [...startResult.events];

    while (startResult.pendingRoll || this.currentPendingRoll || this.currentPendingChoice) {
      const stepResult = this.autoStep();
      allEvents.push(...stepResult.events);
      if (stepResult.complete) break;
    }

    return { events: allEvents, complete: true };
  }

  private _advanceMission(): { events: GameEvent[]; pendingRoll: PendingRoll | null; pendingChoice: PendingChoice | null; complete: boolean } {
    if (!this.missionGen) return { events: [], pendingRoll: null, pendingChoice: null, complete: true };

    const result = this.missionGen.next(undefined);
    return this._processGeneratorResult(result);
  }

  private _processGeneratorResult(result: IteratorResult<MissionYield, void>): { events: GameEvent[]; pendingRoll: PendingRoll | null; pendingChoice: PendingChoice | null; complete: boolean } {
    if (result.done) {
      this.missionGen = null;
      this.currentPendingRoll = null;
      this.currentPendingChoice = null;
      this.missionInProgress = false;
      return { events: this.eventBuffer, pendingRoll: null, pendingChoice: null, complete: true };
    }

    const yielded = result.value;
    if (yielded.type === 'pending') {
      this.currentPendingRoll = yielded.roll;
      return { events: yielded.events, pendingRoll: yielded.roll, pendingChoice: null, complete: false };
    }

    if (yielded.type === 'choice') {
      this.currentPendingChoice = yielded.choice;
      return { events: yielded.events, pendingRoll: null, pendingChoice: yielded.choice, complete: false };
    }

    // type === 'events' — shouldn't happen with current design but handle it
    return { events: yielded.events, pendingRoll: null, pendingChoice: null, complete: false };
  }


}
