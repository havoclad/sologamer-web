import { describe, it, expect, beforeEach } from 'vitest';
import { createRNG } from '../../src/engine/rng.js';
import { TableStore } from '../../src/engine/tables.js';
import { b17Module } from '../../src/games/b17/index.js';
import {
  rollFlakIntensity, rollFlakToHit, rollFlakShellHits, rollFlakArea,
  resolveTargetFlak, resolveLightFlak,
} from '../../src/games/b17/rules/flak.js';

let tables: TableStore;

beforeEach(() => {
  tables = new TableStore();
  tables.loadDirectory(b17Module.tableDirectory);
});

describe('rollFlakIntensity', () => {
  it('returns a valid flak intensity', () => {
    const rng = createRNG(42);
    const result = rollFlakIntensity('Bremen', rng, tables);
    expect(['No flak', 'Light flak', 'Medium flak', 'Heavy flak']).toContain(result);
  });

  it('is deterministic with seeded RNG', () => {
    const r1 = rollFlakIntensity('Bremen', createRNG(123), tables);
    const r2 = rollFlakIntensity('Bremen', createRNG(123), tables);
    expect(r1).toBe(r2);
  });
});

describe('resolveTargetFlak', () => {
  it('returns complete flak resolution', () => {
    const rng = createRNG(99);
    const result = resolveTargetFlak('Bremen', rng, tables);
    expect(result).toHaveProperty('intensity');
    expect(result).toHaveProperty('flakHits');
    expect(result).toHaveProperty('shellHits');
    expect(result).toHaveProperty('areasHit');
    expect(result.flakHits).toBeGreaterThanOrEqual(0);
    expect(result.shellHits).toBeGreaterThanOrEqual(0);
    expect(result.areasHit.length).toBe(result.shellHits);
  });

  it('no flak means no hits', () => {
    // Find a seed that gives 'No flak'
    for (let seed = 0; seed < 1000; seed++) {
      const rng = createRNG(seed);
      const result = resolveTargetFlak('Amiens', rng, tables);
      if (result.intensity === 'No flak') {
        expect(result.flakHits).toBe(0);
        expect(result.shellHits).toBe(0);
        expect(result.areasHit).toHaveLength(0);
        return;
      }
    }
  });
});

describe('resolveLightFlak', () => {
  it('uses light flak intensity with 2 rolls', () => {
    const rng = createRNG(55);
    const result = resolveLightFlak(rng, tables);
    expect(result.intensity).toBe('Light flak');
    expect(result.flakHits).toBeGreaterThanOrEqual(0);
  });
});
