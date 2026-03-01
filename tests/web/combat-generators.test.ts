import { describe, it, expect, beforeEach } from 'vitest';
import type { Fighter } from '../../src/games/b17/rules/fighter-encounters.js';
import type { MissionYield } from '../../src/web/types.js';
import {
  combatView,
  playerRemoveFighters,
  resolveGunFire,
  resolveCombatRounds,
} from '../../src/web/generators/combat-generators.js';
import { createMockCtx, createDefaultMission, driveGenerator } from './test-helpers.js';

// ─── Helpers ───

function createFighter(id: number, type: string, position: string): Fighter {
  return {
    id, type, position,
    attacksMade: 0, scoredHit: false,
    damage: [],
  };
}

// ─── Tests ───

describe('combatView', () => {
  it('maps fighters to CombatViewState', () => {
    const fighters = [
      createFighter(1, 'Me109', '12 High'),
      createFighter(2, 'FW190', '6 Level'),
    ];
    const view = combatView(fighters);
    expect(view.fighters).toHaveLength(2);
    expect(view.fighters[0]).toEqual({ id: 1, type: 'Me109', position: '12 High' });
    expect(view.fighters[1]).toEqual({ id: 2, type: 'FW190', position: '6 Level' });
  });

  it('returns empty array for no fighters', () => {
    const view = combatView([]);
    expect(view.fighters).toEqual([]);
  });
});

describe('playerRemoveFighters', () => {
  let ctx: ReturnType<typeof createMockCtx>;

  beforeEach(() => {
    ctx = createMockCtx();
  });

  it('auto-removes all when count >= removable', () => {
    const fighters = [
      createFighter(1, 'Me109', '12 High'),
      createFighter(2, 'Me109', '6 Level'),
    ];
    const gen = playerRemoveFighters(ctx, fighters, 3, 4, 'full', 4, 'outbound');
    const { result } = driveGenerator(gen, []);
    // All removable fighters are removed
    expect(result.length).toBe(0);
  });

  it('skips Vertical Dive fighters (not removable by cover)', () => {
    const fighters = [
      createFighter(1, 'Me109', '12 High'),
      createFighter(2, 'FW190', 'Vertical Dive'),
    ];
    const gen = playerRemoveFighters(ctx, fighters, 1, 4, 'full', 4, 'outbound');
    const { result } = driveGenerator(gen, []);
    // Vertical Dive fighter remains; the 12 High one is removed
    expect(result.length).toBe(1);
    expect(result[0].position).toBe('Vertical Dive');
  });

  it('yields a choice when player must pick', () => {
    const fighters = [
      createFighter(1, 'Me109', '12 High'),
      createFighter(2, 'Me109', '6 Level'),
      createFighter(3, 'FW190', '1:30 High'),
    ];
    const gen = playerRemoveFighters(ctx, fighters, 1, 4, 'partial', 4, 'outbound');
    const step = gen.next();
    expect(step.done).toBe(false);
    expect(step.value.type).toBe('choice');
    // Send selection of fighter ID 2
    const result = gen.next([2] as any);
    expect(result.done).toBe(true);
    expect(result.value).toHaveLength(2);
    expect(result.value.some((f: Fighter) => f.id === 2)).toBe(false);
  });

  it('returns all fighters if none eligible for removal', () => {
    const fighters = [
      createFighter(1, 'FW190', 'Vertical Dive'),
      createFighter(2, 'Me109', 'Vertical Dive'),
    ];
    const gen = playerRemoveFighters(ctx, fighters, 2, 4, 'full', 4, 'outbound');
    const { result } = driveGenerator(gen, []);
    expect(result.length).toBe(2);
  });
});

