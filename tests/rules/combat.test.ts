import { describe, it, expect, beforeEach } from 'vitest';
import { createRNG } from '../../src/engine/rng.js';
import { TableStore } from '../../src/engine/tables.js';
import { b17Module } from '../../src/games/b17/index.js';
import {
  getFieldOfFire, resolveDefensiveFire, rollFighterDamage,
  isTwinGunMount, applyFighterDamage, resolveGermanOffensiveFire,
  rollFighterCoverDefense, removeDrivenOffFighters,
  rollSuccessiveAttackPosition, getSuccessiveAttackers, rollShellHits,
  isFighterOutOfAction,
  type GunPosition,
} from '../../src/games/b17/rules/combat.js';
import type { Fighter, AttackPosition } from '../../src/games/b17/rules/fighter-encounters.js';

let tables: TableStore;

beforeEach(() => {
  tables = new TableStore();
  tables.loadDirectory(b17Module.tableDirectory);
});

function makeFighter(overrides: Partial<Fighter> = {}): Fighter {
  return {
    id: 1, type: 'Me109', position: '12 High',
    damage: [], attacksMade: 0, scoredHit: false,
    ...overrides,
  };
}

describe('getFieldOfFire', () => {
  it('12 High allows Top Turret and Nose per M-1', () => {
    const fof = getFieldOfFire('12 High', tables);
    expect(fof.has('Top_Turret')).toBe(true);
    expect(fof.has('Nose')).toBe(true);
    expect(fof.get('Top_Turret')).toBe(6);
  });

  it('6 High allows Ball Turret, Tail, both Waists per M-1', () => {
    const fof = getFieldOfFire('6 High', tables);
    expect(fof.has('Ball_Turret')).toBe(true);
    expect(fof.has('Tail')).toBe(true);
    expect(fof.get('Tail')).toBe(4); // Tail hits on 4+ from 6 o'clock
    expect(fof.has('Port_Waist')).toBe(true);
    expect(fof.has('Starboard_Waist')).toBe(true);
  });

  it('Vertical Dive only allows Top Turret and Radio per B-3/M-1', () => {
    const fof = getFieldOfFire('Vertical Dive', tables);
    expect(fof.has('Top_Turret')).toBe(true);
    expect(fof.has('Radio')).toBe(true);
    expect(fof.size).toBe(2);
    // Both must roll 6
    expect(fof.get('Top_Turret')).toBe(6);
    expect(fof.get('Radio')).toBe(6);
  });

  it('Vertical Climb only allows Ball Turret per B-3/M-1', () => {
    const fof = getFieldOfFire('Vertical Climb', tables);
    expect(fof.has('Ball_Turret')).toBe(true);
    expect(fof.size).toBe(1);
    expect(fof.get('Ball_Turret')).toBe(4); // 3-6 to hit (represented as 4 threshold)
  });
});

describe('resolveDefensiveFire', () => {
  it('hit when roll >= required', () => {
    // Seed that produces a 6 on first d6
    for (let seed = 0; seed < 100; seed++) {
      const rng = createRNG(seed);
      const result = resolveDefensiveFire(6, rng, false, false, false, false, false);
      if (result.roll === 6) {
        expect(result.hit).toBe(true);
        return;
      }
    }
  });

  it('miss when roll < required', () => {
    for (let seed = 0; seed < 100; seed++) {
      const rng = createRNG(seed);
      const result = resolveDefensiveFire(6, rng, false, false, false, false, false);
      if (result.roll < 6) {
        expect(result.hit).toBe(false);
        return;
      }
    }
  });

  it('ace bonus adds 1 to roll per §9.3', () => {
    for (let seed = 0; seed < 100; seed++) {
      const rng = createRNG(seed);
      const result = resolveDefensiveFire(6, rng, true, false, false, false, false);
      if (result.roll === 5) {
        // Roll of 5 + ace bonus = 6, should hit
        expect(result.hit).toBe(true);
        return;
      }
    }
  });

  it('evasive action forces need for 6 per §15.1b', () => {
    for (let seed = 0; seed < 100; seed++) {
      const rng = createRNG(seed);
      // Normal required is 4, but evasive action overrides to 6
      const result = resolveDefensiveFire(4, rng, false, true, false, false, false);
      if (result.roll === 4) {
        expect(result.hit).toBe(false); // Normally would hit on 4, but evasive → need 6
        return;
      }
    }
  });

  it('frostbite forces need for 6 per §11.0', () => {
    for (let seed = 0; seed < 100; seed++) {
      const rng = createRNG(seed);
      const result = resolveDefensiveFire(4, rng, false, false, false, true, false);
      if (result.roll === 4) {
        expect(result.hit).toBe(false);
        return;
      }
    }
  });
});

