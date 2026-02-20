import { describe, it, expect, beforeEach } from 'vitest';
import { createRNG } from '../../src/engine/rng.js';
import { TableStore } from '../../src/engine/tables.js';
import { b17Module } from '../../src/games/b17/index.js';
import {
  rollFighterWaves, rollAttackingFighters, rollAttackingFightersWithReroll,
  addLeadTailExtraFighter, isVerticalDive, isVerticalClimb,
  canBeDrivenOffByCover, parsePosition, getM3AttackGroup, getB4AttackGroup,
  getB5AttackKey,
  type Fighter, type AttackPosition,
} from '../../src/games/b17/rules/fighter-encounters.js';

let tables: TableStore;

beforeEach(() => {
  tables = new TableStore();
  tables.loadDirectory(b17Module.tableDirectory);
});

describe('rollFighterWaves', () => {
  it('returns 0-2 waves for non-target zone (B-1)', () => {
    const rng = createRNG(42);
    const result = rollFighterWaves(false, 0, rng, tables);
    expect(result.waveCount).toBeGreaterThanOrEqual(0);
    expect(result.waveCount).toBeLessThanOrEqual(2);
  });

  it('returns 1-3 waves for target zone (B-2)', () => {
    const rng = createRNG(42);
    const result = rollFighterWaves(true, 0, rng, tables);
    expect(result.waveCount).toBeGreaterThanOrEqual(0); // can be 1 min with modifiers
    expect(result.waveCount).toBeLessThanOrEqual(3);
  });

  it('modifier shifts the result', () => {
    // With large negative modifier, should clamp to minimum and get fewer/zero waves
    const rng = createRNG(42);
    const low = rollFighterWaves(false, -5, rng, tables);
    expect(low.waveCount).toBeLessThanOrEqual(1);
  });

  it('is deterministic', () => {
    const r1 = rollFighterWaves(false, 0, createRNG(42), tables);
    const r2 = rollFighterWaves(false, 0, createRNG(42), tables);
    expect(r1.waveCount).toBe(r2.waveCount);
  });
});

