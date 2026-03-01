import { describe, it, expect, beforeEach } from 'vitest';
import { createRNG, type RNG } from '../../src/engine/rng.js';
import { TableStore } from '../../src/engine/tables.js';
import { b17Module } from '../../src/games/b17/index.js';
import { initializeGuns } from '../../src/games/b17/rules/guns.js';
import { createCrewMember } from '../../src/games/b17/rules/crew.js';
import type { B17GameState, AircraftState, MissionState, CrewMember, AmmoState } from '../../src/games/b17/types.js';
import type { Fighter } from '../../src/games/b17/rules/fighter-encounters.js';
import type { GeneratorContext } from '../../src/web/generators/generator-context.js';
import type { MissionYield, GameEvent } from '../../src/web/types.js';
import {
  combatView,
  playerRemoveFighters,
  resolveGunFire,
  resolveCombatRounds,
} from '../../src/web/generators/combat-generators.js';

// ─── Helpers ───

function createDefaultAircraft(): AircraftState {
  return {
    engines: ['ok', 'ok', 'ok', 'ok'],
    fuelLeak: false, fuelFire: false, oxygenOut: false, heatingOut: false,
    ballTurretInop: false, bombBayDoorsInop: false, radioOut: false, tailWheelInop: false,
    wingSurfaceDamage: { left: 0, right: 0 },
    controlDamage: { rudder: false, elevator: false, ailerons: false },
    fireExtinguishersUsed: 0,
    guns: initializeGuns(),
    ammo: { Nose: 12, Port_Cheek: 12, Starboard_Cheek: 12, Top_Turret: 16, Ball_Turret: 16, Port_Waist: 12, Starboard_Waist: 12, Radio: 8, Tail: 16 },
    navigatorEquipInop: false, bombControlsInop: false, autopilotInop: false,
    tailWheelDamaged: false, brakesOut: false, landingGearInop: false,
    ballTurretTrapped: false, portFlapInop: false, starboardFlapInop: false,
    portAileronInop: false, starboardAileronInop: false,
    portElevatorInop: false, starboardElevatorInop: false,
    portWingRootHits: 0, starboardWingRootHits: 0, superficialHits: 0,
  };
}

function createDefaultCrew(): CrewMember[] {
  const positions = [
    'pilot', 'copilot', 'navigator', 'bombardier',
    'engineer', 'radioman', 'ball_turret', 'left_waist', 'right_waist', 'tail_gunner',
  ] as const;
  return positions.map((pos, i) => createCrewMember(`crew-${i}`, `Crew ${pos}`, pos));
}

function createDefaultMission(): MissionState {
  return {
    missionNumber: 1, target: 'Bremen', zone: 4, direction: 'outbound',
    formation: 'lead', squadron: 'lead', weather: 'clear',
    outOfFormation: false, altitude: 20000,
    bombsAboard: true, bombsDropped: false, aborted: false,
    evasiveAction: false, landingModifiers: 0, bombRunModifier: 0,
  };
}

function createMockCtx(rng?: RNG, tables?: TableStore): GeneratorContext & { emitCalls: any[][] } {
  const emitCalls: any[][] = [];
  const _rng = rng ?? createRNG(42);
  const _tables = tables ?? new TableStore();
  if (!tables) _tables.loadDirectory(b17Module.tableDirectory);
  let eventBuffer: GameEvent[] = [];
  let pendingRollId = 0;
  return {
    rng: _rng, tables: _tables,
    state: {
      campaign: {
        missionsCompleted: 0, missionsTotal: 25, planeName: 'Memphis Belle',
        crew: createDefaultCrew(), aircraft: createDefaultAircraft(),
      },
      mission: createDefaultMission(),
    },
    emit(...args: any[]) {
      emitCalls.push(args);
      const event = { id: emitCalls.length, phase: args[0], message: args[1], category: args[2], severity: args[3] } as GameEvent;
      eventBuffer.push(event);
      return event;
    },
    get eventBuffer() { return eventBuffer; },
    set eventBuffer(v) { eventBuffer = v; },
    get pendingRollId() { return pendingRollId; },
    set pendingRollId(v) { pendingRollId = v; },
    createFixedRng(value: number): RNG {
      let used = false;
      const fallback = _rng;
      return {
        next() { return fallback.next(); },
        int(min: number, max: number) { if (!used) { used = true; return value; } return fallback.int(min, max); },
        roll(count: number, sides: number) { if (!used) { used = true; return value; } return fallback.roll(count, sides); },
        d6() { if (!used) { used = true; return value; } return fallback.d6(); },
        twod6() { if (!used) { used = true; return value; } return fallback.twod6(); },
        d6d6() { if (!used) { used = true; return value; } return fallback.d6d6(); },
        percentile() { return fallback.percentile(); },
        getState() { return fallback.getState(); },
        setState(s) { fallback.setState(s); },
      };
    },
    emitCalls,
  };
}

