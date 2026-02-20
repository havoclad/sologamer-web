import { describe, it, expect } from 'vitest';
import { createRNG } from '../../src/engine/rng.js';
import { TableStore } from '../../src/engine/tables.js';
import { b17Module } from '../../src/games/b17/index.js';
import {
  resolveRandomEvent, createRandomEventState,
  rollEngineFailure, rollExtremeCold, rollAceForADay,
  rollMidAirAccident,
} from '../../src/games/b17/rules/random-events.js';

describe('rollEngineFailure', () => {
  it('returns engine index 0-3', () => {
    for (let seed = 0; seed < 50; seed++) {
      const idx = rollEngineFailure(createRNG(seed));
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThanOrEqual(3);
    }
  });
});

describe('rollExtremeCold', () => {
  it('returns array of gun position strings', () => {
    const jammed = rollExtremeCold(createRNG(42));
    expect(Array.isArray(jammed)).toBe(true);
    for (const g of jammed) {
      expect(typeof g).toBe('string');
    }
  });
});

describe('rollAceForADay', () => {
  it('returns valid gunner position', () => {
    for (let seed = 0; seed < 30; seed++) {
      const gunner = rollAceForADay(createRNG(seed));
      expect(['engineer', 'ball_turret', 'tail_gunner']).toContain(gunner);
    }
  });
});

describe('rollMidAirAccident', () => {
  it('returns valid effect', () => {
    for (let seed = 0; seed < 50; seed++) {
      const result = rollMidAirAccident(createRNG(seed));
      expect(['no_effect', 'shallow_dive', 'steep_dive', 'mid_air_collision']).toContain(result.effect);
      if (result.effect === 'steep_dive') {
        expect(result.wingsHold).toBeDefined();
      }
    }
  });
});

describe('resolveRandomEvent', () => {
  it('returns a valid event', () => {
    const tables = new TableStore();
    tables.loadDirectory(b17Module.tableDirectory);
    const state = createRandomEventState();
    const rng = createRNG(42);
    const result = resolveRandomEvent(rng, tables, state, false, false, 'middle');
    expect(result).toHaveProperty('eventType');
    expect(result).toHaveProperty('description');
    expect(result).toHaveProperty('details');
  });

  it('is deterministic with seeded RNG', () => {
    const tables = new TableStore();
    tables.loadDirectory(b17Module.tableDirectory);
    const s1 = createRandomEventState();
    const s2 = createRandomEventState();
    const r1 = resolveRandomEvent(createRNG(77), tables, s1, false, false, 'middle');
    const r2 = resolveRandomEvent(createRNG(77), tables, s2, false, false, 'middle');
    expect(r1.eventType).toBe(r2.eventType);
  });
});
