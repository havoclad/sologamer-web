import { describe, it, expect } from 'vitest';
import { createRNG } from '../../src/engine/rng.js';
import {
  resolveControlledBailout, resolveUncontrolledBailout,
  resolveDitchingSurvival,
} from '../../src/games/b17/rules/bailout.js';
import type { CrewMember } from '../../src/games/b17/types.js';

function makeCrew(overrides: Partial<CrewMember>[] = []): CrewMember[] {
  const positions = ['pilot', 'copilot', 'navigator', 'bombardier', 'engineer',
    'radioman', 'ball_turret', 'left_waist', 'right_waist', 'tail_gunner'] as const;
  return positions.map((p, i) => ({
    position: p, name: `Crew ${p}`, wounds: 'none' as const,
    frostbite: false, kills: 0, missions: 0, status: 'active' as const,
    ...overrides[i],
  }));
}

describe('resolveControlledBailout', () => {
  it('resolves all 10 crew members', () => {
    const result = resolveControlledBailout(makeCrew(), 'France', 3, true, createRNG(42));
    expect(result.crewResults).toHaveLength(10);
    expect(result.type).toBe('controlled');
  });

  it('seriously wounded cannot bail out per G-6 notes', () => {
    const crew = makeCrew([{ wounds: 'serious' } as any]);
    const result = resolveControlledBailout(crew, 'Germany', 4, true, createRNG(42));
    expect(result.crewResults[0].bailedOut).toBe(false);
    expect(result.crewResults[0].fate).toBe('kia');
  });

  it('over Germany = automatically captured per G-6 notes', () => {
    const rng = createRNG(42);
    const result = resolveControlledBailout(makeCrew(), 'Germany', 4, true, rng);
    for (const cr of result.crewResults) {
      if (cr.bailedOut) {
        expect(cr.fate).toBe('pow');
      }
    }
  });

  it('is deterministic', () => {
    const r1 = resolveControlledBailout(makeCrew(), 'France', 3, true, createRNG(42));
    const r2 = resolveControlledBailout(makeCrew(), 'France', 3, true, createRNG(42));
    expect(r1.crewResults.map(c => c.fate)).toEqual(r2.crewResults.map(c => c.fate));
  });
});

describe('resolveUncontrolledBailout', () => {
  it('is much more lethal than controlled', () => {
    // Run many seeds and check KIA rate is high
    let kiaCount = 0;
    let total = 0;
    for (let seed = 0; seed < 50; seed++) {
      const result = resolveUncontrolledBailout(makeCrew(), 'Germany', 4, true, createRNG(seed));
      for (const cr of result.crewResults) {
        total++;
        if (cr.fate === 'kia') kiaCount++;
      }
    }
    // Most crew should die in uncontrolled bailout (5/6 chance per person)
    expect(kiaCount / total).toBeGreaterThan(0.5);
  });
});

describe('resolveDitchingSurvival', () => {
  it('all drown when not rescued', () => {
    const results = resolveDitchingSurvival(makeCrew(), 3, false);
    for (const r of results) {
      if (r.fate !== 'kia') {
        expect(r.fate).toBe('drowned');
      }
    }
  });

  it('rescued in zone 6 are captured per G-10 notes', () => {
    const results = resolveDitchingSurvival(makeCrew(), 6, true);
    for (const r of results) {
      expect(r.fate).toBe('rescued_pow');
    }
  });

  it('rescued in zone 3 returned to England', () => {
    const results = resolveDitchingSurvival(makeCrew(), 3, true);
    for (const r of results) {
      expect(r.fate).toBe('rescued');
    }
  });
});
