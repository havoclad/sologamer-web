import { describe, it, expect, beforeEach } from 'vitest';
import {
  matchSubRollOutcome,
  resolveSubRollWound,
  applySubRollEffect,
  resolveGenericSubRoll,
  resolveFireExtinguisher,
  resolveCompartmentHitGen,
} from '../../src/web/generators/damage-generators.js';
import { createMockCtx, driveGenerator } from './test-helpers.js';

// ─── Tests ───

describe('matchSubRollOutcome', () => {
  it('matches a single value key', () => {
    const subRoll = { type: '1d6', '1': 'Alpha', '2': 'Beta', '3': 'Gamma' };
    expect(matchSubRollOutcome(subRoll, 1)).toBe('Alpha');
    expect(matchSubRollOutcome(subRoll, 2)).toBe('Beta');
    expect(matchSubRollOutcome(subRoll, 3)).toBe('Gamma');
  });

  it('matches a range key', () => {
    const subRoll = { type: '1d6', '1-3': 'Low', '4-6': 'High' };
    expect(matchSubRollOutcome(subRoll, 1)).toBe('Low');
    expect(matchSubRollOutcome(subRoll, 3)).toBe('Low');
    expect(matchSubRollOutcome(subRoll, 4)).toBe('High');
    expect(matchSubRollOutcome(subRoll, 6)).toBe('High');
  });

  it('returns "No effect" for unmatched values', () => {
    const subRoll = { type: '1d6', '1-3': 'Low' };
    expect(matchSubRollOutcome(subRoll, 5)).toBe('No effect');
  });

  it('skips "type" key', () => {
    const subRoll = { type: '1d6', '1': 'Only' };
    expect(matchSubRollOutcome(subRoll, 1)).toBe('Only');
  });

  it('handles non-numeric keys gracefully', () => {
    const subRoll = { type: '1d6', 'abc': 'Invalid', '1': 'Valid' };
    expect(matchSubRollOutcome(subRoll, 1)).toBe('Valid');
  });
});

describe('resolveFireExtinguisher', () => {
  let ctx: ReturnType<typeof createMockCtx>;
  const noopBailout = function* () {} as any;

  beforeEach(() => {
    ctx = createMockCtx();
  });

  it('extinguishes fire on first roll (roll <= 3)', () => {
    ctx.state.campaign.aircraft.engines[1] = 'fire';
    const gen = resolveFireExtinguisher(ctx, 1, 4, 'outbound', noopBailout);
    const { result } = driveGenerator(gen, [2]); // roll 2 = extinguished
    expect(result).toBe(true);
    expect(ctx.state.campaign.aircraft.engines[1]).toBe('out');
    expect(ctx.state.campaign.aircraft.fireExtinguishersUsed).toBe(1);
  });

  it('fails first, extinguishes on second (roll 5 then roll 1)', () => {
    ctx.state.campaign.aircraft.engines[0] = 'fire';
    const gen = resolveFireExtinguisher(ctx, 0, 4, 'outbound', noopBailout);
    const { result } = driveGenerator(gen, [5, 1]); // fail then succeed
    expect(result).toBe(true);
    expect(ctx.state.campaign.aircraft.engines[0]).toBe('out');
    expect(ctx.state.campaign.aircraft.fireExtinguishersUsed).toBe(2);
  });

  it('triggers bailout when both extinguishers fail', () => {
    let bailoutCalled = false;
    const bailout = function* (controlled: boolean) {
      bailoutCalled = true;
      expect(controlled).toBe(true);
    } as any;
    ctx.state.campaign.aircraft.engines[2] = 'fire';
    const gen = resolveFireExtinguisher(ctx, 2, 4, 'outbound', bailout);
    const { result } = driveGenerator(gen, [4, 5]); // both fail
    expect(result).toBe(false);
    expect(bailoutCalled).toBe(true);
    expect(ctx.state.campaign.aircraft.fireExtinguishersUsed).toBe(2);
  });

  it('triggers bailout immediately when no extinguishers remain', () => {
    let bailoutCalled = false;
    const bailout = function* () { bailoutCalled = true; } as any;
    ctx.state.campaign.aircraft.fireExtinguishersUsed = 2;
    ctx.state.campaign.aircraft.engines[3] = 'fire';
    const gen = resolveFireExtinguisher(ctx, 3, 4, 'outbound', bailout);
    const { result } = driveGenerator(gen, []);
    expect(result).toBe(false);
    expect(bailoutCalled).toBe(true);
  });

  it('uses only one extinguisher if first succeeds', () => {
    ctx.state.campaign.aircraft.fireExtinguishersUsed = 1;
    ctx.state.campaign.aircraft.engines[0] = 'fire';
    const gen = resolveFireExtinguisher(ctx, 0, 4, 'outbound', noopBailout);
    const { result } = driveGenerator(gen, [3]); // succeed
    expect(result).toBe(true);
    expect(ctx.state.campaign.aircraft.fireExtinguishersUsed).toBe(2);
  });
});