describe('resolveGunFire', () => {
  let ctx: ReturnType<typeof createMockCtx>;

  beforeEach(() => {
    ctx = createMockCtx();
  });

  it('deducts ammo when gun fires', () => {
    const fighter = createFighter(1, 'Me109', '12 High');
    const initialAmmo = ctx.state.campaign.aircraft.guns.find(g => g.id === 'Tail')!.ammo;
    const gen = resolveGunFire(
      ctx, 'Tail', fighter, 5, 'tail_gunner', createDefaultMission(),
      4, 'outbound', () => 0, () => {},
    );
    driveGenerator(gen, [1]); // miss
    const finalAmmo = ctx.state.campaign.aircraft.guns.find(g => g.id === 'Tail')!.ammo;
    expect(finalAmmo).toBe(initialAmmo - 1);
  });

  it('records a kill on hit + destroyed roll', () => {
    const fighter = createFighter(1, 'Me109', '12 High');
    let destroyed = 0;
    const gen = resolveGunFire(
      ctx, 'Tail', fighter, 1, 'tail_gunner', createDefaultMission(),
      4, 'outbound', () => destroyed, (v) => { destroyed = v; },
    );
    // Roll 6 for hit (always hits), then roll 6 for destroyed
    driveGenerator(gen, [6, 6]);
    expect(destroyed).toBe(1);
    expect(fighter.damage).toContain('Destroyed');
    const tailGunner = ctx.state.campaign.crew.find(c => c.position === 'tail_gunner');
    expect(tailGunner!.kills).toBe(1);
  });

  it('does nothing if fighter is already destroyed', () => {
    const fighter = createFighter(1, 'Me109', '12 High');
    fighter.damage.push('Destroyed');
    const gen = resolveGunFire(
      ctx, 'Tail', fighter, 5, 'tail_gunner', createDefaultMission(),
      4, 'outbound', () => 0, () => {},
    );
    const { yields } = driveGenerator(gen, []);
    expect(yields.length).toBe(0); // no rolls needed
  });

  it('does nothing if crew member not found', () => {
    const fighter = createFighter(1, 'Me109', '12 High');
    // Remove all crew
    ctx.state.campaign.crew = [];
    const gen = resolveGunFire(
      ctx, 'Tail', fighter, 5, 'tail_gunner', createDefaultMission(),
      4, 'outbound', () => 0, () => {},
    );
    const { yields } = driveGenerator(gen, []);
    expect(yields.length).toBe(0);
  });
});

describe('resolveCombatRounds', () => {
  let ctx: ReturnType<typeof createMockCtx>;
  const noopBailout = function* () {} as any;

  beforeEach(() => {
    ctx = createMockCtx();
  });

  it('completes when no fighters present', () => {
    const gen = resolveCombatRounds(
      ctx, [], [], createDefaultMission(), 4, 'outbound',
      () => 0, () => {}, noopBailout,
    );
    const { result } = driveGenerator(gen, []);
    expect(result.destroyed).toBe(false);
  });

  it('yields an allocation choice when fighters attack', () => {
    const fighters = [createFighter(1, 'Me109', '12 High')];
    const gen = resolveCombatRounds(
      ctx, [...fighters], fighters, createDefaultMission(), 4, 'outbound',
      () => 0, () => {}, noopBailout,
    );
    const step = gen.next();
    expect(step.done).toBe(false);
    // Should be a choice for gun allocation
    expect(step.value.type).toBe('choice');
  });

  it('reports destroyed when 4+ engines out', () => {
    // Set 3 engines out already, then combat should detect all 4 after damage
    ctx.state.campaign.aircraft.engines = ['out', 'out', 'out', 'out'];
    const fighters = [createFighter(1, 'Me109', '12 High')];
    const gen = resolveCombatRounds(
      ctx, [...fighters], fighters, createDefaultMission(), 4, 'outbound',
      () => 0, () => {}, noopBailout,
    );
    // Provide enough rolls to get through allocation (hold fire) + German offensive fire
    const rolls: (number | number[])[] = [
      [-1], // hold fire (allocation response)
      1,    // German offensive fire roll (miss)
    ];
    const { result } = driveGenerator(gen, rolls);
    // Should return destroyed since we set all 4 engines out
    expect(result.destroyed).toBe(true);
  });
});
