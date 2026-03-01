/**
 * Damage resolution generators — extracted from GameSession.
 *
 * These handle compartment hits, sub-roll damage, crew wounds,
 * and fire extinguisher sequences.
 */

import type { CrewPosition, WoundSeverity } from '../../games/b17/types.js';
import type { DamageResult } from '../../games/b17/rules/damage.js';
import { rollCompartmentDamage, rollCrewWound, countEnginesOut } from '../../games/b17/rules/damage.js';
import { applyWound } from '../../games/b17/rules/crew.js';
import { getCrewByPosition, POSITION_LABELS } from '../../games/b17/rules/crew.js';
import { disableGun } from '../../games/b17/rules/guns.js';
import { woundToEventSeverity } from '../../games/b17/rules/display-labels.js';
import { normalizeDiceType, type MissionYield, type PendingRoll } from '../types.js';
import type { GeneratorContext } from './generator-context.js';
import { yieldCombatRoll } from './yield-helpers.js';

// ─── matchSubRollOutcome (pure helper) ───

export function matchSubRollOutcome(subRoll: Record<string, any>, value: number): string {
  for (const [key, result] of Object.entries(subRoll)) {
    if (key === 'type') continue;
    const match = key.match(/^(\d+)(?:-(\d+))?$/);
    if (!match) continue;
    const lo = parseInt(match[1]);
    const hi = match[2] ? parseInt(match[2]) : lo;
    if (value >= lo && value <= hi) return result as string;
  }
  return 'No effect';
}

// ─── resolveSubRollWound ───

export function* resolveSubRollWound(
  ctx: GeneratorContext,
  outcomeLower: string,
  damageTable: string, dmgDiceType: string, dmgRollValue: number,
  zone: number, direction: 'outbound' | 'inbound',
): Generator<MissionYield, void, number | number[] | undefined> {
  const rng = ctx.rng;
  const tables = ctx.tables;
  const woundTargets: CrewPosition[] = [];

  if (outcomeLower.includes('ball gunner') || outcomeLower.includes('ball turret')) woundTargets.push('ball_turret');
  else if (outcomeLower.includes('engineer')) woundTargets.push('engineer');
  else if (outcomeLower.includes('port') && outcomeLower.includes('gunner')) woundTargets.push('left_waist');
  else if (outcomeLower.includes('starboard') && outcomeLower.includes('gunner')) woundTargets.push('right_waist');
  else if (outcomeLower.includes('tail gunner')) woundTargets.push('tail_gunner');
  else if (outcomeLower.includes('radio')) woundTargets.push('radioman');
  else if (outcomeLower.includes('navigator')) woundTargets.push('navigator');
  else if (outcomeLower.includes('bombardier')) woundTargets.push('bombardier');
  else if (outcomeLower.includes('pilot')) woundTargets.push('pilot');

  for (const pos of woundTargets) {
    const crew = getCrewByPosition(ctx.state.campaign.crew, pos);
    if (crew && crew.woundSeverity !== 'kia') {
      const woundRollValue: number = yield* yieldCombatRoll(
        ctx,
        'B1-4', 'Wound Severity',
        `Wound severity for ${crew.name} (${POSITION_LABELS[pos]})`, '1d6',
        [
          { roll: '1-3', columns: { result: 'Light wound' } },
          { roll: '4-5', columns: { result: 'Serious wound' } },
          { roll: '6', columns: { result: 'KIA' } },
        ],
      );

      let severity: WoundSeverity;
      try { severity = rollCrewWound(ctx.createFixedRng(woundRollValue), tables); } catch { severity = 'light'; }
      applyWound(crew, severity);
      const sev = woundToEventSeverity(severity);
      ctx.emit('DAMAGE', `${crew.name} (${POSITION_LABELS[pos]}): ${severity} wound`, 'damage', sev, zone, direction,
        [
          { table: damageTable, rollType: dmgDiceType, rolled: dmgRollValue, result: 'Sub-roll wound', description: 'Damage sub-roll' },
          { table: 'B1-4', rollType: '1d6', rolled: woundRollValue, result: severity, description: 'Wound severity' },
        ], true);
    }
  }
}

// ─── applySubRollEffect ───