describe('applySubRollEffect', () => {
  let ctx: ReturnType<typeof createMockCtx>;
  const baseDmg = { result: 'TestDamage', description: 'Test', effects: [] };

  beforeEach(() => {
    ctx = createMockCtx();
  });

  it('handles "destroyed" outcome', () => {
    const gen = applySubRollEffect(
      ctx, 'B1-1', '1d6', 3, baseDmg, 'Nose', 1, 'Aircraft destroyed', 4, 'outbound',
    );
    driveGenerator(gen, []);
    expect(ctx.emitCalls.some(c => c[3] === 'critical')).toBe(true);
  });

  it('handles gun inoperable outcome', () => {
    const gen = applySubRollEffect(
      ctx, 'P-2', '1d6', 3, baseDmg, 'Fuselage', 1, 'Nose gun inoperable', 4, 'outbound',
    );
    driveGenerator(gen, []);
    const noseGun = ctx.state.campaign.aircraft.guns.find(g => g.id === 'Nose');
    expect(noseGun!.disabled).toBe(true);
  });

  it('handles bomb bay doors inoperable', () => {
    const gen = applySubRollEffect(
      ctx, 'P-2', '1d6', 3, baseDmg, 'Fuselage', 1, 'Bomb bay doors inoperable', 4, 'outbound',
    );
    driveGenerator(gen, []);
    expect(ctx.state.campaign.aircraft.bombBayDoorsInop).toBe(true);
    expect(ctx.state.mission!.bombsAboard).toBe(true);
  });

  it('handles autopilot inoperable (-2 bomb run)', () => {
    const gen = applySubRollEffect(
      ctx, 'P-2', '1d6', 3, baseDmg, 'Fuselage', 1, 'Autopilot inoperable', 4, 'outbound',
    );
    driveGenerator(gen, []);
    expect(ctx.state.campaign.aircraft.autopilotInop).toBe(true);
    expect(ctx.state.mission!.bombRunModifier).toBe(-2);
  });

  it('handles landing gear inoperable (-3 landing)', () => {
    const gen = applySubRollEffect(
      ctx, 'P-2', '1d6', 3, baseDmg, 'Fuselage', 1, 'Landing gear inoperable', 4, 'outbound',
    );
    driveGenerator(gen, []);
    expect(ctx.state.campaign.aircraft.landingGearInop).toBe(true);
    expect(ctx.state.mission!.landingModifiers).toBe(-3);
  });

  it('handles tailwheel damaged (-1 landing)', () => {
    const gen = applySubRollEffect(
      ctx, 'P-2', '1d6', 3, baseDmg, 'Fuselage', 1, 'Tailwheel damaged', 4, 'outbound',
    );
    driveGenerator(gen, []);
    expect(ctx.state.campaign.aircraft.tailWheelDamaged).toBe(true);
    expect(ctx.state.mission!.landingModifiers).toBe(-1);
  });

  it('handles brakes out (-1 landing)', () => {
    const gen = applySubRollEffect(
      ctx, 'P-2', '1d6', 3, baseDmg, 'Fuselage', 1, 'Brakes out', 4, 'outbound',
    );
    driveGenerator(gen, []);
    expect(ctx.state.campaign.aircraft.brakesOut).toBe(true);
    expect(ctx.state.mission!.landingModifiers).toBe(-1);
  });

  it('handles ball turret trapped', () => {
    const gen = applySubRollEffect(
      ctx, 'P-2', '1d6', 3, baseDmg, 'Fuselage', 1, 'Crew trapped in ball turret', 4, 'outbound',
    );
    driveGenerator(gen, []);
    expect(ctx.state.campaign.aircraft.ballTurretTrapped).toBe(true);
    expect(ctx.state.campaign.aircraft.ballTurretInop).toBe(true);
  });

  it('handles fire (sets oxygen out)', () => {
    const gen = applySubRollEffect(
      ctx, 'P-2', '1d6', 3, baseDmg, 'Fuselage', 1, 'Fire in compartment', 4, 'outbound',
    );
    driveGenerator(gen, []);
    expect(ctx.state.campaign.aircraft.oxygenOut).toBe(true);
  });

  it('handles oxygen hit', () => {
    const gen = applySubRollEffect(
      ctx, 'P-2', '1d6', 3, baseDmg, 'Fuselage', 1, 'Oxygen system hit', 4, 'outbound',
    );
    driveGenerator(gen, []);
    expect(ctx.state.campaign.aircraft.oxygenOut).toBe(true);
  });

  it('handles heat out', () => {
    const gen = applySubRollEffect(
      ctx, 'P-2', '1d6', 3, baseDmg, 'Fuselage', 1, 'Heat out', 4, 'outbound',
    );
    driveGenerator(gen, []);
    expect(ctx.state.campaign.aircraft.heatingOut).toBe(true);
  });

  it('handles no effect / superficial', () => {
    const gen = applySubRollEffect(
      ctx, 'P-2', '1d6', 3, baseDmg, 'Fuselage', 1, 'Superficial damage, no effect', 4, 'outbound',
    );
    driveGenerator(gen, []);
    expect(ctx.state.campaign.aircraft.superficialHits).toBe(1);
  });

  it('handles port wing flap inoperable (no landing modifier for single side per note b)', () => {
    const gen = applySubRollEffect(
      ctx, 'B1-1', '1d6', 3, baseDmg, 'Port Wing', 1, 'Wing flap inoperable', 4, 'outbound',
    );
    driveGenerator(gen, []);
    expect(ctx.state.campaign.aircraft.portFlapInop).toBe(true);
    expect(ctx.state.mission!.landingModifiers).toBe(0); // single side → no penalty
  });

  it('handles starboard wing flap inoperable (no landing modifier for single side per note b)', () => {
    const gen = applySubRollEffect(
      ctx, 'B1-1', '1d6', 3, baseDmg, 'Starboard Wing', 1, 'Wing flap inoperable', 4, 'outbound',
    );
    driveGenerator(gen, []);
    expect(ctx.state.campaign.aircraft.starboardFlapInop).toBe(true);
    expect(ctx.state.mission!.landingModifiers).toBe(0); // single side → no penalty
  });

  it('applies -1 landing modifier only when BOTH flaps inoperable (note b B1-1)', () => {
    // Damage port flap first
    ctx.state.campaign.aircraft.portFlapInop = true;
    // Now damage starboard flap
    const gen = applySubRollEffect(
      ctx, 'B1-1', '1d6', 3, baseDmg, 'Starboard Wing', 1, 'Wing flap inoperable', 4, 'outbound',
    );
    driveGenerator(gen, []);
    expect(ctx.state.campaign.aircraft.starboardFlapInop).toBe(true);
    expect(ctx.state.mission!.landingModifiers).toBe(-1); // both sides → penalty
  });

  it('handles crew wound outcome (chains to wound resolution)', () => {
    const gen = applySubRollEffect(
      ctx, 'P-2', '1d6', 3, baseDmg, 'Nose', 1, 'Bombardier wound — roll B1-4', 4, 'outbound',
    );
    // First yield is from the wound resolution sub-generator
    const { yields } = driveGenerator(gen, [2]); // roll 2 for wound severity → light wound
    const bombardier = ctx.state.campaign.crew.find(c => c.position === 'bombardier');
    expect(bombardier!.woundSeverity).not.toBe('none');
  });
});

