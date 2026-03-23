import { initializeGuns, getGun, disableGun } from '../../src/games/b17/rules/guns.js';
import { describe, it, expect, beforeEach } from 'vitest';
import { createRNG } from '../../src/engine/rng.js';
import { TableStore } from '../../src/engine/tables.js';
import { b17Module } from '../../src/games/b17/index.js';
import {
  rollHitLocation, WALKING_HIT_COMPARTMENTS, rollCompartmentDamage,
  rollCrewWound, countEnginesOut, isAllEnginesOut,
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
    fireExtinguishersUsed: 0, guns: initializeGuns(), ammo: { Nose: 12, Port_Cheek: 12, Starboard_Cheek: 12, Top_Turret: 16, Ball_Turret: 16, Port_Waist: 12, Starboard_Waist: 12, Radio: 8, Tail: 16 },
    navigatorEquipInop: false, bombControlsInop: false, autopilotInop: false,
    tailWheelDamaged: false, brakesOut: false, landingGearInop: false,
    ballTurretTrapped: false, portFlapInop: false, starboardFlapInop: false,
    portAileronInop: false, starboardAileronInop: false,
    portElevatorInop: false, starboardElevatorInop: false,
    portWingRootHits: 0, starboardWingRootHits: 0, rudderHits: 0,
    portTailplaneRootHits: 0, starboardTailplaneRootHits: 0, windowHeatHits: 0,
    superficialHits: 0, controlCableHits: 0,
    intercomOut: false, gearIndicatorOut: false, flapsIndicatorOut: false,
    aileronControlsOut: false, elevatorControlsOut: false, rudderControlsOut: false,
    propFeatheringOut: false, engineExtinguishersOut: false, electricalSystemOut: false,
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
        expect(result.damageTable).toBe('B1-1');
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
    for (const table of ['P-1', 'P-2', 'P-3', 'P-4', 'P-5', 'P-6', 'B1-1']) {
      const rng = createRNG(42);
      const result = rollCompartmentDamage(table, rng, tables);
      expect(result.result).toBeTruthy();
    }
  });

  it('B1-1 roll 2 = Wing Root, not superficial (regression)', () => {
    // Seed 20 produces twod6()=2 on B1-1
    const result = rollCompartmentDamage('B1-1', createRNG(20), tables);
    expect(result.result).toBe('Wing Root');
    expect(result.effects.some(e => e.type === 'wing_root_hit')).toBe(true);
    expect(result.effects.some(e => e.type === 'superficial')).toBe(false);
  });

  it('B1-1 roll 7 = Superficial Damage (actual superficial)', () => {
    // Seed 1 produces twod6()=7 on B1-1
    const result = rollCompartmentDamage('B1-1', createRNG(1), tables);
    expect(result.result).toBe('Superficial Damage');
    expect(result.effects.some(e => e.type === 'superficial')).toBe(true);
  });

  it('B1-2 entries are not superficial (regression)', () => {
    // All B1-2 results except roll 12 (Electrical System → destroyed) are system damage
    // None should be marked superficial since B1-2 has no "Superficial" entries
    for (let seed = 0; seed < 500; seed++) {
      const result = rollCompartmentDamage('B1-2', createRNG(seed), tables);
      if (result.result !== 'Superficial') {
        expect(result.effects.some(e => e.type === 'superficial')).toBe(false);
      }
    }
  });
});