describe('rollFighterDamage (M-2)', () => {
  it('returns FCA, FBOA, or Destroyed', () => {
    const rng = createRNG(42);
    const result = rollFighterDamage(rng, tables, false);
    expect(['FCA', 'FBOA', 'Destroyed']).toContain(result);
  });

  it('twin gun +1 modifier shifts results per M-2 notes', () => {
    // Verify that twin guns can shift a result up
    let twinDestroyed = 0;
    let singleDestroyed = 0;
    for (let seed = 0; seed < 500; seed++) {
      if (rollFighterDamage(createRNG(seed), tables, true) === 'Destroyed') twinDestroyed++;
      if (rollFighterDamage(createRNG(seed), tables, false) === 'Destroyed') singleDestroyed++;
    }
    // Twin guns should destroy more often due to +1
    expect(twinDestroyed).toBeGreaterThan(singleDestroyed);
  });

  it('FW190 -1 modifier (note b) reduces damage results vs Me109', () => {
    // FW190 applies -1, so fewer Destroyed results than vs Me109 (no modifier)
    let fw190Destroyed = 0;
    let me109Destroyed = 0;
    for (let seed = 0; seed < 500; seed++) {
      if (rollFighterDamage(createRNG(seed), tables, false, 'FW190') === 'Destroyed') fw190Destroyed++;
      if (rollFighterDamage(createRNG(seed), tables, false, 'Me109') === 'Destroyed') me109Destroyed++;
    }
    expect(fw190Destroyed).toBeLessThan(me109Destroyed);
  });

  it('twin +1 and FW190 -1 cancel out to same result as no modifiers', () => {
    // With twin=true and FW190, net modifier is 0 — same distribution as single/Me109
    let twinFW190Destroyed = 0;
    let singleMe109Destroyed = 0;
    for (let seed = 0; seed < 500; seed++) {
      if (rollFighterDamage(createRNG(seed), tables, true, 'FW190') === 'Destroyed') twinFW190Destroyed++;
      if (rollFighterDamage(createRNG(seed), tables, false, 'Me109') === 'Destroyed') singleMe109Destroyed++;
    }
    expect(twinFW190Destroyed).toBe(singleMe109Destroyed);
  });
});

describe('isTwinGunMount', () => {
  it('Ball, Top, Tail are twin per M-2 notes', () => {
    expect(isTwinGunMount('Ball_Turret')).toBe(true);
    expect(isTwinGunMount('Top_Turret')).toBe(true);
    expect(isTwinGunMount('Tail')).toBe(true);
  });
  it('others are not twin', () => {
    expect(isTwinGunMount('Nose')).toBe(false);
    expect(isTwinGunMount('Port_Waist')).toBe(false);
    expect(isTwinGunMount('Radio')).toBe(false);
  });
});

describe('applyFighterDamage', () => {
  it('Destroyed immediately destroys', () => {
    const f = makeFighter();
    expect(applyFighterDamage(f, 'Destroyed').status).toBe('destroyed');
  });

  it('single FCA keeps active', () => {
    const f = makeFighter();
    expect(applyFighterDamage(f, 'FCA').status).toBe('active');
  });

  it('single FBOA breaks off', () => {
    const f = makeFighter();
    expect(applyFighterDamage(f, 'FBOA').status).toBe('breaks_off');
  });

  it('2 FCA = breaks off per M-2', () => {
    const f = makeFighter({ damage: ['FCA'] });
    expect(applyFighterDamage(f, 'FCA').status).toBe('breaks_off');
  });

  it('2 FBOA = destroyed per M-2', () => {
    const f = makeFighter({ damage: ['FBOA'] });
    expect(applyFighterDamage(f, 'FBOA').status).toBe('destroyed');
  });

  it('FCA + FBOA = breaks off per M-2', () => {
    const f = makeFighter({ damage: ['FCA'] });
    expect(applyFighterDamage(f, 'FBOA').status).toBe('breaks_off');
  });
});