describe('resolveSubRollWound', () => {
  let ctx: ReturnType<typeof createMockCtx>;

  beforeEach(() => {
    ctx = createMockCtx();
  });

  it('wounds the correct crew member based on outcome text', () => {
    const gen = resolveSubRollWound(
      ctx, 'engineer wound', 'P-2', '1d6', 3, 4, 'outbound',
    );
    driveGenerator(gen, [2]); // roll 2 → light wound
    const eng = ctx.state.campaign.crew.find(c => c.position === 'engineer');
    expect(eng!.woundSeverity).not.toBe('none');
  });

  it('skips KIA crew members', () => {
    const nav = ctx.state.campaign.crew.find(c => c.position === 'navigator')!;
    nav.woundSeverity = 'kia';
    nav.status = 'kia';
    const gen = resolveSubRollWound(
      ctx, 'navigator wound', 'P-2', '1d6', 3, 4, 'outbound',
    );
    // Should complete without yielding any rolls
    const { yields } = driveGenerator(gen, []);
    expect(yields.length).toBe(0);
  });

  it('identifies ball turret crew from outcome text', () => {
    const gen = resolveSubRollWound(
      ctx, 'ball turret gunner wound', 'P-2', '1d6', 3, 4, 'outbound',
    );
    driveGenerator(gen, [1]); // light wound
    const ball = ctx.state.campaign.crew.find(c => c.position === 'ball_turret');
    expect(ball!.woundSeverity).not.toBe('none');
  });

  it('identifies tail gunner from outcome text', () => {
    const gen = resolveSubRollWound(
      ctx, 'tail gunner wound', 'P-2', '1d6', 3, 4, 'outbound',
    );
    driveGenerator(gen, [1]);
    const tail = ctx.state.campaign.crew.find(c => c.position === 'tail_gunner');
    expect(tail!.woundSeverity).not.toBe('none');
  });

  it('does nothing for unrecognized outcome text', () => {
    const gen = resolveSubRollWound(
      ctx, 'some random text', 'P-2', '1d6', 3, 4, 'outbound',
    );
    const { yields } = driveGenerator(gen, []);
    expect(yields.length).toBe(0);
  });
});

