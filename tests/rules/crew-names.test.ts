import { describe, it, expect } from 'vitest';
import { createRNG } from '../../src/engine/rng.js';
import { generateCrewName, FIRST_NAMES, LAST_NAMES } from '../../src/games/b17/rules/crew-names.js';

describe('generateCrewName', () => {
  it('returns a "First Last" format name', () => {
    const name = generateCrewName(createRNG(42));
    const parts = name.split(' ');
    expect(parts).toHaveLength(2);
    expect(FIRST_NAMES).toContain(parts[0]);
    expect(LAST_NAMES).toContain(parts[1]);
  });

  it('is deterministic with same seed', () => {
    const a = generateCrewName(createRNG(42));
    const b = generateCrewName(createRNG(42));
    expect(a).toBe(b);
  });

  it('varies with different seeds', () => {
    const names = new Set<string>();
    for (let s = 0; s < 20; s++) {
      names.add(generateCrewName(createRNG(s)));
    }
    expect(names.size).toBeGreaterThan(5);
  });
});

describe('name arrays', () => {
  it('FIRST_NAMES has entries', () => {
    expect(FIRST_NAMES.length).toBeGreaterThan(20);
  });

  it('LAST_NAMES has entries', () => {
    expect(LAST_NAMES.length).toBeGreaterThan(20);
  });
});