export function* applySubRollEffect(
  ctx: GeneratorContext,
  damageTable: string, dmgDiceType: string, dmgRollValue: number,
  dmg: DamageResult, location: string,
  subRollValue: number, outcome: string,
  zone: number, direction: 'outbound' | 'inbound',
): Generator<MissionYield, void, number | number[] | undefined> {
  const ac = ctx.state.campaign.aircraft;
  const mission = ctx.state.mission;
  const outcomeLower = outcome.toLowerCase();
  let severity: 'info' | 'warn' | 'bad' | 'critical' | 'good' = 'warn';
  let isImportant = false;

  // ── B-17 destroyed (bombs detonate) ──
  if (outcomeLower.includes('destroyed') || outcomeLower.includes('detonate')) {
    severity = 'critical'; isImportant = true;
    ctx.emit('DAMAGE', `${location}: ${outcome}`, 'damage', severity, zone, direction,
      [
        { table: damageTable, rollType: dmgDiceType, rolled: dmgRollValue, result: dmg.result, description: `${location} damage` },
        { table: damageTable, rollType: '1d6', rolled: subRollValue, result: outcome, description: 'Sub-roll result' },
      ], isImportant);
    return;
  }

  // ── Gun damage ──
  if ((outcomeLower.includes('gun') && outcomeLower.includes('inoperable')) || outcomeLower.includes('guns out')) {
    let gunId: import('../../games/b17/rules/combat.js').GunPosition | null = null;
    if (outcomeLower.includes('nose gun')) gunId = 'Nose';
    else if (outcomeLower.includes('port cheek')) gunId = 'Port_Cheek';
    else if (outcomeLower.includes('starboard cheek')) gunId = 'Starboard_Cheek';
    else if (outcomeLower.includes('top turret')) gunId = 'Top_Turret';
    else if (outcomeLower.includes('ball turret')) gunId = 'Ball_Turret';
    else if (outcomeLower.includes('port waist') || outcomeLower.includes('port gun')) gunId = 'Port_Waist';
    else if (outcomeLower.includes('starboard waist') || outcomeLower.includes('starboard gun')) gunId = 'Starboard_Waist';
    else if (outcomeLower.includes('tail')) gunId = 'Tail';
    else if (outcomeLower.includes('radio')) gunId = 'Radio';
    if (gunId) {
      disableGun(ac.guns, gunId);
      // For top turret + wound combo (P-2 roll 8, sub-roll 6)
      if (outcomeLower.includes('wound') || outcomeLower.includes('b1-4')) {
        severity = 'bad'; isImportant = true;
        ctx.emit('DAMAGE', `${location}: ${outcome}`, 'damage', severity, zone, direction,
          [
            { table: damageTable, rollType: dmgDiceType, rolled: dmgRollValue, result: dmg.result, description: `${location} damage` },
            { table: damageTable, rollType: '1d6', rolled: subRollValue, result: outcome, description: 'Sub-roll result' },
          ], isImportant);
        // Chain to wound resolution
        yield* resolveSubRollWound(ctx, outcomeLower, damageTable, dmgDiceType, dmgRollValue, zone, direction);
        return;
      }
    }
    severity = 'bad'; isImportant = true;
  }
  // ── Crew wound (no gun damage) ──
  else if (outcomeLower.includes('wound') || outcomeLower.includes('b1-4')) {
    severity = 'bad'; isImportant = true;
    ctx.emit('DAMAGE', `${location}: ${outcome}`, 'damage', severity, zone, direction,
      [
        { table: damageTable, rollType: dmgDiceType, rolled: dmgRollValue, result: dmg.result, description: `${location} damage` },
        { table: damageTable, rollType: '1d6', rolled: subRollValue, result: outcome, description: 'Sub-roll result' },
      ], isImportant);
    yield* resolveSubRollWound(ctx, outcomeLower, damageTable, dmgDiceType, dmgRollValue, zone, direction);
    return;
  }
  // ── Bomb bay doors inoperable ──
  else if (outcomeLower.includes('bomb bay doors inoperable') || outcomeLower.includes('bomb bay doors') && outcomeLower.includes('inoperable')) {
    ac.bombBayDoorsInop = true;
    if (mission) mission.bombsAboard = true; // can't drop
    severity = 'bad'; isImportant = true;
  }
  // ── Bomb controls inoperable (bomb run -3) ──
  else if (outcomeLower.includes('bomb controls inoperable') || outcomeLower.includes('bombs must be dropped manually')) {
    ac.bombControlsInop = true;
    if (mission) { mission.bombRunModifier -= 3; mission.bombRunModifierReasons.push('Bomb controls -3'); }
    severity = 'bad'; isImportant = true;
  }
  // ── Autopilot inoperable (bomb run -2) ──
  else if (outcomeLower.includes('autopilot') && outcomeLower.includes('inoperable')) {
    ac.autopilotInop = true;
    if (mission) { mission.bombRunModifier -= 2; mission.bombRunModifierReasons.push('Autopilot -2'); }
    severity = 'bad'; isImportant = true;
  }
  // ── Tailwheel damaged (landing -1) ──
  else if (outcomeLower.includes('tailwheel damaged')) {
    ac.tailWheelDamaged = true;
    if (mission) { mission.landingModifiers -= 1; mission.landingModifierReasons.push('Tailwheel -1'); }
    severity = 'bad'; isImportant = true;
  }
  // ── Brakes out (landing -1) ──
  else if (outcomeLower.includes('brakes out')) {
    ac.brakesOut = true;
    if (mission) { mission.landingModifiers -= 1; mission.landingModifierReasons.push('Brakes -1'); }
    severity = 'bad'; isImportant = true;
  }
  // ── Landing gear inoperable (landing -3) ──
  else if (outcomeLower.includes('landing gear inoperable')) {
    ac.landingGearInop = true;
    if (mission) { mission.landingModifiers -= 3; mission.landingModifierReasons.push('Landing gear -3'); }
    severity = 'critical'; isImportant = true;
  }
  // ── Wing flap inoperable (landing -1) ──
  else if (outcomeLower.includes('flap inoperable') || outcomeLower.includes('wing flap inoperable')) {
    const isPort = location === 'Port Wing';
    if (isPort) ac.portFlapInop = true; else ac.starboardFlapInop = true;
    if (mission) { mission.landingModifiers -= 1; mission.landingModifierReasons.push(`${isPort ? 'Port' : 'Starboard'} flap -1`); }
    severity = 'bad'; isImportant = true;
  }
  // ── Aileron inoperable (landing -1) ──
  else if (outcomeLower.includes('aileron inoperable')) {
    const isPort = location === 'Port Wing';
    if (isPort) ac.portAileronInop = true; else ac.starboardAileronInop = true;
    if (mission) { mission.landingModifiers -= 1; mission.landingModifierReasons.push(`${isPort ? 'Port' : 'Starboard'} aileron -1`); }
    severity = 'bad'; isImportant = true;
  }
  // ── Elevator inoperable ──
  else if (outcomeLower.includes('elevator inoperable')) {
    if (outcomeLower.includes('port')) ac.portElevatorInop = true;
    else ac.starboardElevatorInop = true;
    if (ac.portElevatorInop && ac.starboardElevatorInop && mission) {
      mission.landingModifiers -= 1;
      mission.landingModifierReasons.push('Both elevators -1');
    }
    severity = 'bad'; isImportant = true;
  }
  // ── Tailplane root hit ──
  else if (outcomeLower.includes('tailplane root')) {
    severity = 'bad'; isImportant = true;
  }
  // ── Ball turret mechanism inoperable (trapped) ──
  else if (outcomeLower.includes('trapped') || (outcomeLower.includes('turret mechanism') && outcomeLower.includes('inoperable'))) {
    ac.ballTurretTrapped = true;
    ac.ballTurretInop = true;
    disableGun(ac.guns, 'Ball_Turret');
    severity = 'critical'; isImportant = true;
  }
  // ── Navigator equipment inoperable ──
  else if (outcomeLower.includes('navigator') && outcomeLower.includes('equipment inoperable')) {
    ac.navigatorEquipInop = true;
    severity = 'bad'; isImportant = true;
  }
  // ── Fire + oxygen out ──
  else if (outcomeLower.includes('fire')) {
    ac.oxygenOut = true;
    severity = 'critical'; isImportant = true;
  }
  // ── Oxygen hit (no fire) ──
  else if (outcomeLower.includes('oxygen')) {
    ac.oxygenOut = true;
    severity = 'warn';
  }
  // ── Heat out ──
  else if (outcomeLower.includes('heat out')) {
    ac.heatingOut = true;
    severity = 'warn';
  }
  // ── No effect / superficial ──
  else if (outcomeLower.includes('no effect') || outcomeLower.includes('superficial')) {
    if (outcomeLower.includes('superficial')) {
      ac.superficialHits = (ac.superficialHits || 0) + 1;
    }
    severity = 'info';
  }

  ctx.emit('DAMAGE', `${location}: ${outcome}`, 'damage', severity, zone, direction,
    [
      { table: damageTable, rollType: dmgDiceType, rolled: dmgRollValue, result: dmg.result, description: `${location} damage` },
      { table: damageTable, rollType: '1d6', rolled: subRollValue, result: outcome, description: 'Sub-roll result' },
    ], isImportant);
}