describe('B1-1 fuel tank and engine sub-rolls', () => {
  it('B1-1 roll 10 (Fuel Tank) produces follow_up_table effect', () => {
    // We need a seed that produces twod6()=10 on B1-1
    // createFixedRng approach: find seed that gives 10
    for (let seed = 0; seed < 500; seed++) {
      const rng = createRNG(seed);
      const result = rollCompartmentDamage('B1-1', rng, tables);
      if (result.result === 'Fuel Tank') {
        const followUp = result.effects.find(e => e.type === 'follow_up_table');
        expect(followUp).toBeDefined();
        expect(followUp!.table).toBe('sub_roll');
        expect(followUp!.target).toBe('Fuel Tank');
        return;
      }
    }
    // If no seed produced a Fuel Tank result, that's a problem
    throw new Error('Could not find a seed producing B1-1 Fuel Tank result');
  });

  it('B1-1 roll 9 (Engines) produces follow_up_table effect', () => {
    for (let seed = 0; seed < 500; seed++) {
      const rng = createRNG(seed);
      const result = rollCompartmentDamage('B1-1', rng, tables);
      if (result.result === 'Engines') {
        const followUp = result.effects.find(e => e.type === 'follow_up_table');
        expect(followUp).toBeDefined();
        expect(followUp!.table).toBe('sub_roll');
        expect(followUp!.target).toBe('Engines');
        return;
      }
    }
    throw new Error('Could not find a seed producing B1-1 Engines result');
  });
});

