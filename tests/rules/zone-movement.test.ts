import { describe, it, expect, beforeEach } from 'vitest';
import { createRNG } from '../../src/engine/rng.js';
import { TableStore } from '../../src/engine/tables.js';
import { b17Module } from '../../src/games/b17/index.js';
import {
  rollFighterCover, hasFighterCover, enginesOut, turnsInZone,
  nextZone, mustBeOutOfFormation, getFighterWaveModifier, mustAbort,
  isSubjectToLightFlak,
} from '../../src/games/b17/rules/zone-movement.js';
import type { AircraftState } from '../../src/games/b17/types.js';

let tables: TableStore;

function makeAircraft(overrides: Partial<AircraftState> = {}): AircraftState {
  return {
    engines: ['ok', 'ok', 'ok', 'ok'],
    fuelLeak: false, fuelFire: false,
    oxygenOut: false, heatingOut: false,
    ballTurretInop: false, bombBayDoorsInop: false,
    radioOut: false, tailWheelInop: false,
    wingSurfaceDamage: { left: 0, right: 0 },
    controlDamage: { rudder: false, elevator: false, ailerons: false },
    fireExtinguishersUsed: 0,
    ...overrides,
  };
}

beforeEach(() => {
  tables = new TableStore();
  tables.loadDirectory(b17Module.tableDirectory);
});

describe('rollFighterCover', () => {
  it('returns Poor, Fair, or Good', () => {
    const rng = createRNG(42);
    const result = rollFighterCover(rng, tables);
    expect(['Poor', 'Fair', 'Good']).toContain(result);
  });

  it('is deterministic', () => {
    expect(rollFighterCover(createRNG(42), tables))
      .toBe(rollFighterCover(createRNG(42), tables));
  });
});

describe('hasFighterCover', () => {
  it('zones 2-4 have cover per §6.2', () => {
    expect(hasFighterCover(1)).toBe(false);
    expect(hasFighterCover(2)).toBe(true);
    expect(hasFighterCover(3)).toBe(true);
    expect(hasFighterCover(4)).toBe(true);
    expect(hasFighterCover(5)).toBe(false);
    expect(hasFighterCover(8)).toBe(false);
  });
});

describe('enginesOut', () => {
  it('counts out engines', () => {
    expect(enginesOut(makeAircraft())).toBe(0);
    expect(enginesOut(makeAircraft({ engines: ['out', 'ok', 'ok', 'ok'] }))).toBe(1);
    expect(enginesOut(makeAircraft({ engines: ['out', 'out', 'ok', 'ok'] }))).toBe(2);
    expect(enginesOut(makeAircraft({ engines: ['out', 'out', 'out', 'out'] }))).toBe(4);
  });

  it('does not count fire/runaway as out', () => {
    expect(enginesOut(makeAircraft({ engines: ['fire', 'runaway', 'ok', 'ok'] }))).toBe(0);
  });
});

describe('turnsInZone', () => {
  it('1 turn normally', () => {
    expect(turnsInZone(makeAircraft(), true)).toBe(1);
  });

  it('2 turns with 1 engine out + bombs per §10.1', () => {
    const ac = makeAircraft({ engines: ['out', 'ok', 'ok', 'ok'] });
    expect(turnsInZone(ac, true)).toBe(2);
  });

  it('1 turn with 1 engine out, no bombs (jettisoned)', () => {
    const ac = makeAircraft({ engines: ['out', 'ok', 'ok', 'ok'] });
    expect(turnsInZone(ac, false)).toBe(1);
  });

  it('2 turns with 2+ engines out per §10.2', () => {
    const ac = makeAircraft({ engines: ['out', 'out', 'ok', 'ok'] });
    expect(turnsInZone(ac, false)).toBe(2);
  });
});

describe('nextZone', () => {
  it('increases outbound', () => {
    expect(nextZone(3, 'outbound')).toBe(4);
  });
  it('decreases inbound', () => {
    expect(nextZone(5, 'inbound')).toBe(4);
  });
});

describe('mustBeOutOfFormation', () => {
  it('normal aircraft stays in formation', () => {
    expect(mustBeOutOfFormation(makeAircraft(), false, false, false, false)).toBe(false);
  });

  it('2+ engines out → always out per §10.2', () => {
    const ac = makeAircraft({ engines: ['out', 'out', 'ok', 'ok'] });
    expect(mustBeOutOfFormation(ac, false, false, false, false)).toBe(true);
  });

  it('1 engine out + bombs → out per §10.1', () => {
    const ac = makeAircraft({ engines: ['out', 'ok', 'ok', 'ok'] });
    expect(mustBeOutOfFormation(ac, true, false, false, false)).toBe(true);
  });

  it('oxygen out + dropped to 10k → out per §12.1', () => {
    expect(mustBeOutOfFormation(makeAircraft(), false, true, false, true)).toBe(true);
  });
});

describe('getFighterWaveModifier', () => {
  it('combines gazetteer + squadron modifiers', () => {
    const zoneInfo = { b1Modifier: -2, over: ['water'] };
    expect(getFighterWaveModifier(zoneInfo, -1, false, 0)).toBe(-3);
  });

  it('out of formation zeroes squadron modifier per §13.1b', () => {
    const zoneInfo = { b1Modifier: -2, over: ['water'] };
    expect(getFighterWaveModifier(zoneInfo, -1, true, 0)).toBe(-2);
  });

  it('includes weather modifier', () => {
    expect(getFighterWaveModifier(null, 0, false, -1)).toBe(-1);
  });
});

describe('mustAbort', () => {
  it('does not abort normally', () => {
    expect(mustAbort(makeAircraft(), false, false, false)).toBe(false);
  });

  it('2+ engines out → mandatory abort per §8.0h', () => {
    const ac = makeAircraft({ engines: ['out', 'out', 'ok', 'ok'] });
    expect(mustAbort(ac, false, false, false)).toBe(true);
  });

  it('navigator down + out of formation → abort per §8.0d', () => {
    expect(mustAbort(makeAircraft(), true, true, false)).toBe(true);
  });

  it('navigator down but in formation → no abort', () => {
    expect(mustAbort(makeAircraft(), false, true, false)).toBe(false);
  });

  it('both pilots down + out of formation → abort per §8.0e', () => {
    expect(mustAbort(makeAircraft(), true, false, true)).toBe(true);
  });
});

describe('isSubjectToLightFlak', () => {
  it('not subject when in formation', () => {
    expect(isSubjectToLightFlak(false, 10000, ['France'])).toBe(false);
  });

  it('not subject at 20000 ft', () => {
    expect(isSubjectToLightFlak(true, 20000, ['France'])).toBe(false);
  });

  it('subject when out of formation + 10k + over land per §13.1d', () => {
    expect(isSubjectToLightFlak(true, 10000, ['France'])).toBe(true);
    expect(isSubjectToLightFlak(true, 10000, ['Germany'])).toBe(true);
  });

  it('not subject over water', () => {
    expect(isSubjectToLightFlak(true, 10000, ['water'])).toBe(false);
  });

  it('not subject over England', () => {
    expect(isSubjectToLightFlak(true, 10000, ['England'])).toBe(false);
  });
});
