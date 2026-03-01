/**
 * Shared test helpers for web generator tests.
 *
 * Provides factory functions for creating mock GeneratorContext, default game
 * objects, and a generic generator driver.
 */

import { createRNG, type RNG } from '../../src/engine/rng.js';
import { TableStore } from '../../src/engine/tables.js';
import { b17Module } from '../../src/games/b17/index.js';
import { initializeGuns } from '../../src/games/b17/rules/guns.js';
import { createCrewMember } from '../../src/games/b17/rules/crew.js';
import type { AircraftState, MissionState, CrewMember } from '../../src/games/b17/types.js';
import type { GeneratorContext } from '../../src/web/generators/generator-context.js';
import type { MissionYield, GameEvent } from '../../src/web/types.js';

export function createDefaultAircraft(): AircraftState {
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

export function createDefaultCrew(): CrewMember[] {
  const positions = [
    'pilot', 'copilot', 'navigator', 'bombardier',
    'engineer', 'radioman', 'ball_turret', 'left_waist', 'right_waist', 'tail_gunner',
  ] as const;
  return positions.map((pos, i) => createCrewMember(`crew-${i}`, `Crew ${pos}`, pos));
}

export function createDefaultMission(): MissionState {
  return {
    missionNumber: 1, target: 'Bremen', zone: 4, direction: 'outbound',
    formation: 'lead', squadron: 'lead', weather: 'clear',
    outOfFormation: false, altitude: 20000,
    bombsAboard: true, bombsDropped: false, aborted: false,
    evasiveAction: false, landingModifiers: 0, landingModifierReasons: [], bombRunModifier: 0, bombRunModifierReasons: [],
  };
}

export function createMockCtx(rng?: RNG, tables?: TableStore): GeneratorContext & { emitCalls: any[][] } {
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

export function driveGenerator<T>(
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