describe('resolveGermanOffensiveFire (M-3)', () => {
  it('returns hit or miss', () => {
    const rng = createRNG(42);
    const f = makeFighter();
    const result = resolveGermanOffensiveFire(f, rng, tables, 0, 0);
    expect(typeof result.hit).toBe('boolean');
    expect(result.roll).toBeGreaterThanOrEqual(1);
    expect(result.roll).toBeLessThanOrEqual(6);
  });

  it('roll of 6 always hits per M-3 notes', () => {
    for (let seed = 0; seed < 200; seed++) {
      const rng = createRNG(seed);
      const f = makeFighter();
      const result = resolveGermanOffensiveFire(f, rng, tables, -10, 0);
      if (result.roll === 6) {
        expect(result.hit).toBe(true);
        return;
      }
    }
  });

  it('FCA damage reduces hit chance per M-2/M-3', () => {
    // Fighter with FCA has -1 to offensive roll
    let hitsWithFCA = 0;
    let hitsWithout = 0;
    for (let seed = 0; seed < 500; seed++) {
      const fClean = makeFighter();
      const fDamaged = makeFighter({ damage: ['FCA'] });
      if (resolveGermanOffensiveFire(fClean, createRNG(seed), tables, 0, 0).hit) hitsWithout++;
      if (resolveGermanOffensiveFire(fDamaged, createRNG(seed), tables, 0, 0).hit) hitsWithFCA++;
    }
    expect(hitsWithFCA).toBeLessThanOrEqual(hitsWithout);
  });
});

describe('rollFighterCoverDefense (M-4)', () => {
  it('returns initial and successive driven-off counts', () => {
    const rng = createRNG(42);
    const result = rollFighterCoverDefense('Fair', rng, tables, 0);
    expect(result.initialDrivenOff).toBeGreaterThanOrEqual(1);
    expect(result.successiveDrivenOff).toBeGreaterThanOrEqual(0);
  });

  it('Good cover drives off more than Poor', () => {
    let goodTotal = 0;
    let poorTotal = 0;
    for (let seed = 0; seed < 200; seed++) {
      goodTotal += rollFighterCoverDefense('Good', createRNG(seed), tables, 0).initialDrivenOff;
      poorTotal += rollFighterCoverDefense('Poor', createRNG(seed), tables, 0).initialDrivenOff;
    }
    expect(goodTotal).toBeGreaterThan(poorTotal);
  });
});

describe('removeDrivenOffFighters', () => {
  it('removes specified count', () => {
    const fighters = [
      makeFighter({ id: 1, position: '12 High' }),
      makeFighter({ id: 2, position: '3 Level' }),
    ];
    const { remaining, removed } = removeDrivenOffFighters(fighters, 1);
    expect(remaining).toHaveLength(1);
    expect(removed).toHaveLength(1);
  });

  it('does not remove Vertical Dive fighters per B-3 notes', () => {
    const fighters = [
      makeFighter({ id: 1, position: 'Vertical Dive' }),
      makeFighter({ id: 2, position: '12 High' }),
    ];
    const { remaining, removed } = removeDrivenOffFighters(fighters, 2);
    expect(removed).toHaveLength(1);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].position).toBe('Vertical Dive');
  });

  it('does not remove more than available', () => {
    const fighters = [makeFighter({ id: 1 })];
    const { remaining, removed } = removeDrivenOffFighters(fighters, 5);
    expect(remaining).toHaveLength(0);
    expect(removed).toHaveLength(1);
  });
});

describe('rollSuccessiveAttackPosition (B-6)', () => {
  it('returns a valid attack position', () => {
    const rng = createRNG(42);
    const pos = rollSuccessiveAttackPosition(rng, tables);
    expect(pos).toBeTruthy();
    // B-6 results are all standard positions (no vertical)
    expect(pos).not.toBe('Vertical Dive');
    expect(pos).not.toBe('Vertical Climb');
  });
});