// ─── resolveGenericSubRoll ───

export function* resolveGenericSubRoll(
  ctx: GeneratorContext,
  damageTable: string, dmgDiceType: string, dmgRollValue: number,
  dmg: DamageResult, location: string,
  subRoll: Record<string, any>, _rollEntry: any,
  zone: number, direction: 'outbound' | 'inbound',
): Generator<MissionYield, void, number | number[] | undefined> {
  // Build display rows from sub_roll keys
  const rows: PendingRoll['tableRows'] = Object.entries(subRoll)
    .filter(([k]) => k !== 'type')
    .map(([k, v]) => ({ roll: k, columns: { result: v as string } }));

  // Prompt player for the 1d6 sub-roll
  const subRollValue: number = yield* yieldCombatRoll(
    ctx,
    damageTable, `${dmg.result}`,
    `${location}: ${dmg.result} — roll for specific effect`, '1d6',
    rows,
  );

  // Find matching outcome
  const outcome = matchSubRollOutcome(subRoll, subRollValue);

  // Apply effect to state
  yield* applySubRollEffect(
    ctx,
    damageTable, dmgDiceType, dmgRollValue, dmg,
    location, subRollValue, outcome,
    zone, direction,
  );
}

// ─── resolveFireExtinguisher ───

/**
 * Fire extinguisher sequence per B1-1 note (e).
 * Returns true if fire was extinguished, false if bailout was triggered.
 *
 * Note: This function needs a bailout generator to call when fire cannot be
 * extinguished. It receives it as a parameter to avoid circular dependencies.
 */