function createFighter(id: number, type: string, position: string): Fighter {
  return {
    id, type, position,
    attacksMade: 0, scoredHit: false,
    damage: [],
  };
}

function driveGenerator<T>(
  gen: Generator<MissionYield, T, number | number[] | undefined>,
  rolls: (number | number[])[],
): { yields: MissionYield[]; result: T } {
  const yields: MissionYield[] = [];
  let rollIdx = 0;
  let step = gen.next();
  while (!step.done) {
    yields.push(step.value);
    const rollValue = rollIdx < rolls.length ? rolls[rollIdx++] : undefined;
    step = gen.next(rollValue as any);
  }
  return { yields, result: step.value };
}

// ─── Tests ───

describe('combatView', () => {
  it('maps fighters to CombatViewState', () => {
    const fighters = [
      createFighter(1, 'Me109', '12 High'),
      createFighter(2, 'FW190', '6 Level'),
    ];
    const view = combatView(fighters);
    expect(view.fighters).toHaveLength(2);
    expect(view.fighters[0]).toEqual({ id: 1, type: 'Me109', position: '12 High' });
    expect(view.fighters[1]).toEqual({ id: 2, type: 'FW190', position: '6 Level' });
  });

  it('returns empty array for no fighters', () => {
    const view = combatView([]);
    expect(view.fighters).toEqual([]);
  });
});

describe('playerRemoveFighters', () => {
  let ctx: ReturnType<typeof createMockCtx>;

  beforeEach(() => {
    ctx = createMockCtx();
  });

  it('auto-removes all when count >= removable', () => {
    const fighters = [
      createFighter(1, 'Me109', '12 High'),
      createFighter(2, 'Me109', '6 Level'),
    ];
    const gen = playerRemoveFighters(ctx, fighters, 3, 4, 'full', 4, 'outbound');
    const { result } = driveGenerator(gen, []);
    // All removable fighters are removed
    expect(result.length).toBe(0);
  });

  it('skips Vertical Dive fighters (not removable by cover)', () => {
    const fighters = [
      createFighter(1, 'Me109', '12 High'),
      createFighter(2, 'FW190', 'Vertical Dive'),
    ];
    const gen = playerRemoveFighters(ctx, fighters, 1, 4, 'full', 4, 'outbound');
    const { result } = driveGenerator(gen, []);
    // Vertical Dive fighter remains; the 12 High one is removed
    expect(result.length).toBe(1);
    expect(result[0].position).toBe('Vertical Dive');
  });

  it('yields a choice when player must pick', () => {
    const fighters = [
      createFighter(1, 'Me109', '12 High'),
      createFighter(2, 'Me109', '6 Level'),
      createFighter(3, 'FW190', '1:30 High'),
    ];
    const gen = playerRemoveFighters(ctx, fighters, 1, 4, 'partial', 4, 'outbound');
    const step = gen.next();
    expect(step.done).toBe(false);
    expect(step.value.type).toBe('choice');
    // Send selection of fighter ID 2
    const result = gen.next([2] as any);
    expect(result.done).toBe(true);
    expect(result.value).toHaveLength(2);
    expect(result.value.some((f: Fighter) => f.id === 2)).toBe(false);
  });

  it('returns all fighters if none eligible for removal', () => {
    const fighters = [
      createFighter(1, 'FW190', 'Vertical Dive'),
      createFighter(2, 'Me109', 'Vertical Dive'),
    ];
    const gen = playerRemoveFighters(ctx, fighters, 2, 4, 'full', 4, 'outbound');
    const { result } = driveGenerator(gen, []);
    expect(result.length).toBe(2);
  });
});