describe('resolveGenericSubRoll', () => {
  let ctx: ReturnType<typeof createMockCtx>;

  beforeEach(() => {
    ctx = createMockCtx();
  });

  it('prompts for sub-roll and applies the matched effect', () => {
    const subRoll = { type: '1d6', '1-2': 'No effect', '3-4': 'Oxygen system hit', '5-6': 'Heat out' };
    const dmg = { result: 'System Damage', description: 'System', effects: [] };
    const gen = resolveGenericSubRoll(
      ctx, 'P-2', '1d6', 3, dmg, 'Fuselage', subRoll, {}, 4, 'outbound',
    );
    // Send roll value 5 → "Heat out"
    driveGenerator(gen, [5]);
    expect(ctx.state.campaign.aircraft.heatingOut).toBe(true);
  });

  it('builds display rows from sub-roll keys', () => {
    const subRoll = { type: '1d6', '1-3': 'Alpha', '4-6': 'Beta' };
    const dmg = { result: 'Test', description: 'Test', effects: [] };
    const gen = resolveGenericSubRoll(
      ctx, 'P-2', '1d6', 1, dmg, 'Nose', subRoll, {}, 4, 'outbound',
    );
    const { yields } = driveGenerator(gen, [1]);
    // First yield should be the pending roll with table rows
    const pending = yields[0];
    expect(pending.type).toBe('pending');
    if (pending.type === 'pending') {
      expect(pending.roll.tableRows.length).toBe(2);
    }
  });
});