export function* resolveFireExtinguisher(
  ctx: GeneratorContext,
  engIdx: number, zone: number, direction: 'outbound' | 'inbound',
  executeBailout: (controlled: boolean) => Generator<MissionYield, void, number | number[] | undefined>,
): Generator<MissionYield, boolean, number | number[] | undefined> {
  const ac = ctx.state.campaign.aircraft;
  const engLabel = `Engine #${engIdx + 1}`;
  const extRemaining = 2 - (ac.fireExtinguishersUsed || 0);

  if (extRemaining <= 0) {
    ctx.emit('DAMAGE', `${engLabel} on fire — no fire extinguishers remaining!`, 'damage', 'critical', zone, direction);
    ctx.emit('DAMAGE', 'Engine fire uncontrolled — crew ordered to bail out (G-6 controlled bailout)', 'damage', 'critical', zone, direction, undefined, true);
    yield* executeBailout(true);
    return false;
  }

  // First extinguisher
  ctx.emit('DAMAGE', `${engLabel} on fire — attempting fire extinguisher (${extRemaining} remaining)`, 'damage', 'warn', zone, direction);
  const roll1: number = yield* yieldCombatRoll(
    ctx,
    'B1-1', 'Fire Extinguisher',
    `Roll to extinguish ${engLabel} fire (1-3 = out, 4-6 = fail)`, '1d6',
    [
      { roll: '1-3', columns: { result: 'Fire extinguished!' } },
      { roll: '4-6', columns: { result: 'Extinguisher failed' } },
    ],
  );

  ac.fireExtinguishersUsed = (ac.fireExtinguishersUsed || 0) + 1;

  if (roll1 <= 3) {
    ac.engines[engIdx] = 'out'; // fire is out, engine still dead
    ctx.emit('DAMAGE', `${engLabel}: Fire extinguished!`, 'damage', 'good', zone, direction,
      [{ table: 'B1-1', rollType: '1d6', rolled: roll1, result: 'Fire extinguished', description: 'Fire extinguisher roll' }], true);
    return true;
  }

  ctx.emit('DAMAGE', `${engLabel}: Extinguisher failed!`, 'damage', 'bad', zone, direction,
    [{ table: 'B1-1', rollType: '1d6', rolled: roll1, result: 'Failed', description: 'Fire extinguisher roll' }]);

  // Second extinguisher?
  const ext2Remaining = 2 - ac.fireExtinguishersUsed;
  if (ext2Remaining <= 0) {
    ctx.emit('DAMAGE', `Both extinguishers exhausted — ${engLabel} fire continues!`, 'damage', 'critical', zone, direction, undefined, true);
    ctx.emit('DAMAGE', 'Engine fire uncontrolled — crew ordered to bail out (G-6 controlled bailout)', 'damage', 'critical', zone, direction, undefined, true);
    yield* executeBailout(true);
    return false;
  }

  ctx.emit('DAMAGE', `Trying second extinguisher on ${engLabel} (${ext2Remaining} remaining)`, 'damage', 'warn', zone, direction);
  const roll2: number = yield* yieldCombatRoll(
    ctx,
    'B1-1', 'Fire Extinguisher (2nd attempt)',
    `Roll to extinguish ${engLabel} fire (1-3 = out, 4-6 = fail)`, '1d6',
    [
      { roll: '1-3', columns: { result: 'Fire extinguished!' } },
      { roll: '4-6', columns: { result: 'Extinguisher failed' } },
    ],
  );

  ac.fireExtinguishersUsed++;

  if (roll2 <= 3) {
    ac.engines[engIdx] = 'out';
    ctx.emit('DAMAGE', `${engLabel}: Fire extinguished!`, 'damage', 'good', zone, direction,
      [{ table: 'B1-1', rollType: '1d6', rolled: roll2, result: 'Fire extinguished', description: 'Fire extinguisher roll (2nd)' }], true);
    return true;
  }

  ctx.emit('DAMAGE', `Both extinguishers exhausted — ${engLabel} fire continues!`, 'damage', 'critical', zone, direction,
    [{ table: 'B1-1', rollType: '1d6', rolled: roll2, result: 'Failed', description: 'Fire extinguisher roll (2nd)' }], true);
  ctx.emit('DAMAGE', 'Engine fire uncontrolled — crew ordered to bail out (G-6 controlled bailout)', 'damage', 'critical', zone, direction, undefined, true);
  yield* executeBailout(true);
  return false;
}

// ─── resolveCompartmentHitGen (main entry point) ───

/**
 * Resolve a compartment hit — the main damage resolution generator.
 *
 * executeBailout is passed through to resolveFireExtinguisher for when
 * engine fires cannot be controlled.
 */