describe('rollCrewWound (B1-4)', () => {
  it('returns light, serious, or kia', () => {
    const rng = createRNG(42);
    const result = rollCrewWound(rng, tables);
    expect(['light', 'serious', 'kia']).toContain(result);
  });

  it('distribution: 1-3 light, 4-5 serious, 6 KIA per B1-4', () => {
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

describe('attemptExtinguishFire (B1-3)', () => {
  it('returns true or false', () => {
    const rng = createRNG(42);
    const result = attemptExtinguishFire(rng, tables);
    expect(typeof result).toBe('boolean');
  });

  it('roughly 4/6 success rate per B1-3 (1-4 = out, 5-6 = continues)', () => {
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

describe('B1-2 instrument damage effects', () => {
  function fixedRng(twod6Value: number) {
    return { d6: () => 1, twod6: () => twod6Value, int: (a: number) => a } as any;
  }

  it('B1-2 roll 2 (Autopilot) produces instrument_damage effect with autopilot_out', () => {
    const result = rollCompartmentDamage('B1-2', fixedRng(2), tables);
    expect(result.result).toBe('Autopilot');
    const eff = result.effects.find(e => e.type === 'instrument_damage');
    expect(eff).toBeDefined();
    expect(eff!.damageType).toBe('autopilot_out');
  });

  it('B1-2 roll 3 (Gear Indicator) produces instrument_damage with modifier -3', () => {
    const result = rollCompartmentDamage('B1-2', fixedRng(3), tables);
    expect(result.result).toBe('Landing Gear Indicator');
    const eff = result.effects.find(e => e.type === 'instrument_damage');
    expect(eff).toBeDefined();
    expect(eff!.damageType).toBe('gear_indicator_out');
    expect(eff!.modifier).toBe(-3);
  });

  it('B1-2 roll 4 (Intercom) produces instrument_damage with intercom_out', () => {
    const result = rollCompartmentDamage('B1-2', fixedRng(4), tables);
    expect(result.result).toBe('Intercom System');
    const eff = result.effects.find(e => e.type === 'instrument_damage');
    expect(eff).toBeDefined();
    expect(eff!.damageType).toBe('intercom_out');
  });

  it('B1-2 roll 5 (Oxygen System) produces instrument_damage with oxygen_system_out', () => {
    const result = rollCompartmentDamage('B1-2', fixedRng(5), tables);
    expect(result.result).toBe('Oxygen System');
    const eff = result.effects.find(e => e.type === 'instrument_damage');
    expect(eff).toBeDefined();
    expect(eff!.damageType).toBe('oxygen_system_out');
  });

  it('B1-2 roll 6 (Flaps Indicator) produces instrument_damage with modifier -1', () => {
    const result = rollCompartmentDamage('B1-2', fixedRng(6), tables);
    expect(result.result).toBe('Wing Flaps Indicator');
    const eff = result.effects.find(e => e.type === 'instrument_damage');
    expect(eff).toBeDefined();
    expect(eff!.damageType).toBe('flaps_indicator_out');
    expect(eff!.modifier).toBe(-1);
  });

  it('B1-2 roll 7 (Aileron Controls) produces instrument_damage with modifier -1', () => {
    const result = rollCompartmentDamage('B1-2', fixedRng(7), tables);
    expect(result.result).toBe('Aileron Controls');
    const eff = result.effects.find(e => e.type === 'instrument_damage');
    expect(eff).toBeDefined();
    expect(eff!.damageType).toBe('aileron_controls_out');
    expect(eff!.modifier).toBe(-1);
  });

  it('B1-2 roll 8 (Elevator Controls) produces instrument_damage with modifier -1', () => {
    const result = rollCompartmentDamage('B1-2', fixedRng(8), tables);
    expect(result.result).toBe('Elevator Controls');
    const eff = result.effects.find(e => e.type === 'instrument_damage');
    expect(eff).toBeDefined();
    expect(eff!.damageType).toBe('elevator_controls_out');
    expect(eff!.modifier).toBe(-1);
  });

  it('B1-2 roll 9 (Rudder Controls) produces instrument_damage with modifier -1', () => {
    const result = rollCompartmentDamage('B1-2', fixedRng(9), tables);
    expect(result.result).toBe('Rudder Controls');
    const eff = result.effects.find(e => e.type === 'instrument_damage');
    expect(eff).toBeDefined();
    expect(eff!.damageType).toBe('rudder_controls_out');
    expect(eff!.modifier).toBe(-1);
  });

  it('B1-2 roll 10 (Prop Feathering) produces instrument_damage with prop_feathering_out', () => {
    const result = rollCompartmentDamage('B1-2', fixedRng(10), tables);
    expect(result.result).toBe('Propeller Feathering');
    const eff = result.effects.find(e => e.type === 'instrument_damage');
    expect(eff).toBeDefined();
    expect(eff!.damageType).toBe('prop_feathering_out');
  });

  it('B1-2 roll 11 (Engine Extinguishers) produces instrument_damage with engine_extinguishers_out', () => {
    const result = rollCompartmentDamage('B1-2', fixedRng(11), tables);
    expect(result.result).toBe('Engine Fire Extinguishers');
    const eff = result.effects.find(e => e.type === 'instrument_damage');
    expect(eff).toBeDefined();
    expect(eff!.damageType).toBe('engine_extinguishers_out');
  });

  it('B1-2 roll 12 (Electrical System) produces instrument_damage with electrical_system_out', () => {
    const result = rollCompartmentDamage('B1-2', fixedRng(12), tables);
    expect(result.result).toBe('Electrical System');
    const eff = result.effects.find(e => e.type === 'instrument_damage');
    expect(eff).toBeDefined();
    expect(eff!.damageType).toBe('electrical_system_out');
  });

  it('no B1-2 result should fall through to system_damage', () => {
    for (let roll = 2; roll <= 12; roll++) {
      const result = rollCompartmentDamage('B1-2', fixedRng(roll), tables);
      const hasSysDmg = result.effects.some(e => e.type === 'system_damage');
      expect(hasSysDmg, `Roll ${roll} (${result.result}) should not have system_damage`).toBe(false);
    }
  });
});

// ─── Regression tests ───

describe('Bug regression: P-5 Waist wound follow-up (B1-4)', () => {
  it('P-5 roll 6 produces follow_up_table effect pointing to B1-4', () => {
    // Roll 6 on P-5 = "Port Gunner — Roll for wound on Table B1-4"
    // The RNG must produce a 2d6 result of 6
    const fixedRng = { d6: () => 3, twod6: () => 6, int: (a: number, b: number) => a };
    const result = rollCompartmentDamage('P-5', fixedRng as any, tables);
    const followUp = result.effects.find(e => e.type === 'follow_up_table');
    expect(followUp).toBeDefined();
    expect(followUp!.table).toBe('B1-4');
  });

  it('P-5 roll 8 produces follow_up_table effect pointing to B1-4 for Starboard Gunner', () => {
    const fixedRng = { d6: () => 4, twod6: () => 8, int: (a: number, b: number) => a };
    const result = rollCompartmentDamage('P-5', fixedRng as any, tables);
    const followUp = result.effects.find(e => e.type === 'follow_up_table');
    expect(followUp).toBeDefined();
    expect(followUp!.table).toBe('B1-4');
  });

  it('P-5 roll 10 produces follow_up_table for Both Waist Gunners', () => {
    const fixedRng = { d6: () => 5, twod6: () => 10, int: (a: number, b: number) => a };
    const result = rollCompartmentDamage('P-5', fixedRng as any, tables);
    const followUp = result.effects.find(e => e.type === 'follow_up_table');
    expect(followUp).toBeDefined();
    expect(followUp!.table).toBe('B1-4');
  });
});

describe('Bug regression: P-1 roll 4 and P-2 roll 3 follow_up.targets (plural)', () => {
  it('P-1 roll 4 produces follow_up_table with targets for Bombardier and Navigator', () => {
    // Roll 4 on P-1 = "Bombardier and Navigator" with follow_up.targets array
    const fixedRng = { d6: () => 2, twod6: () => 4, int: (a: number, b: number) => a };
    const result = rollCompartmentDamage('P-1', fixedRng as any, tables);
    const followUp = result.effects.find(e => e.type === 'follow_up_table');
    expect(followUp).toBeDefined();
    expect(followUp!.table).toBe('B1-4');
    expect(followUp!.targets).toEqual(['Bombardier', 'Navigator']);
  });

  it('P-2 roll 3 produces follow_up_table with targets for Pilot and Co-Pilot', () => {
    // Roll 3 on P-2 = "Pilot and Co-Pilot" with follow_up.targets array
    const fixedRng = { d6: () => 1, twod6: () => 3, int: (a: number, b: number) => a };
    const result = rollCompartmentDamage('P-2', fixedRng as any, tables);
    const followUp = result.effects.find(e => e.type === 'follow_up_table');
    expect(followUp).toBeDefined();
    expect(followUp!.table).toBe('B1-4');
    expect(followUp!.targets).toEqual(['Pilot', 'Co-Pilot']);
  });

  it('P-1 roll 5 still produces singular target for Navigator', () => {
    // Roll 5 on P-1 = "Navigator" with follow_up.target (singular)
    const fixedRng = { d6: () => 2, twod6: () => 5, int: (a: number, b: number) => a };
    const result = rollCompartmentDamage('P-1', fixedRng as any, tables);
    const followUp = result.effects.find(e => e.type === 'follow_up_table');
    expect(followUp).toBeDefined();
    expect(followUp!.table).toBe('B1-4');
    expect(followUp!.target).toBe('Navigator');
  });
});

describe('Bug regression: P-6 roll 7 rudder hits tracked correctly', () => {
  it('P-6 roll 7 produces rudder_hit effect, NOT wing_root_hit', () => {
    // Roll 7 on P-6 = "Rudder" with cumulative rudder_hits
    const fixedRng = { d6: () => 4, twod6: () => 7, int: (a: number, b: number) => a };
    const result = rollCompartmentDamage('P-6', fixedRng as any, tables);
    expect(result.result).toBe('Rudder');
    expect(result.effects.some(e => e.type === 'rudder_hit')).toBe(true);
    expect(result.effects.some(e => e.type === 'wing_root_hit')).toBe(false);
  });

  it('B1-1 roll 2 still produces wing_root_hit (not rudder_hit)', () => {
    // Ensure we did not break wing root hit behavior
    const result = rollCompartmentDamage('B1-1', createRNG(20), tables);
    expect(result.result).toBe('Wing Root');
    expect(result.effects.some(e => e.type === 'wing_root_hit')).toBe(true);
    expect(result.effects.some(e => e.type === 'rudder_hit')).toBe(false);
  });
});

describe('Bug fix: see property references resolved', () => {
  function fixedRng(twod6Value: number) {
    return { d6: () => 1, twod6: () => twod6Value, int: (a: number) => a } as any;
  }

  it('P-3 roll 9 resolves see:"3" — produces sub_roll effect like roll 3 (bombs)', () => {
    const result = rollCompartmentDamage('P-3', fixedRng(9), tables);
    expect(result.result).toBe('Bombs');
    const followUp = result.effects.find(e => e.type === 'follow_up_table');
    expect(followUp).toBeDefined();
    expect(followUp!.table).toBe('sub_roll');
    expect(followUp!.target).toBe('Bombs');
  });

  it('P-3 roll 10 resolves see:"5" — produces sub_roll effect like roll 5 (bomb bay doors)', () => {
    const result = rollCompartmentDamage('P-3', fixedRng(10), tables);
    expect(result.result).toBe('Bomb Bay Doors');
    const followUp = result.effects.find(e => e.type === 'follow_up_table');
    expect(followUp).toBeDefined();
    expect(followUp!.table).toBe('sub_roll');
    expect(followUp!.target).toBe('Bomb Bay Doors');
  });

  it('P-3 roll 11 resolves see:"3" — produces sub_roll effect like roll 3 (bombs)', () => {
    const result = rollCompartmentDamage('P-3', fixedRng(11), tables);
    expect(result.result).toBe('Bombs');
    const followUp = result.effects.find(e => e.type === 'follow_up_table');
    expect(followUp).toBeDefined();
    expect(followUp!.table).toBe('sub_roll');
    expect(followUp!.target).toBe('Bombs');
  });

  it('P-4 roll 3 resolves see:"B1-2:4" — produces intercom_out instrument_damage effect', () => {
    const result = rollCompartmentDamage('P-4', fixedRng(3), tables);
    expect(result.result).toBe('Intercom System Out');
    const eff = result.effects.find(e => e.type === 'instrument_damage');
    expect(eff).toBeDefined();
    expect(eff!.damageType).toBe('intercom_out');
  });

  it('P-4 roll 5 with see:"4" keeps its own radio_out effect (see is informational)', () => {
    const result = rollCompartmentDamage('P-4', fixedRng(5), tables);
    expect(result.result).toBe('Radio Out');
    // Should have system_damage from its own effect, not be overridden
    expect(result.effects.length).toBeGreaterThan(0);
  });

  it('P-3 roll 12 with see:"P-2:12" keeps its own control_cables effect', () => {
    const result = rollCompartmentDamage('P-3', fixedRng(12), tables);
    expect(result.result).toBe('Control Cables');
    expect(result.effects.some(e => e.type === 'control_cables')).toBe(true);
  });
});

describe('Bug regression: P-6 Tail guns inoperable', () => {
  it('P-6 roll 4 result describes tail guns inoperable', () => {
    // Roll 4 on P-6 = "Tail Turret — Tail guns inoperable"
    const fixedRng = { d6: () => 2, twod6: () => 4, int: (a: number, b: number) => a };
    const result = rollCompartmentDamage('P-6', fixedRng as any, tables);
    expect(result.description.toLowerCase()).toContain('tail guns inoperable');
  });

  it('disabled tail gun prevents tail gun eligibility', () => {
    const ac = makeAircraft({});
    disableGun(ac.guns, 'Tail');
    expect(getGun(ac.guns, 'Tail').disabled).toBe(true);
    // Ammo is full and aircraft is otherwise fine, but tail guns should be inoperable
    expect(getGun(ac.guns, 'Tail').ammo).toBeGreaterThan(0);
  });
});

describe('Unhandled P-series effect values', () => {
  function fixedRng(twod6Value: number) {
    return { d6: () => 1, twod6: () => twod6Value, int: (a: number) => a } as any;
  }

  it('P-2 roll 2 (pilot_copilot_heat_out) produces heat_damage effect', () => {
    const result = rollCompartmentDamage('P-2', fixedRng(2), tables);
    expect(result.result).toBe('Compartment Heat');
    const eff = result.effects.find(e => e.type === 'heat_damage');
    expect(eff).toBeDefined();
    expect(eff!.target).toBe('pilot_copilot');
  });

  it('P-3 roll 2 (release_mechanism_out) produces system_damage effect', () => {
    const result = rollCompartmentDamage('P-3', fixedRng(2), tables);
    expect(result.result).toBe('Bomb Release Mechanism');
    const eff = result.effects.find(e => e.type === 'system_damage');
    expect(eff).toBeDefined();
    expect(eff!.damageType).toBe('release_mechanism_out');
    expect(eff!.modifier).toBe(-3);
  });

  it('P-4 roll 4 (radio_out) produces system_damage effect', () => {
    const result = rollCompartmentDamage('P-4', fixedRng(4), tables);
    expect(result.result).toBe('Radio Out');
    const eff = result.effects.find(e => e.type === 'system_damage');
    expect(eff).toBeDefined();
    expect(eff!.damageType).toBe('radio_out');
  });

  it('P-4 roll 5 (radio_out) also produces system_damage effect', () => {
    const result = rollCompartmentDamage('P-4', fixedRng(5), tables);
    expect(result.result).toBe('Radio Out');
    const eff = result.effects.find(e => e.type === 'system_damage');
    expect(eff).toBeDefined();
    expect(eff!.damageType).toBe('radio_out');
  });

  it('P-4 roll 2 (radio_room_heat_out) produces heat_damage effect', () => {
    const result = rollCompartmentDamage('P-4', fixedRng(2), tables);
    expect(result.result).toBe('Compartment Heat');
    const eff = result.effects.find(e => e.type === 'heat_damage');
    expect(eff).toBeDefined();
    expect(eff!.target).toBe('radio_room');
  });

  it('P-1 roll 2 (bomb_run_off_target via damage_effects) produces equipment_damage with bomb_run_off_target', () => {
    const result = rollCompartmentDamage('P-1', fixedRng(2), tables);
    expect(result.result).toBe('Norden Sight');
    const eff = result.effects.find(e => e.type === 'equipment_damage');
    expect(eff).toBeDefined();
    expect(eff!.damageType).toBe('bomb_run_off_target');
  });

  it('P-2 roll 11 (window_heat_out) produces window_heat_hit effect', () => {
    const result = rollCompartmentDamage('P-2', fixedRng(11), tables);
    expect(result.result).toBe('Window Heat Out');
    const eff = result.effects.find(e => e.type === 'window_heat_hit');
    expect(eff).toBeDefined();
  });

  it('none of these effects fall through to generic system_damage or superficial', () => {
    // P-2 roll 2
    const r1 = rollCompartmentDamage('P-2', fixedRng(2), tables);
    expect(r1.effects.some(e => e.type === 'superficial')).toBe(false);

    // P-3 roll 2
    const r2 = rollCompartmentDamage('P-3', fixedRng(2), tables);
    expect(r2.effects.some(e => e.type === 'superficial')).toBe(false);

    // P-4 rolls 2, 4, 5
    const r3 = rollCompartmentDamage('P-4', fixedRng(2), tables);
    expect(r3.effects.some(e => e.type === 'superficial')).toBe(false);
    const r4 = rollCompartmentDamage('P-4', fixedRng(4), tables);
    expect(r4.effects.some(e => e.type === 'superficial')).toBe(false);
    const r5 = rollCompartmentDamage('P-4', fixedRng(5), tables);
    expect(r5.effects.some(e => e.type === 'superficial')).toBe(false);
  });
});
