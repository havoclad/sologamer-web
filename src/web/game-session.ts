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
import type {
  B17GameState, CrewMember, CrewPosition, AircraftState,
  WoundSeverity, MissionState, AmmoState,
} from '../games/b17/types.js';
import { DEFAULT_AMMO } from '../games/b17/types.js';
import type { B17Phase } from '../games/b17/phases.js';
import {
  getZoneInfo, getTargetZone,
  type TargetInfo, type ZoneInfo,
} from '../games/b17/rules/mission-setup.js';
import {
  hasFighterCover, turnsInZone, getFighterWaveModifier,
  mustAbort, enginesOut, type FighterCoverLevel,
} from '../games/b17/rules/zone-movement.js';
import {
  addLeadTailExtraFighter,
  canBeDrivenOffByCover,
  getM3AttackGroup,
  type Fighter,
} from '../games/b17/rules/fighter-encounters.js';
import {
  getFieldOfFire, resolveDefensiveFire, rollFighterDamage, isTwinGunMount,
  applyFighterDamage, resolveGermanOffensiveFire, rollFighterCoverDefense,
  removeDrivenOffFighters, rollShellHits, rollSuccessiveAttackPosition,
  getSuccessiveAttackers,
  type GunPosition,
} from '../games/b17/rules/combat.js';
import {
  rollHitLocation, rollCompartmentDamage, rollCrewWound, accumulateWound,
  countEnginesOut, WALKING_HIT_COMPARTMENTS,
  type ShellHitLocation, type DamageResult,
} from '../games/b17/rules/damage.js';

// ─── Pluralization helper ───

function plural(count: number, singular: string, pluralForm?: string): string {
  if (count === 1) return `1 ${singular}`;
  return `${count} ${pluralForm ?? singular + 's'}`;
}

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