export function* resolveCompartmentHitGen(
  ctx: GeneratorContext,
  location: string, damageTable: string,
  zone: number, direction: 'outbound' | 'inbound',
  executeBailout: (controlled: boolean) => Generator<MissionYield, void, number | number[] | undefined>,
): Generator<MissionYield, void, number | number[] | undefined> {
  const rng = ctx.rng;
  const tables = ctx.tables;

  // Yield for compartment damage roll
  const dmgTableDisplay = tables.getTableDisplayData(damageTable);
  const dmgDiceType = normalizeDiceType(dmgTableDisplay?.rolltype ?? '1d6');
  const dmgRollValue: number = yield* yieldCombatRoll(
    ctx,
    damageTable, dmgTableDisplay?.title ?? damageTable,
    `Damage to ${location}`, dmgDiceType,
    dmgTableDisplay?.rows ?? [],
  );

  let dmg: DamageResult;
  try {
    dmg = rollCompartmentDamage(damageTable, ctx.createFixedRng(dmgRollValue), tables);
  } catch {
    dmg = { result: 'Superficial', description: 'No effect', effects: [{ type: 'superficial' }] };
  }

  for (const effect of dmg.effects) {
    switch (effect.type) {
      case 'superficial':
        ctx.state.campaign.aircraft.superficialHits = (ctx.state.campaign.aircraft.superficialHits || 0) + 1;
        ctx.emit('DAMAGE', `${location}: Superficial — no effect`, 'damage', 'info', zone, direction,
          [{ table: damageTable, rollType: dmgDiceType, rolled: dmgRollValue, result: 'Superficial' }]);
        break;
      case 'crew_wound': {
        const pos = effect.position as CrewPosition;
        const crew = getCrewByPosition(ctx.state.campaign.crew, pos);
        if (crew && crew.woundSeverity !== 'kia') {
          const woundRollValue: number = yield* yieldCombatRoll(
            ctx,
            'B1-4', 'Wound Severity',
            `Wound severity for ${crew.name} (${POSITION_LABELS[pos]})`, '1d6',
            [
              { roll: '1-3', columns: { result: 'Light wound' } },
              { roll: '4-5', columns: { result: 'Serious wound' } },
              { roll: '6', columns: { result: 'KIA' } },
            ],
          );

          let severity: WoundSeverity;
          try { severity = rollCrewWound(ctx.createFixedRng(woundRollValue), tables); } catch { severity = 'light'; }
          applyWound(crew, severity);
          const sev = woundToEventSeverity(severity);
          ctx.emit('DAMAGE', `${crew.name} (${POSITION_LABELS[pos]}): ${severity} wound`, 'damage', sev, zone, direction,
            [
              { table: damageTable, rollType: dmgDiceType, rolled: dmgRollValue, result: 'Crew wound', description: `${location} damage` },
              { table: 'B1-4', rollType: '1d6', rolled: woundRollValue, result: severity, description: 'Wound severity' },
            ], true);
          if (countEnginesOut(ctx.state.campaign.aircraft) >= 2 && ctx.state.mission) {
            ctx.state.mission.outOfFormation = true;
          }
        }
        break;
      }
      case 'engine_damage': {
        const engIdx = effect.engine ?? rng.int(0, 3);
        if (ctx.state.campaign.aircraft.engines[engIdx] !== 'out') {
          ctx.state.campaign.aircraft.engines[engIdx] = 'out';
          ctx.emit('DAMAGE', `Engine #${engIdx + 1} knocked out!`, 'damage', 'bad', zone, direction,
            [{ table: damageTable, rollType: dmgDiceType, rolled: dmgRollValue, result: `Engine #${engIdx + 1} out` }], true);
          const out = countEnginesOut(ctx.state.campaign.aircraft);
          if (out >= 2 && ctx.state.mission) {
            ctx.state.mission.outOfFormation = true;
            ctx.emit('DAMAGE', `${out} engines out — out of formation!`, 'damage', 'bad', zone, direction);
          }
        }
        break;
      }
      case 'fire':
        ctx.emit('DAMAGE', `FIRE in ${location}!`, 'damage', 'critical', zone, direction,
          [{ table: damageTable, rollType: dmgDiceType, rolled: dmgRollValue, result: 'Fire' }], true);
        break;
      case 'oxygen_hit':
        ctx.state.campaign.aircraft.oxygenOut = true;
        ctx.emit('DAMAGE', `Oxygen system damaged`, 'damage', 'warn', zone, direction,
          [{ table: damageTable, rollType: dmgDiceType, rolled: dmgRollValue, result: 'Oxygen hit' }]);
        break;
      case 'control_damage':
        ctx.emit('DAMAGE', `Control surface damage`, 'damage', 'bad', zone, direction,
          [{ table: damageTable, rollType: dmgDiceType, rolled: dmgRollValue, result: 'Control damage' }]);
        if (ctx.state.mission) { ctx.state.mission.landingModifiers -= 1; ctx.state.mission.landingModifierReasons.push('Control damage -1'); }
        break;
      case 'wing_root_hit': {
        const isPort = location.toLowerCase().includes('port');
        if (isPort) {
          ctx.state.campaign.aircraft.portWingRootHits = (ctx.state.campaign.aircraft.portWingRootHits || 0) + 1;
          const hits = ctx.state.campaign.aircraft.portWingRootHits;
          if (hits >= 5) {
            ctx.emit('DAMAGE', `Port wing root: ${hits}/5 hits — WING RIPS OFF!`, 'damage', 'critical', zone, direction,
              [{ table: damageTable, rollType: dmgDiceType, rolled: dmgRollValue, result: 'Wing root hit (destroyed)' }], true);
          } else {
            ctx.emit('DAMAGE', `Port wing root hit (${hits}/5)`, 'damage', 'bad', zone, direction,
              [{ table: damageTable, rollType: dmgDiceType, rolled: dmgRollValue, result: `Wing root hit ${hits}/5` }], true);
          }
        } else {
          ctx.state.campaign.aircraft.starboardWingRootHits = (ctx.state.campaign.aircraft.starboardWingRootHits || 0) + 1;
          const hits = ctx.state.campaign.aircraft.starboardWingRootHits;
          if (hits >= 5) {
            ctx.emit('DAMAGE', `Starboard wing root: ${hits}/5 hits — WING RIPS OFF!`, 'damage', 'critical', zone, direction,
              [{ table: damageTable, rollType: dmgDiceType, rolled: dmgRollValue, result: 'Wing root hit (destroyed)' }], true);
          } else {
            ctx.emit('DAMAGE', `Starboard wing root hit (${hits}/5)`, 'damage', 'bad', zone, direction,
              [{ table: damageTable, rollType: dmgDiceType, rolled: dmgRollValue, result: `Wing root hit ${hits}/5` }], true);
          }
        }
        break;
      }
      case 'destroyed':
        ctx.emit('DAMAGE', `CATASTROPHIC DAMAGE — aircraft destroyed!`, 'damage', 'critical', zone, direction,
          [{ table: damageTable, rollType: dmgDiceType, rolled: dmgRollValue, result: 'Destroyed' }], true);
        break;
      case 'follow_up_table': {
        const subRollData = tables.get(damageTable)?.raw as any;
        const rollEntry = subRollData?.rolls?.[String(dmgRollValue)];
        const subRoll = rollEntry?.sub_roll;

        if (subRoll?.type === 'fuel_tank') {
          // ── Fuel Tank sub-rolls ──
          const isPort = location === 'Port Wing';
          const wingLabel = isPort ? 'Port' : 'Starboard';

          const tankLocRoll: number = yield* yieldCombatRoll(
            ctx,
            'B1-1', `${wingLabel} Wing Fuel Tank Location`,
            `Which fuel tank was hit?`, '1d6',
            [
              { roll: '1-3', columns: { result: 'Outboard tank' } },
              { roll: '4-6', columns: { result: 'Inboard tank' } },
            ],
          );
          const tankLocation = tankLocRoll <= 3 ? 'Outboard tank' : 'Inboard tank';

          const tankDmgRoll: number = yield* yieldCombatRoll(
            ctx,
            'B1-1', `${wingLabel} Wing Fuel Tank Damage`,
            `Damage to ${tankLocation}`, '1d6',
            [
              { roll: '1-2', columns: { result: 'Fire — roll to extinguish on Table B1-3' } },
              { roll: '3-4', columns: { result: 'Fuel leak — limited range' } },
              { roll: '5-6', columns: { result: 'Self-seal, no effect' } },
            ],
          );

          if (tankDmgRoll <= 2) {
            ctx.state.campaign.aircraft.fuelFire = true;
            ctx.emit('DAMAGE', `FUEL FIRE in ${wingLabel} wing ${tankLocation}!`, 'damage', 'critical', zone, direction,
              [
                { table: damageTable, rollType: dmgDiceType, rolled: dmgRollValue, result: 'Fuel Tank' },
                { table: 'B1-1', rollType: '1d6', rolled: tankLocRoll, result: tankLocation, description: 'Tank location' },
                { table: 'B1-1', rollType: '1d6', rolled: tankDmgRoll, result: 'Fire', description: 'Fuel tank damage' },
              ], true);
          } else if (tankDmgRoll <= 4) {
            ctx.state.campaign.aircraft.fuelLeak = true;
            ctx.emit('DAMAGE', `Fuel leak in ${wingLabel} wing ${tankLocation} — limited range`, 'damage', 'bad', zone, direction,
              [
                { table: damageTable, rollType: dmgDiceType, rolled: dmgRollValue, result: 'Fuel Tank' },
                { table: 'B1-1', rollType: '1d6', rolled: tankLocRoll, result: tankLocation, description: 'Tank location' },
                { table: 'B1-1', rollType: '1d6', rolled: tankDmgRoll, result: 'Fuel leak', description: 'Fuel tank damage' },
              ], true);
          } else {
            ctx.emit('DAMAGE', `${wingLabel} wing ${tankLocation} hit — self-sealed, no effect`, 'damage', 'good', zone, direction,
              [
                { table: damageTable, rollType: dmgDiceType, rolled: dmgRollValue, result: 'Fuel Tank' },
                { table: 'B1-1', rollType: '1d6', rolled: tankLocRoll, result: tankLocation, description: 'Tank location' },
                { table: 'B1-1', rollType: '1d6', rolled: tankDmgRoll, result: 'Self-seal', description: 'Fuel tank damage' },
              ]);
          }
        } else if (subRoll?.type === 'engine_hit') {
          // ── Engine sub-rolls ──
          const isPort = location === 'Port Wing';
          const wingLabel = isPort ? 'Port' : 'Starboard';
          const enginePair = isPort
            ? { lo: '#1 engine', hi: '#2 engine', loIdx: 0, hiIdx: 1 }
            : { lo: '#3 engine', hi: '#4 engine', loIdx: 2, hiIdx: 3 };

          const engLocRoll: number = yield* yieldCombatRoll(
            ctx,
            'B1-1', `${wingLabel} Wing Engine Hit`,
            `Which engine was hit?`, '1d6',
            [
              { roll: '1-3', columns: { result: enginePair.lo } },
              { roll: '4-6', columns: { result: enginePair.hi } },
            ],
          );
          const engIdx = engLocRoll <= 3 ? enginePair.loIdx : enginePair.hiIdx;
          const engLabel = `Engine #${engIdx + 1}`;

          const engDmgRoll: number = yield* yieldCombatRoll(
            ctx,
            'B1-1', `${engLabel} Damage`,
            `Damage to ${engLabel}`, '1d6',
            [
              { roll: '1-2', columns: { result: 'Superficial damage — no effect' } },
              { roll: '3-4', columns: { result: 'Engine out' } },
              { roll: '5', columns: { result: 'Runaway engine' } },
              { roll: '6', columns: { result: 'Oil tank hit' } },
            ],
          );

          if (engDmgRoll <= 2) {
            ctx.emit('DAMAGE', `${engLabel}: Superficial — no effect`, 'damage', 'info', zone, direction,
              [
                { table: damageTable, rollType: dmgDiceType, rolled: dmgRollValue, result: 'Engines' },
                { table: 'B1-1', rollType: '1d6', rolled: engLocRoll, result: engLabel, description: 'Engine location' },
                { table: 'B1-1', rollType: '1d6', rolled: engDmgRoll, result: 'Superficial', description: 'Engine damage' },
              ]);
          } else if (engDmgRoll <= 4) {
            if (ctx.state.campaign.aircraft.engines[engIdx] !== 'out') {
              ctx.state.campaign.aircraft.engines[engIdx] = 'out';
              ctx.emit('DAMAGE', `${engLabel} knocked out!`, 'damage', 'bad', zone, direction,
                [
                  { table: damageTable, rollType: dmgDiceType, rolled: dmgRollValue, result: 'Engines' },
                  { table: 'B1-1', rollType: '1d6', rolled: engLocRoll, result: engLabel, description: 'Engine location' },
                  { table: 'B1-1', rollType: '1d6', rolled: engDmgRoll, result: 'Engine out', description: 'Engine damage' },
                ], true);
              const out = countEnginesOut(ctx.state.campaign.aircraft);
              if (out >= 2 && ctx.state.mission) {
                ctx.state.mission.outOfFormation = true;
                ctx.emit('DAMAGE', `${out} engines out — out of formation!`, 'damage', 'bad', zone, direction);
              }
            }
          } else if (engDmgRoll === 5) {
            if (ctx.state.campaign.aircraft.engines[engIdx] !== 'out') {
              ctx.state.campaign.aircraft.engines[engIdx] = 'out';
              ctx.emit('DAMAGE', `${engLabel} RUNAWAY — engine out!`, 'damage', 'bad', zone, direction,
                [
                  { table: damageTable, rollType: dmgDiceType, rolled: dmgRollValue, result: 'Engines' },
                  { table: 'B1-1', rollType: '1d6', rolled: engLocRoll, result: engLabel, description: 'Engine location' },
                  { table: 'B1-1', rollType: '1d6', rolled: engDmgRoll, result: 'Runaway engine', description: 'Engine damage' },
                ], true);
              const out = countEnginesOut(ctx.state.campaign.aircraft);
              if (out >= 2 && ctx.state.mission) {
                ctx.state.mission.outOfFormation = true;
                ctx.emit('DAMAGE', `${out} engines out — out of formation!`, 'damage', 'bad', zone, direction);
              }
            }
          } else {
            // Oil tank hit — engine out + fire
            ctx.state.campaign.aircraft.engines[engIdx] = 'fire';
            ctx.emit('DAMAGE', `${engLabel} OIL TANK HIT — engine out, fire!`, 'damage', 'critical', zone, direction,
              [
                { table: damageTable, rollType: dmgDiceType, rolled: dmgRollValue, result: 'Engines' },
                { table: 'B1-1', rollType: '1d6', rolled: engLocRoll, result: engLabel, description: 'Engine location' },
                { table: 'B1-1', rollType: '1d6', rolled: engDmgRoll, result: 'Oil tank hit', description: 'Engine damage' },
              ], true);
            const out = countEnginesOut(ctx.state.campaign.aircraft);
            if (out >= 2 && ctx.state.mission) {
              ctx.state.mission.outOfFormation = true;
              ctx.emit('DAMAGE', `${out} engines out — out of formation!`, 'damage', 'bad', zone, direction);
            }
            // Fire extinguisher sequence
            yield* resolveFireExtinguisher(ctx, engIdx, zone, direction, executeBailout);
          }
        } else if (effect.table === 'B1-4') {
          // ── Crew wound follow-up (B1-4) ──
          const targetText = (effect.target ?? rollEntry?.follow_up?.target ?? '') as string;
          const woundTargets: CrewPosition[] = [];
          if (/port\s*waist/i.test(targetText)) woundTargets.push('left_waist');
          else if (/starboard\s*waist/i.test(targetText)) woundTargets.push('right_waist');
          else if (/both\s*waist/i.test(targetText)) woundTargets.push('left_waist', 'right_waist');
          else if (/tail/i.test(targetText)) woundTargets.push('tail_gunner');
          else if (/ball/i.test(targetText)) woundTargets.push('ball_turret');
          else if (/radio/i.test(targetText)) woundTargets.push('radioman');
          else if (/navigator/i.test(targetText)) woundTargets.push('navigator');
          else if (/bombardier/i.test(targetText)) woundTargets.push('bombardier');
          else if (/pilot/i.test(targetText)) woundTargets.push('pilot');
          else if (/engineer/i.test(targetText)) woundTargets.push('engineer');

          for (const pos of woundTargets) {
            const crew = getCrewByPosition(ctx.state.campaign.crew, pos);
            if (crew && crew.woundSeverity !== 'kia') {
              const woundRollValue: number = yield* yieldCombatRoll(
                ctx,
                'B1-4', 'Wound Severity',
                `Wound severity for ${crew.name} (${POSITION_LABELS[pos]})`, '1d6',
                [
                  { roll: '1-3', columns: { result: 'Light wound' } },
                  { roll: '4-5', columns: { result: 'Serious wound' } },
                  { roll: '6', columns: { result: 'KIA' } },
                ],
              );

              let severity: WoundSeverity;
              try { severity = rollCrewWound(ctx.createFixedRng(woundRollValue), tables); } catch { severity = 'light'; }
              applyWound(crew, severity);
              const sev = woundToEventSeverity(severity);
              ctx.emit('DAMAGE', `${crew.name} (${POSITION_LABELS[pos]}): ${severity} wound`, 'damage', sev, zone, direction,
                [
                  { table: damageTable, rollType: dmgDiceType, rolled: dmgRollValue, result: dmg.result, description: `${location} damage` },
                  { table: 'B1-4', rollType: '1d6', rolled: woundRollValue, result: severity, description: 'Wound severity' },
                ], true);
            }
          }
        } else if (subRoll && subRoll.type === '1d6') {
          // ── Generic 1d6 sub-roll ──
          yield* resolveGenericSubRoll(
            ctx,
            damageTable, dmgDiceType, dmgRollValue, dmg,
            location, subRoll, rollEntry,
            zone, direction,
          );
        } else {
          // True generic fallback (no sub-roll data)
          ctx.emit('DAMAGE', `${location}: ${dmg.description || dmg.result}`, 'damage', 'info', zone, direction,
            [{ table: damageTable, rollType: dmgDiceType, rolled: dmgRollValue, result: dmg.result }]);
        }
        break;
      }
      default: {
        // Check for specific system damage that needs state updates
        const resultLower = (dmg.result ?? '').toLowerCase();
        const descLower = (dmg.description ?? '').toLowerCase();
        if (descLower.includes('tail guns inoperable') || resultLower.includes('tail guns inoperable')) {
          disableGun(ctx.state.campaign.aircraft.guns, 'Tail');
          ctx.emit('DAMAGE', `${location}: Tail guns inoperable!`, 'damage', 'bad', zone, direction,
            [{ table: damageTable, rollType: dmgDiceType, rolled: dmgRollValue, result: dmg.result }], true);
        } else if (descLower.includes('ball turret') && (descLower.includes('guns out') || descLower.includes('inoperable'))) {
          ctx.state.campaign.aircraft.ballTurretInop = true;
          ctx.emit('DAMAGE', `${location}: ${dmg.description || dmg.result}`, 'damage', 'bad', zone, direction,
            [{ table: damageTable, rollType: dmgDiceType, rolled: dmgRollValue, result: dmg.result }], true);
        } else {
          ctx.emit('DAMAGE', `${location}: ${dmg.description || dmg.result}`, 'damage', 'info', zone, direction,
            [{ table: damageTable, rollType: dmgDiceType, rolled: dmgRollValue, result: dmg.result }]);
        }
        break;
      }
    }
  }
}
