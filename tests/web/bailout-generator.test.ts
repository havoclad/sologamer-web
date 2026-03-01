import { describe, it, expect, beforeEach } from 'vitest';
import { executeBailout } from '../../src/web/generators/bailout-generator.js';
import { createMockCtx, driveGenerator } from './test-helpers.js';

// ─── Tests ───

describe('executeBailout', () => {
  let ctx: ReturnType<typeof createMockCtx>;

  beforeEach(() => {
    ctx = createMockCtx();
  });

  it('skips already-KIA crew members', () => {
    // Kill all but one crew member
    for (let i = 1; i < ctx.state.campaign.crew.length; i++) {
      ctx.state.campaign.crew[i].status = 'kia';
      ctx.state.campaign.crew[i].woundSeverity = 'kia';
    }
    // Remaining crew member gets one roll
    const gen = executeBailout(ctx, true);
    const step = gen.next();
    // Should yield exactly one bailout roll (for the one alive crew member)
    expect(step.done).toBe(false);
    expect(step.value.type).toBe('pending');
    // Feed roll 6 = success
    const result = driveGenerator(
      executeBailout(ctx, true),
      [6], // one roll for the one alive crew member
    );
    // Mission should be aborted
    expect(ctx.state.mission!.aborted).toBe(true);
  });

  it('marks seriously wounded crew as KIA (cannot bail)', () => {
    // Make all crew seriously wounded
    for (const member of ctx.state.campaign.crew) {
      member.woundSeverity = 'serious';
    }
    const gen = executeBailout(ctx, true);
    // All seriously wounded → no rolls needed, all become KIA
    const { yields } = driveGenerator(gen, []);
    expect(yields).toHaveLength(0);
    for (const member of ctx.state.campaign.crew) {
      expect(member.status).toBe('kia');
    }
    const kiaEmit = ctx.emitCalls.find(c => c[1]?.includes('cannot bail out'));
    expect(kiaEmit).toBeDefined();
  });

  it('controlled bailout: roll 6 always succeeds', () => {
    // Keep only pilot alive for simplicity
    for (let i = 1; i < ctx.state.campaign.crew.length; i++) {
      ctx.state.campaign.crew[i].status = 'kia';
      ctx.state.campaign.crew[i].woundSeverity = 'kia';
    }
    const gen = executeBailout(ctx, true);
    gen.next(); // First yield: bailout roll for pilot
    gen.next(6); // Roll 6 = success
    // Pilot should not be KIA
    expect(ctx.state.campaign.crew[0].status).not.toBe('kia');
  });

  it('uncontrolled bailout: roll 1-5 = KIA, 6 = OK', () => {
    // Keep only pilot alive
    for (let i = 1; i < ctx.state.campaign.crew.length; i++) {
      ctx.state.campaign.crew[i].status = 'kia';
      ctx.state.campaign.crew[i].woundSeverity = 'kia';
    }
    // Roll 3 → should fail for uncontrolled
    driveGenerator(executeBailout(ctx, false), [3]);
    expect(ctx.state.campaign.crew[0].status).toBe('kia');
  });

  it('uncontrolled bailout: natural 6 succeeds', () => {
    // Fresh ctx with only pilot alive
    const ctx2 = createMockCtx();
    for (let i = 1; i < ctx2.state.campaign.crew.length; i++) {
      ctx2.state.campaign.crew[i].status = 'kia';
      ctx2.state.campaign.crew[i].woundSeverity = 'kia';
    }
    driveGenerator(executeBailout(ctx2, false), [6]);
    expect(ctx2.state.campaign.crew[0].status).not.toBe('kia');
  });

  it('sets all engines out after bailout', () => {
    // All roll 6 = bail out successfully
    const rolls = ctx.state.campaign.crew.map(() => 6);
    driveGenerator(executeBailout(ctx, true), rolls);
    expect(ctx.state.campaign.aircraft.engines).toEqual(['out', 'out', 'out', 'out']);
  });

  it('marks mission as aborted after bailout', () => {
    const rolls = ctx.state.campaign.crew.map(() => 6);
    driveGenerator(executeBailout(ctx, true), rolls);
    expect(ctx.state.mission!.aborted).toBe(true);
  });

  it('emits summary with KIA count', () => {
    // All roll 1 → controlled: roll 1 triggers sub-roll
    // Make it simple: seriously wounded → auto KIA
    for (const member of ctx.state.campaign.crew) {
      member.woundSeverity = 'serious';
    }
    driveGenerator(executeBailout(ctx, true), []);
    const summary = ctx.emitCalls.find(c => c[1]?.includes('Bailout complete'));
    expect(summary).toBeDefined();
    expect(summary![1]).toContain('KIA');
  });

  it('emits campaign ended when all crew KIA/captured', () => {
    // All seriously wounded → all KIA, none returned
    for (const member of ctx.state.campaign.crew) {
      member.woundSeverity = 'serious';
    }
    driveGenerator(executeBailout(ctx, true), []);
    const endEmit = ctx.emitCalls.find(c => c[1]?.includes('campaign ended'));
    expect(endEmit).toBeDefined();
  });

  it('controlled bailout roll 1 triggers accident sub-roll', () => {
    // Keep only pilot alive
    for (let i = 1; i < ctx.state.campaign.crew.length; i++) {
      ctx.state.campaign.crew[i].status = 'kia';
      ctx.state.campaign.crew[i].woundSeverity = 'kia';
    }
    const gen = executeBailout(ctx, true);
    gen.next();      // bailout roll yield
    const step2 = gen.next(1); // roll 1 → needs sub-roll
    // Should yield another roll for accident check
    expect(step2.done).toBe(false);
    expect(step2.value.type).toBe('pending');
    // Sub-roll 5 = OK
    gen.next(5);
    expect(ctx.state.campaign.crew[0].status).not.toBe('kia');
  });

  it('controlled bailout roll 1 + sub-roll 6 = KIA in accident', () => {
    // Keep only pilot alive
    const ctx2 = createMockCtx();
    for (let i = 1; i < ctx2.state.campaign.crew.length; i++) {
      ctx2.state.campaign.crew[i].status = 'kia';
      ctx2.state.campaign.crew[i].woundSeverity = 'kia';
    }
    driveGenerator(executeBailout(ctx2, true), [1, 6]); // roll 1 → sub-roll 6 = KIA
    expect(ctx2.state.campaign.crew[0].status).toBe('kia');
  });

  it('light wound applies -1 modifier', () => {
    // Keep only pilot alive, with light wound
    for (let i = 1; i < ctx.state.campaign.crew.length; i++) {
      ctx.state.campaign.crew[i].status = 'kia';
      ctx.state.campaign.crew[i].woundSeverity = 'kia';
    }
    ctx.state.campaign.crew[0].woundSeverity = 'light';
    const gen = executeBailout(ctx, true);
    gen.next(); // bailout roll yield
    // Roll 2 with -1 modifier = effective 1 → triggers sub-roll for controlled
    const step = gen.next(2);
    // Should yield a sub-roll (accident check)
    expect(step.done).toBe(false);
    expect(step.value.type).toBe('pending');
  });
});