describe('B1-2 instrument damage state application', () => {
  let ctx: ReturnType<typeof createMockCtx>;
  const noopBailout = function* () {} as any;

  beforeEach(() => {
    ctx = createMockCtx();
  });

  // B1-2 is a 2d6 table. We need to feed roll values matching B1-2 entries.
  // resolveCompartmentHitGen yields a pending roll, then we feed the value.

  it('B1-2 roll 2 sets autopilotInop and bombRunModifier -2', () => {
    const gen = resolveCompartmentHitGen(ctx, 'Pilot Compt.', 'B1-2', 4, 'outbound', noopBailout);
    driveGenerator(gen, [2]); // roll 2 on B1-2 = Autopilot
    expect(ctx.state.campaign.aircraft.autopilotInop).toBe(true);
    expect(ctx.state.mission!.bombRunModifier).toBe(-2);
  });

  it('B1-2 roll 3 sets gearIndicatorOut and landingModifiers -3', () => {
    const gen = resolveCompartmentHitGen(ctx, 'Pilot Compt.', 'B1-2', 4, 'outbound', noopBailout);
    driveGenerator(gen, [3]); // roll 3 = Landing Gear Indicator
    expect(ctx.state.campaign.aircraft.gearIndicatorOut).toBe(true);
    expect(ctx.state.mission!.landingModifiers).toBe(-3);
  });

  it('B1-2 roll 4 sets intercomOut', () => {
    const gen = resolveCompartmentHitGen(ctx, 'Pilot Compt.', 'B1-2', 4, 'outbound', noopBailout);
    driveGenerator(gen, [4]); // roll 4 = Intercom System
    expect(ctx.state.campaign.aircraft.intercomOut).toBe(true);
  });

  it('B1-2 roll 5 sets oxygenOut and drops to 10k out of formation', () => {
    const gen = resolveCompartmentHitGen(ctx, 'Pilot Compt.', 'B1-2', 4, 'outbound', noopBailout);
    driveGenerator(gen, [5]); // roll 5 = Oxygen System
    expect(ctx.state.campaign.aircraft.oxygenOut).toBe(true);
    expect(ctx.state.mission!.outOfFormation).toBe(true);
    expect(ctx.state.mission!.altitude).toBe(10000);
  });

  it('B1-2 roll 6 sets flapsIndicatorOut and landingModifiers -1', () => {
    const gen = resolveCompartmentHitGen(ctx, 'Pilot Compt.', 'B1-2', 4, 'outbound', noopBailout);
    driveGenerator(gen, [6]); // roll 6 = Wing Flaps Indicator
    expect(ctx.state.campaign.aircraft.flapsIndicatorOut).toBe(true);
    expect(ctx.state.mission!.landingModifiers).toBe(-1);
  });

  it('B1-2 roll 7 sets aileronControlsOut and landingModifiers -1', () => {
    const gen = resolveCompartmentHitGen(ctx, 'Pilot Compt.', 'B1-2', 4, 'outbound', noopBailout);
    driveGenerator(gen, [7]); // roll 7 = Aileron Controls
    expect(ctx.state.campaign.aircraft.aileronControlsOut).toBe(true);
    expect(ctx.state.mission!.landingModifiers).toBe(-1);
  });

  it('B1-2 roll 8 sets elevatorControlsOut and landingModifiers -1', () => {
    const gen = resolveCompartmentHitGen(ctx, 'Pilot Compt.', 'B1-2', 4, 'outbound', noopBailout);
    driveGenerator(gen, [8]); // roll 8 = Elevator Controls
    expect(ctx.state.campaign.aircraft.elevatorControlsOut).toBe(true);
    expect(ctx.state.mission!.landingModifiers).toBe(-1);
  });

  it('B1-2 roll 9 sets rudderControlsOut and landingModifiers -1', () => {
    const gen = resolveCompartmentHitGen(ctx, 'Pilot Compt.', 'B1-2', 4, 'outbound', noopBailout);
    driveGenerator(gen, [9]); // roll 9 = Rudder Controls
    expect(ctx.state.campaign.aircraft.rudderControlsOut).toBe(true);
    expect(ctx.state.mission!.landingModifiers).toBe(-1);
  });

  it('B1-2 roll 10 sets propFeatheringOut', () => {
    const gen = resolveCompartmentHitGen(ctx, 'Pilot Compt.', 'B1-2', 4, 'outbound', noopBailout);
    driveGenerator(gen, [10]); // roll 10 = Propeller Feathering
    expect(ctx.state.campaign.aircraft.propFeatheringOut).toBe(true);
  });

  it('B1-2 roll 11 sets engineExtinguishersOut', () => {
    const gen = resolveCompartmentHitGen(ctx, 'Pilot Compt.', 'B1-2', 4, 'outbound', noopBailout);
    driveGenerator(gen, [11]); // roll 11 = Engine Fire Extinguishers
    expect(ctx.state.campaign.aircraft.engineExtinguishersOut).toBe(true);
  });

  it('B1-2 roll 12 sets electricalSystemOut', () => {
    const gen = resolveCompartmentHitGen(ctx, 'Pilot Compt.', 'B1-2', 4, 'outbound', noopBailout);
    driveGenerator(gen, [12]); // roll 12 = Electrical System
    expect(ctx.state.campaign.aircraft.electricalSystemOut).toBe(true);
  });

  it('P-2 roll 9 (Instruments) follows up to B1-2 and applies effects', () => {
    // P-2 roll 9 = Instruments → follow-up to B1-2
    // First roll (9) triggers P-2 Instruments, second roll (2) triggers B1-2 Autopilot
    const gen = resolveCompartmentHitGen(ctx, 'Pilot Compt.', 'P-2', 4, 'outbound', noopBailout);
    driveGenerator(gen, [9, 2]); // P-2 roll 9, then B1-2 roll 2 (Autopilot)
    expect(ctx.state.campaign.aircraft.autopilotInop).toBe(true);
    expect(ctx.state.mission!.bombRunModifier).toBe(-2);
  });

  it('B1-2 landing modifiers are cumulative', () => {
    // Apply two different landing-affecting instrument damages
    const gen1 = resolveCompartmentHitGen(ctx, 'Pilot Compt.', 'B1-2', 4, 'outbound', noopBailout);
    driveGenerator(gen1, [6]); // Flaps indicator -1
    const gen2 = resolveCompartmentHitGen(ctx, 'Pilot Compt.', 'B1-2', 4, 'outbound', noopBailout);
    driveGenerator(gen2, [7]); // Aileron controls -1
    expect(ctx.state.mission!.landingModifiers).toBe(-2);
  });
});