describe('getSuccessiveAttackers', () => {
  it('returns fighters that scored hits', () => {
    const fighters = [
      makeFighter({ id: 1, scoredHit: true, attacksMade: 1 }),
      makeFighter({ id: 2, scoredHit: false, attacksMade: 1 }),
    ];
    const result = getSuccessiveAttackers(fighters, false);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(1);
  });

  it('out of formation: all fighters attack again per §13.1c', () => {
    const fighters = [
      makeFighter({ id: 1, scoredHit: false, attacksMade: 1 }),
      makeFighter({ id: 2, scoredHit: false, attacksMade: 1 }),
    ];
    const result = getSuccessiveAttackers(fighters, true);
    expect(result).toHaveLength(2);
  });

  it('max 3 attacks per wave per §6.5b', () => {
    const fighters = [
      makeFighter({ id: 1, scoredHit: true, attacksMade: 3 }),
    ];
    const result = getSuccessiveAttackers(fighters, true);
    expect(result).toHaveLength(0);
  });

  it('FBOA fighters do not attack again', () => {
    const fighters = [
      makeFighter({ id: 1, scoredHit: true, attacksMade: 1, damage: ['FBOA'] }),
    ];
    expect(getSuccessiveAttackers(fighters, true)).toHaveLength(0);
  });

  it('destroyed fighters are skipped by isFighterOutOfAction', () => {
    // Import the helper
    const destroyed = makeFighter({ damage: ['Destroyed'] });
    expect(isFighterOutOfAction(destroyed)).toBe(true);
  });

  it('FBOA fighters are skipped by isFighterOutOfAction', () => {
    const fboa = makeFighter({ damage: ['FBOA'] });
    expect(isFighterOutOfAction(fboa)).toBe(true);
  });

  it('2x FCA fighters are skipped by isFighterOutOfAction (cumulative FBOA)', () => {
    const twoFCA = makeFighter({ damage: ['FCA', 'FCA'] });
    expect(isFighterOutOfAction(twoFCA)).toBe(true);
  });

  it('active fighters are NOT skipped by isFighterOutOfAction', () => {
    const active = makeFighter({ damage: [] });
    expect(isFighterOutOfAction(active)).toBe(false);
    const oneFCA = makeFighter({ damage: ['FCA'] });
    expect(isFighterOutOfAction(oneFCA)).toBe(false);
  });

  it('applyFighterDamage pushes Destroyed to fighter.damage array', () => {
    const f = makeFighter({ damage: [] });
    const result = applyFighterDamage(f, 'Destroyed');
    expect(result.status).toBe('destroyed');
    expect(f.damage).toContain('Destroyed');
  });

  it('a fighter destroyed by applyFighterDamage is caught by isFighterOutOfAction', () => {
    const f = makeFighter({ damage: [] });
    applyFighterDamage(f, 'Destroyed');
    expect(isFighterOutOfAction(f)).toBe(true);
  });

  it('destroyed fighters do not make successive attacks (regression)', () => {
    const fighters = [
      makeFighter({ id: 1, scoredHit: true, attacksMade: 1, damage: ['Destroyed'] }),
      makeFighter({ id: 2, scoredHit: true, attacksMade: 1, damage: [] }),
    ];
    const result = getSuccessiveAttackers(fighters, false);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(2);
  });
});

describe('rollShellHits (B-4)', () => {
  it('returns a non-negative number', () => {
    const rng = createRNG(42);
    const f = makeFighter({ position: '12 High' });
    const hits = rollShellHits(f, rng, tables);
    expect(hits).toBeGreaterThanOrEqual(0);
  });

  it('FW190 multiplies by 1.5 per B-4 notes', () => {
    let fw190Total = 0;
    let me109Total = 0;
    for (let seed = 0; seed < 200; seed++) {
      fw190Total += rollShellHits(makeFighter({ type: 'FW190', position: '12 High' }), createRNG(seed), tables);
      me109Total += rollShellHits(makeFighter({ type: 'Me109', position: '12 High' }), createRNG(seed), tables);
    }
    // FW190 should average higher
    expect(fw190Total).toBeGreaterThan(me109Total);
  });

  it('Me110 adds +1 per B-4 notes', () => {
    let me110Total = 0;
    let me109Total = 0;
    for (let seed = 0; seed < 200; seed++) {
      me110Total += rollShellHits(makeFighter({ type: 'Me110', position: '12 High' }), createRNG(seed), tables);
      me109Total += rollShellHits(makeFighter({ type: 'Me109', position: '12 High' }), createRNG(seed), tables);
    }
    expect(me110Total).toBeGreaterThan(me109Total);
  });
});
