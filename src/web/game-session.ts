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
import { initializeGuns, getGun, cloneGuns, gunsToAmmo, disableGun, jamGun, type Gun } from '../games/b17/rules/guns.js';
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
  getSuccessiveAttackers, isFighterOutOfAction,
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

/** @deprecated - Use gun.crewPosition from the Gun object instead */
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
  return !m || m.status !== 'active' || m.woundSeverity === 'serious' || m.woundSeverity === 'kia';
}

function cloneCrew(crew: CrewMember[]): CrewMember[] {
  return crew.map(c => ({ ...c }));
}

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

/** Build display rows for M-3 based on fighter's attack position.
 *  totalModifier = engineMod + evasiveMod - fcaDamage (net modifier applied to roll).
 *  Only show "(always)" on roll 6 when modifiers would cause it to miss otherwise. */
function buildM3Rows(tables: TableStore, fighterPosition: string, totalModifier: number = 0): PendingRoll['tableRows'] {
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

  /** Build a CombatViewState from a fighters array */
  private static combatView(fighters: Fighter[]): CombatViewState {
    return {
      fighters: fighters.map(f => ({ id: f.id, type: f.type, position: f.position })),
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

  /** Create a PendingRoll for a table lookup */
  private createPendingRoll(tableId: string, purpose: string, modifier = 0, subKey?: string): PendingRoll {
    const tableDisplay = this.tables.getTableDisplayData(tableId, subKey);
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
      evasiveAction: false, landingModifiers: 0, bombRunModifier: 0,
    };
    this.state.mission = mission;
    this.state.campaign.aircraft.guns = initializeGuns();
    this.state.campaign.aircraft.ammo = gunsToAmmo(this.state.campaign.aircraft.guns) as any;

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
          [{ table: waveTable, rollType: waveDiceType, rolled: waveRoll, modifier: waveMod, result: '0 waves' }],
          false, GameSession.combatView([]));
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
              [{ table: 'B-3', rollType: 'd6d6', rolled: atkRoll, result: 'No attackers' }],
              false, GameSession.combatView([]));
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
          this.emit('COMBAT', 'Fighters driven off by other B-17s', 'combat', 'good', z, 'outbound',
            undefined, false, GameSession.combatView([]));
          continue;
        }

        if (extraFighterPerWave && !mission.outOfFormation) {
          fighters = addLeadTailExtraFighter(fighters, nextFighterId++);
        }

        // Describe fighters
        const initialFighterCount = fighters.length;
        const fDescs = fighters.map(f => `${f.type} at ${f.position}`);
        this.emit('COMBAT', `${plural(fighters.length, 'fighter')}: ${fDescs.join(', ')}`, 'combat', 'warn', z, 'outbound',
          undefined, false, GameSession.combatView(fighters));

        // Fighter cover defense (M-4)
        let successiveCover = 0;
        if (coverLevel && hasFighterCover(z)) {
          const m4RollValue: number = yield* this._yieldCombatRoll(
            'M-4', 'Fighter Cover Defense',
            `Friendly fighters intercept — cover level: ${coverLevel}`,
            '1d6',
            buildM4Rows(tables, coverLevel),
          );

          const coverResult = rollFighterCoverDefense(coverLevel, createFixedRng(m4RollValue, rng), tables, 0);
          successiveCover = coverResult.successiveDrivenOff;
          if (coverResult.initialDrivenOff > 0) {
            fighters = yield* this._playerRemoveFighters(fighters, coverResult.initialDrivenOff, m4RollValue, coverLevel, z, 'outbound');
          } else {
            this.emit('COMBAT', `Friendly fighters fail to intercept`, 'combat', 'warn', z, 'outbound',
              [{ table: 'M-4', rollType: '1d6', rolled: m4RollValue, result: `0 driven off (${coverLevel} cover)` }]);
          }
        }

        if (fighters.length === 0) {
          this.emit('COMBAT', 'All fighters driven off!', 'combat', 'good', z, 'outbound',
            undefined, false, GameSession.combatView([]));
          continue;
        }

        // Emit updated fighter list after drive-offs so the combat view refreshes
        if (fighters.length < initialFighterCount) {
          const remainDescs = fighters.map(f => `${f.type} at ${f.position}`);
          this.emit('COMBAT', `${plural(fighters.length, 'fighter')}: ${remainDescs.join(', ')}`, 'combat', 'warn', z, 'outbound',
            undefined, false, GameSession.combatView(fighters));
        }

        // Combat rounds — Rule 6.3a: allocate ALL guns before resolving fire
        let activeFighters = [...fighters];
        let attackRound = 0;
        const combatResult = yield* this._resolveCombatRounds(activeFighters, fighters, mission, z, 'outbound', () => fightersDestroyed, (v) => { fightersDestroyed = v; }, successiveCover);
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
            [{ table: inboundWaveTable, rollType: waveDiceType, rolled: waveRoll, modifier: waveMod, result: '0 waves' }],
            false, GameSession.combatView([]));
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
            this.emit('COMBAT', 'Fighters driven off by formation', 'combat', 'good', z, 'inbound',
              undefined, false, GameSession.combatView([]));
            continue;
          }

          if (extraFighterPerWave && !mission.outOfFormation) {
            fighters = addLeadTailExtraFighter(fighters, nextFighterId++);
          }

          // Fighter cover defense (M-4)
          let inboundSuccessiveCover = 0;
          if (coverLevel && hasFighterCover(z)) {
            const m4RollValue: number = yield* this._yieldCombatRoll(
              'M-4', 'Fighter Cover Defense',
              `Friendly fighters intercept — cover level: ${coverLevel}`,
              '1d6',
              buildM4Rows(tables, coverLevel),
            );

            const coverResult = rollFighterCoverDefense(coverLevel, createFixedRng(m4RollValue, rng), tables, 0);
            inboundSuccessiveCover = coverResult.successiveDrivenOff;
            if (coverResult.initialDrivenOff > 0) {
              fighters = yield* this._playerRemoveFighters(fighters, coverResult.initialDrivenOff, m4RollValue, coverLevel, z, 'inbound');
            }
          }

          if (fighters.length === 0) { continue; }

          this.emit('COMBAT', `${plural(fighters.length, 'fighter')} attacking`, 'combat', 'warn', z, 'inbound',
            undefined, false, GameSession.combatView(fighters));

          // Combat rounds — Rule 6.3a: allocate ALL guns before resolving fire
          const inboundResult = yield* this._resolveCombatRounds(fighters, fighters, mission, z, 'inbound', () => fightersDestroyed, (v) => { fightersDestroyed = v; }, inboundSuccessiveCover);
          if (inboundResult.destroyed) { destroyed = true; }
        }
      }
    }

    // ═══ LANDING ═══
    if (!destroyed) {
      this.emit('LANDING', `${this.state.campaign.planeName} approaches the airfield...`, 'landing', 'info', 1, 'inbound');

      // Weather at base per §5.2d — roll O-1 to determine landing weather modifier
      let weatherLandingMod = 0;
      const baseWeatherPending = this.createPendingRoll('O-1', 'Weather at home base');
      const baseWeatherRoll: number = (yield { type: 'pending', roll: baseWeatherPending, events: this.eventBuffer }) ?? autoRoll(baseWeatherPending.diceType, rng);
      this.eventBuffer = [];

      const baseWeatherResult = tables.lookupWithValue('O-1', baseWeatherRoll);
      if (baseWeatherResult) {
        const weatherStr = baseWeatherResult.entry.weather as string;
        if (weatherStr === 'Bad') {
          weatherLandingMod = -2;
        } else if (weatherStr === 'Poor') {
          weatherLandingMod = -1;
        }
        const wsev = weatherStr === 'Good' ? 'good' : weatherStr === 'Poor' ? 'warn' : 'bad';
        const modDesc = weatherLandingMod !== 0 ? ` (${weatherLandingMod} to landing)` : '';
        this.emit('WEATHER', `Weather at base: ${weatherStr}${modDesc}`, 'landing', wsev as any,
          1, 'inbound', [{
            table: 'O-1', rollType: '2d6', rolled: baseWeatherRoll, result: weatherStr,
            description: `Base weather determination${modDesc}`,
          }]);
      }

      // Landing roll on G-9
      const landingPending: PendingRoll = {
        id: this.pendingRollId++,
        tableId: 'G-9',
        tableName: 'Landing on Land',
        diceType: '2d6',
        purpose: 'Landing attempt',
        modifier: mission.landingModifiers + weatherLandingMod + (countEnginesOut(this.state.campaign.aircraft) >= 3 ? -3 : 0),
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
          [{ table: 'G-9', rollType: '2d6', rolled: landingRoll, modifier: landingMod, modifiedRoll: modifiedLanding, result: 'Safe landing' }], true);
      } else if (modifiedLanding >= 5) {
        this.emit('LANDING', 'Rough landing — minor damage', 'landing', 'warn', 1, 'inbound',
          [{ table: 'G-9', rollType: '2d6', rolled: landingRoll, modifier: landingMod, modifiedRoll: modifiedLanding, result: 'Rough landing' }], true);
      } else {
        this.emit('LANDING', 'Crash landing!', 'landing', 'bad', 1, 'inbound',
          [{ table: 'G-9', rollType: '2d6', rolled: landingRoll, modifier: landingMod, modifiedRoll: modifiedLanding, result: 'Crash landing' }], true);
        for (const crew of this.state.campaign.crew) {
          if (crew.status === 'active' && rng.d6() <= 2) {
            crew.woundSeverity = accumulateWound(crew.woundSeverity, 'light');
            this.emit('LANDING', `${crew.name} injured in crash!`, 'damage', 'bad', 1, 'inbound');
          }
        }
      }

      // Ball turret trapped + landing gear inop = Ball Gunner KIA
      if (ac.ballTurretTrapped && ac.landingGearInop) {
        const ballGunner = getCrewByPosition(this.state.campaign.crew, 'ball_turret');
        if (ballGunner && ballGunner.woundSeverity !== 'kia') {
          ballGunner.woundSeverity = 'kia';
          ballGunner.status = 'kia';
          this.emit('LANDING', `${ballGunner.name} (Ball Gunner) killed — trapped in turret with landing gear inoperable!`, 'damage', 'critical', 1, 'inbound', undefined, true);
        }
      }
    } else {
      this.emit('BAILOUT', `${this.state.campaign.planeName} has been shot down!`, 'landing', 'critical', undefined, undefined, undefined, true);
      for (const crew of this.state.campaign.crew) {
        if (crew.status === 'active' && crew.woundSeverity !== 'kia') {
          const bailRoll = rng.d6();
          if (bailRoll <= 3) {
            crew.status = 'pow';
            this.emit('BAILOUT', `${crew.name}: Captured (POW)`, 'landing', 'bad',
              undefined, undefined, [{ table: 'G-6', rollType: '1d6', rolled: bailRoll, result: 'POW' }]);
          } else if (bailRoll <= 5) {
            this.emit('BAILOUT', `${crew.name}: Evaded capture!`, 'landing', 'good',
              undefined, undefined, [{ table: 'G-6', rollType: '1d6', rolled: bailRoll, result: 'Evaded' }]);
          } else {
            crew.status = 'kia'; crew.woundSeverity = 'kia';
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

    // ═══ BETWEEN-MISSION CREW PROCESSING ═══
    const crewUpdates: string[] = [];
    for (const crew of this.state.campaign.crew) {
      // KIA — permanent, mark for replacement (TODO: actual replacement system)
      if (crew.woundSeverity === 'kia' || crew.status === 'kia') {
        continue; // stays KIA
      }

      // Seriously wounded — miss next mission, then recover
      // For now: mark as recovering (TODO: actually bench them for a mission)
      if (crew.woundSeverity === 'serious') {
        crewUpdates.push(`${crew.name} (${crew.position}): seriously wounded — hospitalized`);
        continue;
      }

      // Lightly wounded / frostbite — auto-recover before next mission
      if (crew.woundSeverity === 'light' || crew.lightWounds > 0) {
        crewUpdates.push(`${crew.name} (${crew.position}): light wounds healed`);
        crew.woundSeverity = 'none';
        crew.lightWounds = 0;
      }
      if (crew.frostbite) {
        crewUpdates.push(`${crew.name} (${crew.position}): frostbite recovered`);
        crew.frostbite = false;
      }
    }

    if (crewUpdates.length > 0) {
      this.emit('DEBRIEF', `Crew status updates:\n${crewUpdates.join('\n')}`, 'debrief', 'info');
    }

    // Reset mission-scoped aircraft state but preserve campaign-level damage
    const ac2 = this.state.campaign.aircraft;
    ac2.fireExtinguishersUsed = 0;

    // Check for campaign victory
    if (this.state.campaign.missionsCompleted >= this.state.campaign.missionsTotal) {
      this.emit('DEBRIEF', `🎖️ TOUR COMPLETE! ${this.state.campaign.missionsCompleted} missions flown. Campaign victory!`, 'debrief', 'good', undefined, undefined, undefined, true);
    }

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
    'Port Wing': 'B1-1',
    'Starboard Wing': 'B1-1',
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
    // Note (c): If Bombardier is KIA or seriously wounded, bomb run is automatically off target
    const bombardier = getCrewByPosition(this.state.campaign.crew, 'bombardier');
    if (bombardier && (bombardier.woundSeverity === 'kia' || bombardier.woundSeverity === 'serious')) {
      const reason = bombardier.woundSeverity === 'kia' ? 'KIA' : 'seriously wounded';
      this.emit('BOMB_RUN', `Bomb run: OFF target — Bombardier ${bombardier.name} is ${reason}, automatic miss (O-6 note c)`, 'bombing', 'warn', zone, 'outbound');

      // Skip O-6 roll, proceed directly to O-7 with Off target
      const accuracyPending = this.createPendingRoll('O-7', `Bombing accuracy (OFF target)`, 0, 'Off');
      const accuracyRoll: number = (yield { type: 'pending', roll: accuracyPending, events: this.eventBuffer }) ?? autoRoll(accuracyPending.diceType, rng);
      this.eventBuffer = [];

      const accuracyResult = tables.lookupWithValue('O-7', accuracyRoll);
      let accuracy = 0;
      if (accuracyResult?.entry) {
        const accData = accuracyResult.entry['Off'] as Record<string, any> | undefined;
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
        [{ table: 'O-7', rollType: '2d6', rolled: accuracyRoll, result: `${accuracy}% accuracy`, description: `Bombing accuracy (OFF target)` }], true);
      return;
    }

    const bombRunMod = mission.bombRunModifier || 0;
    const bombRunPending = this.createPendingRoll('O-6', `Bomb run — on or off target?`, bombRunMod);
    const bombRunRoll: number = (yield { type: 'pending', roll: bombRunPending, events: this.eventBuffer }) ?? autoRoll(bombRunPending.diceType, rng);
    this.eventBuffer = [];

    const modifiedBombRun = bombRunRoll + bombRunMod;
    const bombRunResult = tables.lookupWithValue('O-6', modifiedBombRun);
    const onTarget = bombRunResult?.entry?.bomb_run_on_target as string ?? 'Off';
    const onOff = onTarget === 'On' ? 'ON target' : 'OFF target';

    this.emit('BOMB_RUN', `Bomb run: ${onOff}!${bombRunMod ? ` (roll ${bombRunRoll}, modifier ${bombRunMod})` : ''}`, 'bombing', onTarget === 'On' ? 'good' : 'warn', zone, 'outbound',
      [{ table: 'O-6', rollType: '1d6', rolled: bombRunRoll, modifier: bombRunMod, modifiedRoll: modifiedBombRun, result: onOff, description: 'Bomb run accuracy' }]);

    // ── O-7: Bombing accuracy ──
    const accuracyPending = this.createPendingRoll('O-7', `Bombing accuracy (${onOff})`, 0, onTarget);
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
    successiveCoverDrivenOff = 0,
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

        // Fighter cover drives off additional fighters each successive round (M-4 successive value)
        if (successiveCoverDrivenOff > 0 && activeFighters.length > 0) {
          const removable = activeFighters.filter(f => canBeDrivenOffByCover(f.position));
          const toRemove = Math.min(successiveCoverDrivenOff, removable.length);
          if (toRemove > 0) {
            // If player needs to choose which to remove
            activeFighters = yield* this._playerRemoveFighters(activeFighters, toRemove, 0, 'successive cover', zone, direction);
            allFighters = allFighters.filter(f => activeFighters.includes(f) || !f.damage.includes('Destroyed'));
          }
          if (activeFighters.length === 0) {
            this.emit('COMBAT', 'All fighters driven off by cover!', 'combat', 'good', zone, direction, undefined, true, GameSession.combatView([]));
            break;
          }
        }

        const survDescs = activeFighters.map(f => `${f.type} at ${f.position}`);
        this.emit('COMBAT', `${plural(activeFighters.length, 'fighter')} pressing the attack: ${survDescs.join(', ')}`, 'combat', 'warn', zone, direction,
          undefined, false, GameSession.combatView(activeFighters));
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

      // Filter guns by crew availability, ammo, and gun operability
      const eligibleGuns = gunEntries.filter(ge => {
        const cm = getCrewByPosition(crew, ge.crewPos);
        if (!cm || cm.status !== 'active' || cm.woundSeverity === 'serious' || cm.woundSeverity === 'kia') return false;
        const gunObj = getGun(aircraft.guns, ge.gun);
        if (gunObj.ammo <= 0 || gunObj.disabled || gunObj.jammed) return false;
        if (ge.gun === 'Ball_Turret' && aircraft.ballTurretInop) return false;
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
            const gunObj = getGun(aircraft.guns, ge.gun);
            // Determine if ALL targets for this gun are delayed (tail special only)
            const allDelayed = ge.targets.every(t => t.isDelayed);
            return {
              gunId: ge.gun,
              gunLabel: GUN_LABELS[ge.gun] || ge.gun,
              crewName: cm.name,
              ammoRemaining: gunObj.ammo,
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

          // Ammo is deducted when the gun actually fires (in _resolveGunFire),
          // not at allocation time — if the target is destroyed before firing,
          // no ammo is spent.

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
        return !f.damage.includes('Destroyed');
      });

      if (activeFighters.length === 0) {
        this.emit('COMBAT', 'All fighters driven off or destroyed!', 'combat', 'good', zone, direction, undefined, true, GameSession.combatView([]));
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
          buildM3Rows(tables, fighter.position, engineMod + evasiveMod - fighter.damage.filter(d => d === 'FCA').length),
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
              this.state.campaign.aircraft.superficialHits = (this.state.campaign.aircraft.superficialHits || 0) + 1;
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
        const tailGunObj = getGun(aircraft.guns, 'Tail');
        if (tailGunner && tailGunner.status === 'active' && tailGunner.woundSeverity !== 'serious' && tailGunner.woundSeverity !== 'kia' && !tailGunObj.disabled) {
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
          if (f.damage.includes('Destroyed')) return false;
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

      // Successive attacks — roll B-6 for new attack position per §6.5a
      if (attackRound < 3) {
        activeFighters = getSuccessiveAttackers(activeFighters, mission.outOfFormation);
        const b6Display = tables.getTableDisplayData('B-6');
        for (const f of activeFighters) {
          const b6RollValue: number = yield* this._yieldCombatRoll(
            'B-6', 'Successive Attack Position',
            `${f.type} coming around — roll for new attack position`,
            '2d6',
            b6Display?.rows ?? [],
          );
          try {
            const result = tables.lookupWithValue('B-6', b6RollValue);
            if (result) {
              f.position = (result.entry as any).position ?? (result.entry as any).result ?? f.position;
            }
          } catch { /* keep position */ }
          this.emit('COMBAT', `${f.type} repositions to ${f.position}`, 'combat', 'info', zone, direction,
            [{ table: 'B-6', rollType: '2d6', rolled: b6RollValue, result: f.position }]);
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
    if (isFighterOutOfAction(fighter)) return;

    // Deduct ammo when gun actually fires (not at allocation time)
    const gunObj = getGun(this.state.campaign.aircraft.guns, gun);
    gunObj.ammo--;
    // Keep legacy ammo in sync
    this.state.campaign.aircraft.ammo[gun as keyof AmmoState]--;

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
      const m2Mods: string[] = [];
      if (gunObj.twin) m2Mods.push('twin mount +1');
      if (fighter.type === 'FW190') m2Mods.push('FW190 -1 (note b)');
      const m2ModStr = m2Mods.length > 0 ? ` (${m2Mods.join(', ')})` : '';

      const dmgRollValue: number = yield* this._yieldCombatRoll(
        'M-2', 'Fighter Damage',
        `Damage to ${fighter.type} hit by ${GUN_LABELS[gun]}${m2ModStr}`,
        '1d6',
        [
          { roll: '1-3', columns: { result: 'FCA — continues attack' } },
          { roll: '4-5', columns: { result: 'FBOA — breaks off' } },
          { roll: '6', columns: { result: 'Destroyed' } },
        ],
      );

      const dmg = rollFighterDamage(createFixedRng(dmgRollValue, rng), tables, gunObj.twin, fighter.type);
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
      this.emit('COMBAT', `Friendly fighters drive off ${removable.length} ${removable.length === 1 ? 'enemy' : 'enemies'}!`, 'combat', 'good', zone, direction,
        [{ table: 'M-4', rollType: '1d6', rolled: m4RollValue, result: `${actualCount} driven off (${coverLevel} cover)` }]);
      return nonRemovable;
    }

    this.emit('COMBAT', `Friendly fighters can drive off ${actualCount} ${actualCount === 1 ? 'enemy' : 'enemies'} — choose which to remove`, 'combat', 'good', zone, direction,
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
          const gunObj = getGun(this.state.campaign.aircraft.guns, gun);
          if (isCrewDown(this.state.campaign.crew, gunObj.crewPosition)) continue;
          if (gunObj.ammo <= 0 || gunObj.disabled || gunObj.jammed) continue;
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
          this.state.campaign.aircraft.superficialHits = (this.state.campaign.aircraft.superficialHits || 0) + 1;
          this.emit('DAMAGE', `${location}: Superficial — no effect`, 'damage', 'info', zone, direction,
            [{ table: damageTable, rollType: dmgDiceType, rolled: dmgRollValue, result: 'Superficial' }]);
          break;
        case 'crew_wound': {
          const pos = effect.position as CrewPosition;
          const crew = getCrewByPosition(this.state.campaign.crew, pos);
          if (crew && crew.woundSeverity !== 'kia') {
            // Yield for wound severity roll
            const woundRollValue: number = yield* this._yieldCombatRoll(
              'B1-4', 'Wound Severity',
              `Wound severity for ${crew.name} (${POSITION_LABELS[pos]})`, '1d6',
              [
                { roll: '1-3', columns: { result: 'Light wound' } },
                { roll: '4-5', columns: { result: 'Serious wound' } },
                { roll: '6', columns: { result: 'KIA' } },
              ],
            );

            let severity: WoundSeverity;
            try { severity = rollCrewWound(createFixedRng(woundRollValue, rng), tables); } catch { severity = 'light'; }
            crew.woundSeverity = accumulateWound(crew.woundSeverity, severity);
            if (severity === 'kia') crew.status = 'kia';
            const sev = severity === 'kia' ? 'critical' : severity === 'serious' ? 'bad' : 'warn';
            this.emit('DAMAGE', `${crew.name} (${POSITION_LABELS[pos]}): ${severity} wound`, 'damage', sev as any, zone, direction,
              [
                { table: damageTable, rollType: dmgDiceType, rolled: dmgRollValue, result: 'Crew wound', description: `${location} damage` },
                { table: 'B1-4', rollType: '1d6', rolled: woundRollValue, result: severity, description: 'Wound severity' },
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
        case 'wing_root_hit': {
          const isPort = location.toLowerCase().includes('port');
          if (isPort) {
            this.state.campaign.aircraft.portWingRootHits = (this.state.campaign.aircraft.portWingRootHits || 0) + 1;
            const hits = this.state.campaign.aircraft.portWingRootHits;
            if (hits >= 5) {
              this.emit('DAMAGE', `Port wing root: ${hits}/5 hits — WING RIPS OFF!`, 'damage', 'critical', zone, direction,
                [{ table: damageTable, rollType: dmgDiceType, rolled: dmgRollValue, result: 'Wing root hit (destroyed)' }], true);
            } else {
              this.emit('DAMAGE', `Port wing root hit (${hits}/5)`, 'damage', 'bad', zone, direction,
                [{ table: damageTable, rollType: dmgDiceType, rolled: dmgRollValue, result: `Wing root hit ${hits}/5` }], true);
            }
          } else {
            this.state.campaign.aircraft.starboardWingRootHits = (this.state.campaign.aircraft.starboardWingRootHits || 0) + 1;
            const hits = this.state.campaign.aircraft.starboardWingRootHits;
            if (hits >= 5) {
              this.emit('DAMAGE', `Starboard wing root: ${hits}/5 hits — WING RIPS OFF!`, 'damage', 'critical', zone, direction,
                [{ table: damageTable, rollType: dmgDiceType, rolled: dmgRollValue, result: 'Wing root hit (destroyed)' }], true);
            } else {
              this.emit('DAMAGE', `Starboard wing root hit (${hits}/5)`, 'damage', 'bad', zone, direction,
                [{ table: damageTable, rollType: dmgDiceType, rolled: dmgRollValue, result: `Wing root hit ${hits}/5` }], true);
            }
          }
          break;
        }
        case 'destroyed':
          this.emit('DAMAGE', `CATASTROPHIC DAMAGE — aircraft destroyed!`, 'damage', 'critical', zone, direction,
            [{ table: damageTable, rollType: dmgDiceType, rolled: dmgRollValue, result: 'Destroyed' }], true);
          break;
        case 'follow_up_table': {
          const subRollData = tables.get(damageTable)?.raw as any;
          const rollEntry = subRollData?.rolls?.[String(dmgRollValue)];
          const subRoll = rollEntry?.sub_roll;

          if (subRoll?.type === 'fuel_tank') {
            // ── Fuel Tank sub-rolls ──
            const isPort = location === 'Port Wing';
            const wingLabel = isPort ? 'Port' : 'Starboard';

            // Roll 1: Tank location
            const tankLocRoll: number = yield* this._yieldCombatRoll(
              'B1-1', `${wingLabel} Wing Fuel Tank Location`,
              `Which fuel tank was hit?`, '1d6',
              [
                { roll: '1-3', columns: { result: 'Outboard tank' } },
                { roll: '4-6', columns: { result: 'Inboard tank' } },
              ],
            );
            const tankLocation = tankLocRoll <= 3 ? 'Outboard tank' : 'Inboard tank';

            // Roll 2: Damage type
            const tankDmgRoll: number = yield* this._yieldCombatRoll(
              'B1-1', `${wingLabel} Wing Fuel Tank Damage`,
              `Damage to ${tankLocation}`, '1d6',
              [
                { roll: '1-2', columns: { result: 'Fire — roll to extinguish on Table B1-3' } },
                { roll: '3-4', columns: { result: 'Fuel leak — limited range' } },
                { roll: '5-6', columns: { result: 'Self-seal, no effect' } },
              ],
            );

            if (tankDmgRoll <= 2) {
              // Fire
              this.state.campaign.aircraft.fuelFire = true;
              this.emit('DAMAGE', `FUEL FIRE in ${wingLabel} wing ${tankLocation}!`, 'damage', 'critical', zone, direction,
                [
                  { table: damageTable, rollType: dmgDiceType, rolled: dmgRollValue, result: 'Fuel Tank' },
                  { table: 'B1-1', rollType: '1d6', rolled: tankLocRoll, result: tankLocation, description: 'Tank location' },
                  { table: 'B1-1', rollType: '1d6', rolled: tankDmgRoll, result: 'Fire', description: 'Fuel tank damage' },
                ], true);
            } else if (tankDmgRoll <= 4) {
              // Fuel leak
              this.state.campaign.aircraft.fuelLeak = true;
              this.emit('DAMAGE', `Fuel leak in ${wingLabel} wing ${tankLocation} — limited range`, 'damage', 'bad', zone, direction,
                [
                  { table: damageTable, rollType: dmgDiceType, rolled: dmgRollValue, result: 'Fuel Tank' },
                  { table: 'B1-1', rollType: '1d6', rolled: tankLocRoll, result: tankLocation, description: 'Tank location' },
                  { table: 'B1-1', rollType: '1d6', rolled: tankDmgRoll, result: 'Fuel leak', description: 'Fuel tank damage' },
                ], true);
            } else {
              // Self-seal
              this.emit('DAMAGE', `${wingLabel} wing ${tankLocation} hit — self-sealed, no effect`, 'damage', 'good', zone, direction,
                [
                  { table: damageTable, rollType: dmgDiceType, rolled: dmgRollValue, result: 'Fuel Tank' },
                  { table: 'B1-1', rollType: '1d6', rolled: tankLocRoll, result: tankLocation, description: 'Tank location' },
                  { table: 'B1-1', rollType: '1d6', rolled: tankDmgRoll, result: 'Self-seal', description: 'Fuel tank damage' },
                ]);
            }
          } else if (subRoll?.type === 'engine_hit') {
            // ── Engine sub-rolls ──
            const isPort = location === 'Port Wing';
            const wingLabel = isPort ? 'Port' : 'Starboard';
            const enginePair = isPort
              ? { lo: '#1 engine', hi: '#2 engine', loIdx: 0, hiIdx: 1 }
              : { lo: '#3 engine', hi: '#4 engine', loIdx: 2, hiIdx: 3 };

            // Roll 1: Which engine
            const engLocRoll: number = yield* this._yieldCombatRoll(
              'B1-1', `${wingLabel} Wing Engine Hit`,
              `Which engine was hit?`, '1d6',
              [
                { roll: '1-3', columns: { result: enginePair.lo } },
                { roll: '4-6', columns: { result: enginePair.hi } },
              ],
            );
            const engIdx = engLocRoll <= 3 ? enginePair.loIdx : enginePair.hiIdx;
            const engLabel = `Engine #${engIdx + 1}`;

            // Roll 2: Damage type
            const engDmgRoll: number = yield* this._yieldCombatRoll(
              'B1-1', `${engLabel} Damage`,
              `Damage to ${engLabel}`, '1d6',
              [
                { roll: '1-2', columns: { result: 'Superficial damage — no effect' } },
                { roll: '3-4', columns: { result: 'Engine out' } },
                { roll: '5', columns: { result: 'Runaway engine' } },
                { roll: '6', columns: { result: 'Oil tank hit' } },
              ],
            );

            if (engDmgRoll <= 2) {
              this.emit('DAMAGE', `${engLabel}: Superficial — no effect`, 'damage', 'info', zone, direction,
                [
                  { table: damageTable, rollType: dmgDiceType, rolled: dmgRollValue, result: 'Engines' },
                  { table: 'B1-1', rollType: '1d6', rolled: engLocRoll, result: engLabel, description: 'Engine location' },
                  { table: 'B1-1', rollType: '1d6', rolled: engDmgRoll, result: 'Superficial', description: 'Engine damage' },
                ]);
            } else if (engDmgRoll <= 4) {
              if (this.state.campaign.aircraft.engines[engIdx] !== 'out') {
                this.state.campaign.aircraft.engines[engIdx] = 'out';
                this.emit('DAMAGE', `${engLabel} knocked out!`, 'damage', 'bad', zone, direction,
                  [
                    { table: damageTable, rollType: dmgDiceType, rolled: dmgRollValue, result: 'Engines' },
                    { table: 'B1-1', rollType: '1d6', rolled: engLocRoll, result: engLabel, description: 'Engine location' },
                    { table: 'B1-1', rollType: '1d6', rolled: engDmgRoll, result: 'Engine out', description: 'Engine damage' },
                  ], true);
                const out = countEnginesOut(this.state.campaign.aircraft);
                if (out >= 2 && this.state.mission) {
                  this.state.mission.outOfFormation = true;
                  this.emit('DAMAGE', `${out} engines out — out of formation!`, 'damage', 'bad', zone, direction);
                }
              }
            } else if (engDmgRoll === 5) {
              // Runaway engine — treat as engine out
              if (this.state.campaign.aircraft.engines[engIdx] !== 'out') {
                this.state.campaign.aircraft.engines[engIdx] = 'out';
                this.emit('DAMAGE', `${engLabel} RUNAWAY — engine out!`, 'damage', 'bad', zone, direction,
                  [
                    { table: damageTable, rollType: dmgDiceType, rolled: dmgRollValue, result: 'Engines' },
                    { table: 'B1-1', rollType: '1d6', rolled: engLocRoll, result: engLabel, description: 'Engine location' },
                    { table: 'B1-1', rollType: '1d6', rolled: engDmgRoll, result: 'Runaway engine', description: 'Engine damage' },
                  ], true);
                const out = countEnginesOut(this.state.campaign.aircraft);
                if (out >= 2 && this.state.mission) {
                  this.state.mission.outOfFormation = true;
                  this.emit('DAMAGE', `${out} engines out — out of formation!`, 'damage', 'bad', zone, direction);
                }
              }
            } else {
              // Oil tank hit — engine out + fire
              this.state.campaign.aircraft.engines[engIdx] = 'fire';
              this.emit('DAMAGE', `${engLabel} OIL TANK HIT — engine out, fire!`, 'damage', 'critical', zone, direction,
                [
                  { table: damageTable, rollType: dmgDiceType, rolled: dmgRollValue, result: 'Engines' },
                  { table: 'B1-1', rollType: '1d6', rolled: engLocRoll, result: engLabel, description: 'Engine location' },
                  { table: 'B1-1', rollType: '1d6', rolled: engDmgRoll, result: 'Oil tank hit', description: 'Engine damage' },
                ], true);
              const out = countEnginesOut(this.state.campaign.aircraft);
              if (out >= 2 && this.state.mission) {
                this.state.mission.outOfFormation = true;
                this.emit('DAMAGE', `${out} engines out — out of formation!`, 'damage', 'bad', zone, direction);
              }
              // Fire extinguisher sequence (B1-1 note e)
              yield* this._resolveFireExtinguisher(engIdx, zone, direction);
            }
          } else if (effect.table === 'B1-4') {
            // ── Crew wound follow-up (B1-4) ──
            // Map follow-up target text to crew positions
            const targetText = (effect.target ?? rollEntry?.follow_up?.target ?? '') as string;
            const woundTargets: CrewPosition[] = [];
            if (/port\s*waist/i.test(targetText)) woundTargets.push('left_waist');
            else if (/starboard\s*waist/i.test(targetText)) woundTargets.push('right_waist');
            else if (/both\s*waist/i.test(targetText)) woundTargets.push('left_waist', 'right_waist');
            else if (/tail/i.test(targetText)) woundTargets.push('tail_gunner');
            else if (/ball/i.test(targetText)) woundTargets.push('ball_turret');
            else if (/radio/i.test(targetText)) woundTargets.push('radioman');
            else if (/navigator/i.test(targetText)) woundTargets.push('navigator');
            else if (/bombardier/i.test(targetText)) woundTargets.push('bombardier');
            else if (/pilot/i.test(targetText)) woundTargets.push('pilot');
            else if (/engineer/i.test(targetText)) woundTargets.push('engineer');

            for (const pos of woundTargets) {
              const crew = getCrewByPosition(this.state.campaign.crew, pos);
              if (crew && crew.woundSeverity !== 'kia') {
                const woundRollValue: number = yield* this._yieldCombatRoll(
                  'B1-4', 'Wound Severity',
                  `Wound severity for ${crew.name} (${POSITION_LABELS[pos]})`, '1d6',
                  [
                    { roll: '1-3', columns: { result: 'Light wound' } },
                    { roll: '4-5', columns: { result: 'Serious wound' } },
                    { roll: '6', columns: { result: 'KIA' } },
                  ],
                );

                let severity: WoundSeverity;
                try { severity = rollCrewWound(createFixedRng(woundRollValue, rng), tables); } catch { severity = 'light'; }
                crew.woundSeverity = accumulateWound(crew.woundSeverity, severity);
                if (severity === 'kia') crew.status = 'kia';
                const sev = severity === 'kia' ? 'critical' : severity === 'serious' ? 'bad' : 'warn';
                this.emit('DAMAGE', `${crew.name} (${POSITION_LABELS[pos]}): ${severity} wound`, 'damage', sev as any, zone, direction,
                  [
                    { table: damageTable, rollType: dmgDiceType, rolled: dmgRollValue, result: dmg.result, description: `${location} damage` },
                    { table: 'B1-4', rollType: '1d6', rolled: woundRollValue, result: severity, description: 'Wound severity' },
                  ], true);
              }
            }
          } else if (subRoll && subRoll.type === '1d6') {
            // ── Generic 1d6 sub-roll ──
            yield* this._resolveGenericSubRoll(
              damageTable, dmgDiceType, dmgRollValue, dmg,
              location, subRoll, rollEntry,
              zone, direction,
            );
          } else {
            // True generic fallback (no sub-roll data)
            this.emit('DAMAGE', `${location}: ${dmg.description || dmg.result}`, 'damage', 'info', zone, direction,
              [{ table: damageTable, rollType: dmgDiceType, rolled: dmgRollValue, result: dmg.result }]);
          }
          break;
        }
        default: {
          // Check for specific system damage that needs state updates
          const resultLower = (dmg.result ?? '').toLowerCase();
          const descLower = (dmg.description ?? '').toLowerCase();
          if (descLower.includes('tail guns inoperable') || resultLower.includes('tail guns inoperable')) {
            disableGun(this.state.campaign.aircraft.guns, 'Tail');
            this.emit('DAMAGE', `${location}: Tail guns inoperable!`, 'damage', 'bad', zone, direction,
              [{ table: damageTable, rollType: dmgDiceType, rolled: dmgRollValue, result: dmg.result }], true);
          } else if (descLower.includes('ball turret') && (descLower.includes('guns out') || descLower.includes('inoperable'))) {
            this.state.campaign.aircraft.ballTurretInop = true;
            this.emit('DAMAGE', `${location}: ${dmg.description || dmg.result}`, 'damage', 'bad', zone, direction,
              [{ table: damageTable, rollType: dmgDiceType, rolled: dmgRollValue, result: dmg.result }], true);
          } else {
            this.emit('DAMAGE', `${location}: ${dmg.description || dmg.result}`, 'damage', 'info', zone, direction,
              [{ table: damageTable, rollType: dmgDiceType, rolled: dmgRollValue, result: dmg.result }]);
          }
          break;
        }
      }
    }
  }

  // ── Generic 1d6 sub-roll handler ──
  private *_resolveGenericSubRoll(
    damageTable: string, dmgDiceType: string, dmgRollValue: number,
    dmg: DamageResult, location: string,
    subRoll: Record<string, any>, _rollEntry: any,
    zone: number, direction: 'outbound' | 'inbound',
  ): Generator<MissionYield, void, number | number[] | undefined> {
    // Build display rows from sub_roll keys
    const rows: PendingRoll['tableRows'] = Object.entries(subRoll)
      .filter(([k]) => k !== 'type')
      .map(([k, v]) => ({ roll: k, columns: { result: v as string } }));

    // Prompt player for the 1d6 sub-roll
    const subRollValue: number = yield* this._yieldCombatRoll(
      damageTable, `${dmg.result}`,
      `${location}: ${dmg.result} — roll for specific effect`, '1d6',
      rows,
    );

    // Find matching outcome
    const outcome = this._matchSubRollOutcome(subRoll, subRollValue);

    // Apply effect to state
    yield* this._applySubRollEffect(
      damageTable, dmgDiceType, dmgRollValue, dmg,
      location, subRollValue, outcome,
      zone, direction,
    );
  }

  private _matchSubRollOutcome(subRoll: Record<string, any>, value: number): string {
    for (const [key, result] of Object.entries(subRoll)) {
      if (key === 'type') continue;
      const match = key.match(/^(\d+)(?:-(\d+))?$/);
      if (!match) continue;
      const lo = parseInt(match[1]);
      const hi = match[2] ? parseInt(match[2]) : lo;
      if (value >= lo && value <= hi) return result as string;
    }
    return 'No effect';
  }

  private *_applySubRollEffect(
    damageTable: string, dmgDiceType: string, dmgRollValue: number,
    dmg: DamageResult, location: string,
    subRollValue: number, outcome: string,
    zone: number, direction: 'outbound' | 'inbound',
  ): Generator<MissionYield, void, number | number[] | undefined> {
    const ac = this.state.campaign.aircraft;
    const mission = this.state.mission;
    const outcomeLower = outcome.toLowerCase();
    let severity: 'info' | 'warn' | 'bad' | 'critical' | 'good' = 'warn';
    let isImportant = false;

    // ── B-17 destroyed (bombs detonate) ──
    if (outcomeLower.includes('destroyed') || outcomeLower.includes('detonate')) {
      severity = 'critical'; isImportant = true;
      this.emit('DAMAGE', `${location}: ${outcome}`, 'damage', severity, zone, direction,
        [
          { table: damageTable, rollType: dmgDiceType, rolled: dmgRollValue, result: dmg.result, description: `${location} damage` },
          { table: damageTable, rollType: '1d6', rolled: subRollValue, result: outcome, description: 'Sub-roll result' },
        ], isImportant);
      return;
    }

    // ── Gun damage ──
    if ((outcomeLower.includes('gun') && outcomeLower.includes('inoperable')) || outcomeLower.includes('guns out')) {
      let gunId: import('../games/b17/rules/combat.js').GunPosition | null = null;
      if (outcomeLower.includes('nose gun')) gunId = 'Nose';
      else if (outcomeLower.includes('port cheek')) gunId = 'Port_Cheek';
      else if (outcomeLower.includes('starboard cheek')) gunId = 'Starboard_Cheek';
      else if (outcomeLower.includes('top turret')) gunId = 'Top_Turret';
      else if (outcomeLower.includes('ball turret')) gunId = 'Ball_Turret';
      else if (outcomeLower.includes('port waist') || outcomeLower.includes('port gun')) gunId = 'Port_Waist';
      else if (outcomeLower.includes('starboard waist') || outcomeLower.includes('starboard gun')) gunId = 'Starboard_Waist';
      else if (outcomeLower.includes('tail')) gunId = 'Tail';
      else if (outcomeLower.includes('radio')) gunId = 'Radio';
      if (gunId) {
        disableGun(ac.guns, gunId);
        // For top turret + wound combo (P-2 roll 8, sub-roll 6)
        if (outcomeLower.includes('wound') || outcomeLower.includes('b1-4')) {
          severity = 'bad'; isImportant = true;
          this.emit('DAMAGE', `${location}: ${outcome}`, 'damage', severity, zone, direction,
            [
              { table: damageTable, rollType: dmgDiceType, rolled: dmgRollValue, result: dmg.result, description: `${location} damage` },
              { table: damageTable, rollType: '1d6', rolled: subRollValue, result: outcome, description: 'Sub-roll result' },
            ], isImportant);
          // Chain to wound resolution
          yield* this._resolveSubRollWound(outcomeLower, damageTable, dmgDiceType, dmgRollValue, zone, direction);
          return;
        }
      }
      severity = 'bad'; isImportant = true;
    }
    // ── Crew wound (no gun damage) ──
    else if (outcomeLower.includes('wound') || outcomeLower.includes('b1-4')) {
      severity = 'bad'; isImportant = true;
      this.emit('DAMAGE', `${location}: ${outcome}`, 'damage', severity, zone, direction,
        [
          { table: damageTable, rollType: dmgDiceType, rolled: dmgRollValue, result: dmg.result, description: `${location} damage` },
          { table: damageTable, rollType: '1d6', rolled: subRollValue, result: outcome, description: 'Sub-roll result' },
        ], isImportant);
      yield* this._resolveSubRollWound(outcomeLower, damageTable, dmgDiceType, dmgRollValue, zone, direction);
      return;
    }
    // ── Bomb bay doors inoperable ──
    else if (outcomeLower.includes('bomb bay doors inoperable') || outcomeLower.includes('bomb bay doors') && outcomeLower.includes('inoperable')) {
      ac.bombBayDoorsInop = true;
      if (mission) mission.bombsAboard = true; // can't drop
      severity = 'bad'; isImportant = true;
    }
    // ── Bomb controls inoperable (bomb run -3) ──
    else if (outcomeLower.includes('bomb controls inoperable') || outcomeLower.includes('bombs must be dropped manually')) {
      ac.bombControlsInop = true;
      if (mission) mission.bombRunModifier -= 3;
      severity = 'bad'; isImportant = true;
    }
    // ── Autopilot inoperable (bomb run -2) ──
    else if (outcomeLower.includes('autopilot') && outcomeLower.includes('inoperable')) {
      ac.autopilotInop = true;
      if (mission) mission.bombRunModifier -= 2;
      severity = 'bad'; isImportant = true;
    }
    // ── Tailwheel damaged (landing -1) ──
    else if (outcomeLower.includes('tailwheel damaged')) {
      ac.tailWheelDamaged = true;
      if (mission) mission.landingModifiers -= 1;
      severity = 'bad'; isImportant = true;
    }
    // ── Brakes out (landing -1) ──
    else if (outcomeLower.includes('brakes out')) {
      ac.brakesOut = true;
      if (mission) mission.landingModifiers -= 1;
      severity = 'bad'; isImportant = true;
    }
    // ── Landing gear inoperable (landing -3) ──
    else if (outcomeLower.includes('landing gear inoperable')) {
      ac.landingGearInop = true;
      if (mission) mission.landingModifiers -= 3;
      severity = 'critical'; isImportant = true;
    }
    // ── Wing flap inoperable (landing -1) ──
    else if (outcomeLower.includes('flap inoperable') || outcomeLower.includes('wing flap inoperable')) {
      const isPort = location === 'Port Wing';
      if (isPort) ac.portFlapInop = true; else ac.starboardFlapInop = true;
      if (mission) mission.landingModifiers -= 1;
      severity = 'bad'; isImportant = true;
    }
    // ── Aileron inoperable (landing -1) ──
    else if (outcomeLower.includes('aileron inoperable')) {
      const isPort = location === 'Port Wing';
      if (isPort) ac.portAileronInop = true; else ac.starboardAileronInop = true;
      if (mission) mission.landingModifiers -= 1;
      severity = 'bad'; isImportant = true;
    }
    // ── Elevator inoperable ──
    else if (outcomeLower.includes('elevator inoperable')) {
      if (outcomeLower.includes('port')) ac.portElevatorInop = true;
      else ac.starboardElevatorInop = true;
      // Both elevators inop = landing -1 (only apply once)
      if (ac.portElevatorInop && ac.starboardElevatorInop && mission) {
        // Check if we already applied the combined penalty
        // (individual elevator hits don't have their own penalty per rules)
        mission.landingModifiers -= 1;
      }
      severity = 'bad'; isImportant = true;
    }
    // ── Tailplane root hit ──
    else if (outcomeLower.includes('tailplane root')) {
      severity = 'bad'; isImportant = true;
      // TODO: cumulative tracking — 3 hits = tailplane rips off
    }
    // ── Ball turret mechanism inoperable (trapped) ──
    else if (outcomeLower.includes('trapped') || (outcomeLower.includes('turret mechanism') && outcomeLower.includes('inoperable'))) {
      ac.ballTurretTrapped = true;
      ac.ballTurretInop = true;
      disableGun(ac.guns, 'Ball_Turret');
      severity = 'critical'; isImportant = true;
    }
    // ── Navigator equipment inoperable ──
    else if (outcomeLower.includes('navigator') && outcomeLower.includes('equipment inoperable')) {
      ac.navigatorEquipInop = true;
      severity = 'bad'; isImportant = true;
    }
    // ── Fire + oxygen out ──
    else if (outcomeLower.includes('fire')) {
      ac.oxygenOut = true;
      severity = 'critical'; isImportant = true;
      // TODO: trigger fire extinguish sequence (B1-3)
    }
    // ── Oxygen hit (no fire) ──
    else if (outcomeLower.includes('oxygen')) {
      // Individual crew oxygen tracking — for now just set global flag
      ac.oxygenOut = true;
      severity = 'warn';
    }
    // ── Heat out ──
    else if (outcomeLower.includes('heat out')) {
      ac.heatingOut = true;
      severity = 'warn';
    }
    // ── No effect / superficial ──
    else if (outcomeLower.includes('no effect') || outcomeLower.includes('superficial')) {
      if (outcomeLower.includes('superficial')) {
        ac.superficialHits = (ac.superficialHits || 0) + 1;
      }
      severity = 'info';
    }

    this.emit('DAMAGE', `${location}: ${outcome}`, 'damage', severity, zone, direction,
      [
        { table: damageTable, rollType: dmgDiceType, rolled: dmgRollValue, result: dmg.result, description: `${location} damage` },
        { table: damageTable, rollType: '1d6', rolled: subRollValue, result: outcome, description: 'Sub-roll result' },
      ], isImportant);
  }

  /** Resolve a crew wound triggered by a sub-roll outcome */
  private *_resolveSubRollWound(
    outcomeLower: string,
    damageTable: string, dmgDiceType: string, dmgRollValue: number,
    zone: number, direction: 'outbound' | 'inbound',
  ): Generator<MissionYield, void, number | number[] | undefined> {
    const rng = this.rng;
    const tables = this.tables;
    const woundTargets: CrewPosition[] = [];

    if (outcomeLower.includes('ball gunner') || outcomeLower.includes('ball turret')) woundTargets.push('ball_turret');
    else if (outcomeLower.includes('engineer')) woundTargets.push('engineer');
    else if (outcomeLower.includes('port') && outcomeLower.includes('gunner')) woundTargets.push('left_waist');
    else if (outcomeLower.includes('starboard') && outcomeLower.includes('gunner')) woundTargets.push('right_waist');
    else if (outcomeLower.includes('tail gunner')) woundTargets.push('tail_gunner');
    else if (outcomeLower.includes('radio')) woundTargets.push('radioman');
    else if (outcomeLower.includes('navigator')) woundTargets.push('navigator');
    else if (outcomeLower.includes('bombardier')) woundTargets.push('bombardier');
    else if (outcomeLower.includes('pilot')) woundTargets.push('pilot');

    for (const pos of woundTargets) {
      const crew = getCrewByPosition(this.state.campaign.crew, pos);
      if (crew && crew.woundSeverity !== 'kia') {
        const woundRollValue: number = yield* this._yieldCombatRoll(
          'B1-4', 'Wound Severity',
          `Wound severity for ${crew.name} (${POSITION_LABELS[pos]})`, '1d6',
          [
            { roll: '1-3', columns: { result: 'Light wound' } },
            { roll: '4-5', columns: { result: 'Serious wound' } },
            { roll: '6', columns: { result: 'KIA' } },
          ],
        );

        let severity: WoundSeverity;
        try { severity = rollCrewWound(createFixedRng(woundRollValue, rng), tables); } catch { severity = 'light'; }
        crew.woundSeverity = accumulateWound(crew.woundSeverity, severity);
        if (severity === 'kia') crew.status = 'kia';
        const sev = severity === 'kia' ? 'critical' : severity === 'serious' ? 'bad' : 'warn';
        this.emit('DAMAGE', `${crew.name} (${POSITION_LABELS[pos]}): ${severity} wound`, 'damage', sev as any, zone, direction,
          [
            { table: damageTable, rollType: dmgDiceType, rolled: dmgRollValue, result: 'Sub-roll wound', description: 'Damage sub-roll' },
            { table: 'B1-4', rollType: '1d6', rolled: woundRollValue, result: severity, description: 'Wound severity' },
          ], true);
      }
    }
  }

  /**
   * General-purpose crew bailout sequence.
   *
   * Per Tables G-6 (controlled) / G-7 (uncontrolled):
   *   - Seriously wounded → cannot bail out, KIA
   *   - Otherwise → player rolls 1d6 per crewman
   *   - Light wound modifier: -1 (errata: applies to both G-6 and G-7)
   *   - Natural 6 always succeeds even with modifier
   *
   * Post-bailout fate per G-6/G-7 notes + G-11 terrain:
   *   - Germany/Netherlands → automatically captured (POW)
   *   - France/Belgium → roll 1d6: 1-5 captured, 6 returned to England
   *   - Water → roll on G-8: 1-4 drowned, 5-6 rescued (radio out → all die)
   *
   * After all crew resolved: summary, mark aircraft destroyed, check campaign end.
   */
  private *_executeBailout(
    controlled: boolean,
  ): Generator<MissionYield, void, number | number[] | undefined> {
    const mission = this.state.mission!;
    const zone = mission.zone;
    const direction = mission.direction;
    const crew = this.state.campaign.crew;
    const ac = this.state.campaign.aircraft;
    const tableId = controlled ? 'G-6' : 'G-7';
    const tableTitle = controlled ? 'Controlled Bailout' : 'Bailout from Uncontrolled Plane';

    // Determine terrain from G-11
    const zoneInfo = getZoneInfo(mission.target, zone, this.tables);
    const terrains: string[] = zoneInfo?.over ?? ['unknown'];
    // Pick primary terrain (first non-water if mixed, e.g. "water, France" for Cherbourg zone 3)
    // For bailout, if there are multiple terrains, use the land one (crew bailing over land)
    // But if only water, use water
    const terrain = terrains.length === 1 ? terrains[0].toLowerCase()
      : (terrains.find(t => t.toLowerCase() !== 'water') ?? terrains[0]).toLowerCase();

    this.emit('DAMAGE', `${controlled ? 'Controlled' : 'Uncontrolled'} bailout! Zone ${zone} — over ${terrains.join(', ')}`,
      'damage', 'critical', zone, direction, undefined, true);

    let kiaCount = 0;
    let capturedCount = 0;
    let returnedCount = 0;
    let drownedCount = 0;

    // G-6 table rows for display
    const bailoutRows = controlled
      ? [
          { roll: '1', columns: { result: 'Roll 1D: 1-5 OK, 6 KIA in accident' } },
          { roll: '2-6', columns: { result: 'Bailout OK' } },
        ]
      : [
          { roll: '1-5', columns: { result: 'No bailout — goes down with plane' } },
          { roll: '6', columns: { result: 'Bailout OK' } },
        ];

    for (const member of crew) {
      const label = `${member.name} (${POSITION_LABELS[member.position]})`;

      // Already KIA — skip
      if (member.woundSeverity === 'kia' || member.status === 'kia') {
        continue;
      }

      // Seriously wounded → cannot bail out, goes down with plane
      if (member.woundSeverity === 'serious') {
        member.status = 'kia';
        member.woundSeverity = 'kia';
        kiaCount++;
        this.emit('DAMAGE', `${label}: Seriously wounded — cannot bail out. KIA.`,
          'damage', 'critical', zone, direction, undefined, true);
        continue;
      }

      // Roll for bailout
      const modifier = member.woundSeverity === 'light' ? -1 : 0;
      const modText = modifier !== 0 ? ` (light wound: ${modifier})` : '';
      const rollValue: number = yield* this._yieldCombatRoll(
        tableId, tableTitle,
        `Bailout roll for ${label}${modText}`, '1d6',
        bailoutRows, modifier,
      );

      // Determine if bailed out
      let bailedOut: boolean;
      if (controlled) {
        // G-6: Roll 1 → sub-roll (but we simplify: 1 with modifier applied)
        // Actually per G-6: raw 1 needs sub-roll 1-5 OK, 6 KIA
        // But with modifier, effective roll matters
        // Natural 6 always OK
        if (rollValue === 6) {
          bailedOut = true;
        } else {
          const effective = rollValue + modifier;
          if (effective <= 1) {
            // Per G-6 roll "1": sub-roll needed. Roll again.
            const subRoll: number = yield* this._yieldCombatRoll(
              'G-6', 'Bailout Accident Check',
              `${label} stumbled — roll for accident (1-5 OK, 6 KIA)`, '1d6',
              [
                { roll: '1-5', columns: { result: 'Bailout OK' } },
                { roll: '6', columns: { result: 'Crewman killed in accident' } },
              ],
            );
            bailedOut = subRoll <= 5;
          } else {
            bailedOut = true; // effective 2+ = OK
          }
        }
      } else {
        // G-7: 1-5 = KIA, 6 = OK. Natural 6 always OK.
        if (rollValue === 6) {
          bailedOut = true;
        } else {
          const effective = rollValue + modifier;
          bailedOut = effective >= 6;
        }
      }

      if (!bailedOut) {
        member.status = 'kia';
        member.woundSeverity = 'kia';
        kiaCount++;
        this.emit('DAMAGE', `${label}: Failed to bail out — KIA.`,
          'damage', 'critical', zone, direction,
          [{ table: tableId, rollType: '1d6', rolled: rollValue, result: 'KIA' }], true);
        continue;
      }

      // Successful bailout — determine fate by terrain
      if (terrain === 'germany' || terrain === 'netherlands') {
        member.status = 'pow';
        capturedCount++;
        this.emit('DAMAGE', `${label}: Bailed out over ${terrain} — captured (POW).`,
          'damage', 'bad', zone, direction,
          [{ table: tableId, rollType: '1d6', rolled: rollValue, result: 'Bailout OK → POW' }], true);
      } else if (terrain === 'france' || terrain === 'belgium') {
        // Roll for evasion
        const evadeRoll: number = yield* this._yieldCombatRoll(
          tableId, 'Evasion Roll',
          `${label} landed in ${terrain} — roll for evasion (6 = returns to England)`, '1d6',
          [
            { roll: '1-5', columns: { result: 'Captured' } },
            { roll: '6', columns: { result: 'Returned to England by Underground' } },
          ],
        );
        if (evadeRoll >= 6) {
          member.status = 'evaded';
          returnedCount++;
          this.emit('DAMAGE', `${label}: Evaded capture! Returned to England by the Underground.`,
            'damage', 'good', zone, direction,
            [{ table: tableId, rollType: '1d6', rolled: evadeRoll, result: 'Evaded' }], true);
        } else {
          member.status = 'pow';
          capturedCount++;
          this.emit('DAMAGE', `${label}: Captured in ${terrain} (POW).`,
            'damage', 'bad', zone, direction,
            [{ table: tableId, rollType: '1d6', rolled: evadeRoll, result: 'Captured' }], true);
        }
      } else if (terrain === 'water') {
        // G-8: radio out → all die
        if (ac.radioOut) {
          member.status = 'kia';
          drownedCount++;
          kiaCount++;
          this.emit('DAMAGE', `${label}: Bailed out over water — radio not operating, drowned.`,
            'damage', 'critical', zone, direction, undefined, true);
        } else {
          const waterRoll: number = yield* this._yieldCombatRoll(
            'G-8', 'Bailout Over Water',
            `${label} bailed out over water — roll for rescue (5-6 = rescued)`, '1d6',
            [
              { roll: '1-4', columns: { result: 'Drowned' } },
              { roll: '5-6', columns: { result: 'Rescued' } },
            ],
          );
          if (waterRoll >= 5) {
            // Per §16.4 / G-10 notes: zones 6-7 rescued → captured
            if (zone >= 6) {
              member.status = 'pow';
              capturedCount++;
              this.emit('DAMAGE', `${label}: Rescued from water — but captured (zone ${zone}).`,
                'damage', 'bad', zone, direction,
                [{ table: 'G-8', rollType: '1d6', rolled: waterRoll, result: 'Rescued → POW' }], true);
            } else {
              member.status = 'evaded';
              returnedCount++;
              this.emit('DAMAGE', `${label}: Rescued from water — returned to England!`,
                'damage', 'good', zone, direction,
                [{ table: 'G-8', rollType: '1d6', rolled: waterRoll, result: 'Rescued' }], true);
            }
          } else {
            member.status = 'kia';
            member.woundSeverity = 'kia';
            drownedCount++;
            kiaCount++;
            this.emit('DAMAGE', `${label}: Drowned after bailing out over water.`,
              'damage', 'critical', zone, direction,
              [{ table: 'G-8', rollType: '1d6', rolled: waterRoll, result: 'Drowned' }], true);
          }
        }
      } else {
        // Unknown terrain — treat as England (safe)
        member.status = 'evaded';
        returnedCount++;
        this.emit('DAMAGE', `${label}: Bailed out safely.`,
          'damage', 'good', zone, direction, undefined, true);
      }
    }

    // ── Summary ──
    const totalKia = kiaCount + drownedCount;
    const summaryParts: string[] = [];
    if (kiaCount > 0) summaryParts.push(`${kiaCount} KIA`);
    if (drownedCount > 0) summaryParts.push(`${drownedCount} drowned`);
    if (capturedCount > 0) summaryParts.push(`${capturedCount} captured`);
    if (returnedCount > 0) summaryParts.push(`${returnedCount} returned to England`);
    this.emit('DAMAGE', `Bailout complete: ${summaryParts.join(', ')}`,
      'damage', returnedCount > 0 ? 'warn' : 'critical', zone, direction, undefined, true);

    // Mark aircraft destroyed
    for (let i = 0; i < 4; i++) ac.engines[i as 0|1|2|3] = 'out';

    // Campaign end check
    const anyReturned = returnedCount > 0;
    if (!anyReturned) {
      this.emit('DAMAGE', 'All crewmen KIA or captured — campaign ended.',
        'damage', 'critical', zone, direction, undefined, true);
    } else {
      this.emit('DAMAGE', `${returnedCount} crewmen returned to England. Campaign may continue with a new plane and replacement crew.`,
        'damage', 'warn', zone, direction, undefined, true);
    }

    // Mark mission as aborted (it's over)
    mission.aborted = true;
  }

  /** Fire extinguisher sequence per B1-1 note (e). Two extinguishers, 1-3 = out, 4-6 = fail.
   *  Returns true if fire was extinguished, false if both extinguishers failed. */
  private *_resolveFireExtinguisher(
    engIdx: number, zone: number, direction: 'outbound' | 'inbound',
  ): Generator<MissionYield, boolean, number | number[] | undefined> {
    const ac = this.state.campaign.aircraft;
    const engLabel = `Engine #${engIdx + 1}`;
    const extRemaining = 2 - (ac.fireExtinguishersUsed || 0);

    if (extRemaining <= 0) {
      this.emit('DAMAGE', `${engLabel} on fire — no fire extinguishers remaining!`, 'damage', 'critical', zone, direction);
      // Per B1-1 note (e): crew bails out on G-6 (controlled bailout)
      this.emit('DAMAGE', 'Engine fire uncontrolled — crew ordered to bail out (G-6 controlled bailout)', 'damage', 'critical', zone, direction, undefined, true);
      yield* this._executeBailout(true);
      return false;
    }

    // First extinguisher
    this.emit('DAMAGE', `${engLabel} on fire — attempting fire extinguisher (${extRemaining} remaining)`, 'damage', 'warn', zone, direction);
    const roll1: number = yield* this._yieldCombatRoll(
      'B1-1', 'Fire Extinguisher',
      `Roll to extinguish ${engLabel} fire (1-3 = out, 4-6 = fail)`, '1d6',
      [
        { roll: '1-3', columns: { result: 'Fire extinguished!' } },
        { roll: '4-6', columns: { result: 'Extinguisher failed' } },
      ],
    );

    ac.fireExtinguishersUsed = (ac.fireExtinguishersUsed || 0) + 1;

    if (roll1 <= 3) {
      ac.engines[engIdx] = 'out'; // fire is out, engine still dead
      this.emit('DAMAGE', `${engLabel}: Fire extinguished!`, 'damage', 'good', zone, direction,
        [{ table: 'B1-1', rollType: '1d6', rolled: roll1, result: 'Fire extinguished', description: 'Fire extinguisher roll' }], true);
      return true;
    }

    this.emit('DAMAGE', `${engLabel}: Extinguisher failed!`, 'damage', 'bad', zone, direction,
      [{ table: 'B1-1', rollType: '1d6', rolled: roll1, result: 'Failed', description: 'Fire extinguisher roll' }]);

    // Second extinguisher?
    const ext2Remaining = 2 - ac.fireExtinguishersUsed;
    if (ext2Remaining <= 0) {
      this.emit('DAMAGE', `Both extinguishers exhausted — ${engLabel} fire continues!`, 'damage', 'critical', zone, direction, undefined, true);
      // Per B1-1 note (e): crew bails out on G-6 (controlled bailout)
      this.emit('DAMAGE', 'Engine fire uncontrolled — crew ordered to bail out (G-6 controlled bailout)', 'damage', 'critical', zone, direction, undefined, true);
      yield* this._executeBailout(true);
      return false;
    }

    this.emit('DAMAGE', `Trying second extinguisher on ${engLabel} (${ext2Remaining} remaining)`, 'damage', 'warn', zone, direction);
    const roll2: number = yield* this._yieldCombatRoll(
      'B1-1', 'Fire Extinguisher (2nd attempt)',
      `Roll to extinguish ${engLabel} fire (1-3 = out, 4-6 = fail)`, '1d6',
      [
        { roll: '1-3', columns: { result: 'Fire extinguished!' } },
        { roll: '4-6', columns: { result: 'Extinguisher failed' } },
      ],
    );

    ac.fireExtinguishersUsed++;

    if (roll2 <= 3) {
      ac.engines[engIdx] = 'out';
      this.emit('DAMAGE', `${engLabel}: Fire extinguished!`, 'damage', 'good', zone, direction,
        [{ table: 'B1-1', rollType: '1d6', rolled: roll2, result: 'Fire extinguished', description: 'Fire extinguisher roll (2nd)' }], true);
      return true;
    }

    this.emit('DAMAGE', `Both extinguishers exhausted — ${engLabel} fire continues!`, 'damage', 'critical', zone, direction,
      [{ table: 'B1-1', rollType: '1d6', rolled: roll2, result: 'Failed', description: 'Fire extinguisher roll (2nd)' }], true);
    // Per B1-1 note (e): crew bails out on G-6 (controlled bailout)
    this.emit('DAMAGE', 'Engine fire uncontrolled — crew ordered to bail out (G-6 controlled bailout)', 'damage', 'critical', zone, direction, undefined, true);
    yield* this._executeBailout(true);
    return false;
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
          if (crew && crew.woundSeverity !== 'kia') {
            let severity: WoundSeverity;
            try { severity = rollCrewWound(rng, tables); } catch { severity = 'light'; }
            crew.woundSeverity = accumulateWound(crew.woundSeverity, severity);
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
        default: {
          const resultLower = (dmg.result ?? '').toLowerCase();
          const descLower = (dmg.description ?? '').toLowerCase();
          if (descLower.includes('tail guns inoperable') || resultLower.includes('tail guns inoperable')) {
            disableGun(this.state.campaign.aircraft.guns, 'Tail');
            this.emit('DAMAGE', `${location}: Tail guns inoperable!`, 'damage', 'bad', zone, direction,
              [{ table: damageTable, rollType: '1d6', rolled: 0, result: dmg.result }], true);
          } else {
            this.emit('DAMAGE', `${location}: ${dmg.description || dmg.result}`, 'damage', 'info', zone, direction,
              [{ table: damageTable, rollType: '1d6', rolled: 0, result: dmg.result }]);
          }
          break;
        }
      }
    }
  }
}
