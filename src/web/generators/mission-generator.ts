/**
 * Mission generator — orchestrates the full B-17 mission sequence.
 *
 * Yields PendingRoll / PendingChoice objects at each decision point.
 * The player (or autoplay) provides values via generator.next(value).
 */

import type { MissionState } from '../../games/b17/types.js';
import { initializeGuns, gunsToAmmo } from '../../games/b17/rules/guns.js';
import {
  getZoneInfo, getTargetZone,
  type TargetInfo,
} from '../../games/b17/rules/mission-setup.js';
import {
  hasFighterCover, getFighterWaveModifier, getFighterWaveModifierReason,
  mustAbort, type FighterCoverLevel,
} from '../../games/b17/rules/zone-movement.js';
import {
  addLeadTailExtraFighter,
  type Fighter,
} from '../../games/b17/rules/fighter-encounters.js';
import {
  rollFighterCoverDefense,
} from '../../games/b17/rules/combat.js';
import { countEnginesOut } from '../../games/b17/rules/damage.js';
import { applyWound, applyKia, getCrewByPosition, isCrewDown } from '../../games/b17/rules/crew.js';
import { woundToEventSeverity, plural } from '../../games/b17/rules/display-labels.js';
import type { PendingRoll, MissionYield } from '../types.js';
import { normalizeDiceType, autoRoll } from '../types.js';
import { buildM4Rows } from '../table-display.js';
import type { GeneratorContext } from './generator-context.js';
import { yieldCombatRoll, createPendingRoll } from './yield-helpers.js';
import { resolveCombatRounds, combatView, playerRemoveFighters } from './combat-generators.js';
import { executeBombRun } from './bomb-run-generator.js';
import { executeBailout } from './bailout-generator.js';