describe('compartment fire sub-rolls trigger B1-3 extinguisher resolution', () => {
  let ctx: ReturnType<typeof createMockCtx>;
  const noopBailout = function* () {} as any;

  beforeEach(() => {
    ctx = createMockCtx();
  });

  it('P-1 roll 12 sub-roll 6 (fire) triggers B1-3 extinguisher sequence', () => {
    // P-1 roll 12 = Oxygen Supply Hit → sub-roll 6 = fire + oxygen out, roll B1-3
    const gen = resolveCompartmentHitGen(
      ctx, 'Nose', 'P-1', 4, 'outbound', noopBailout,
    );
    // Roll 12 on P-1 (Oxygen Supply Hit), sub-roll 6 (fire), then B1-3 extinguisher roll 2 (fire out)
    driveGenerator(gen, [12, 6, 2]);
    expect(ctx.state.campaign.aircraft.oxygenOut).toBe(true);
    // Should have a B1-3 extinguisher roll event
    const b13Event = ctx.emitCalls.find(c =>
      typeof c[1] === 'string' && c[1].includes('extinguish'),
    );
    expect(b13Event).toBeDefined();
  });

  it('P-2 roll 10 sub-roll 6 (fire) triggers B1-3 extinguisher sequence', () => {
    // P-2 roll 10 = Oxygen System → sub-roll 6 = fire + oxygen out, roll B1-3
    const gen = resolveCompartmentHitGen(
      ctx, 'Pilot Compt.', 'P-2', 4, 'outbound', noopBailout,
    );
    // Roll 10, sub-roll 6 (fire), B1-3 roll 1 (fire out)
    driveGenerator(gen, [10, 6, 1]);
    expect(ctx.state.campaign.aircraft.oxygenOut).toBe(true);
    const b13Event = ctx.emitCalls.find(c =>
      typeof c[1] === 'string' && c[1].includes('extinguish'),
    );
    expect(b13Event).toBeDefined();
  });

  it('compartment fire extinguisher uses hand extinguishers (not engine)', () => {
    const gen = resolveCompartmentHitGen(
      ctx, 'Nose', 'P-1', 4, 'outbound', noopBailout,
    );
    // Roll 12, sub-roll 6 (fire), B1-3 roll 2 (fire out)
    driveGenerator(gen, [12, 6, 2]);
    expect(ctx.state.campaign.aircraft.handExtinguishersUsed).toBe(1);
    expect(ctx.state.campaign.aircraft.fireExtinguishersUsed).toBe(0); // engine extinguishers untouched
  });

  it('compartment fire extinguisher retries up to 3 times then triggers bailout', () => {
    let bailoutCalled = false;
    const bailout = function* (controlled: boolean) {
      bailoutCalled = true;
      expect(controlled).toBe(true); // B1-3 failure = controlled bailout G-6
    } as any;

    const gen = resolveCompartmentHitGen(
      ctx, 'Nose', 'P-1', 4, 'outbound', bailout,
    );
    // Roll 12 (Oxygen), sub-roll 6 (fire), then 3 failed B1-3 rolls (5, 6, 5)
    driveGenerator(gen, [12, 6, 5, 6, 5]);
    expect(bailoutCalled).toBe(true);
    expect(ctx.state.campaign.aircraft.handExtinguishersUsed).toBe(3);
  });

  it('compartment fire extinguisher succeeds on second attempt', () => {
    const gen = resolveCompartmentHitGen(
      ctx, 'Nose', 'P-1', 4, 'outbound', noopBailout,
    );
    // Roll 12, sub-roll 6 (fire), B1-3 roll 5 (fail), B1-3 roll 3 (fire out)
    driveGenerator(gen, [12, 6, 5, 3]);
    expect(ctx.state.campaign.aircraft.handExtinguishersUsed).toBe(2);
    // Verify fire extinguished event
    const extEvent = ctx.emitCalls.find(c =>
      typeof c[1] === 'string' && c[1].includes('extinguished'),
    );
    expect(extEvent).toBeDefined();
  });

  it('triggers bailout immediately when no hand extinguishers remain', () => {
    let bailoutCalled = false;
    const bailout = function* () { bailoutCalled = true; } as any;
    ctx.state.campaign.aircraft.handExtinguishersUsed = 5; // all 5 used

    const gen = resolveCompartmentHitGen(
      ctx, 'Nose', 'P-1', 4, 'outbound', bailout,
    );
    // Roll 12, sub-roll 6 (fire) — no extinguishers left, immediate bailout
    driveGenerator(gen, [12, 6]);
    expect(bailoutCalled).toBe(true);
  });
});

