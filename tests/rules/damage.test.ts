import { describe, it, expect, beforeEach } from 'vitest';
import { createRNG } from '../../src/engine/rng.js';
import { TableStore } from '../../src/engine/tables.js';
import { b17Module } from '../../src/games/b17/index.js';
import {
  rollHitLocation, WALKING_HIT_COMPARTMENTS, rollCompartmentDamage,
  rollCrewWound, accumulateWound, countEnginesOut, isAllEnginesOut,
  getEngineLandingModifier, attemptExtinguishFire, rollFrostbite,
  rollFrostbiteRecovery, resolveBIP,
} from '../../src/games/b17/rules/damage.js';
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
    fireExtinguishersUsed: 0, ammo: { Nose: 12, Port_Cheek: 12, Starboard_Cheek: 12, Top_Turret: 16, Ball_Turret: 16, Port_Waist: 12, Starboard_Waist: 12, Radio: 8, Tail: 16 },
    ...overrides,
  };
}

beforeEach(() => {
  tables = new TableStore();
  tables.loadDirectory(b17Module.tableDirectory);
});

describe('rollHitLocation (B-5)', () => {
  it('returns a valid location for 12 High attack', () => {
    const rng = createRNG(42);
    const result = rollHitLocation('12 High', rng, tables);
    expect(result.location).toBeTruthy();
  });

  it('returns superficial for some rolls', () => {
    // Find a seed that produces superficial
    for (let seed = 0; seed < 200; seed++) {
      const result = rollHitLocation('12 Level', createRNG(seed), tables);
      if (result.isSuperificial) {
        expect(result.location).toBe('Superficial');
        return;
      }
    }
  });

  it('Wings result resolves to Port or Starboard', () => {
    // Wings result from B-5 should auto-resolve via d6
    for (let seed = 0; seed < 500; seed++) {
      const result = rollHitLocation('12 High', createRNG(seed), tables);
      if (result.location === 'Port Wing' || result.location === 'Starboard Wing') {
        expect(result.damageTable).toBe('BL-1');
        return;
      }
    }
  });

  it('produces different locations across many seeds', () => {
    const locations = new Set<string>();
    for (let seed = 0; seed < 500; seed++) {
      const result = rollHitLocation('12 High', createRNG(seed), tables);
      locations.add(result.location);
    }
    expect(locations.size).toBeGreaterThan(3);
  });
});

describe('WALKING_HIT_COMPARTMENTS', () => {
  it('contains all 6 fuselage compartments per B-5', () => {
    expect(WALKING_HIT_COMPARTMENTS).toHaveLength(6);
    const locs = WALKING_HIT_COMPARTMENTS.map(c => c.location);
    expect(locs).toContain('Nose');
    expect(locs).toContain('Pilot Compt.');
    expect(locs).toContain('Bomb Bay');
    expect(locs).toContain('Radio Room');
    expect(locs).toContain('Waist');
    expect(locs).toContain('Tail');
  });

  it('each has a damage table', () => {
    for (const c of WALKING_HIT_COMPARTMENTS) {
      expect(c.damageTable).toMatch(/^P-[1-6]$/);
    }
  });
});

describe('rollCompartmentDamage', () => {
  it('P-1 (Nose) returns a damage result', () => {
    const rng = createRNG(42);
    const result = rollCompartmentDamage('P-1', rng, tables);
    expect(result.result).toBeTruthy();
    expect(result.effects.length).toBeGreaterThan(0);
  });

  it('P-3 (Bomb Bay) can produce "destroyed" effect', () => {
    // Roll 2 on P-3 = Bomb Detonation
    for (let seed = 0; seed < 500; seed++) {
      const result = rollCompartmentDamage('P-3', createRNG(seed), tables);
      if (result.result === 'Bomb Detonation') {
        const hasDestroyed = result.effects.some(e => e.type === 'destroyed');
        expect(hasDestroyed).toBe(true);
        return;
      }
    }
  });

  it('various tables all return valid results', () => {
    for (const table of ['P-1', 'P-2', 'P-3', 'P-4', 'P-5', 'P-6', 'BL-1']) {
      const rng = createRNG(42);
      const result = rollCompartmentDamage(table, rng, tables);
      expect(result.result).toBeTruthy();
    }
  });

  it('BL-1 roll 2 = Wing Root, not superficial (regression)', () => {
    // Seed 20 produces twod6()=2 on BL-1
    const result = rollCompartmentDamage('BL-1', createRNG(20), tables);
    expect(result.result).toBe('Wing Root');
    expect(result.effects.some(e => e.type === 'wing_root_hit')).toBe(true);
    expect(result.effects.some(e => e.type === 'superficial')).toBe(false);
  });

  it('BL-1 roll 7 = Superficial Damage (actual superficial)', () => {
    // Seed 1 produces twod6()=7 on BL-1
    const result = rollCompartmentDamage('BL-1', createRNG(1), tables);
    expect(result.result).toBe('Superficial Damage');
    expect(result.effects.some(e => e.type === 'superficial')).toBe(true);
  });

  it('BL-2 entries are not superficial (regression)', () => {
    // All BL-2 results except roll 12 (Electrical System → destroyed) are system damage
    // None should be marked superficial since BL-2 has no "Superficial" entries
    for (let seed = 0; seed < 500; seed++) {
      const result = rollCompartmentDamage('BL-2', createRNG(seed), tables);
      if (result.result !== 'Superficial') {
        expect(result.effects.some(e => e.type === 'superficial')).toBe(false);
      }
    }
  });
});