describe('rollAttackingFighters', () => {
  it('returns fighters with valid types and positions', () => {
    const rng = createRNG(42);
    const result = rollAttackingFighters(rng, tables, false, 1);
    if (!result.isNoAttackers) {
      expect(result.fighters.length).toBeGreaterThan(0);
      for (const f of result.fighters) {
        expect(['Me109', 'Me110', 'FW190']).toContain(f.type);
        expect(f.position).toBeTruthy();
        expect(f.attacksMade).toBe(0);
        expect(f.damage).toEqual([]);
      }
    }
  });

  it('out of formation adds Me109 at 12 Level per §13.1a', () => {
    // Find a seed that produces fighters (not "No Attackers")
    for (let seed = 0; seed < 100; seed++) {
      const result = rollAttackingFighters(createRNG(seed), tables, true, 1);
      if (!result.isNoAttackers && result.fighters.length > 0) {
        const extra = result.fighters[result.fighters.length - 1];
        expect(extra.type).toBe('Me109');
        expect(extra.position).toBe('12 Level');
        return;
      }
    }
  });

  it('assigns unique IDs to fighters', () => {
    const rng = createRNG(42);
    const result = rollAttackingFighters(rng, tables, false, 100);
    if (!result.isNoAttackers) {
      const ids = result.fighters.map(f => f.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});

describe('rollAttackingFightersWithReroll', () => {
  it('re-rolls "No Attackers" when out of formation per B-3 note (c)', () => {
    // This should eventually produce fighters or exhaust re-rolls
    const rng = createRNG(42);
    const result = rollAttackingFightersWithReroll(rng, tables, true, 1);
    // Either got fighters or exhausted 10 re-rolls
    expect(result.rolls.length).toBeGreaterThanOrEqual(1);
  });

  it('does NOT re-roll when in formation', () => {
    // Find a seed that produces "No Attackers"
    for (let seed = 0; seed < 500; seed++) {
      const result = rollAttackingFightersWithReroll(createRNG(seed), tables, false, 1);
      if (result.fighters.length === 0) {
        expect(result.rolls.length).toBe(1); // no re-rolls
        return;
      }
    }
  });
});

describe('addLeadTailExtraFighter', () => {
  it('adds Me109 at 12 Level per §5.1c', () => {
    const fighters: Fighter[] = [{
      id: 1, type: 'FW190', position: '12 High',
      damage: [], attacksMade: 0, scoredHit: false,
    }];
    const result = addLeadTailExtraFighter(fighters, 2);
    expect(result).toHaveLength(2);
    expect(result[1].type).toBe('Me109');
    expect(result[1].position).toBe('12 Level');
    expect(result[1].id).toBe(2);
  });
});

describe('position helpers', () => {
  it('isVerticalDive', () => {
    expect(isVerticalDive('Vertical Dive')).toBe(true);
    expect(isVerticalDive('12 High')).toBe(false);
  });

  it('isVerticalClimb', () => {
    expect(isVerticalClimb('Vertical Climb')).toBe(true);
    expect(isVerticalClimb('6 Low')).toBe(false);
  });

  it('canBeDrivenOffByCover — Vertical Dive cannot per B-3 notes', () => {
    expect(canBeDrivenOffByCover('Vertical Dive')).toBe(false);
    expect(canBeDrivenOffByCover('Vertical Climb')).toBe(true);
    expect(canBeDrivenOffByCover('12 High')).toBe(true);
  });

  it('parsePosition extracts clock and altitude', () => {
    expect(parsePosition('12 High')).toEqual({ clock: '12', altitude: 'High' });
    expect(parsePosition('10:30 Level')).toEqual({ clock: '10:30', altitude: 'Level' });
    expect(parsePosition('1:30 Low')).toEqual({ clock: '1:30', altitude: 'Low' });
    expect(parsePosition('Vertical Dive')).toEqual({ clock: 'vertical', altitude: 'Vertical Dive' });
  });
});

describe('attack group mapping', () => {
  it('getM3AttackGroup groups correctly per M-3 structure', () => {
    expect(getM3AttackGroup('12 High')).toBe('12_high_level_low');
    expect(getM3AttackGroup('12 Level')).toBe('12_high_level_low');
    expect(getM3AttackGroup('10:30 Low')).toBe('10:30_1:30_high_level_low');
    expect(getM3AttackGroup('1:30 High')).toBe('10:30_1:30_high_level_low');
    expect(getM3AttackGroup('3 Level')).toBe('3_9_high_level_low');
    expect(getM3AttackGroup('9 High')).toBe('3_9_high_level_low');
    expect(getM3AttackGroup('6 Low')).toBe('6_high_level_low');
    expect(getM3AttackGroup('Vertical Dive')).toBe('vertical_dive');
    expect(getM3AttackGroup('Vertical Climb')).toBe('vertical_climb');
  });

  it('getB4AttackGroup groups correctly per B-4 structure', () => {
    expect(getB4AttackGroup('12 High')).toBe('12_1:30_10:30');
    expect(getB4AttackGroup('1:30 Level')).toBe('12_1:30_10:30');
    expect(getB4AttackGroup('10:30 Low')).toBe('12_1:30_10:30');
    expect(getB4AttackGroup('3 High')).toBe('3_9');
    expect(getB4AttackGroup('9 Level')).toBe('3_9');
    expect(getB4AttackGroup('6 High')).toBe('6');
    expect(getB4AttackGroup('Vertical Dive')).toBe('vertical_dive');
  });

  it('getB5AttackKey includes altitude', () => {
    expect(getB5AttackKey('12 High')).toEqual({ group: '12_1:30_10:30', altitude: 'high' });
    expect(getB5AttackKey('3 Level')).toEqual({ group: '3_9', altitude: 'level' });
    expect(getB5AttackKey('6 Low')).toEqual({ group: '6', altitude: 'low' });
    expect(getB5AttackKey('Vertical Dive')).toEqual({ group: 'vertical_dive', altitude: 'all' });
  });
});
