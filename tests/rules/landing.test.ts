import { describe, it, expect, beforeEach } from 'vitest';
import { createRNG } from '../../src/engine/rng.js';
import { TableStore } from '../../src/engine/tables.js';
import { b17Module } from '../../src/games/b17/index.js';
import {
  calculateLandModifier, calculateWaterLandModifier,
  resolveLandLanding, resolveWaterLanding,
  determineLandingLocation, isWaterRescueCaptured,
  type LandingModifierInputs,
} from '../../src/games/b17/rules/landing.js';
import type { CrewMember } from '../../src/games/b17/types.js';

let tables: TableStore;

function defaultInputs(): LandingModifierInputs {
  return {
    enginesOut: 0, tailWheelInop: false,
    controlDamage: { rudder: false, elevator: false, ailerons: false },
    bipDamage: false, landingInEurope: false, accumulatedModifiers: 0,
    radioOut: false, pilotCopilotExperienced: false,
    nonPilotFlying: false, bombsAboard: false,
  };
}

function makeCrew(): CrewMember[] {
  return ['pilot', 'copilot', 'navigator', 'bombardier', 'engineer',
    'radioman', 'ball_turret', 'left_waist', 'right_waist', 'tail_gunner'].map(p => ({
    position: p as any, name: `Crew ${p}`, wounds: 'none' as const,
    frostbite: false, kills: 0, missions: 0, status: 'active' as const,
  }));
}

beforeEach(() => {
  tables = new TableStore();
  tables.loadDirectory(b17Module.tableDirectory);
});

describe('calculateLandModifier', () => {
  it('returns 0 for undamaged landing', () => {
    expect(calculateLandModifier(defaultInputs())).toBe(0);
  });

  it('applies -7 for 4 engines out per §10.4', () => {
    expect(calculateLandModifier({ ...defaultInputs(), enginesOut: 4 })).toBe(-7);
  });

  it('applies -3 for 3 engines out per §10.3', () => {
    expect(calculateLandModifier({ ...defaultInputs(), enginesOut: 3 })).toBe(-3);
  });

  it('cumulates Europe and BIP modifiers', () => {
    const mod = calculateLandModifier({
      ...defaultInputs(), landingInEurope: true, bipDamage: true,
    });
    expect(mod).toBe(-7); // -3 Europe + -4 BIP
  });
});

describe('calculateWaterLandModifier', () => {
  it('applies -4 for 4 engines out (different from G-9)', () => {
    expect(calculateWaterLandModifier({ ...defaultInputs(), enginesOut: 4 })).toBe(-4);
  });

  it('applies -6 for radio out', () => {
    expect(calculateWaterLandModifier({ ...defaultInputs(), radioOut: true })).toBe(-6);
  });

  it('applies +1 for experienced pilot', () => {
    expect(calculateWaterLandModifier({ ...defaultInputs(), pilotCopilotExperienced: true })).toBe(1);
  });
});

describe('resolveLandLanding', () => {
  it('returns valid outcome', () => {
    const result = resolveLandLanding(0, makeCrew(), createRNG(42), tables);
    expect(result).toHaveProperty('outcome');
    expect(result).toHaveProperty('roll');
    expect(result.modifier).toBe(0);
  });

  it('is deterministic', () => {
    const r1 = resolveLandLanding(0, makeCrew(), createRNG(42), tables);
    const r2 = resolveLandLanding(0, makeCrew(), createRNG(42), tables);
    expect(r1.outcome).toBe(r2.outcome);
  });
});

describe('resolveWaterLanding', () => {
  it('always marks plane as lost', () => {
    const result = resolveWaterLanding(0, 3, false, createRNG(42), tables);
    expect(result.planeLost).toBe(true);
    expect(result.location).toBe('water');
  });
});

describe('determineLandingLocation', () => {
  it('zone 1 is always england', () => {
    expect(determineLandingLocation(1, ['England'])).toEqual(['england']);
  });

  it('maps water terrain correctly', () => {
    expect(determineLandingLocation(3, ['water'])).toEqual(['water']);
  });

  it('handles mixed terrain', () => {
    const locs = determineLandingLocation(4, ['water', 'Netherlands']);
    expect(locs).toContain('water');
    expect(locs).toContain('europe');
  });
});

describe('isWaterRescueCaptured', () => {
  it('zones 6-7 captured per G-10 notes', () => {
    expect(isWaterRescueCaptured(6)).toBe(true);
    expect(isWaterRescueCaptured(7)).toBe(true);
  });

  it('zones 2-5 returned to England', () => {
    expect(isWaterRescueCaptured(3)).toBe(false);
    expect(isWaterRescueCaptured(5)).toBe(false);
  });
});