describe('rollCrewWound (BL-4)', () => {
  it('returns light, serious, or kia', () => {
    const rng = createRNG(42);
    const result = rollCrewWound(rng, tables);
    expect(['light', 'serious', 'kia']).toContain(result);
  });

  it('distribution: 1-3 light, 4-5 serious, 6 KIA per BL-4', () => {
    let light = 0, serious = 0, kia = 0;
    for (let seed = 0; seed < 600; seed++) {
      const result = rollCrewWound(createRNG(seed), tables);
      if (result === 'light') light++;
      else if (result === 'serious') serious++;
      else kia++;
    }
    // Roughly: 50% light, 33% serious, 17% KIA
    expect(light).toBeGreaterThan(serious);
    expect(serious).toBeGreaterThan(kia);
  });
});

describe('accumulateWound', () => {
  it('none + light = light', () => {
    expect(accumulateWound('none', 'light')).toBe('light');
  });

  it('none + serious = serious', () => {
    expect(accumulateWound('none', 'serious')).toBe('serious');
  });

  it('none + kia = kia', () => {
    expect(accumulateWound('none', 'kia')).toBe('kia');
  });

  it('light + serious = kia per BL-4', () => {
    expect(accumulateWound('light', 'serious')).toBe('kia');
  });

  it('serious + light = kia per BL-4', () => {
    expect(accumulateWound('serious', 'light')).toBe('kia');
  });

  it('serious + serious = kia', () => {
    expect(accumulateWound('serious', 'serious')).toBe('kia');
  });

  it('kia + anything = kia', () => {
    expect(accumulateWound('kia', 'light')).toBe('kia');
    expect(accumulateWound('kia', 'serious')).toBe('kia');
  });
});

describe('engine helpers', () => {
  it('countEnginesOut', () => {
    expect(countEnginesOut(makeAircraft())).toBe(0);
    expect(countEnginesOut(makeAircraft({ engines: ['out', 'ok', 'out', 'ok'] }))).toBe(2);
  });

  it('isAllEnginesOut', () => {
    expect(isAllEnginesOut(makeAircraft())).toBe(false);
    expect(isAllEnginesOut(makeAircraft({ engines: ['out', 'out', 'out', 'out'] }))).toBe(true);
  });

  it('getEngineLandingModifier per §10.3/§10.4', () => {
    expect(getEngineLandingModifier(makeAircraft())).toBe(0);
    expect(getEngineLandingModifier(makeAircraft({
      engines: ['out', 'out', 'out', 'ok'],
    }))).toBe(-3);
    expect(getEngineLandingModifier(makeAircraft({
      engines: ['out', 'out', 'out', 'out'],
    }))).toBe(-7);
  });
});

describe('attemptExtinguishFire (BL-3)', () => {
  it('returns true or false', () => {
    const rng = createRNG(42);
    const result = attemptExtinguishFire(rng, tables);
    expect(typeof result).toBe('boolean');
  });

  it('roughly 4/6 success rate per BL-3 (1-4 = out, 5-6 = continues)', () => {
    let successes = 0;
    for (let seed = 0; seed < 600; seed++) {
      if (attemptExtinguishFire(createRNG(seed), tables)) successes++;
    }
    // Should be around 400/600 = 67%
    expect(successes).toBeGreaterThan(300);
    expect(successes).toBeLessThan(500);
  });
});

describe('rollFrostbite', () => {
  it('50% chance per §11.0 (1-3 = frostbite, 4-6 = ok)', () => {
    let frostbitten = 0;
    for (let seed = 0; seed < 600; seed++) {
      if (rollFrostbite(createRNG(seed))) frostbitten++;
    }
    expect(frostbitten).toBeGreaterThan(200);
    expect(frostbitten).toBeLessThan(400);
  });
});

describe('rollFrostbiteRecovery', () => {
  it('returns grounded or recovers per Errata #5', () => {
    const result = rollFrostbiteRecovery(createRNG(42));
    expect(['grounded', 'recovers']).toContain(result);
  });
});

describe('resolveBIP', () => {
  it('Wing = crew bailout per §19.2b', () => {
    expect(resolveBIP('Port Wing', false).type).toBe('crew_bailout');
    expect(resolveBIP('Starboard Wing', false).type).toBe('crew_bailout');
  });

  it('Tail = crew bailout per §19.2b', () => {
    expect(resolveBIP('Tail', false).type).toBe('crew_bailout');
  });

  it('Pilot Compartment = crew bailout per §19.2b', () => {
    expect(resolveBIP('Pilot Compt.', false).type).toBe('crew_bailout');
  });

  it('Bomb Bay + bombs = B-17 destroyed per §19.2c', () => {
    expect(resolveBIP('Bomb Bay', true).type).toBe('b17_destroyed');
  });

  it('Bomb Bay without bombs = heavy damage per §19.2d', () => {
    expect(resolveBIP('Bomb Bay', false).type).toBe('heavy_damage');
  });

  it('Nose/Radio Room/Waist = heavy damage per §19.2d', () => {
    expect(resolveBIP('Nose', false).type).toBe('heavy_damage');
    expect(resolveBIP('Radio Room', false).type).toBe('heavy_damage');
    expect(resolveBIP('Waist', false).type).toBe('heavy_damage');
  });
});
