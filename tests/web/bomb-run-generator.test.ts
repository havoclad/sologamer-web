import { describe, it, expect, beforeEach } from 'vitest';
import { executeBombRun, FLAK_AREA_DAMAGE_TABLE } from '../../src/web/generators/bomb-run-generator.js';
import { createMockCtx, driveGenerator } from './test-helpers.js';

const noopBailout = function* () {} as any;

// ─── Tests ───

describe('FLAK_AREA_DAMAGE_TABLE', () => {
  it('maps compartment areas to damage table IDs', () => {
    expect(FLAK_AREA_DAMAGE_TABLE['Nose']).toBe('P-1');
    expect(FLAK_AREA_DAMAGE_TABLE['Pilot Compartment']).toBe('P-2');
    expect(FLAK_AREA_DAMAGE_TABLE['Bomb Bay']).toBe('P-3');
    expect(FLAK_AREA_DAMAGE_TABLE['Radio Room']).toBe('P-4');
    expect(FLAK_AREA_DAMAGE_TABLE['Waist']).toBe('P-5');
    expect(FLAK_AREA_DAMAGE_TABLE['Tail']).toBe('P-6');
    expect(FLAK_AREA_DAMAGE_TABLE['Port Wing']).toBe('B1-1');
    expect(FLAK_AREA_DAMAGE_TABLE['Starboard Wing']).toBe('B1-1');
  });
});

describe('executeBombRun', () => {
  let ctx: ReturnType<typeof createMockCtx>;
  const target = { name: 'Bremen', tableId: 'T-1', zones: 7 };

  beforeEach(() => {
    ctx = createMockCtx();
  });

  it('returns early if no bombs aboard', () => {
    ctx.state.mission!.bombsAboard = false;
    const gen = executeBombRun(ctx, target, 4, ctx.state.mission!, noopBailout);
    const { yields } = driveGenerator(gen, []);
    expect(yields).toHaveLength(0);
    const warnEmit = ctx.emitCalls.find(c => c[1].includes('No bombs'));
    expect(warnEmit).toBeDefined();
  });

  it('resolves no-flak bomb run with on-target result', () => {
    // O-2 roll: need a roll that gives "No flak" — roll 1 for O-2 typically = no flak
    // O-6 roll: on target
    // O-7 roll: accuracy
    const gen = executeBombRun(ctx, target, 4, ctx.state.mission!, noopBailout);
    // The first yield is O-2 pending roll
    const step1 = gen.next();
    expect(step1.done).toBe(false);
    expect(step1.value.type).toBe('pending');

    // Feed roll = 1 for O-2 (No flak for most targets)
    const step2 = gen.next(1);
    // If no flak, next yield is O-6 (bomb run)
    if (!step2.done && step2.value.type === 'pending') {
      // O-6 roll = 6 (on target)
      const step3 = gen.next(6);
      if (!step3.done && step3.value.type === 'pending') {
        // O-7 accuracy roll
        gen.next(7);
      }
    }
    expect(ctx.state.mission!.bombsAboard).toBe(false);
    expect(ctx.state.mission!.bombsDropped).toBe(true);
  });

  it('skips O-6 and forces OFF target when bombardier is KIA', () => {
    const bombardier = ctx.state.campaign.crew.find(c => c.position === 'bombardier')!;
    bombardier.woundSeverity = 'kia';
    bombardier.status = 'kia';

    const gen = executeBombRun(ctx, target, 4, ctx.state.mission!, noopBailout);
    // O-2: no flak (roll 1)
    gen.next();
    const step2 = gen.next(1);
    // Next yield should be O-7 directly (OFF target), not O-6
    expect(step2.done).toBe(false);
    if (!step2.done) {
      const pending = (step2.value as any).roll;
      expect(pending.tableId).toBe('O-7');
      expect(pending.purpose).toContain('OFF target');
    }
    // Feed accuracy roll
    gen.next(7);
    expect(ctx.state.mission!.bombsDropped).toBe(true);
    const offTargetEmit = ctx.emitCalls.find(c => c[1].includes('OFF target') && c[1].includes('Bombardier'));
    expect(offTargetEmit).toBeDefined();
  });

  it('skips O-6 and forces OFF target when bombardier is seriously wounded', () => {
    const bombardier = ctx.state.campaign.crew.find(c => c.position === 'bombardier')!;
    bombardier.woundSeverity = 'serious';

    const gen = executeBombRun(ctx, target, 4, ctx.state.mission!, noopBailout);
    gen.next();
    const step2 = gen.next(1); // O-2: no flak
    expect(step2.done).toBe(false);
    if (!step2.done) {
      const pending = (step2.value as any).roll;
      expect(pending.tableId).toBe('O-7');
    }
  });

  it('handles flak hits and resolves damage', () => {
    const gen = executeBombRun(ctx, target, 4, ctx.state.mission!, noopBailout);
    // O-2: heavy flak (roll 6)
    gen.next();
    gen.next(6);
    // If heavy flak, we get 3 O-3 burst rolls
    // Just drive with auto-rolls to completion
    const rolls: number[] = [];
    for (let i = 0; i < 50; i++) rolls.push(1); // all misses/low rolls
    const { yields } = driveGenerator(
      executeBombRun(ctx, target, 4, ctx.state.mission!, noopBailout),
      [6, ...rolls], // first roll = 6 for O-2 (heavy flak), then low rolls
    );
    // Should have yielded at least the O-2 roll + 3 O-3 burst rolls
    expect(yields.length).toBeGreaterThanOrEqual(4);
  });

  it('detects aircraft destruction when all engines out during flak', () => {
    // Set 3 engines out, leave 1 ok
    ctx.state.campaign.aircraft.engines = ['out', 'out', 'out', 'ok'];
    // Use a fresh ctx for a clean test
    const freshCtx = createMockCtx();
    freshCtx.state.campaign.aircraft.engines = ['out', 'out', 'out', 'out'];

    const gen = executeBombRun(freshCtx, target, 4, freshCtx.state.mission!, noopBailout);
    // O-2: roll for heavy flak
    gen.next();
    gen.next(6);
    // O-3 burst 1: hit (roll 12 = guaranteed hit)
    // After a hit, O-4 + O-5 + damage resolution would occur
    // But with all engines already out, it should detect destruction after flak damage
    // Drive with many rolls to complete
    const rolls: number[] = [];
    for (let i = 0; i < 50; i++) rolls.push(12);
    const { result } = driveGenerator(
      executeBombRun(freshCtx, target, 4, freshCtx.state.mission!, noopBailout),
      [6, ...rolls],
    );
    // The function returns void, but should have emitted destruction message
    const destructionEmit = freshCtx.emitCalls.find(c => c[1]?.includes('ALL ENGINES OUT'));
    expect(destructionEmit).toBeDefined();
  });
});