export function* executeMission(
  ctx: GeneratorContext,
): Generator<MissionYield, void, number | number[] | undefined> {
  const missionNumber = ctx.state.campaign.missionsCompleted + 1;
  const rng = ctx.rng;
  const tables = ctx.tables;
  let nextFighterId = 1;
  let fightersDestroyed = 0;

  // Check crew availability
  const activeCrew = ctx.state.campaign.crew.filter(c => c.status === 'active');
  if (activeCrew.length < 6) {
    ctx.emit('CAMPAIGN', 'Not enough crew to fly. Campaign over.', 'system', 'critical');
    return;
  }

  // ═══ SETUP ═══
  ctx.emit('SETUP', `Mission #${missionNumber} begins`, 'setup', 'info', undefined, undefined, undefined, true);

  // ── Target selection ──
  let targetTableName: string;
  let targetTableDesc: string;
  if (missionNumber <= 5) {
    targetTableName = 'G-1';
    targetTableDesc = `Missions 1-5`;
  } else if (missionNumber <= 10) {
    targetTableName = 'G-2';
    targetTableDesc = `Missions 6-10`;
  } else {
    targetTableName = 'G-3';
    targetTableDesc = `Missions 11-25`;
  }

  // Yield pending roll for target selection
  ctx.eventBuffer = [];
  const targetPending = createPendingRoll(ctx, targetTableName, `Target for Mission ${missionNumber}`);
  const targetRollValue: number = (yield { type: 'pending', roll: targetPending, events: ctx.eventBuffer }) ?? autoRoll(targetPending.diceType, rng);
  ctx.eventBuffer = [];

  const targetResult = tables.lookupWithValue(targetTableName, targetRollValue);
  if (!targetResult) {
    ctx.emit('SETUP', `Failed to look up target on ${targetTableName}`, 'system', 'critical');
    return;
  }

  const target: TargetInfo = {
    name: targetResult.entry.Target as string,
    type: targetResult.entry.Type as string,
  };

  let targetZone: number;
  try {
    targetZone = getTargetZone(target.name, tables);
  } catch {
    targetZone = 5; // fallback
  }

  ctx.emit('SETUP', `Target: ${target.name} (${target.type})`, 'setup', 'info',
    undefined, undefined, [{
      table: targetTableName, tableTitle: targetTableDesc,
      rollType: normalizeDiceType(targetPending.diceType),
      rolled: targetRollValue, result: `${target.name} (${target.type})`,
      description: `Target selection for ${targetTableDesc}`,
    }]);

  ctx.emit('SETUP', `Target zone: ${targetZone}`, 'setup', 'info');

  // ── Formation position (G-4) ──
  const formPending = createPendingRoll(ctx, 'G-4', 'Formation position within squadron');
  const formRollValue: number = (yield { type: 'pending', roll: formPending, events: ctx.eventBuffer }) ?? autoRoll(formPending.diceType, rng);
  ctx.eventBuffer = [];

  const formResult = tables.lookupWithValue('G-4', formRollValue);
  let formationPosition: 'lead' | 'middle' | 'tail' = 'middle';
  let extraFighterPerWave = false;
  if (formResult) {
    const pos = formResult.entry.formation_position as string;
    if (pos === 'Lead Bomber') { formationPosition = 'lead'; extraFighterPerWave = true; }
    else if (pos === 'Tail Bomber') { formationPosition = 'tail'; extraFighterPerWave = true; }
  }

  const formLabel = formationPosition === 'lead' ? 'Lead Bomber'
    : formationPosition === 'tail' ? 'Tail Bomber' : 'Middle';

  ctx.emit('SETUP', `Formation: ${formLabel}`, 'setup', 'info',
    undefined, undefined, [{
      table: 'G-4', rollType: '2d6', rolled: formRollValue, result: formLabel,
      description: 'Formation position within squadron',
    }]);

  // ── Squadron position (G-4a, missions 6+ only) ──
  let squadronMod = 0;
  let squadronPosition: { position: string; b1b2Modifier: number } | null = null;

  if (missionNumber > 5) {
    const sqPending = createPendingRoll(ctx, 'G-4a', 'Squadron position (High/Middle/Low)');
    const sqRollValue: number = (yield { type: 'pending', roll: sqPending, events: ctx.eventBuffer }) ?? autoRoll(sqPending.diceType, rng);
    ctx.eventBuffer = [];

    const sqResult = tables.lookupWithValue('G-4a', sqRollValue);
    if (sqResult) {
      const pos = sqResult.entry.squadron_position as string;
      if (pos === 'High') { squadronPosition = { position: 'high', b1b2Modifier: 0 }; }
      else if (pos === 'Low') { squadronPosition = { position: 'low', b1b2Modifier: 1 }; }
      else { squadronPosition = { position: 'middle', b1b2Modifier: -1 }; }
      squadronMod = squadronPosition.b1b2Modifier;

      const sqLabel = pos;
      ctx.emit('SETUP', `Squadron: ${sqLabel} (B-1/B-2 mod: ${squadronMod >= 0 ? '+' : ''}${squadronMod})`, 'setup', 'info',
        undefined, undefined, [{
          table: 'G-4a', rollType: '1d6', rolled: sqRollValue, result: sqLabel,
          description: 'Squadron position (missions 6+)',
        }]);
    }
  }

  if (extraFighterPerWave) {
    ctx.emit('SETUP', `${formLabel} position: +1 fighter per wave!`, 'setup', 'warn');
  }

  // Initialize mission state
  const mission: MissionState = {
    missionNumber, target: target.name, zone: 1,
    direction: 'outbound', formation: squadronPosition?.position as any ?? 'lead',
    squadron: squadronPosition?.position as any ?? 'lead',
    weather: 'clear', outOfFormation: false, altitude: 20000,
    bombsAboard: true, bombsDropped: false, aborted: false,
    evasiveAction: false, landingModifiers: 0, landingModifierReasons: [], bombRunModifier: 0, bombRunModifierReasons: [],
  };
  ctx.state.mission = mission;
  ctx.state.campaign.aircraft.guns = initializeGuns();
  ctx.state.campaign.aircraft.ammo = gunsToAmmo(ctx.state.campaign.aircraft.guns) as any;

  // Crew roster event
  ctx.emit('SETUP', 'Crew manifest', 'setup', 'info', undefined, undefined, undefined, true);

  // ═══ ZONE LOOP ═══
  let destroyed = false;

  // Outbound
  for (let z = 2; z <= targetZone && !destroyed; z++) {
    mission.zone = z;
    mission.direction = 'outbound';
    const isTarget = z === targetZone;
    const zoneInfo = getZoneInfo(target.name, z, tables);
    const overText = zoneInfo?.over?.length ? ` (over ${zoneInfo.over.join(', ')})` : '';

    ctx.emit('ZONE', `Entering Zone ${z}${isTarget ? ' — TARGET' : ''} outbound${overText}`,
      'movement', 'info', z, 'outbound', undefined, true);

    // Weather at target
    if (isTarget) {
      const weatherPending = createPendingRoll(ctx, 'O-1', `Weather over target (${target.name})`);
      const weatherRoll: number = (yield { type: 'pending', roll: weatherPending, events: ctx.eventBuffer }) ?? autoRoll(weatherPending.diceType, rng);
      ctx.eventBuffer = [];

      const weatherResult = tables.lookupWithValue('O-1', weatherRoll);
      if (weatherResult) {
        const weatherStr = weatherResult.entry.weather as string;
        mission.weather = weatherStr === 'Bad' ? 'overcast' : weatherStr === 'Poor' ? 'poor' : 'clear';
        const wsev = mission.weather === 'clear' ? 'good' : mission.weather === 'poor' ? 'warn' : 'bad';
        ctx.emit('WEATHER', `Weather over target: ${weatherStr}`, 'movement', wsev as any,
          z, 'outbound', [{
            table: 'O-1', rollType: '2d6', rolled: weatherRoll, result: weatherStr,
            description: 'Weather determination',
          }]);
      }
    }

    // Fighter cover
    let coverLevel: FighterCoverLevel | null = null;
    if (hasFighterCover(z)) {
      if (missionNumber <= 5) {
        coverLevel = 'Good';
        ctx.emit('COVER', `Fighter cover: Good (missions 1–5: always Good)`, 'combat', 'good',
          z, 'outbound', [{
            table: 'G-5', rollType: '—', rolled: 0, result: 'Good',
            description: 'Missions 1–5: always Good fighter cover',
          }]);
      } else {
        const coverPending = createPendingRoll(ctx, 'G-5', `Fighter cover level (Zone ${z})`);
        const coverRoll: number = (yield { type: 'pending', roll: coverPending, events: ctx.eventBuffer }) ?? autoRoll(coverPending.diceType, rng);
        ctx.eventBuffer = [];

        const coverResult = tables.lookupWithValue('G-5', coverRoll);
        if (coverResult) {
          coverLevel = coverResult.entry.fighter_cover as FighterCoverLevel;
          const csev = coverLevel === 'Good' ? 'good' : coverLevel === 'Fair' ? 'info' : 'warn';
          ctx.emit('COVER', `Fighter cover: ${coverLevel}`, 'combat', csev as any,
            z, 'outbound', [{
              table: 'G-5', tableTitle: 'Fighter Cover', rollType: '1d6', rolled: coverRoll, result: coverLevel,
              description: 'Allied fighter cover level',
            }]);
        }
      }
    } else {
      ctx.emit('COVER', 'No fighter cover in this zone', 'combat', 'warn', z, 'outbound');
    }

    // Fighter waves
    const waveMod = getFighterWaveModifier(zoneInfo ?? null, squadronMod, mission.outOfFormation, 0);
    const waveTable = isTarget ? 'B-2' : 'B-1';
    const waveTableData = tables.getRoll(waveTable);
    const waveDiceType = normalizeDiceType(waveTableData?.rolltype ?? '1d6');

    const waveModReason = getFighterWaveModifierReason(zoneInfo ?? null, squadronMod, mission.outOfFormation, 0);
    const wavePending = createPendingRoll(ctx, waveTable, `Fighter waves (Zone ${z}${isTarget ? ' — Target' : ''})`, waveMod, undefined, waveModReason);
    const waveRoll: number = (yield { type: 'pending', roll: wavePending, events: ctx.eventBuffer }) ?? autoRoll(waveDiceType, rng);
    ctx.eventBuffer = [];

    const waveResult = tables.lookupWithValue(waveTable, waveRoll, waveMod);
    const waveCount = waveResult ? (waveResult.entry.fighter_waves as number ?? 0) : 0;

    if (waveCount === 0) {
      ctx.emit('COMBAT', 'No enemy fighters encountered', 'combat', 'good', z, 'outbound',
        [{ table: waveTable, rollType: waveDiceType, rolled: waveRoll, modifier: waveMod, result: '0 waves' }],
        false, combatView([]));
    } else {
      ctx.emit('COMBAT', `${plural(waveCount, 'fighter wave')}!`, 'combat', 'bad', z, 'outbound',
        [{ table: waveTable, rollType: waveDiceType, rolled: waveRoll, modifier: waveMod, result: `${waveCount} ${waveCount === 1 ? 'wave' : 'waves'}` }]);
    }

    // Process fighter waves
    for (let w = 1; w <= waveCount && !destroyed; w++) {
      ctx.emit('WAVE', `Fighter Wave ${w}`, 'combat', 'bad', z, 'outbound');

      // Roll attacking fighters on B-3
      const atkPending = createPendingRoll(ctx, 'B-3', `Attacking fighters (Wave ${w}, Zone ${z})`);
      const atkRoll: number = (yield { type: 'pending', roll: atkPending, events: ctx.eventBuffer }) ?? autoRoll(atkPending.diceType, rng);
      ctx.eventBuffer = [];

      const atkResult = tables.lookupWithValue('B-3', atkRoll);
      let fighters: Fighter[] = [];

      if (atkResult) {
        const fighterData = atkResult.entry.fighters as Array<{ type: string; position: string; count: number }> | undefined;
        if (fighterData && fighterData.length > 0) {
          fighters = fighterData.map(f => ({
            id: nextFighterId++,
            type: f.type as any,
            position: f.position,
            damage: [],
            attacksMade: 0,
            scoredHit: false,
          }));
        }

        // Handle "No Attackers" with out-of-formation reroll
        if (fighters.length === 0 && !mission.outOfFormation) {
          ctx.emit('COMBAT', 'Fighters driven off by other B-17s', 'combat', 'good', z, 'outbound',
            [{ table: 'B-3', rollType: 'd6d6', rolled: atkRoll, result: 'No attackers' }],
            false, combatView([]));
          continue;
        } else if (fighters.length === 0 && mission.outOfFormation) {
          // Reroll when out of formation
          ctx.emit('COMBAT', 'No attackers rolled, but out of formation — rerolling', 'combat', 'warn', z, 'outbound');
          const rerollPending = createPendingRoll(ctx, 'B-3', `Attacking fighters reroll (out of formation)`);
          const reroll: number = (yield { type: 'pending', roll: rerollPending, events: ctx.eventBuffer }) ?? autoRoll(rerollPending.diceType, rng);
          ctx.eventBuffer = [];

          const rerollResult = tables.lookupWithValue('B-3', reroll);
          if (rerollResult) {
            const reFighterData = rerollResult.entry.fighters as Array<{ type: string; position: string; count: number }> | undefined;
            if (reFighterData && reFighterData.length > 0) {
              fighters = reFighterData.map(f => ({
                id: nextFighterId++, type: f.type as any, position: f.position,
                damage: [], attacksMade: 0, scoredHit: false,
              }));
            }
          }
          if (fighters.length === 0) {
            ctx.emit('COMBAT', 'Reroll: still no attackers', 'combat', 'good', z, 'outbound');
            continue;
          }
        }
      } else {
        ctx.emit('COMBAT', 'Fighters driven off by other B-17s', 'combat', 'good', z, 'outbound',
          undefined, false, combatView([]));
        continue;
      }

      if (extraFighterPerWave && !mission.outOfFormation) {
        fighters = addLeadTailExtraFighter(fighters, nextFighterId++);
      }

      // Describe fighters
      const initialFighterCount = fighters.length;
      const fDescs = fighters.map(f => `${f.type} at ${f.position}`);
      ctx.emit('COMBAT', `${plural(fighters.length, 'fighter')}: ${fDescs.join(', ')}`, 'combat', 'warn', z, 'outbound',
        undefined, false, combatView(fighters));

      // Fighter cover defense (M-4)
      let successiveCover = 0;
      if (coverLevel && hasFighterCover(z)) {
        const m4RollValue: number = yield* yieldCombatRoll(ctx,
          'M-4', 'Fighter Cover Defense',
          `Friendly fighters intercept — cover level: ${coverLevel}`,
          '1d6',
          buildM4Rows(tables, coverLevel),
        );

        const coverResult = rollFighterCoverDefense(coverLevel, ctx.createFixedRng(m4RollValue), tables, 0);
        successiveCover = coverResult.successiveDrivenOff;
        if (coverResult.initialDrivenOff > 0) {
          fighters = yield* playerRemoveFighters(ctx, fighters, coverResult.initialDrivenOff, m4RollValue, coverLevel, z, 'outbound');
        } else {
          ctx.emit('COMBAT', `Friendly fighters fail to intercept`, 'combat', 'warn', z, 'outbound',
            [{ table: 'M-4', rollType: '1d6', rolled: m4RollValue, result: `0 driven off (${coverLevel} cover)` }]);
        }
      }

      if (fighters.length === 0) {
        ctx.emit('COMBAT', 'All fighters driven off!', 'combat', 'good', z, 'outbound',
          undefined, false, combatView([]));
        continue;
      }

      // Emit updated fighter list after drive-offs so the combat view refreshes
      if (fighters.length < initialFighterCount) {
        const remainDescs = fighters.map(f => `${f.type} at ${f.position}`);
        ctx.emit('COMBAT', `${plural(fighters.length, 'fighter')}: ${remainDescs.join(', ')}`, 'combat', 'warn', z, 'outbound',
          undefined, false, combatView(fighters));
      }

      // Combat rounds — Rule 6.3a: allocate ALL guns before resolving fire
      const activeFighters = [...fighters];
      const combatResult = yield* resolveCombatRounds(ctx, activeFighters, fighters, mission, z, 'outbound', () => fightersDestroyed, (v) => { fightersDestroyed = v; }, (c) => executeBailout(ctx, c), successiveCover);
      if (combatResult.destroyed) { destroyed = true; }
    }

    // Abort check
    if (!destroyed && !mission.aborted && mission.direction === 'outbound') {
      const navDown = isCrewDown(ctx.state.campaign.crew, 'navigator');
      const pilotsDown = isCrewDown(ctx.state.campaign.crew, 'pilot') && isCrewDown(ctx.state.campaign.crew, 'copilot');
      if (mustAbort(ctx.state.campaign.aircraft, mission.outOfFormation, navDown, pilotsDown)) {
        mission.aborted = true;
        ctx.emit('ABORT', 'Mission aborted — mandatory conditions met!', 'movement', 'bad', z, 'outbound', undefined, true);
      }
    }

    // Target zone bomb run
    if (isTarget && !destroyed && !mission.aborted) {
      yield* executeBombRun(ctx, target, z, mission, (c) => executeBailout(ctx, c));
      ctx.emit('TURN', 'Turning for home', 'movement', 'info', z, 'outbound');
    }
  }

  // ═══ INBOUND ═══
  if (!destroyed) {
    for (let z = targetZone; z >= 2 && !destroyed; z--) {
      mission.zone = z;
      mission.direction = 'inbound';
      const isTarget = z === targetZone;
      const zoneInfo = getZoneInfo(target.name, z, tables);
      const overText = zoneInfo?.over?.length ? ` (over ${zoneInfo.over.join(', ')})` : '';

      ctx.emit('ZONE', `Entering Zone ${z}${isTarget ? ' — TARGET' : ''} inbound${overText}`, 'movement', 'info', z, 'inbound', undefined, true);

      // Fighter cover
      let coverLevel: FighterCoverLevel | null = null;
      if (hasFighterCover(z)) {
        if (missionNumber <= 5) {
          coverLevel = 'Good';
          ctx.emit('COVER', `Fighter cover: Good (missions 1–5: always Good)`, 'combat', 'good', z, 'inbound',
            [{ table: 'G-5', rollType: '—', rolled: 0, result: 'Good', description: 'Missions 1–5: always Good fighter cover' }]);
        } else {
          const coverPending = createPendingRoll(ctx, 'G-5', `Fighter cover level (Zone ${z} inbound)`);
          const coverRoll: number = (yield { type: 'pending', roll: coverPending, events: ctx.eventBuffer }) ?? autoRoll(coverPending.diceType, rng);
          ctx.eventBuffer = [];

          const coverResult = tables.lookupWithValue('G-5', coverRoll);
          if (coverResult) {
            coverLevel = coverResult.entry.fighter_cover as FighterCoverLevel;
            ctx.emit('COVER', `Fighter cover: ${coverLevel}`, 'combat',
              coverLevel === 'Good' ? 'good' : 'info', z, 'inbound',
              [{ table: 'G-5', tableTitle: 'Fighter Cover', rollType: '1d6', rolled: coverRoll, result: coverLevel }]);
          }
        }
      }

      // Fighter waves — use B-2 for target zone, B-1 for non-target zones
      const inboundWaveTable = isTarget ? 'B-2' : 'B-1';
      const waveMod = getFighterWaveModifier(zoneInfo ?? null, squadronMod, mission.outOfFormation, 0);
      const waveTableData = tables.getRoll(inboundWaveTable);
      const waveDiceType = normalizeDiceType(waveTableData?.rolltype ?? '1d6');

      const waveModReason = getFighterWaveModifierReason(zoneInfo ?? null, squadronMod, mission.outOfFormation, 0);
      const wavePending = createPendingRoll(ctx, inboundWaveTable, `Fighter waves (Zone ${z}${isTarget ? ' — Target' : ''} inbound)`, waveMod, undefined, waveModReason);
      const waveRoll: number = (yield { type: 'pending', roll: wavePending, events: ctx.eventBuffer }) ?? autoRoll(waveDiceType, rng);
      ctx.eventBuffer = [];

      const waveResult = tables.lookupWithValue(inboundWaveTable, waveRoll, waveMod);
      const waveCount = waveResult ? (waveResult.entry.fighter_waves as number ?? 0) : 0;

      if (waveCount === 0) {
        ctx.emit('COMBAT', 'No enemy fighters', 'combat', 'good', z, 'inbound',
          [{ table: inboundWaveTable, rollType: waveDiceType, rolled: waveRoll, modifier: waveMod, result: '0 waves' }],
          false, combatView([]));
        continue;
      }

      ctx.emit('COMBAT', `${plural(waveCount, 'fighter wave')}!`, 'combat', 'bad', z, 'inbound',
        [{ table: inboundWaveTable, rollType: waveDiceType, rolled: waveRoll, modifier: waveMod, result: `${waveCount} ${waveCount === 1 ? 'wave' : 'waves'}` }]);

      // Inbound combat
      for (let w = 1; w <= waveCount && !destroyed; w++) {
        ctx.emit('WAVE', `Fighter Wave ${w}`, 'combat', 'bad', z, 'inbound');

        const atkPending = createPendingRoll(ctx, 'B-3', `Attacking fighters (Wave ${w}, Zone ${z} inbound)`);
        const atkRoll: number = (yield { type: 'pending', roll: atkPending, events: ctx.eventBuffer }) ?? autoRoll(atkPending.diceType, rng);
        ctx.eventBuffer = [];

        const atkResult = tables.lookupWithValue('B-3', atkRoll);
        let fighters: Fighter[] = [];

        if (atkResult) {
          const fighterData = atkResult.entry.fighters as Array<{ type: string; position: string; count: number }> | undefined;
          if (fighterData && fighterData.length > 0) {
            fighters = fighterData.map(f => ({
              id: nextFighterId++, type: f.type as any, position: f.position,
              damage: [], attacksMade: 0, scoredHit: false,
            }));
          }
        }

        if (fighters.length === 0) {
          ctx.emit('COMBAT', 'Fighters driven off by formation', 'combat', 'good', z, 'inbound',
            [{ table: 'B-3', rollType: 'd6d6', rolled: atkRoll, result: 'No attackers' }],
            false, combatView([]));
          continue;
        }

        if (extraFighterPerWave && !mission.outOfFormation) {
          fighters = addLeadTailExtraFighter(fighters, nextFighterId++);
        }

        // Describe fighters (B-3 result)
        const fDescsInbound = fighters.map(f => `${f.type} at ${f.position}`);
        ctx.emit('COMBAT', `${plural(fighters.length, 'fighter')}: ${fDescsInbound.join(', ')}`, 'combat', 'warn', z, 'inbound',
          [{ table: 'B-3', rollType: 'd6d6', rolled: atkRoll, result: `${fighters.length} fighters` }],
          false, combatView(fighters));

        // Fighter cover defense (M-4)
        let inboundSuccessiveCover = 0;
        if (coverLevel && hasFighterCover(z)) {
          const m4RollValue: number = yield* yieldCombatRoll(ctx,
            'M-4', 'Fighter Cover Defense',
            `Friendly fighters intercept — cover level: ${coverLevel}`,
            '1d6',
            buildM4Rows(tables, coverLevel),
          );

          const coverResult = rollFighterCoverDefense(coverLevel, ctx.createFixedRng(m4RollValue), tables, 0);
          inboundSuccessiveCover = coverResult.successiveDrivenOff;
          if (coverResult.initialDrivenOff > 0) {
            fighters = yield* playerRemoveFighters(ctx, fighters, coverResult.initialDrivenOff, m4RollValue, coverLevel, z, 'inbound');
          }
        }

        if (fighters.length === 0) { continue; }

        ctx.emit('COMBAT', `${plural(fighters.length, 'fighter')} attacking`, 'combat', 'warn', z, 'inbound',
          undefined, false, combatView(fighters));

        // Combat rounds
        const inboundResult = yield* resolveCombatRounds(ctx, fighters, fighters, mission, z, 'inbound', () => fightersDestroyed, (v) => { fightersDestroyed = v; }, (c) => executeBailout(ctx, c), inboundSuccessiveCover);
        if (inboundResult.destroyed) { destroyed = true; }
      }
    }
  }

  // ═══ LANDING ═══
  const ac = ctx.state.campaign.aircraft;
  if (!destroyed) {
    ctx.emit('LANDING', `${ctx.state.campaign.planeName} approaches the airfield...`, 'landing', 'info', 1, 'inbound');

    // Weather at base per §5.2d — roll O-1 to determine landing weather modifier
    let weatherLandingMod = 0;
    const baseWeatherPending = createPendingRoll(ctx, 'O-1', 'Weather at home base');
    const baseWeatherRoll: number = (yield { type: 'pending', roll: baseWeatherPending, events: ctx.eventBuffer }) ?? autoRoll(baseWeatherPending.diceType, rng);
    ctx.eventBuffer = [];

    const baseWeatherResult = tables.lookupWithValue('O-1', baseWeatherRoll);
    if (baseWeatherResult) {
      const weatherStr = baseWeatherResult.entry.weather as string;
      if (weatherStr === 'Bad') {
        weatherLandingMod = -2;
      } else if (weatherStr === 'Poor') {
        weatherLandingMod = -1;
      }
      const wsev = weatherStr === 'Good' ? 'good' : weatherStr === 'Poor' ? 'warn' : 'bad';
      const modDesc = weatherLandingMod !== 0 ? ` (${weatherLandingMod} to landing)` : '';
      ctx.emit('WEATHER', `Weather at base: ${weatherStr}${modDesc}`, 'landing', wsev as any,
        1, 'inbound', [{
          table: 'O-1', rollType: '2d6', rolled: baseWeatherRoll, result: weatherStr,
          description: `Base weather determination${modDesc}`,
        }]);
    }

    // Landing roll on G-9 — use actual table data
    const g9Display = tables.getTableDisplayData('G-9');
    const g9TableRows = g9Display ? g9Display.rows.map(r => ({
      roll: r.roll,
      columns: { result: r.columns.landing?.replace('$plane_name', ctx.state.campaign.planeName) ?? '' },
    })) : [];

    // Build landing modifier reason from tracked damage sources
    const landingReasonParts: string[] = [...mission.landingModifierReasons];
    if (weatherLandingMod !== 0) landingReasonParts.push(`Weather ${weatherLandingMod >= 0 ? '+' : ''}${weatherLandingMod}`);
    if (countEnginesOut(ac) >= 3) landingReasonParts.push('3+ engines out -3');
    const landingModReason = landingReasonParts.join(', ');

    const landingPending: PendingRoll = {
      id: ctx.pendingRollId++,
      tableId: 'G-9',
      tableName: 'Landing on Land',
      diceType: '2d6',
      purpose: 'Landing attempt',
      modifier: mission.landingModifiers + weatherLandingMod + (countEnginesOut(ac) >= 3 ? -3 : 0),
      ...(landingModReason ? { modifierReason: landingModReason } : {}),
      tableRows: g9TableRows,
    };

    const landingRoll: number = (yield { type: 'pending', roll: landingPending, events: ctx.eventBuffer }) ?? autoRoll('2d6', rng);
    ctx.eventBuffer = [];

    const landingMod = landingPending.modifier;
    const modifiedLanding = landingRoll + landingMod;

    // Look up result in G-9 table (lookupWithValue handles clamping to table range)
    const g9Result = tables.lookupWithValue('G-9', landingRoll, landingMod);
    const clampedLanding = g9Result?.modified ?? modifiedLanding;
    const landingResultText = g9Result
      ? (g9Result.entry as any).landing?.replace('$plane_name', ctx.state.campaign.planeName) ?? 'Unknown'
      : 'Unknown';

    // Determine severity level: 2+ good, 1 warn, 0/-1 bad, -2/-3 critical
    const landingSeverity = clampedLanding >= 2 ? 'good' : clampedLanding === 1 ? 'warn' :
      clampedLanding >= -1 ? 'bad' : 'critical';

    // Emit the G-9 landing result
    ctx.emit('LANDING', landingResultText, 'landing', landingSeverity as any, 1, 'inbound',
      [{ table: 'G-9', rollType: '2d6', rolled: landingRoll, modifier: landingMod, modifiedRoll: modifiedLanding, result: landingResultText }], true);

    // Apply effects based on severity
    if (clampedLanding <= 0) {
      destroyed = true;
    }

    if (clampedLanding <= -3) {
      // All crew KIA, plane wrecked
      for (const crew of ctx.state.campaign.crew) {
        if (crew.status === 'active') {
          applyKia(crew);
          ctx.emit('LANDING', `${crew.name}: KIA in crash`, 'damage', 'critical', 1, 'inbound', undefined, true);
        }
      }
    } else if (clampedLanding <= -1) {
      // Crew rolls for wounds (B1-4), with +1 penalty at -2
      const woundPenalty = clampedLanding === -2 ? 1 : 0;
      const penaltyDesc = woundPenalty > 0 ? ' (with +1)' : '';
      for (const crew of ctx.state.campaign.crew) {
        if (crew.status === 'active') {
          const woundRoll = Math.min(6, rng.d6() + woundPenalty);
          const woundEntry = tables.lookupValue('B1-4', woundRoll);
          const severity = (woundEntry as any)?.severity ?? 'light';
          applyWound(crew, severity);
          const sev = woundToEventSeverity(severity);
          ctx.emit('LANDING', `${crew.name}: wound roll ${woundRoll}${penaltyDesc} — ${(woundEntry as any)?.result ?? severity}`,
            'damage', sev, 1, 'inbound',
            [{ table: 'B1-4', rollType: '1d6', rolled: woundRoll, result: (woundEntry as any)?.result ?? severity,
               ...(woundPenalty > 0 ? { description: 'Landing wound (+1 penalty)' } : {}) }], true);
        }
      }
    }

    // Ball turret trapped + landing gear inop = Ball Gunner KIA
    if (ac.ballTurretTrapped && ac.landingGearInop) {
      const ballGunner = getCrewByPosition(ctx.state.campaign.crew, 'ball_turret');
      if (ballGunner && ballGunner.woundSeverity !== 'kia') {
        ballGunner.woundSeverity = 'kia';
        ballGunner.status = 'kia';
        ctx.emit('LANDING', `${ballGunner.name} (Ball Gunner) killed — trapped in turret with landing gear inoperable!`, 'damage', 'critical', 1, 'inbound', undefined, true);
      }
    }
  } else {
    ctx.emit('BAILOUT', `${ctx.state.campaign.planeName} has been shot down!`, 'landing', 'critical', undefined, undefined, undefined, true);
    for (const crew of ctx.state.campaign.crew) {
      if (crew.status === 'active' && crew.woundSeverity !== 'kia') {
        const bailRoll = rng.d6();
        if (bailRoll <= 3) {
          crew.status = 'pow';
          ctx.emit('BAILOUT', `${crew.name}: Captured (POW)`, 'landing', 'bad',
            undefined, undefined, [{ table: 'G-6', rollType: '1d6', rolled: bailRoll, result: 'POW' }]);
        } else if (bailRoll <= 5) {
          ctx.emit('BAILOUT', `${crew.name}: Evaded capture!`, 'landing', 'good',
            undefined, undefined, [{ table: 'G-6', rollType: '1d6', rolled: bailRoll, result: 'Evaded' }]);
        } else {
          crew.status = 'kia'; crew.woundSeverity = 'kia';
          ctx.emit('BAILOUT', `${crew.name}: KIA`, 'landing', 'critical',
            undefined, undefined, [{ table: 'G-6', rollType: '1d6', rolled: bailRoll, result: 'KIA' }]);
        }
      }
    }
  }

  // ═══ DEBRIEF ═══
  ctx.state.campaign.missionsCompleted++;
  for (const crew of ctx.state.campaign.crew) {
    if (crew.status === 'active') crew.missions++;
  }

  const survived = !destroyed;
  ctx.emit('DEBRIEF', `Mission #${missionNumber} to ${target.name}: ${survived ? 'SURVIVED' : 'LOST'}`, 'debrief',
    survived ? 'good' : 'critical', undefined, undefined,
    [{ table: '', rollType: '', rolled: 0, result: survived ? 'Survived' : 'Lost', description: `Fighters destroyed: ${fightersDestroyed}` }], true);

  // ═══ BETWEEN-MISSION CREW PROCESSING ═══
  const crewUpdates: string[] = [];
  for (const crew of ctx.state.campaign.crew) {
    if (crew.woundSeverity === 'kia' || crew.status === 'kia') {
      continue;
    }

    if (crew.woundSeverity === 'serious') {
      crewUpdates.push(`${crew.name} (${crew.position}): seriously wounded — hospitalized`);
      continue;
    }

    if (crew.woundSeverity === 'light' || crew.lightWounds > 0) {
      crewUpdates.push(`${crew.name} (${crew.position}): light wounds healed`);
      crew.woundSeverity = 'none';
      crew.lightWounds = 0;
    }
    if (crew.frostbite) {
      crewUpdates.push(`${crew.name} (${crew.position}): frostbite recovered`);
      crew.frostbite = false;
    }
  }

  if (crewUpdates.length > 0) {
    ctx.emit('DEBRIEF', `Crew status updates:\n${crewUpdates.join('\n')}`, 'debrief', 'info');
  }

  // Reset mission-scoped aircraft state but preserve campaign-level damage
  ac.fireExtinguishersUsed = 0;

  // Check for campaign victory
  if (ctx.state.campaign.missionsCompleted >= ctx.state.campaign.missionsTotal) {
    ctx.emit('DEBRIEF', `🎖️ TOUR COMPLETE! ${ctx.state.campaign.missionsCompleted} missions flown. Campaign victory!`, 'debrief', 'good', undefined, undefined, undefined, true);
  }

  ctx.state.mission = null;
}