describe('resolveGunFire', () => {
  let ctx: ReturnType<typeof createMockCtx>;

  beforeEach(() => {
    ctx = createMockCtx();
  });

  it('deducts ammo when gun fires', () => {
    const fighter = createFighter(1, 'Me109', '12 High');
    const initialAmmo = ctx.state.campaign.aircraft.guns.find(g => g.id === 'Tail')!.ammo;
    const gen = resolveGunFire(
      ctx, 'Tail', fighter, 5, 'tail_gunner', createDefaultMission(),
      4, 'outbound', () => 0, () => {},
    );
    driveGenerator(gen, [1]); // miss
    const finalAmmo = ctx.state.campaign.aircraft.guns.find(g => g.id === 'Tail')!.ammo;
    expect(finalAmmo).toBe(initialAmmo - 1);
  });

  it('records a kill on hit + destroyed roll', () => {
    const fighter = createFighter(1, 'Me109', '12 High');
    let destroyed = 0;
    const gen = resolveGunFire(
      ctx, 'Tail', fighter, 1, 'tail_gunner', createDefaultMission(),
      4, 'outbound', () => destroyed, (v) => { destroyed = v; },
    );
    // Roll 6 for hit (always hits), then roll 6 for destroyed
    driveGenerator(gen, [6, 6]);
    expect(destroyed).toBe(1);
    expect(fighter.damage).toContain('Destroyed');
    const tailGunner = ctx.state.campaign.crew.find(c => c.position === 'tail_gunner');
    expect(tailGunner!.kills).toBe(1);
  });

  it('does nothing if fighter is already destroyed', () => {
    const fighter = createFighter(1, 'Me109', '12 High');
    fighter.damage.push('Destroyed');
    const gen = resolveGunFire(
      ctx, 'Tail', fighter, 5, 'tail_gunner', createDefaultMission(),
      4, 'outbound', () => 0, () => {},
    );
    const { yields } = driveGenerator(gen, []);
    expect(yields.length).toBe(0); // no rolls needed
  });

  it('does nothing if crew member not found', () => {
    const fighter = createFighter(1, 'Me109', '12 High');
    // Remove all crew
    ctx.state.campaign.crew = [];
    const gen = resolveGunFire(
      ctx, 'Tail', fighter, 5, 'tail_gunner', createDefaultMission(),
      4, 'outbound', () => 0, () => {},
    );
    const { yields } = driveGenerator(gen, []);
    expect(yields.length).toBe(0);
  });
});

describe('resolveCombatRounds', () => {
  let ctx: ReturnType<typeof createMockCtx>;
  const noopBailout = function* () {} as any;

  beforeEach(() => {
    ctx = createMockCtx();
  });

  it('completes when no fighters present', () => {
    const gen = resolveCombatRounds(
      ctx, [], [], createDefaultMission(), 4, 'outbound',
      () => 0, () => {}, noopBailout,
    );
    const { result } = driveGenerator(gen, []);
    expect(result.destroyed).toBe(false);
  });

  it('yields an allocation choice when fighters attack', () => {
    const fighters = [createFighter(1, 'Me109', '12 High')];
    const gen = resolveCombatRounds(
      ctx, [...fighters], fighters, createDefaultMission(), 4, 'outbound',
      () => 0, () => {}, noopBailout,
    );
    const step = gen.next();
    expect(step.done).toBe(false);
    // Should be a choice for gun allocation
    expect(step.value.type).toBe('choice');
  });

  it('reports destroyed when 4+ engines out', () => {
    // Set 3 engines out already, then combat should detect all 4 after damage
    ctx.state.campaign.aircraft.engines = ['out', 'out', 'out', 'out'];
    const fighters = [createFighter(1, 'Me109', '12 High')];
    const gen = resolveCombatRounds(
      ctx, [...fighters], fighters, createDefaultMission(), 4, 'outbound',
      () => 0, () => {}, noopBailout,
    );
    // Provide enough rolls to get through allocation (hold fire) + German offensive fire
    const rolls: (number | number[])[] = [
      [-1], // hold fire (allocation response)
      1,    // German offensive fire roll (miss)
    ];
    const { result } = driveGenerator(gen, rolls);
    // Should return destroyed since we set all 4 engines out
    expect(result.destroyed).toBe(true);
  });
});