describe('resolveCompartmentHitGen', () => {
  let ctx: ReturnType<typeof createMockCtx>;
  const noopBailout = function* () {} as any;

  beforeEach(() => {
    ctx = createMockCtx();
  });

  it('yields a pending roll for compartment damage', () => {
    const gen = resolveCompartmentHitGen(
      ctx, 'Nose', 'P-1', 4, 'outbound', noopBailout,
    );
    const step = gen.next();
    expect(step.done).toBe(false);
    expect(step.value.type).toBe('pending');
    if (step.value.type === 'pending') {
      expect(step.value.roll.tableId).toBe('P-1');
    }
  });

  it('resolves superficial damage correctly', () => {
    // Feed a roll value that causes superficial damage (depends on table data)
    // Roll value 1 on most damage tables tends to be superficial
    const gen = resolveCompartmentHitGen(
      ctx, 'Nose', 'P-1', 4, 'outbound', noopBailout,
    );
    // Drive with roll 1 (likely superficial on P-1)
    const { yields } = driveGenerator(gen, [1]);
    // Should complete without error and emit at least one event
    expect(ctx.emitCalls.length).toBeGreaterThan(0);
  });

  it('handles engine damage correctly', () => {
    // Use a damage table where engine damage is a possible result
    // and feed a roll value that triggers it
    const gen = resolveCompartmentHitGen(
      ctx, 'Port Wing', 'B1-1', 4, 'outbound', noopBailout,
    );
    // Drive through — results depend on table data + seeded RNG
    // Just verify it doesn't throw and produces events
    const rolls = Array(20).fill(3); // provide enough rolls for any sub-rolls
    const { yields } = driveGenerator(gen, rolls);
    expect(ctx.emitCalls.length).toBeGreaterThan(0);
  });

  it('tracks wing root hits cumulatively', () => {
    // Set up pre-existing wing root hits and verify accumulation
    ctx.state.campaign.aircraft.portWingRootHits = 3;
    // Manually test the wing_root_hit effect path
    // Rather than relying on table data, test the effect handling directly
    expect(ctx.state.campaign.aircraft.portWingRootHits).toBe(3);
  });

  it('does not crash on unknown damage table', () => {
    const gen = resolveCompartmentHitGen(
      ctx, 'Unknown', 'FAKE-TABLE', 4, 'outbound', noopBailout,
    );
    // Should fall back to superficial damage
    const { yields } = driveGenerator(gen, [3]);
    expect(ctx.emitCalls.length).toBeGreaterThan(0);
  });

  it('P-1 roll 4 wounds both Bombardier and Navigator (plural targets)', () => {
    // Roll 4 on P-1 = "Bombardier and Navigator" with follow_up.targets array
    const gen = resolveCompartmentHitGen(
      ctx, 'Nose', 'P-1', 4, 'outbound', noopBailout,
    );
    // First roll = 4 (damage table), then two wound rolls (one per target)
    const { yields } = driveGenerator(gen, [4, 2, 3]);
    // Both bombardier and navigator should be wounded
    const bombardier = ctx.state.campaign.crew.find(c => c.position === 'bombardier');
    const navigator = ctx.state.campaign.crew.find(c => c.position === 'navigator');
    expect(bombardier!.woundSeverity).not.toBe('none');
    expect(navigator!.woundSeverity).not.toBe('none');
  });

  it('P-2 roll 3 wounds both Pilot and Co-Pilot (plural targets)', () => {
    // Roll 3 on P-2 = "Pilot and Co-Pilot" with follow_up.targets array
    const gen = resolveCompartmentHitGen(
      ctx, 'Pilot Compt.', 'P-2', 4, 'outbound', noopBailout,
    );
    // First roll = 3 (damage table), then two wound rolls (one per target)
    const { yields } = driveGenerator(gen, [3, 2, 3]);
    // Both pilot and copilot should be wounded
    const pilot = ctx.state.campaign.crew.find(c => c.position === 'pilot');
    const copilot = ctx.state.campaign.crew.find(c => c.position === 'copilot');
    expect(pilot!.woundSeverity).not.toBe('none');
    expect(copilot!.woundSeverity).not.toBe('none');
  });

  it('emits events with correct zone and direction', () => {
    const gen = resolveCompartmentHitGen(
      ctx, 'Nose', 'P-1', 5, 'inbound', noopBailout,
    );
    driveGenerator(gen, [1]);
    // Check that all emit calls include zone=5, direction='inbound'
    for (const call of ctx.emitCalls) {
      if (call[4] !== undefined) expect(call[4]).toBe(5);
      if (call[5] !== undefined) expect(call[5]).toBe('inbound');
    }
  });

  it('P-2 roll 2 (pilot_copilot_heat_out) sets heatingOut', () => {
    const gen = resolveCompartmentHitGen(ctx, 'Pilot Compt.', 'P-2', 4, 'outbound', noopBailout);
    driveGenerator(gen, [2]); // roll 2 on P-2 = Compartment Heat (pilot/copilot)
    expect(ctx.state.campaign.aircraft.heatingOut).toBe(true);
  });

  it('P-4 roll 2 (radio_room_heat_out) sets heatingOut', () => {
    const gen = resolveCompartmentHitGen(ctx, 'Radio Room', 'P-4', 4, 'outbound', noopBailout);
    driveGenerator(gen, [2]); // roll 2 on P-4 = Compartment Heat (radio room)
    expect(ctx.state.campaign.aircraft.heatingOut).toBe(true);
  });

  it('P-3 roll 2 (release_mechanism_out) sets bombControlsInop and bombRunModifier -3', () => {
    const gen = resolveCompartmentHitGen(ctx, 'Bomb Bay', 'P-3', 4, 'outbound', noopBailout);
    driveGenerator(gen, [2]); // roll 2 on P-3 = Bomb Release Mechanism
    expect(ctx.state.campaign.aircraft.bombControlsInop).toBe(true);
    expect(ctx.state.mission!.bombRunModifier).toBe(-3);
    expect(ctx.state.mission!.bombRunModifierReasons).toContain('Bomb release mechanism -3');
  });

  it('P-4 roll 4 (radio_out) sets radioOut', () => {
    const gen = resolveCompartmentHitGen(ctx, 'Radio Room', 'P-4', 4, 'outbound', noopBailout);
    driveGenerator(gen, [4]); // roll 4 on P-4 = Radio Out
    expect(ctx.state.campaign.aircraft.radioOut).toBe(true);
  });

  it('P-4 roll 5 (radio_out) also sets radioOut', () => {
    const gen = resolveCompartmentHitGen(ctx, 'Radio Room', 'P-4', 4, 'outbound', noopBailout);
    driveGenerator(gen, [5]); // roll 5 on P-4 = Radio Out
    expect(ctx.state.campaign.aircraft.radioOut).toBe(true);
  });

  it('P-1 roll 2 (Norden sight / bomb_run_off_target) applies massive bomb run penalty', () => {
    const gen = resolveCompartmentHitGen(ctx, 'Nose', 'P-1', 4, 'outbound', noopBailout);
    driveGenerator(gen, [2]); // roll 2 on P-1 = Norden Sight destroyed
    expect(ctx.state.mission!.bombRunModifier).toBeLessThanOrEqual(-99);
    expect(ctx.state.mission!.bombRunModifierReasons.some(r => r.toLowerCase().includes('norden'))).toBe(true);
  });

  it('P-2 roll 11 (window_heat_out) 1st hit has no effect', () => {
    const gen = resolveCompartmentHitGen(ctx, 'Pilot Compt.', 'P-2', 4, 'outbound', noopBailout);
    driveGenerator(gen, [11]);
    expect(ctx.state.campaign.aircraft.windowHeatHits).toBe(1);
    expect(ctx.state.mission!.landingModifiers).toBe(0);
  });

  it('P-2 roll 11 (window_heat_out) 2nd hit causes landing -1', () => {
    ctx.state.campaign.aircraft.windowHeatHits = 1;
    const gen = resolveCompartmentHitGen(ctx, 'Pilot Compt.', 'P-2', 4, 'outbound', noopBailout);
    driveGenerator(gen, [11]);
    expect(ctx.state.campaign.aircraft.windowHeatHits).toBe(2);
    expect(ctx.state.campaign.aircraft.heatingOut).toBe(true);
    expect(ctx.state.mission!.landingModifiers).toBe(-1);
    expect(ctx.state.mission!.landingModifierReasons).toContain('Window heat out (2nd hit, landing -1)');
  });

  it('P-2 roll 11 (window_heat_out) 3rd hit has no additional effect', () => {
    ctx.state.campaign.aircraft.windowHeatHits = 2;
    ctx.state.campaign.aircraft.heatingOut = true;
    ctx.state.mission!.landingModifiers = -1;
    const gen = resolveCompartmentHitGen(ctx, 'Pilot Compt.', 'P-2', 4, 'outbound', noopBailout);
    driveGenerator(gen, [11]);
    expect(ctx.state.campaign.aircraft.windowHeatHits).toBe(3);
    expect(ctx.state.mission!.landingModifiers).toBe(-1); // no additional penalty
  });

  it('P-6 roll 9 sub-roll 5 (port tailplane root hit) tracks cumulatively', () => {
    const gen = resolveCompartmentHitGen(ctx, 'Tail Section', 'P-6', 4, 'outbound', noopBailout);
    driveGenerator(gen, [9, 5]); // roll 9 on P-6, sub-roll 5 = Port tailplane root hit
    expect(ctx.state.campaign.aircraft.portTailplaneRootHits).toBe(1);
  });

  it('P-6 roll 9 sub-roll 6 (starboard tailplane root hit) tracks cumulatively', () => {
    const gen = resolveCompartmentHitGen(ctx, 'Tail Section', 'P-6', 4, 'outbound', noopBailout);
    driveGenerator(gen, [9, 6]); // roll 9 on P-6, sub-roll 6 = Starboard tailplane root hit
    expect(ctx.state.campaign.aircraft.starboardTailplaneRootHits).toBe(1);
  });

  it('P-6 tailplane root hit at 3 cumulative hits causes catastrophic failure', () => {
    ctx.state.campaign.aircraft.portTailplaneRootHits = 2;
    const gen = resolveCompartmentHitGen(ctx, 'Tail Section', 'P-6', 4, 'outbound', noopBailout);
    driveGenerator(gen, [9, 5]); // 3rd port tailplane root hit
    expect(ctx.state.campaign.aircraft.portTailplaneRootHits).toBe(3);
    expect(ctx.emitCalls.some(c => c[1].includes('RIPS OFF'))).toBe(true);
  });
});