export interface GameEvent {
  id: number;
  phase: string;
  zone?: number;
  direction?: 'outbound' | 'inbound';
  category: 'setup' | 'movement' | 'combat' | 'damage' | 'flak' | 'bombing' | 'landing' | 'debrief' | 'system';
  severity: 'info' | 'good' | 'warn' | 'bad' | 'critical';
  message: string;
  details?: RollDetail[];
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

// ─── Crew name generation ───

const FIRST_NAMES = [
  'James', 'Robert', 'John', 'William', 'Richard', 'Thomas', 'Charles', 'Donald',
  'George', 'Kenneth', 'Edward', 'Frank', 'Raymond', 'Harold', 'Paul', 'Jack',
  'Henry', 'Arthur', 'Ralph', 'Albert', 'Eugene', 'Howard', 'Carl', 'Walter',
];
const LAST_NAMES = [
  'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Miller', 'Davis', 'Wilson',
  'Anderson', 'Taylor', 'Thomas', 'Moore', 'Martin', 'Jackson', 'Thompson', 'White',
  'Harris', 'Clark', 'Lewis', 'Robinson', 'Walker', 'Young', 'Allen', 'King',
  'Wright', 'Scott', 'Green', 'Baker', 'Adams', 'Nelson', 'Hill', 'Campbell',
];

const POSITION_LABELS: Record<CrewPosition, string> = {
  pilot: 'Pilot', copilot: 'Co-Pilot', navigator: 'Navigator', bombardier: 'Bombardier',
  engineer: 'Engineer/Top Turret', radioman: 'Radio Operator',
  ball_turret: 'Ball Turret Gunner', left_waist: 'Left Waist Gunner',
  right_waist: 'Right Waist Gunner', tail_gunner: 'Tail Gunner',
};

const GUN_LABELS: Record<string, string> = {
  Nose: 'Nose guns', Port_Cheek: 'Port cheek gun', Starboard_Cheek: 'Starboard cheek gun',
  Top_Turret: 'Top turret', Ball_Turret: 'Ball turret',
  Port_Waist: 'Left waist gun', Starboard_Waist: 'Right waist gun',
  Radio: 'Radio room gun', Tail: 'Tail guns',
};

const GUN_TO_CREW: Record<string, CrewPosition> = {
  Nose: 'bombardier', Port_Cheek: 'navigator', Starboard_Cheek: 'navigator',
  Top_Turret: 'engineer', Ball_Turret: 'ball_turret',
  Port_Waist: 'left_waist', Starboard_Waist: 'right_waist',
  Radio: 'radioman', Tail: 'tail_gunner',
};

function generateCrewName(rng: RNG): string {
  return `${FIRST_NAMES[rng.int(0, FIRST_NAMES.length - 1)]} ${LAST_NAMES[rng.int(0, LAST_NAMES.length - 1)]}`;
}

function getCrewByPosition(crew: CrewMember[], pos: CrewPosition): CrewMember | undefined {
  return crew.find(c => c.position === pos);
}

function isCrewDown(crew: CrewMember[], pos: CrewPosition): boolean {
  const m = crew.find(c => c.position === pos);
  return !m || m.status !== 'active' || m.wounds === 'serious' || m.wounds === 'kia';
}

function cloneCrew(crew: CrewMember[]): CrewMember[] {
  return crew.map(c => ({ ...c }));
}

function cloneAircraft(ac: AircraftState): AircraftState {
  return {
    ...ac,
    engines: [...ac.engines] as AircraftState['engines'],
    wingSurfaceDamage: { ...ac.wingSurfaceDamage },
    controlDamage: { ...ac.controlDamage },
    ammo: { ...ac.ammo },
  };
}

// ─── Normalize dice type from JSON format ───
function normalizeDiceType(rolltype: string): string {
  switch (rolltype) {
    case 'd6': return '1d6';
    case '1d6': return '1d6';
    case '2d6': return '2d6';
    case 'd6d6': return 'd6d6';
    default: return rolltype;
  }
}

/** Build display rows for M-4 filtered by a specific cover level */
function buildM4Rows(tables: TableStore, coverLevel: string): PendingRoll['tableRows'] {
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

/** Build display rows for M-3 based on fighter's attack position */
function buildM3Rows(tables: TableStore, fighterPosition: string): PendingRoll['tableRows'] {
  const raw = (tables.get('M-3')?.raw as any)?.attack_positions;
  if (!raw) return [
    { roll: '1-5', columns: { result: 'Depends on position' } },
    { roll: '6', columns: { result: 'Always hits' } },
  ];
  const attackGroup = getM3AttackGroup(fighterPosition as any);
  const groupData = raw[attackGroup];
  if (!groupData?.hit_on) return [
    { roll: '1-5', columns: { result: 'Depends on position' } },
    { roll: '6', columns: { result: 'Always hits' } },
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
  rows.push({ roll: '6', columns: { result: 'Hit (always)' } });
  return rows;
}

/** Build display rows for B-4 filtered by fighter attack position group */
function buildB4Rows(tables: TableStore, fighterPosition: string): PendingRoll['tableRows'] {
  const raw = (tables.get('B-4')?.raw as any)?.attack_positions;
  if (!raw) return [];

  // Map fighter position to B-4 group key
  const posLower = fighterPosition.toLowerCase();
  let groupKey: string;
  if (posLower.includes('vertical dive')) groupKey = 'vertical_dive';
  else if (posLower.includes('vertical climb')) groupKey = 'vertical_climb';
  else if (posLower.startsWith('3 ') || posLower.startsWith('9 ')) groupKey = '3_9';
  else if (posLower.startsWith('6 ')) groupKey = '6';
  else groupKey = '12_1:30_10:30';

  const group = raw[groupKey];
  if (!group?.rolls) return [];

  const rows: PendingRoll['tableRows'] = [];
  for (const [roll, hits] of Object.entries(group.rolls as Record<string, number>)) {
    rows.push({ roll, columns: { 'Shell Hits': String(hits) } });
  }
  return rows;
}

/** Build display rows for B-5 filtered by fighter attack position and altitude */
function buildB5Rows(tables: TableStore, fighterPosition: string): PendingRoll['tableRows'] {
  const raw = (tables.get('B-5')?.raw as any)?.attack_positions;
  if (!raw) return [];

  // Map fighter position to B-5 group key
  const posLower = fighterPosition.toLowerCase();
  let groupKey: string;
  if (posLower.includes('vertical dive')) groupKey = 'vertical_dive';
  else if (posLower.includes('vertical climb')) groupKey = 'vertical_climb';
  else if (posLower.startsWith('3 ') || posLower.startsWith('9 ')) groupKey = '3_9';
  else if (posLower.startsWith('6 ')) groupKey = '6';
  else groupKey = '12_1:30_10:30';

  const group = raw[groupKey];
  if (!group) return [];

  // Determine altitude sub-key (high/level/low from position, or flat for vertical)
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
function buildO3Rows(tables: TableStore, flakLevel: string): PendingRoll['tableRows'] {
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

/** Generate a random roll value for a given dice type */
function autoRoll(diceType: string, rng: RNG): number {
  switch (diceType) {
    case '2d6': return rng.twod6();
    case 'd6d6': return rng.d6d6();
    default: return rng.d6();
  }
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

// ─── Yield type for the mission generator ───
type MissionYield = { type: 'events'; events: GameEvent[] } | { type: 'pending'; roll: PendingRoll; events: GameEvent[] } | { type: 'choice'; choice: PendingChoice; events: GameEvent[] };

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
  ): GameEvent {
    const event: GameEvent = {
      id: this.eventId++,
      phase, zone, direction, category, severity, message, details,
    };
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

  /** Create a PendingRoll for a table lookup */
  private createPendingRoll(tableId: string, purpose: string, modifier = 0): PendingRoll {
    const tableDisplay = this.tables.getTableDisplayData(tableId);
    const table = this.tables.getRoll(tableId);
    return {
      id: this.pendingRollId++,
      tableId,
      tableName: tableDisplay?.title ?? tableId,
      diceType: normalizeDiceType(tableDisplay?.rolltype ?? table?.rolltype ?? '1d6'),
      purpose,
      modifier,
      tableRows: tableDisplay?.rows ?? [],
    };
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
    this.missionGen = this._executeMission();

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
      context: `${this.currentPendingRoll.table} (${this.currentPendingRoll.description})`,
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
      context: this.currentPendingChoice.description,
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

  /**
   * Mission generator — yields PendingRoll at each table lookup.
   * Receives the player's roll value via generator.next(value).
   */
  private *_executeMission(): Generator<MissionYield, void, number | number[] | undefined> {
    const missionNumber = this.state.campaign.missionsCompleted + 1;
    const rng = this.rng;
    const tables = this.tables;
    let nextFighterId = 1;
    let fightersDestroyed = 0;

    // Check crew availability
    const activeCrew = this.state.campaign.crew.filter(c => c.status === 'active');
    if (activeCrew.length < 6) {
      this.emit('CAMPAIGN', 'Not enough crew to fly. Campaign over.', 'system', 'critical');
      return;
    }

    // ═══ SETUP ═══
    this.emit('SETUP', `Mission #${missionNumber} begins`, 'setup', 'info', undefined, undefined, undefined, true);

    // ── Target selection ──
    let targetTableName: string;
    let targetTableDesc: string;
    if (missionNumber <= 5) {
      targetTableName = 'G-1';
      targetTableDesc = `Missions 1-5`;
    } else if (missionNumber <= 10) {
      targetTableName = 'G-2';
      targetTableDesc = `Missions 6-10`;
    } else {
      targetTableName = 'G-3';
      targetTableDesc = `Missions 11-25`;
    }

    // Yield pending roll for target selection
    this.eventBuffer = [];
    const targetPending = this.createPendingRoll(targetTableName, `Target for Mission ${missionNumber}`);
    const targetRollValue: number = (yield { type: 'pending', roll: targetPending, events: this.eventBuffer }) ?? autoRoll(targetPending.diceType, rng);
    this.eventBuffer = [];

    const targetResult = tables.lookupWithValue(targetTableName, targetRollValue);
    if (!targetResult) {
      this.emit('SETUP', `Failed to look up target on ${targetTableName}`, 'system', 'critical');
      return;
    }

    const target: TargetInfo = {
      name: targetResult.entry.Target as string,
      type: targetResult.entry.Type as string,
    };

    let targetZone: number;
    try {
      targetZone = getTargetZone(target.name, tables);
    } catch {
      targetZone = 5; // fallback
    }

    this.emit('SETUP', `Target: ${target.name} (${target.type})`, 'setup', 'info',
      undefined, undefined, [{
        table: targetTableName, tableTitle: targetTableDesc,
        rollType: normalizeDiceType(targetPending.diceType),
        rolled: targetRollValue, result: `${target.name} (${target.type})`,
        description: `Target selection for ${targetTableDesc}`,
      }]);

    // ── Formation position (G-4) ──
    const formPending = this.createPendingRoll('G-4', 'Formation position within squadron');
    const formRollValue: number = (yield { type: 'pending', roll: formPending, events: this.eventBuffer }) ?? autoRoll(formPending.diceType, rng);
    this.eventBuffer = [];

    const formResult = tables.lookupWithValue('G-4', formRollValue);
    let formationPosition: 'lead' | 'middle' | 'tail' = 'middle';
    let extraFighterPerWave = false;
    if (formResult) {
      const pos = formResult.entry.formation_position as string;
      if (pos === 'Lead Bomber') { formationPosition = 'lead'; extraFighterPerWave = true; }
      else if (pos === 'Tail Bomber') { formationPosition = 'tail'; extraFighterPerWave = true; }
    }

    const formLabel = formationPosition === 'lead' ? 'Lead Bomber'
      : formationPosition === 'tail' ? 'Tail Bomber' : 'Middle';

    this.emit('SETUP', `Formation: ${formLabel}`, 'setup', 'info',
      undefined, undefined, [{
        table: 'G-4', rollType: '2d6', rolled: formRollValue, result: formLabel,
        description: 'Formation position within squadron',
      }]);

    // ── Squadron position (G-4a, missions 6+ only) ──
    let squadronMod = 0;
    let squadronPosition: { position: string; b1b2Modifier: number } | null = null;

    if (missionNumber > 5) {
      const sqPending = this.createPendingRoll('G-4a', 'Squadron position (High/Middle/Low)');
      const sqRollValue: number = (yield { type: 'pending', roll: sqPending, events: this.eventBuffer }) ?? autoRoll(sqPending.diceType, rng);
      this.eventBuffer = [];

      const sqResult = tables.lookupWithValue('G-4a', sqRollValue);
      if (sqResult) {
        const pos = sqResult.entry.squadron_position as string;
        if (pos === 'High') { squadronPosition = { position: 'high', b1b2Modifier: 0 }; }
        else if (pos === 'Low') { squadronPosition = { position: 'low', b1b2Modifier: 1 }; }
        else { squadronPosition = { position: 'middle', b1b2Modifier: -1 }; }
        squadronMod = squadronPosition.b1b2Modifier;

        const sqLabel = pos;
        this.emit('SETUP', `Squadron: ${sqLabel} (B-1/B-2 mod: ${squadronMod >= 0 ? '+' : ''}${squadronMod})`, 'setup', 'info',
          undefined, undefined, [{
            table: 'G-4a', rollType: '1d6', rolled: sqRollValue, result: sqLabel,
            description: 'Squadron position (missions 6+)',
          }]);
      }
    }

    if (extraFighterPerWave) {
      this.emit('SETUP', `${formLabel} position: +1 fighter per wave!`, 'setup', 'warn');
    }

    this.emit('SETUP', `Target zone: ${targetZone}`, 'setup', 'info');

    // Initialize mission state
    const mission: MissionState = {
      missionNumber, target: target.name, zone: 1,
      direction: 'outbound', formation: squadronPosition?.position as any ?? 'lead',
      squadron: squadronPosition?.position as any ?? 'lead',
      weather: 'clear', outOfFormation: false, altitude: 20000,
      bombsAboard: true, bombsDropped: false, aborted: false,
      evasiveAction: false, landingModifiers: 0,
    };
    this.state.mission = mission;
    this.state.campaign.aircraft.ammo = { ...DEFAULT_AMMO };

    // Crew roster event
    this.emit('SETUP', 'Crew manifest', 'setup', 'info', undefined, undefined, undefined, true);

    // ═══ ZONE LOOP ═══
    let destroyed = false;

    // Outbound
    for (let z = 2; z <= targetZone && !destroyed; z++) {
      mission.zone = z;
      mission.direction = 'outbound';
      const isTarget = z === targetZone;
      const zoneInfo = getZoneInfo(target.name, z, tables);
      const overText = zoneInfo?.over?.length ? ` (over ${zoneInfo.over.join(', ')})` : '';

      this.emit('ZONE', `Entering Zone ${z}${isTarget ? ' — TARGET' : ''} outbound${overText}`,
        'movement', 'info', z, 'outbound', undefined, true);

      // Weather at target
      if (isTarget) {
        const weatherPending = this.createPendingRoll('O-1', `Weather over target (${target.name})`);
        const weatherRoll: number = (yield { type: 'pending', roll: weatherPending, events: this.eventBuffer }) ?? autoRoll(weatherPending.diceType, rng);
        this.eventBuffer = [];

        const weatherResult = tables.lookupWithValue('O-1', weatherRoll);
        if (weatherResult) {
          const weatherStr = weatherResult.entry.weather as string;
          mission.weather = weatherStr === 'Bad' ? 'overcast' : weatherStr === 'Poor' ? 'poor' : 'clear';
          const wsev = mission.weather === 'clear' ? 'good' : mission.weather === 'poor' ? 'warn' : 'bad';
          this.emit('WEATHER', `Weather over target: ${weatherStr}`, 'movement', wsev as any,
            z, 'outbound', [{
              table: 'O-1', rollType: '2d6', rolled: weatherRoll, result: weatherStr,
              description: 'Weather determination',
            }]);
        }
      }

      // Fighter cover
      let coverLevel: FighterCoverLevel | null = null;
      if (hasFighterCover(z)) {
        if (missionNumber <= 5) {
          coverLevel = 'Good';
          this.emit('COVER', `Fighter cover: Good (missions 1–5: always Good)`, 'combat', 'good',
            z, 'outbound', [{
              table: 'G-5', rollType: '—', rolled: 0, result: 'Good',
              description: 'Missions 1–5: always Good fighter cover',
            }]);
        } else {
          const coverPending = this.createPendingRoll('G-5', `Fighter cover level (Zone ${z})`);
          const coverRoll: number = (yield { type: 'pending', roll: coverPending, events: this.eventBuffer }) ?? autoRoll(coverPending.diceType, rng);
          this.eventBuffer = [];

          const coverResult = tables.lookupWithValue('G-5', coverRoll);
          if (coverResult) {
            coverLevel = coverResult.entry.fighter_cover as FighterCoverLevel;
            const csev = coverLevel === 'Good' ? 'good' : coverLevel === 'Fair' ? 'info' : 'warn';
            this.emit('COVER', `Fighter cover: ${coverLevel}`, 'combat', csev as any,
              z, 'outbound', [{
                table: 'G-5', tableTitle: 'Fighter Cover', rollType: '1d6', rolled: coverRoll, result: coverLevel,
                description: 'Allied fighter cover level',
              }]);
          }
        }
      } else {
        this.emit('COVER', 'No fighter cover in this zone', 'combat', 'warn', z, 'outbound');
      }

      // Fighter waves
      const waveMod = getFighterWaveModifier(zoneInfo ?? null, squadronMod, mission.outOfFormation, 0);
      const waveTable = isTarget ? 'B-2' : 'B-1';
      const waveTableData = tables.getRoll(waveTable);
      const waveDiceType = normalizeDiceType(waveTableData?.rolltype ?? '1d6');

      const wavePending = this.createPendingRoll(waveTable, `Fighter waves (Zone ${z}${isTarget ? ' — Target' : ''})`, waveMod);
      const waveRoll: number = (yield { type: 'pending', roll: wavePending, events: this.eventBuffer }) ?? autoRoll(waveDiceType, rng);
      this.eventBuffer = [];

      const waveResult = tables.lookupWithValue(waveTable, waveRoll, waveMod);
      const waveCount = waveResult ? (waveResult.entry.fighter_waves as number ?? 0) : 0;

      if (waveCount === 0) {
        this.emit('COMBAT', 'No enemy fighters encountered', 'combat', 'good', z, 'outbound',
          [{ table: waveTable, rollType: waveDiceType, rolled: waveRoll, modifier: waveMod, result: '0 waves' }]);
      } else {
        this.emit('COMBAT', `${plural(waveCount, 'fighter wave')}!`, 'combat', 'bad', z, 'outbound',
          [{ table: waveTable, rollType: waveDiceType, rolled: waveRoll, modifier: waveMod, result: `${waveCount} ${waveCount === 1 ? 'wave' : 'waves'}` }]);
      }

      // Process fighter waves
      for (let w = 1; w <= waveCount && !destroyed; w++) {
        this.emit('WAVE', `Fighter Wave ${w}`, 'combat', 'bad', z, 'outbound');

        // Roll attacking fighters on B-3
        const atkPending = this.createPendingRoll('B-3', `Attacking fighters (Wave ${w}, Zone ${z})`);
        const atkRoll: number = (yield { type: 'pending', roll: atkPending, events: this.eventBuffer }) ?? autoRoll(atkPending.diceType, rng);
        this.eventBuffer = [];

        const atkResult = tables.lookupWithValue('B-3', atkRoll);
        let fighters: Fighter[] = [];

        if (atkResult) {
          const fighterData = atkResult.entry.fighters as Array<{ type: string; position: string; count: number }> | undefined;
          if (fighterData && fighterData.length > 0) {
            fighters = fighterData.map(f => ({
              id: nextFighterId++,
              type: f.type as any,
              position: f.position,
              damage: [],
              attacksMade: 0,
              scoredHit: false,
            }));
          }

          // Handle "No Attackers" with out-of-formation reroll
          if (fighters.length === 0 && !mission.outOfFormation) {
            this.emit('COMBAT', 'Fighters driven off by other B-17s', 'combat', 'good', z, 'outbound',
              [{ table: 'B-3', rollType: 'd6d6', rolled: atkRoll, result: 'No attackers' }]);
            continue;
          } else if (fighters.length === 0 && mission.outOfFormation) {
            // Reroll when out of formation
            this.emit('COMBAT', 'No attackers rolled, but out of formation — rerolling', 'combat', 'warn', z, 'outbound');
            const rerollPending = this.createPendingRoll('B-3', `Attacking fighters reroll (out of formation)`);
            const reroll: number = (yield { type: 'pending', roll: rerollPending, events: this.eventBuffer }) ?? autoRoll(rerollPending.diceType, rng);
            this.eventBuffer = [];

            const rerollResult = tables.lookupWithValue('B-3', reroll);
            if (rerollResult) {
              const reFighterData = rerollResult.entry.fighters as Array<{ type: string; position: string; count: number }> | undefined;
              if (reFighterData && reFighterData.length > 0) {
                fighters = reFighterData.map(f => ({
                  id: nextFighterId++, type: f.type as any, position: f.position,
                  damage: [], attacksMade: 0, scoredHit: false,
                }));
              }
            }
            if (fighters.length === 0) {
              this.emit('COMBAT', 'Reroll: still no attackers', 'combat', 'good', z, 'outbound');
              continue;
            }
          }
        } else {
          this.emit('COMBAT', 'Fighters driven off by other B-17s', 'combat', 'good', z, 'outbound');
          continue;
        }

        if (extraFighterPerWave && !mission.outOfFormation) {
          fighters = addLeadTailExtraFighter(fighters, nextFighterId++);
        }

        // Describe fighters
        const fDescs = fighters.map(f => `${f.type} at ${f.position}`);
        this.emit('COMBAT', `${plural(fighters.length, 'fighter')}: ${fDescs.join(', ')}`, 'combat', 'warn', z, 'outbound');

        // Fighter cover defense (M-4)
        if (coverLevel && hasFighterCover(z)) {
          const m4RollValue: number = yield* this._yieldCombatRoll(
            'M-4', 'Fighter Cover Defense',
            `Friendly fighters intercept — cover level: ${coverLevel}`,
            '1d6',
            buildM4Rows(tables, coverLevel),
          );

          const coverResult = rollFighterCoverDefense(coverLevel, createFixedRng(m4RollValue, rng), tables, 0);
          if (coverResult.initialDrivenOff > 0) {
            fighters = yield* this._playerRemoveFighters(fighters, coverResult.initialDrivenOff, m4RollValue, coverLevel, z, 'outbound');
          } else {
            this.emit('COMBAT', `Friendly fighters fail to intercept`, 'combat', 'warn', z, 'outbound',
              [{ table: 'M-4', rollType: '1d6', rolled: m4RollValue, result: `0 driven off (${coverLevel} cover)` }]);
          }
        }

        if (fighters.length === 0) {
          this.emit('COMBAT', 'All fighters driven off!', 'combat', 'good', z, 'outbound');
          continue;
        }

        // Combat rounds — Rule 6.3a: allocate ALL guns before resolving fire
        let activeFighters = [...fighters];
        let attackRound = 0;
        const combatResult = yield* this._resolveCombatRounds(activeFighters, fighters, mission, z, 'outbound', () => fightersDestroyed, (v) => { fightersDestroyed = v; });
        if (combatResult.destroyed) { destroyed = true; }
      }

      // Abort check
      if (!destroyed && !mission.aborted && mission.direction === 'outbound') {
        const navDown = isCrewDown(this.state.campaign.crew, 'navigator');
        const pilotsDown = isCrewDown(this.state.campaign.crew, 'pilot') && isCrewDown(this.state.campaign.crew, 'copilot');
        if (mustAbort(this.state.campaign.aircraft, mission.outOfFormation, navDown, pilotsDown)) {
          mission.aborted = true;
          this.emit('ABORT', 'Mission aborted — mandatory conditions met!', 'movement', 'bad', z, 'outbound', undefined, true);
        }
      }

      // Target zone bomb run
      if (isTarget && !destroyed && !mission.aborted) {
        yield* this._executeBombRun(target, z, mission);
        this.emit('TURN', 'Turning for home', 'movement', 'info', z, 'outbound');
      }
    }

    // ═══ INBOUND ═══
    if (!destroyed) {
      // Per Rule 5.2.e: After bombing run, resolve combat again in the target zone (inbound),
      // then proceed through remaining zones back to base.
      for (let z = targetZone; z >= 2 && !destroyed; z--) {
        mission.zone = z;
        mission.direction = 'inbound';
        const isTarget = z === targetZone;
        const zoneInfo = getZoneInfo(target.name, z, tables);
        const overText = zoneInfo?.over?.length ? ` (over ${zoneInfo.over.join(', ')})` : '';

        this.emit('ZONE', `Entering Zone ${z}${isTarget ? ' — TARGET' : ''} inbound${overText}`, 'movement', 'info', z, 'inbound', undefined, true);

        // Fighter cover
        let coverLevel: FighterCoverLevel | null = null;
        if (hasFighterCover(z)) {
          if (missionNumber <= 5) {
            coverLevel = 'Good';
            this.emit('COVER', `Fighter cover: Good (missions 1–5: always Good)`, 'combat', 'good', z, 'inbound',
              [{ table: 'G-5', rollType: '—', rolled: 0, result: 'Good', description: 'Missions 1–5: always Good fighter cover' }]);
          } else {
            const coverPending = this.createPendingRoll('G-5', `Fighter cover level (Zone ${z} inbound)`);
            const coverRoll: number = (yield { type: 'pending', roll: coverPending, events: this.eventBuffer }) ?? autoRoll(coverPending.diceType, rng);
            this.eventBuffer = [];

            const coverResult = tables.lookupWithValue('G-5', coverRoll);
            if (coverResult) {
              coverLevel = coverResult.entry.fighter_cover as FighterCoverLevel;
              this.emit('COVER', `Fighter cover: ${coverLevel}`, 'combat',
                coverLevel === 'Good' ? 'good' : 'info', z, 'inbound',
                [{ table: 'G-5', tableTitle: 'Fighter Cover', rollType: '1d6', rolled: coverRoll, result: coverLevel }]);
            }
          }
        }

        // Fighter waves — use B-2 for target zone, B-1 for non-target zones
        const inboundWaveTable = isTarget ? 'B-2' : 'B-1';
        const waveMod = getFighterWaveModifier(zoneInfo ?? null, squadronMod, mission.outOfFormation, 0);
        const waveTableData = tables.getRoll(inboundWaveTable);
        const waveDiceType = normalizeDiceType(waveTableData?.rolltype ?? '1d6');

        const wavePending = this.createPendingRoll(inboundWaveTable, `Fighter waves (Zone ${z}${isTarget ? ' — Target' : ''} inbound)`, waveMod);
        const waveRoll: number = (yield { type: 'pending', roll: wavePending, events: this.eventBuffer }) ?? autoRoll(waveDiceType, rng);
        this.eventBuffer = [];

        const waveResult = tables.lookupWithValue(inboundWaveTable, waveRoll, waveMod);
        const waveCount = waveResult ? (waveResult.entry.fighter_waves as number ?? 0) : 0;

        if (waveCount === 0) {
          this.emit('COMBAT', 'No enemy fighters', 'combat', 'good', z, 'inbound',
            [{ table: inboundWaveTable, rollType: waveDiceType, rolled: waveRoll, modifier: waveMod, result: '0 waves' }]);
          continue;
        }

        this.emit('COMBAT', `${plural(waveCount, 'fighter wave')}!`, 'combat', 'bad', z, 'inbound',
          [{ table: inboundWaveTable, rollType: waveDiceType, rolled: waveRoll, modifier: waveMod, result: `${waveCount} ${waveCount === 1 ? 'wave' : 'waves'}` }]);

        // Inbound combat (simplified — same logic as outbound)
        for (let w = 1; w <= waveCount && !destroyed; w++) {
          this.emit('WAVE', `Fighter Wave ${w}`, 'combat', 'bad', z, 'inbound');

          const atkPending = this.createPendingRoll('B-3', `Attacking fighters (Wave ${w}, Zone ${z} inbound)`);
          const atkRoll: number = (yield { type: 'pending', roll: atkPending, events: this.eventBuffer }) ?? autoRoll(atkPending.diceType, rng);
          this.eventBuffer = [];

          const atkResult = tables.lookupWithValue('B-3', atkRoll);
          let fighters: Fighter[] = [];

          if (atkResult) {
            const fighterData = atkResult.entry.fighters as Array<{ type: string; position: string; count: number }> | undefined;
            if (fighterData && fighterData.length > 0) {
              fighters = fighterData.map(f => ({
                id: nextFighterId++, type: f.type as any, position: f.position,
                damage: [], attacksMade: 0, scoredHit: false,
              }));
            }
          }

          if (fighters.length === 0) {
            this.emit('COMBAT', 'Fighters driven off by formation', 'combat', 'good', z, 'inbound');
            continue;
          }

          if (extraFighterPerWave && !mission.outOfFormation) {
            fighters = addLeadTailExtraFighter(fighters, nextFighterId++);
          }

          // Fighter cover defense (M-4)
          if (coverLevel && hasFighterCover(z)) {
            const m4RollValue: number = yield* this._yieldCombatRoll(
              'M-4', 'Fighter Cover Defense',
              `Friendly fighters intercept — cover level: ${coverLevel}`,
              '1d6',
              buildM4Rows(tables, coverLevel),
            );

            const coverResult = rollFighterCoverDefense(coverLevel, createFixedRng(m4RollValue, rng), tables, 0);
            if (coverResult.initialDrivenOff > 0) {
              fighters = yield* this._playerRemoveFighters(fighters, coverResult.initialDrivenOff, m4RollValue, coverLevel, z, 'inbound');
            }
          }

          if (fighters.length === 0) { continue; }

          this.emit('COMBAT', `${plural(fighters.length, 'fighter')} attacking`, 'combat', 'warn', z, 'inbound');

          // Combat rounds — Rule 6.3a: allocate ALL guns before resolving fire
          const inboundResult = yield* this._resolveCombatRounds(fighters, fighters, mission, z, 'inbound', () => fightersDestroyed, (v) => { fightersDestroyed = v; });
          if (inboundResult.destroyed) { destroyed = true; }
        }
      }
    }

    // ═══ LANDING ═══
    if (!destroyed) {
      this.emit('LANDING', `${this.state.campaign.planeName} approaches the airfield...`, 'landing', 'info', 1, 'inbound');

      // Landing roll — not on G-8 (which is water bailout), use 2d6
      const landingPending: PendingRoll = {
        id: this.pendingRollId++,
        tableId: 'LANDING',
        tableName: 'Landing',
        diceType: '2d6',
        purpose: 'Landing attempt',
        modifier: mission.landingModifiers + (countEnginesOut(this.state.campaign.aircraft) >= 3 ? -3 : 0),
        tableRows: [
          { roll: '2-4', columns: { result: 'Crash landing' } },
          { roll: '5-7', columns: { result: 'Rough landing — minor damage' } },
          { roll: '8-12', columns: { result: 'Safe landing' } },
        ],
      };

      const landingRoll: number = (yield { type: 'pending', roll: landingPending, events: this.eventBuffer }) ?? autoRoll('2d6', rng);
      this.eventBuffer = [];

      const landingMod = landingPending.modifier;
      const modifiedLanding = landingRoll + landingMod;

      if (modifiedLanding >= 8) {
        this.emit('LANDING', 'Safe landing!', 'landing', 'good', 1, 'inbound',
          [{ table: 'Landing', rollType: '2d6', rolled: landingRoll, modifier: landingMod, modifiedRoll: modifiedLanding, result: 'Safe landing' }], true);
      } else if (modifiedLanding >= 5) {
        this.emit('LANDING', 'Rough landing — minor damage', 'landing', 'warn', 1, 'inbound',
          [{ table: 'Landing', rollType: '2d6', rolled: landingRoll, modifier: landingMod, modifiedRoll: modifiedLanding, result: 'Rough landing' }], true);
      } else {
        this.emit('LANDING', 'Crash landing!', 'landing', 'bad', 1, 'inbound',
          [{ table: 'Landing', rollType: '2d6', rolled: landingRoll, modifier: landingMod, modifiedRoll: modifiedLanding, result: 'Crash landing' }], true);
        for (const crew of this.state.campaign.crew) {
          if (crew.status === 'active' && rng.d6() <= 2) {
            crew.wounds = accumulateWound(crew.wounds, 'light');
            this.emit('LANDING', `${crew.name} injured in crash!`, 'damage', 'bad', 1, 'inbound');
          }
        }
      }
    } else {
      this.emit('BAILOUT', `${this.state.campaign.planeName} has been shot down!`, 'landing', 'critical', undefined, undefined, undefined, true);
      for (const crew of this.state.campaign.crew) {
        if (crew.status === 'active' && crew.wounds !== 'kia') {
          const bailRoll = rng.d6();
          if (bailRoll <= 3) {
            crew.status = 'pow';
            this.emit('BAILOUT', `${crew.name}: Captured (POW)`, 'landing', 'bad',
              undefined, undefined, [{ table: 'G-6', rollType: '1d6', rolled: bailRoll, result: 'POW' }]);
          } else if (bailRoll <= 5) {
            this.emit('BAILOUT', `${crew.name}: Evaded capture!`, 'landing', 'good',
              undefined, undefined, [{ table: 'G-6', rollType: '1d6', rolled: bailRoll, result: 'Evaded' }]);
          } else {
            crew.status = 'kia'; crew.wounds = 'kia';
            this.emit('BAILOUT', `${crew.name}: KIA`, 'landing', 'critical',
              undefined, undefined, [{ table: 'G-6', rollType: '1d6', rolled: bailRoll, result: 'KIA' }]);
          }
        }
      }
    }

    // ═══ DEBRIEF ═══
    this.state.campaign.missionsCompleted++;
    for (const crew of this.state.campaign.crew) {
      if (crew.status === 'active') crew.missions++;
    }

    const survived = !destroyed;
    this.emit('DEBRIEF', `Mission #${missionNumber} to ${target.name}: ${survived ? 'SURVIVED' : 'LOST'}`, 'debrief',
      survived ? 'good' : 'critical', undefined, undefined,
      [{ table: '', rollType: '', rolled: 0, result: survived ? 'Survived' : 'Lost', description: `Fighters destroyed: ${fightersDestroyed}` }], true);

    this.state.mission = null;
    this.missionInProgress = false;
  }

  // ─── Area-to-damage-table mapping for flak hits ───
  private static readonly FLAK_AREA_DAMAGE_TABLE: Record<string, string> = {
    'Nose': 'P-1',
    'Pilot Compartment': 'P-2',
    'Bomb Bay': 'P-3',
    'Radio Room': 'P-4',
    'Waist': 'P-5',
    'Tail': 'P-6',
    'Port Wing': 'BL-1',
    'Starboard Wing': 'BL-1',
  };

  /**
   * Bomb run generator — handles the full bombing sequence:
   * O-2 (Flak over target) → O-3 (Flak to hit) → O-4 (shell hits) → O-5 (area affected)
   * → damage resolution → O-6 (Bomb run on/off target) → O-7 (Bombing accuracy)
   */
  private *_executeBombRun(
    target: TargetInfo, zone: number, mission: MissionState,
  ): Generator<MissionYield, void, number | number[] | undefined> {
    const rng = this.rng;
    const tables = this.tables;

    if (!mission.bombsAboard) {
      this.emit('BOMB_RUN', 'No bombs to drop — already jettisoned', 'bombing', 'warn', zone, 'outbound');
      return;
    }

    this.emit('BOMB_RUN', `Beginning bomb run over ${target.name}!`, 'bombing', 'info', zone, 'outbound');

    // ── O-2: Flak over target ──
    const flakPending = this.createPendingRoll('O-2', `Flak over target (${target.name})`);
    const flakRoll: number = (yield { type: 'pending', roll: flakPending, events: this.eventBuffer }) ?? autoRoll(flakPending.diceType, rng);
    this.eventBuffer = [];

    const flakResult = tables.lookupWithValue('O-2', flakRoll);
    const flakLevel = flakResult?.entry?.Flak as string ?? 'No flak';

    const flakSev = flakLevel === 'No flak' ? 'good' : flakLevel === 'Light flak' ? 'warn' : 'bad';
    this.emit('BOMB_RUN', `Flak: ${flakLevel}`, 'bombing', flakSev as any, zone, 'outbound',
      [{ table: 'O-2', rollType: '1d6', rolled: flakRoll, result: flakLevel, description: 'Flak over target' }]);

    // ── O-3: Flak to hit B-17 (3 rolls if flak present) ──
    let totalFlakHits = 0;
    if (flakLevel !== 'No flak') {
      for (let burst = 1; burst <= 3; burst++) {
        const hitRoll: number = yield* this._yieldCombatRoll(
          'O-3', 'Flak to Hit B-17',
          `Flak burst ${burst}/3 — does it hit? (${flakLevel})`,
          '2d6',
          buildO3Rows(tables, flakLevel),
        );
        this.eventBuffer = [];

        const hitResult = tables.lookupWithValue('O-3', hitRoll);
        // O-3 has nested results by flak level
        let flakHit = false;
        if (hitResult?.entry) {
          const levelData = hitResult.entry[flakLevel] as Record<string, any> | undefined;
          if (levelData) {
            flakHit = parseInt(levelData.flak_hits as string ?? '0', 10) > 0;
          }
        }

        if (flakHit) {
          totalFlakHits++;
          this.emit('BOMB_RUN', `Flak burst ${burst}: HIT!`, 'damage', 'bad', zone, 'outbound',
            [{ table: 'O-3', rollType: '2d6', rolled: hitRoll, result: 'Hit', description: `${flakLevel} burst ${burst}` }]);
        } else {
          this.emit('BOMB_RUN', `Flak burst ${burst}: Miss`, 'bombing', 'info', zone, 'outbound',
            [{ table: 'O-3', rollType: '2d6', rolled: hitRoll, result: 'Miss', description: `${flakLevel} burst ${burst}` }]);
        }
      }
    }

    // ── O-4: Effect of flak hits (shell count per hit) ──
    if (totalFlakHits > 0) {
      this.emit('BOMB_RUN', `${plural(totalFlakHits, 'flak hit')} on the B-17!`, 'damage', 'bad', zone, 'outbound');

      for (let h = 1; h <= totalFlakHits; h++) {
        const shellPending = this.createPendingRoll('O-4', `Shell hits from flak hit ${h}`);
        const shellRoll: number = (yield { type: 'pending', roll: shellPending, events: this.eventBuffer }) ?? autoRoll(shellPending.diceType, rng);
        this.eventBuffer = [];

        const shellResult = tables.lookupWithValue('O-4', shellRoll);
        const shellHits = shellResult ? parseInt(shellResult.entry.shell_hits as string ?? '1', 10) : 1;

        this.emit('BOMB_RUN', `Flak hit ${h}: ${plural(shellHits, 'shell hit')}`, 'damage', 'bad', zone, 'outbound',
          [{ table: 'O-4', rollType: '2d6', rolled: shellRoll, result: `${shellHits} shells`, description: 'Effect of flak hits' }]);

        // ── O-5: Area affected by each shell hit ──
        for (let s = 1; s <= shellHits; s++) {
          const areaPending = this.createPendingRoll('O-5', `Where does flak shell ${s} hit?`);
          const areaRoll: number = (yield { type: 'pending', roll: areaPending, events: this.eventBuffer }) ?? autoRoll(areaPending.diceType, rng);
          this.eventBuffer = [];

          const areaResult = tables.lookupWithValue('O-5', areaRoll);
          const area = areaResult?.entry?.area_affected as string ?? 'Superficial';

          this.emit('DAMAGE', `Flak shell ${s}: Hit to ${area}`, 'damage', 'warn', zone, 'outbound',
            [{ table: 'O-5', rollType: '2d6', rolled: areaRoll, result: area, description: 'Area affected by flak' }]);

          // Resolve damage on the appropriate compartment table
          const dmgTable = GameSession.FLAK_AREA_DAMAGE_TABLE[area];
          if (dmgTable) {
            yield* this._resolveCompartmentHitGen(area, dmgTable, zone, 'outbound');
          }
        }
      }

      // Check if aircraft destroyed
      if (countEnginesOut(this.state.campaign.aircraft) >= 4) {
        this.emit('DAMAGE', 'ALL ENGINES OUT! Going down!', 'damage', 'critical', zone, 'outbound', undefined, true);
        return;
      }
    }

    // ── O-6: Bomb run on/off target ──
    const bombRunPending = this.createPendingRoll('O-6', `Bomb run — on or off target?`);
    const bombRunRoll: number = (yield { type: 'pending', roll: bombRunPending, events: this.eventBuffer }) ?? autoRoll(bombRunPending.diceType, rng);
    this.eventBuffer = [];

    const bombRunResult = tables.lookupWithValue('O-6', bombRunRoll);
    const onTarget = bombRunResult?.entry?.bomb_run_on_target as string ?? 'Off';
    const onOff = onTarget === 'On' ? 'ON target' : 'OFF target';

    this.emit('BOMB_RUN', `Bomb run: ${onOff}!`, 'bombing', onTarget === 'On' ? 'good' : 'warn', zone, 'outbound',
      [{ table: 'O-6', rollType: '1d6', rolled: bombRunRoll, result: onOff, description: 'Bomb run accuracy' }]);

    // ── O-7: Bombing accuracy ──
    const accuracyPending = this.createPendingRoll('O-7', `Bombing accuracy (${onOff})`);
    const accuracyRoll: number = (yield { type: 'pending', roll: accuracyPending, events: this.eventBuffer }) ?? autoRoll(accuracyPending.diceType, rng);
    this.eventBuffer = [];

    const accuracyResult = tables.lookupWithValue('O-7', accuracyRoll);
    let accuracy = 0;
    if (accuracyResult?.entry) {
      const accData = accuracyResult.entry[onTarget] as Record<string, any> | undefined;
      if (accData) {
        accuracy = parseInt(accData.bombing_accuracy as string ?? '0', 10);
      } else {
        accuracy = parseInt(accuracyResult.entry.bombing_accuracy as string ?? '0', 10);
      }
    }

    mission.bombsAboard = false;
    mission.bombsDropped = true;

    this.emit('BOMB_RUN', `Bombs away over ${target.name}! Accuracy: ${accuracy}%`, 'bombing',
      accuracy >= 30 ? 'good' : accuracy > 0 ? 'warn' : 'bad', zone, 'outbound',
      [{ table: 'O-7', rollType: '2d6', rolled: accuracyRoll, result: `${accuracy}% accuracy`, description: `Bombing accuracy (${onOff})` }], true);
  }

  /**
   * Full combat round resolution per Rule 6.3a:
   * 1. Player allocates ALL guns to targets (or holds fire)
   * 2. Resolve non-tail defensive fire
   * 3. German offensive fire for surviving fighters
   * 4. Resolve delayed tail gun fire (per M-1 notes)
   * 5. Successive attacks
   */
  private *_resolveCombatRounds(
    activeFighters: Fighter[],
    allFighters: Fighter[],
    mission: MissionState,
    zone: number,
    direction: 'outbound' | 'inbound',
    getDestroyed: () => number,
    setDestroyed: (v: number) => void,
  ): Generator<MissionYield, { destroyed: boolean }, number | number[] | undefined> {
    const rng = this.rng;
    const tables = this.tables;
    const crew = this.state.campaign.crew;
    const aircraft = this.state.campaign.aircraft;
    let attackRound = 0;

    type GunTarget = { fighterId: number; fighter: Fighter; hitReq: number; isDelayed: boolean };
    type GunEntry = { gun: GunPosition; crewPos: CrewPosition; targets: GunTarget[] };
    type Allocation = { gun: GunPosition; fighter: Fighter; hitReq: number; isDelayed: boolean; crewPos: CrewPosition };

    /** Track what happened each round for successive attack context */
    let lastRoundSummary: string[] = [];

    while (activeFighters.length > 0 && attackRound < 3) {
      attackRound++;
      if (attackRound > 1) {
        // Provide context: what happened in the previous round
        this.emit('COMBAT', `═══ Successive Attack Round ${attackRound} ═══`, 'combat', 'warn', zone, direction);
        for (const line of lastRoundSummary) {
          this.emit('COMBAT', line, 'combat', 'info', zone, direction);
        }
        const survDescs = activeFighters.map(f => `${f.type} at ${f.position}`);
        this.emit('COMBAT', `${plural(activeFighters.length, 'fighter')} pressing the attack: ${survDescs.join(', ')}`, 'combat', 'warn', zone, direction);
      }
      lastRoundSummary = [];

      // ═══ ALLOCATION PHASE (Rule 6.3a) ═══
      // Build gun→targets map from M-1 field of fire data
      const gunEntries: GunEntry[] = [];

      for (const fighter of activeFighters) {
        const fieldOfFire = getFieldOfFire(fighter.position, tables);
        for (const [gun, hitReq] of fieldOfFire) {
          let entry = gunEntries.find(e => e.gun === gun);
          if (!entry) {
            const crewPos = GUN_TO_CREW[gun];
            if (!crewPos) continue;
            entry = { gun, crewPos, targets: [] };
            gunEntries.push(entry);
          }
          entry.targets.push({ fighterId: fighter.id, fighter, hitReq, isDelayed: false });
        }

        // Tail gun special rule: can fire at 10:30, 12, 1:30 positions (need 6, resolves LAST)
        const posLower = fighter.position.toLowerCase();
        const isTailSpecialPos = posLower.startsWith('10:30') || posLower.startsWith('12 ') || posLower.startsWith('1:30');
        if (isTailSpecialPos && !posLower.includes('vertical')) {
          const fieldOfFire = getFieldOfFire(fighter.position, tables);
          if (!fieldOfFire.has('Tail')) {
            // Tail isn't already listed — add as special delayed target
            let entry = gunEntries.find(e => e.gun === 'Tail');
            if (!entry) {
              entry = { gun: 'Tail', crewPos: 'tail_gunner', targets: [] };
              gunEntries.push(entry);
            }
            entry.targets.push({ fighterId: fighter.id, fighter, hitReq: 6, isDelayed: true });
          }
        }
      }

      // Filter guns by crew availability and ammo
      const eligibleGuns = gunEntries.filter(ge => {
        const cm = getCrewByPosition(crew, ge.crewPos);
        if (!cm || cm.status !== 'active' || cm.wounds === 'serious' || cm.wounds === 'kia') return false;
        const ammoKey = ge.gun as keyof AmmoState;
        if (aircraft.ammo[ammoKey] <= 0) return false;
        return true;
      });

      let delayedAllocations: Allocation[] = [];

      if (eligibleGuns.length === 0) {
        this.emit('COMBAT', 'No guns available to fire!', 'combat', 'warn', zone, direction);
      } else {
        // Yield gun allocation choice to player
        const allocationChoice: PendingChoice = {
          id: this.pendingRollId++,
          type: 'choice',
          choiceType: 'gun-allocation',
          purpose: 'Allocate Defensive Fire (Rule 6.3a)',
          prompt: 'Assign each gun to a target fighter, or hold fire to conserve ammo.',
          options: [], // Not used for allocation type
          minSelections: 0,
          maxSelections: eligibleGuns.length,
          allocations: eligibleGuns.map(ge => {
            const cm = getCrewByPosition(crew, ge.crewPos)!;
            const ammoKey = ge.gun as keyof AmmoState;
            // Determine if ALL targets for this gun are delayed (tail special only)
            const allDelayed = ge.targets.every(t => t.isDelayed);
            return {
              gunId: ge.gun,
              gunLabel: GUN_LABELS[ge.gun] || ge.gun,
              crewName: cm.name,
              ammoRemaining: aircraft.ammo[ammoKey],
              isTailSpecial: allDelayed,
              targets: ge.targets.map(t => ({
                fighterId: t.fighterId,
                label: `${t.fighter.type} at ${t.fighter.position} (need ${t.hitReq}+)${t.isDelayed ? ' ⏳ fires after German attack' : ''}`,
                hitReq: t.hitReq,
              })),
            };
          }),
        };

        const eventsToSend = this.eventBuffer;
        this.eventBuffer = [];
        const response = yield { type: 'choice' as const, choice: allocationChoice, events: eventsToSend };
        this.eventBuffer = [];

        // Parse allocation response: array where response[i] = fighterId for gun i, or -1 for hold
        const allocationResponse: number[] = Array.isArray(response) ? response : [];

        const regularAllocations: Allocation[] = [];

        for (let i = 0; i < eligibleGuns.length; i++) {
          const fighterId = allocationResponse[i] ?? -1;
          if (fighterId === -1) continue; // Hold fire

          const ge = eligibleGuns[i];
          const target = ge.targets.find(t => t.fighterId === fighterId);
          if (!target) continue;

          // Deduct ammo now (per rules, ammo is spent when gun fires)
          const ammoKey = ge.gun as keyof AmmoState;
          aircraft.ammo[ammoKey]--;

          const alloc: Allocation = {
            gun: ge.gun,
            fighter: target.fighter,
            hitReq: target.hitReq,
            isDelayed: target.isDelayed,
            crewPos: ge.crewPos,
          };

          if (target.isDelayed) {
            delayedAllocations.push(alloc);
          } else {
            regularAllocations.push(alloc);
          }
        }

        const heldCount = eligibleGuns.length - regularAllocations.length - delayedAllocations.length;
        if (heldCount > 0) {
          this.emit('COMBAT', `${plural(heldCount, 'gun')} holding fire`, 'combat', 'info', zone, direction);
        }

        // ═══ RESOLVE REGULAR DEFENSIVE FIRE ═══
        if (regularAllocations.length > 0) {
          this.emit('COMBAT', `Resolving defensive fire — ${plural(regularAllocations.length, 'gun')} firing`, 'combat', 'info', zone, direction, undefined, true);
        }

        for (const alloc of regularAllocations) {
          yield* this._resolveGunFire(alloc.gun, alloc.fighter, alloc.hitReq, alloc.crewPos, mission, zone, direction, getDestroyed, setDestroyed);
        }

        // Build summary for successive attack context
        const firedGunNames = regularAllocations.map(a => GUN_LABELS[a.gun] || a.gun);
        if (firedGunNames.length > 0) lastRoundSummary.push(`Defensive fire: ${firedGunNames.join(', ')}`);
        if (delayedAllocations.length > 0) lastRoundSummary.push(`Delayed tail fire: ${plural(delayedAllocations.length, 'target')}`);
        if (heldCount > 0) lastRoundSummary.push(`${plural(heldCount, 'gun')} held fire`);
      }

      // Filter destroyed/broken-off fighters after defensive fire
      activeFighters = allFighters.filter(f => {
        const fboa = f.damage.filter(d => d === 'FBOA').length;
        if (fboa > 0) return false;
        const fca = f.damage.filter(d => d === 'FCA').length;
        if (fca >= 2) return false;
        return !f.damage.includes('Destroyed' as any);
      });

      if (activeFighters.length === 0) {
        this.emit('COMBAT', 'All fighters driven off or destroyed!', 'combat', 'good', zone, direction, undefined, true);
        break;
      }

      // ═══ GERMAN OFFENSIVE FIRE (Rule 6.4) ═══
      const engineMod = enginesOut(this.state.campaign.aircraft) >= 2 ? 1 : 0;
      const evasiveMod = mission.evasiveAction ? -1 : 0;

      for (const fighter of activeFighters) {
        const offRollValue: number = yield* this._yieldCombatRoll(
          'M-3', 'German Offensive Fire',
          `${fighter.type} at ${fighter.position} attacks your B-17`,
          '1d6',
          buildM3Rows(tables, fighter.position),
        );

        let offResult: { roll: number; hit: boolean };
        try {
          offResult = resolveGermanOffensiveFire(fighter, createFixedRng(offRollValue, rng), tables, engineMod, evasiveMod);
        } catch {
          offResult = { roll: offRollValue, hit: offRollValue === 6 };
        }
        fighter.attacksMade++;

        if (offResult.hit) {
          fighter.scoredHit = true;
          this.emit('COMBAT', `${fighter.type} at ${fighter.position} fires — HIT!`, 'combat', 'bad', zone, direction,
            [{ table: 'M-3', rollType: '1d6', rolled: offRollValue, result: 'Hit', description: 'German offensive fire' }]);

          const shellRollValue: number = yield* this._yieldCombatRoll(
            'B-4', 'Shell Hits', `Number of shell hits from ${fighter.type} at ${fighter.position}`,
            '2d6', buildB4Rows(tables, fighter.position),
          );

          let shellHits: number;
          try { shellHits = rollShellHits(fighter, createFixedRng(shellRollValue, rng), tables); } catch { shellHits = rng.int(1, 3); }

          this.emit('DAMAGE', `${plural(shellHits, 'shell hit')}!`, 'damage', 'bad', zone, direction,
            [{ table: 'B-4', rollType: '2d6', rolled: shellRollValue, result: `${shellHits} shells` }]);

          for (let s = 0; s < shellHits; s++) {
            const hitLocRollValue: number = yield* this._yieldCombatRoll(
              'B-5', 'Hit Location', `Where does shell ${s + 1} hit? (${fighter.type} at ${fighter.position})`,
              '2d6', buildB5Rows(tables, fighter.position),
            );

            let hitLoc: ShellHitLocation;
            try { hitLoc = rollHitLocation(fighter.position, createFixedRng(hitLocRollValue, rng), tables); } catch { hitLoc = { location: 'Superficial', isSuperificial: true }; }

            if (hitLoc.isSuperificial) {
              this.emit('DAMAGE', `Shell ${s + 1}: Superficial damage`, 'damage', 'info', zone, direction,
                [{ table: 'B-5', rollType: '2d6', rolled: hitLocRollValue, result: 'Superficial' }]);
              continue;
            }

            if (hitLoc.isWalkingHits) {
              this.emit('DAMAGE', `Shell ${s + 1}: Walking hits along fuselage!`, 'damage', 'critical', zone, direction,
                [{ table: 'B-5', rollType: '2d6', rolled: hitLocRollValue, result: 'Walking hits' }]);
              for (const compt of WALKING_HIT_COMPARTMENTS) {
                yield* this._resolveCompartmentHitGen(compt.location, compt.damageTable, zone, direction);
              }
              continue;
            }

            this.emit('DAMAGE', `Shell ${s + 1}: Hit to ${hitLoc.location}`, 'damage', 'warn', zone, direction,
              [{ table: 'B-5', rollType: '2d6', rolled: hitLocRollValue, result: hitLoc.location as string }]);

            if (hitLoc.damageTable) {
              yield* this._resolveCompartmentHitGen(hitLoc.location as string, hitLoc.damageTable, zone, direction);
            }
          }
        } else {
          this.emit('COMBAT', `${fighter.type} at ${fighter.position} fires — miss`, 'combat', 'info', zone, direction,
            [{ table: 'M-3', rollType: '1d6', rolled: offRollValue, result: 'Miss' }]);
        }
      }

      // Track German fire results for successive attack summary
      const germanHits = activeFighters.filter(f => f.scoredHit).length;
      const germanMisses = activeFighters.length - germanHits;
      if (germanHits > 0) lastRoundSummary.push(`German fire: ${plural(germanHits, 'hit')}, ${plural(germanMisses, 'miss', 'misses')}`);
      else lastRoundSummary.push(`German fire: all missed`);

      // ═══ DELAYED TAIL GUN FIRE (M-1 Notes) ═══
      // Tail guns firing at 10:30/12/1:30 resolve AFTER all other defensive fire AND German offensive fire
      if (delayedAllocations.length > 0) {
        // Check tail gunner is still alive and gun is still operational
        const tailGunner = getCrewByPosition(crew, 'tail_gunner');
        const tailAmmo = aircraft.ammo['Tail' as keyof AmmoState];
        if (tailGunner && tailGunner.status === 'active' && tailGunner.wounds !== 'serious' && tailGunner.wounds !== 'kia') {
          this.emit('COMBAT', `Tail guns firing (delayed) — ${plural(delayedAllocations.length, 'target')}`, 'combat', 'info', zone, direction);
          for (const alloc of delayedAllocations) {
            yield* this._resolveGunFire(alloc.gun, alloc.fighter, alloc.hitReq, alloc.crewPos, mission, zone, direction, getDestroyed, setDestroyed);
          }
        } else {
          this.emit('COMBAT', 'Tail guns cannot fire — gunner down or gun knocked out', 'combat', 'warn', zone, direction);
          // Ammo was already deducted; that's the rule — ammo is lost if gun is knocked out before firing
        }

        // Re-filter after tail gun fire (must also exclude destroyed fighters)
        activeFighters = allFighters.filter(f => {
          if (f.damage.includes('Destroyed' as any)) return false;
          const fboa = f.damage.filter(d => d === 'FBOA').length;
          if (fboa > 0) return false;
          const fca = f.damage.filter(d => d === 'FCA').length;
          if (fca >= 2) return false;
          return true;
        });
      }

      // Check destruction
      if (countEnginesOut(this.state.campaign.aircraft) >= 4) {
        this.emit('DAMAGE', 'ALL ENGINES OUT! Going down!', 'damage', 'critical', zone, direction, undefined, true);
        return { destroyed: true };
      }

      // Successive attacks
      if (attackRound < 3) {
        activeFighters = getSuccessiveAttackers(activeFighters, mission.outOfFormation);
        for (const f of activeFighters) {
          try {
            const newPos = rollSuccessiveAttackPosition(rng, tables);
            f.position = newPos;
          } catch { /* keep position */ }
        }
      }
    }

    return { destroyed: false };
  }

  /**
   * Resolve a single gun firing at a fighter — yields M-1 roll and if hit, M-2 roll.
   */
  private *_resolveGunFire(
    gun: GunPosition,
    fighter: Fighter,
    hitReq: number,
    crewPos: CrewPosition,
    mission: MissionState,
    zone: number,
    direction: 'outbound' | 'inbound',
    getDestroyed: () => number,
    setDestroyed: (v: number) => void,
  ): Generator<MissionYield, void, number | number[] | undefined> {
    const rng = this.rng;
    const tables = this.tables;
    const cm = getCrewByPosition(this.state.campaign.crew, crewPos);
    if (!cm) return;

    // Check fighter is still active (may have been destroyed by earlier gun in same phase)
    const fboaCount = fighter.damage.filter(d => d === 'FBOA').length;
    if (fboaCount > 0 || fighter.damage.filter(d => d === 'FCA').length >= 2) return;

    const defRollValue: number = yield* this._yieldCombatRoll(
      'M-1', 'Defensive Fire',
      `${GUN_LABELS[gun]} (${cm.name}) fires at ${fighter.type} at ${fighter.position} — need ${hitReq}+ to hit`,
      '1d6',
      [
        ...(hitReq > 1 ? [{ roll: `1-${hitReq - 1}`, columns: { result: 'Miss' } }] : []),
        { roll: `${hitReq}-6`, columns: { result: 'Hit' } },
      ],
    );

    const fr = resolveDefensiveFire(hitReq, createFixedRng(defRollValue, rng), false, mission.evasiveAction, false, cm.frostbite, false);
    if (fr.hit) {
      const dmgRollValue: number = yield* this._yieldCombatRoll(
        'M-2', 'Fighter Damage',
        `Damage to ${fighter.type} hit by ${GUN_LABELS[gun]}${isTwinGunMount(gun) ? ' (twin mount +1)' : ''}`,
        '1d6',
        [
          { roll: '1-3', columns: { result: 'FCA — continues attack' } },
          { roll: '4-5', columns: { result: 'FBOA — breaks off' } },
          { roll: '6', columns: { result: 'Destroyed' } },
        ],
      );

      const dmg = rollFighterDamage(createFixedRng(dmgRollValue, rng), tables, isTwinGunMount(gun));
      const status = applyFighterDamage(fighter, dmg);

      if (status.status === 'destroyed') {
        setDestroyed(getDestroyed() + 1);
        cm.kills++;
        this.emit('COMBAT', `${GUN_LABELS[gun]} (${cm.name}) — ${fighter.type} DESTROYED!`, 'combat', 'good', zone, direction,
          [
            { table: 'M-1', rollType: '1d6', rolled: defRollValue, result: `Hit (need ${hitReq}+)`, description: `${GUN_LABELS[gun]} vs ${fighter.position}` },
            { table: 'M-2', rollType: '1d6', rolled: dmgRollValue, result: 'Destroyed', description: 'Fighter damage result' },
          ], true);
      } else if (status.status === 'breaks_off') {
        this.emit('COMBAT', `${GUN_LABELS[gun]} (${cm.name}) — ${fighter.type} damaged, breaks off!`, 'combat', 'good', zone, direction,
          [
            { table: 'M-1', rollType: '1d6', rolled: defRollValue, result: `Hit (need ${hitReq}+)` },
            { table: 'M-2', rollType: '1d6', rolled: dmgRollValue, result: 'Breaks off' },
          ]);
      } else {
        this.emit('COMBAT', `${GUN_LABELS[gun]} (${cm.name}) — ${fighter.type} hit, continues!`, 'combat', 'warn', zone, direction,
          [
            { table: 'M-1', rollType: '1d6', rolled: defRollValue, result: `Hit (need ${hitReq}+)` },
            { table: 'M-2', rollType: '1d6', rolled: dmgRollValue, result: 'Continues attack' },
          ]);
      }
    } else {
      this.emit('COMBAT', `${GUN_LABELS[gun]} (${cm.name}) fires at ${fighter.position}... miss`, 'combat', 'info', zone, direction,
        [{ table: 'M-1', rollType: '1d6', rolled: defRollValue, result: `Miss (need ${hitReq}+)`, description: `${GUN_LABELS[gun]} vs ${fighter.position}` }], true);
    }
  }

  /**
   * Player chooses which fighters to remove (Rule 6.2).
   * Yields a PendingChoice if in manual mode; auto-picks in autoplay.
   */
  private *_playerRemoveFighters(
    fighters: Fighter[], count: number,
    m4RollValue: number, coverLevel: string,
    zone: number, direction: 'outbound' | 'inbound',
  ): Generator<MissionYield, Fighter[], number | number[] | undefined> {
    const removable = fighters.filter(f => canBeDrivenOffByCover(f.position));
    const nonRemovable = fighters.filter(f => !canBeDrivenOffByCover(f.position));
    const actualCount = Math.min(count, removable.length);

    if (actualCount === 0) {
      this.emit('COMBAT', `${count} fighters should be driven off, but none are eligible (Vertical Dive immune)`, 'combat', 'warn', zone, direction,
        [{ table: 'M-4', rollType: '1d6', rolled: m4RollValue, result: `${count} driven off (${coverLevel} cover) — none eligible` }]);
      return fighters;
    }

    // If only one possible set of removals, skip the choice
    if (actualCount >= removable.length) {
      this.emit('COMBAT', `Friendly fighters drive off ${removable.length} enemy!`, 'combat', 'good', zone, direction,
        [{ table: 'M-4', rollType: '1d6', rolled: m4RollValue, result: `${actualCount} driven off (${coverLevel} cover)` }]);
      return nonRemovable;
    }

    this.emit('COMBAT', `Friendly fighters can drive off ${actualCount} enemy — choose which to remove`, 'combat', 'good', zone, direction,
      [{ table: 'M-4', rollType: '1d6', rolled: m4RollValue, result: `${actualCount} driven off (${coverLevel} cover)` }]);

    // Yield a choice for the player — include field-of-fire info so they can make informed decisions
    const tables = this.tables;
    const choice: PendingChoice = {
      id: this.pendingRollId++,
      type: 'choice',
      purpose: `Choose ${actualCount} fighter${actualCount > 1 ? 's' : ''} to drive off`,
      prompt: `Select ${actualCount} fighter${actualCount > 1 ? 's' : ''} to remove:`,
      options: fighters.map(f => {
        // Build field-of-fire summary for this fighter
        const fieldOfFire = getFieldOfFire(f.position, tables);
        const gunDescs: string[] = [];
        for (const [gun, hitReq] of fieldOfFire) {
          const crewPos = GUN_TO_CREW[gun];
          if (!crewPos) continue;
          if (isCrewDown(this.state.campaign.crew, crewPos)) continue;
          const ammoKey = gun as keyof AmmoState;
          if (this.state.campaign.aircraft.ammo[ammoKey] <= 0) continue;
          gunDescs.push(`${GUN_LABELS[gun]} (${hitReq}+)`);
        }
        const gunInfo = gunDescs.length > 0 ? ` — ${gunDescs.join(', ')}` : ' — no guns in range';
        const isVerticalDive = !canBeDrivenOffByCover(f.position);
        return {
          id: f.id,
          label: `${f.type} at ${f.position}${gunInfo}`,
          disabled: isVerticalDive,
          reason: isVerticalDive ? 'Vertical Dive — cannot be driven off' : undefined,
        };
      }),
      minSelections: actualCount,
      maxSelections: actualCount,
    };

    const removEventsToSend = this.eventBuffer;
    this.eventBuffer = [];
    const response = yield { type: 'choice' as const, choice, events: removEventsToSend };
    this.eventBuffer = [];

    // Parse response — should be number[] of fighter IDs
    let selectedIds: number[] = [];
    if (Array.isArray(response)) {
      selectedIds = response;
    } else {
      // Fallback: auto-select first N removable
      selectedIds = removable.slice(0, actualCount).map(f => f.id);
    }

    // Validate: only remove removable fighters, up to actualCount
    const validIds = new Set(selectedIds.filter(id => removable.some(f => f.id === id)).slice(0, actualCount));
    // If player didn't select enough, fill in
    if (validIds.size < actualCount) {
      for (const f of removable) {
        if (validIds.size >= actualCount) break;
        validIds.add(f.id);
      }
    }

    const removed = fighters.filter(f => validIds.has(f.id));
    const remaining = fighters.filter(f => !validIds.has(f.id));

    const removedDescs = removed.map(f => `${f.type} at ${f.position}`).join(', ');
    this.emit('COMBAT', `Driven off: ${removedDescs}`, 'combat', 'good', zone, direction);

    return remaining;
  }

  /** Yield a PendingRoll for a combat dice roll and return the player's value */
  private *_yieldCombatRoll(
    tableId: string, tableName: string, purpose: string, diceType: string,
    tableRows: PendingRoll['tableRows'] = [], modifier = 0,
  ): Generator<MissionYield, number, number | number[] | undefined> {
    const pending: PendingRoll = {
      id: this.pendingRollId++,
      tableId, tableName, diceType, purpose, modifier, tableRows,
    };
    // Flush accumulated events WITH this yield (don't clear before — that loses events)
    const eventsToSend = this.eventBuffer;
    this.eventBuffer = [];
    const raw = yield { type: 'pending', roll: pending, events: eventsToSend };
    const value: number = (typeof raw === 'number' ? raw : undefined) ?? autoRoll(diceType, this.rng);
    this.eventBuffer = [];
    return value;
  }

  /** Generator version of _resolveCompartmentHit — yields PendingRolls for damage and wound rolls */
  private *_resolveCompartmentHitGen(
    location: string, damageTable: string,
    zone: number, direction: 'outbound' | 'inbound',
  ): Generator<MissionYield, void, number | number[] | undefined> {
    const rng = this.rng;
    const tables = this.tables;

    // Yield for compartment damage roll
    const dmgTableDisplay = tables.getTableDisplayData(damageTable);
    const dmgDiceType = normalizeDiceType(dmgTableDisplay?.rolltype ?? '1d6');
    const dmgRollValue: number = yield* this._yieldCombatRoll(
      damageTable, dmgTableDisplay?.title ?? damageTable,
      `Damage to ${location}`, dmgDiceType,
      dmgTableDisplay?.rows ?? [],
    );

    let dmg: DamageResult;
    try {
      dmg = rollCompartmentDamage(damageTable, createFixedRng(dmgRollValue, rng), tables);
    } catch {
      dmg = { result: 'Superficial', description: 'No effect', effects: [{ type: 'superficial' }] };
    }

    for (const effect of dmg.effects) {
      switch (effect.type) {
        case 'superficial':
          this.emit('DAMAGE', `${location}: Superficial — no effect`, 'damage', 'info', zone, direction,
            [{ table: damageTable, rollType: dmgDiceType, rolled: dmgRollValue, result: 'Superficial' }]);
          break;
        case 'crew_wound': {
          const pos = effect.position as CrewPosition;
          const crew = getCrewByPosition(this.state.campaign.crew, pos);
          if (crew && crew.wounds !== 'kia') {
            // Yield for wound severity roll
            const woundRollValue: number = yield* this._yieldCombatRoll(
              'BL-4', 'Wound Severity',
              `Wound severity for ${crew.name} (${POSITION_LABELS[pos]})`, '1d6',
              [
                { roll: '1-3', columns: { result: 'Light wound' } },
                { roll: '4-5', columns: { result: 'Serious wound' } },
                { roll: '6', columns: { result: 'KIA' } },
              ],
            );

            let severity: WoundSeverity;
            try { severity = rollCrewWound(createFixedRng(woundRollValue, rng), tables); } catch { severity = 'light'; }
            crew.wounds = accumulateWound(crew.wounds, severity);
            if (severity === 'kia') crew.status = 'kia';
            const sev = severity === 'kia' ? 'critical' : severity === 'serious' ? 'bad' : 'warn';
            this.emit('DAMAGE', `${crew.name} (${POSITION_LABELS[pos]}): ${severity} wound`, 'damage', sev as any, zone, direction,
              [
                { table: damageTable, rollType: dmgDiceType, rolled: dmgRollValue, result: 'Crew wound', description: `${location} damage` },
                { table: 'BL-4', rollType: '1d6', rolled: woundRollValue, result: severity, description: 'Wound severity' },
              ], true);
            if (countEnginesOut(this.state.campaign.aircraft) >= 2 && this.state.mission) {
              this.state.mission.outOfFormation = true;
            }
          }
          break;
        }
        case 'engine_damage': {
          const engIdx = effect.engine ?? rng.int(0, 3);
          if (this.state.campaign.aircraft.engines[engIdx] !== 'out') {
            this.state.campaign.aircraft.engines[engIdx] = 'out';
            this.emit('DAMAGE', `Engine #${engIdx + 1} knocked out!`, 'damage', 'bad', zone, direction,
              [{ table: damageTable, rollType: dmgDiceType, rolled: dmgRollValue, result: `Engine #${engIdx + 1} out` }], true);
            const out = countEnginesOut(this.state.campaign.aircraft);
            if (out >= 2 && this.state.mission) {
              this.state.mission.outOfFormation = true;
              this.emit('DAMAGE', `${out} engines out — out of formation!`, 'damage', 'bad', zone, direction);
            }
          }
          break;
        }
        case 'fire':
          this.emit('DAMAGE', `FIRE in ${location}!`, 'damage', 'critical', zone, direction,
            [{ table: damageTable, rollType: dmgDiceType, rolled: dmgRollValue, result: 'Fire' }], true);
          break;
        case 'oxygen_hit':
          this.state.campaign.aircraft.oxygenOut = true;
          this.emit('DAMAGE', `Oxygen system damaged`, 'damage', 'warn', zone, direction,
            [{ table: damageTable, rollType: dmgDiceType, rolled: dmgRollValue, result: 'Oxygen hit' }]);
          break;
        case 'control_damage':
          this.emit('DAMAGE', `Control surface damage`, 'damage', 'bad', zone, direction,
            [{ table: damageTable, rollType: dmgDiceType, rolled: dmgRollValue, result: 'Control damage' }]);
          if (this.state.mission) this.state.mission.landingModifiers -= 1;
          break;
        case 'destroyed':
          this.emit('DAMAGE', `CATASTROPHIC DAMAGE — aircraft destroyed!`, 'damage', 'critical', zone, direction,
            [{ table: damageTable, rollType: dmgDiceType, rolled: dmgRollValue, result: 'Destroyed' }], true);
          break;
        default:
          this.emit('DAMAGE', `${location}: ${dmg.description || dmg.result}`, 'damage', 'info', zone, direction,
            [{ table: damageTable, rollType: dmgDiceType, rolled: dmgRollValue, result: dmg.result }]);
          break;
      }
    }
  }

  private _resolveCompartmentHit(
    location: string, damageTable: string,
    zone: number, direction: 'outbound' | 'inbound',
  ): void {
    const rng = this.rng;
    const tables = this.tables;
    let dmg: DamageResult;
    try {
      dmg = rollCompartmentDamage(damageTable, rng, tables);
    } catch {
      dmg = { result: 'Superficial', description: 'No effect', effects: [{ type: 'superficial' }] };
    }

    for (const effect of dmg.effects) {
      switch (effect.type) {
        case 'superficial':
          this.emit('DAMAGE', `${location}: Superficial — no effect`, 'damage', 'info', zone, direction,
            [{ table: damageTable, rollType: '1d6', rolled: 0, result: 'Superficial' }]);
          break;
        case 'crew_wound': {
          const pos = effect.position as CrewPosition;
          const crew = getCrewByPosition(this.state.campaign.crew, pos);
          if (crew && crew.wounds !== 'kia') {
            let severity: WoundSeverity;
            try { severity = rollCrewWound(rng, tables); } catch { severity = 'light'; }
            crew.wounds = accumulateWound(crew.wounds, severity);
            if (severity === 'kia') crew.status = 'kia';
            const sev = severity === 'kia' ? 'critical' : severity === 'serious' ? 'bad' : 'warn';
            this.emit('DAMAGE', `${crew.name} (${POSITION_LABELS[pos]}): ${severity} wound`, 'damage', sev as any, zone, direction,
              [
                { table: damageTable, rollType: '1d6', rolled: 0, result: 'Crew wound', description: `${location} damage` },
                { table: 'G-9', rollType: '2d6', rolled: 0, result: severity, description: 'Wound severity' },
              ], true);
            if (countEnginesOut(this.state.campaign.aircraft) >= 2 && this.state.mission) {
              this.state.mission.outOfFormation = true;
            }
          }
          break;
        }
        case 'engine_damage': {
          const engIdx = effect.engine ?? rng.int(0, 3);
          if (this.state.campaign.aircraft.engines[engIdx] !== 'out') {
            this.state.campaign.aircraft.engines[engIdx] = 'out';
            this.emit('DAMAGE', `Engine #${engIdx + 1} knocked out!`, 'damage', 'bad', zone, direction,
              [{ table: damageTable, rollType: '1d6', rolled: 0, result: `Engine #${engIdx + 1} out` }], true);
            const out = countEnginesOut(this.state.campaign.aircraft);
            if (out >= 2 && this.state.mission) {
              this.state.mission.outOfFormation = true;
              this.emit('DAMAGE', `${out} engines out — out of formation!`, 'damage', 'bad', zone, direction);
            }
          }
          break;
        }
        case 'fire':
          this.emit('DAMAGE', `FIRE in ${location}!`, 'damage', 'critical', zone, direction,
            [{ table: damageTable, rollType: '1d6', rolled: 0, result: 'Fire' }], true);
          break;
        case 'oxygen_hit':
          this.state.campaign.aircraft.oxygenOut = true;
          this.emit('DAMAGE', `Oxygen system damaged`, 'damage', 'warn', zone, direction,
            [{ table: damageTable, rollType: '1d6', rolled: 0, result: 'Oxygen hit' }]);
          break;
        case 'control_damage':
          this.emit('DAMAGE', `Control surface damage`, 'damage', 'bad', zone, direction,
            [{ table: damageTable, rollType: '1d6', rolled: 0, result: 'Control damage' }]);
          if (this.state.mission) this.state.mission.landingModifiers -= 1;
          break;
        case 'destroyed':
          this.emit('DAMAGE', `CATASTROPHIC DAMAGE — aircraft destroyed!`, 'damage', 'critical', zone, direction,
            [{ table: damageTable, rollType: '1d6', rolled: 0, result: 'Destroyed' }], true);
          break;
        default:
          this.emit('DAMAGE', `${location}: ${dmg.description || dmg.result}`, 'damage', 'info', zone, direction,
            [{ table: damageTable, rollType: '1d6', rolled: 0, result: dmg.result }]);
          break;
      }
    }
  }
}
