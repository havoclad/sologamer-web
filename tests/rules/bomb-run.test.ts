import { describe, it, expect, beforeEach } from 'vitest';
import { createRNG } from '../../src/engine/rng.js';
import { TableStore } from '../../src/engine/tables.js';
import { b17Module } from '../../src/games/b17/index.js';
import {
  canTakeEvasiveAction, rollBombRun, rollBombingAccuracy,
  resolveBombRun, resolveTargetOfOpportunity,
} from '../../src/games/b17/rules/bomb-run.js';
import type { AircraftState } from '../../src/games/b17/types.js';

let tables: TableStore;

function defaultAircraft(): AircraftState {
  return {
    engines: ['ok', 'ok', 'ok', 'ok'],
    fuelLeak: false, fuelFire: false, oxygenOut: false, heatingOut: false,
    ballTurretInop: false, bombBayDoorsInop: false, radioOut: false, tailWheelInop: false,
    wingSurfaceDamage: { left: 0, right: 0 },
    controlDamage: { rudder: false, elevator: false, ailerons: false },
    fireExtinguishersUsed: 0, ammo: { Nose: 12, Port_Cheek: 12, Starboard_Cheek: 12, Top_Turret: 16, Ball_Turret: 16, Port_Waist: 12, Starboard_Waist: 12, Radio: 8, Tail: 16 },
  };
}

beforeEach(() => {
  tables = new TableStore();
  tables.loadDirectory(b17Module.tableDirectory);
});

describe('canTakeEvasiveAction', () => {
  it('not allowed when in formation per §15.2a', () => {
    expect(canTakeEvasiveAction(defaultAircraft(), false, 0, true, false)).toBe(false);
  });

  it('allowed when out of formation with no restrictions', () => {
    expect(canTakeEvasiveAction(defaultAircraft(), true, 0, true, false)).toBe(true);
  });

  it('not allowed with 2+ engines out per §15.2b', () => {
    const ac = defaultAircraft();
    ac.engines = ['out', 'out', 'ok', 'ok'];
    expect(canTakeEvasiveAction(ac, true, 0, true, false)).toBe(false);
  });

  it('not allowed with control damage per §15.2c', () => {
    const ac = defaultAircraft();
    ac.controlDamage.rudder = true;
    expect(canTakeEvasiveAction(ac, true, 0, true, false)).toBe(false);
  });

  it('not allowed with 3+ negative landing modifiers per §15.2d', () => {
    expect(canTakeEvasiveAction(defaultAircraft(), true, -3, true, false)).toBe(false);
  });
});

describe('rollBombRun', () => {
  it('returns On or Off', () => {
    const rng = createRNG(42);
    const { result } = rollBombRun(rng, tables, 0);
    expect(['On', 'Off']).toContain(result);
  });

  it('is deterministic', () => {
    const r1 = rollBombRun(createRNG(42), tables, 0);
    const r2 = rollBombRun(createRNG(42), tables, 0);
    expect(r1.result).toBe(r2.result);
  });
});

describe('rollBombingAccuracy', () => {
  it('returns a percentage 0-75', () => {
    const rng = createRNG(42);
    const result = rollBombingAccuracy('On', rng, tables);
    expect(result.accuracyPercent).toBeGreaterThanOrEqual(0);
    expect(result.accuracyPercent).toBeLessThanOrEqual(75);
  });
});

describe('resolveBombRun', () => {
  it('returns no bombs dropped when bombs not aboard', () => {
    const result = resolveBombRun(createRNG(42), tables, 0, false);
    expect(result.bombsDropped).toBe(false);
    expect(result.accuracyPercent).toBe(0);
  });

  it('returns complete result with bombs aboard', () => {
    const result = resolveBombRun(createRNG(42), tables, 0, true);
    expect(result.bombsDropped).toBe(true);
    expect(['On', 'Off']).toContain(result.bombRunResult);
  });
});

describe('resolveTargetOfOpportunity', () => {
  it('always off target', () => {
    const result = resolveTargetOfOpportunity(createRNG(42), tables);
    expect(result.bombRunResult).toBe('Off');
    expect(result.bombsDropped).toBe(true);
  });
});
