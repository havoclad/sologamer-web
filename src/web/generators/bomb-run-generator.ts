/**
 * Bomb run generator — handles the full bombing sequence:
 * O-2 (Flak over target) → O-3 (Flak to hit) → O-4 (shell hits) → O-5 (area affected)
 * → damage resolution → O-6 (Bomb run on/off target) → O-7 (Bombing accuracy)
 */

import type { MissionState } from '../../games/b17/types.js';
import type { TargetInfo } from '../../games/b17/rules/mission-setup.js';
import { countEnginesOut } from '../../games/b17/rules/damage.js';
import { getCrewByPosition } from '../../games/b17/rules/crew.js';
import { plural } from '../../games/b17/rules/display-labels.js';
import type { MissionYield } from '../types.js';
import { autoRoll } from '../types.js';
import { buildO3Rows } from '../table-display.js';
import type { GeneratorContext } from './generator-context.js';
import { yieldCombatRoll, createPendingRoll } from './yield-helpers.js';
import { resolveCompartmentHitGen } from './damage-generators.js';

/** Area-to-damage-table mapping for flak hits */
export const FLAK_AREA_DAMAGE_TABLE: Record<string, string> = {
  'Nose': 'P-1',
  'Pilot Compartment': 'P-2',
  'Bomb Bay': 'P-3',
  'Radio Room': 'P-4',
  'Waist': 'P-5',
  'Tail': 'P-6',
  'Port Wing': 'B1-1',
  'Starboard Wing': 'B1-1',
};

export function* executeBombRun(
  ctx: GeneratorContext,
  target: TargetInfo, zone: number, mission: MissionState,
  executeBailout: (controlled: boolean) => Generator<MissionYield, void, number | number[] | undefined>,
): Generator<MissionYield, void, number | number[] | undefined> {
  const rng = ctx.rng;
  const tables = ctx.tables;

  if (!mission.bombsAboard) {
    ctx.emit('BOMB_RUN', 'No bombs to drop — already jettisoned', 'bombing', 'warn', zone, 'outbound');
    return;
  }

  ctx.emit('BOMB_RUN', `Beginning bomb run over ${target.name}!`, 'bombing', 'info', zone, 'outbound');

  // ── O-2: Flak over target ──
  const flakPending = createPendingRoll(ctx, 'O-2', `Flak over target (${target.name})`);
  const flakRoll: number = (yield { type: 'pending', roll: flakPending, events: ctx.eventBuffer }) ?? autoRoll(flakPending.diceType, rng);
  ctx.eventBuffer = [];

  const flakResult = tables.lookupWithValue('O-2', flakRoll);
  const flakLevel = flakResult?.entry?.Flak as string ?? 'No flak';

  const flakSev = flakLevel === 'No flak' ? 'good' : flakLevel === 'Light flak' ? 'warn' : 'bad';
  ctx.emit('BOMB_RUN', `Flak: ${flakLevel}`, 'bombing', flakSev as any, zone, 'outbound',
    [{ table: 'O-2', rollType: '1d6', rolled: flakRoll, result: flakLevel, description: 'Flak over target' }]);

  // ── O-3: Flak to hit B-17 (3 rolls if flak present) ──
  let totalFlakHits = 0;
  if (flakLevel !== 'No flak') {
    const o3Rows = buildO3Rows(tables, flakLevel);
    for (let burst = 1; burst <= 3; burst++) {
      const hitRoll: number = yield* yieldCombatRoll(
        ctx,
        'O-3', 'Flak to Hit B-17',
        `Flak burst ${burst}/3 — does it hit? (${flakLevel})`,
        '2d6',
        o3Rows,
      );
      ctx.eventBuffer = [];

      const hitResult = tables.lookupWithValue('O-3', hitRoll);
      // O-3 has nested results by flak level
      let flakHit = false;
      if (hitResult?.entry) {
        const levelData = hitResult.entry[flakLevel] as Record<string, any> | undefined;
        if (levelData) {
          flakHit = parseInt(levelData.flak_hits as string ?? '0', 10) > 0;
        }
      }

      if (flakHit) {
        totalFlakHits++;
        ctx.emit('BOMB_RUN', `Flak burst ${burst}: HIT!`, 'damage', 'bad', zone, 'outbound',
          [{ table: 'O-3', rollType: '2d6', rolled: hitRoll, result: 'Hit', description: `${flakLevel} burst ${burst}` }]);
      } else {
        ctx.emit('BOMB_RUN', `Flak burst ${burst}: Miss`, 'bombing', 'info', zone, 'outbound',
          [{ table: 'O-3', rollType: '2d6', rolled: hitRoll, result: 'Miss', description: `${flakLevel} burst ${burst}` }]);
      }
    }
  }

  // ── O-4: Effect of flak hits (shell count per hit) ──
  if (totalFlakHits > 0) {
    ctx.emit('BOMB_RUN', `${plural(totalFlakHits, 'flak hit')} on the B-17!`, 'damage', 'bad', zone, 'outbound');

    for (let h = 1; h <= totalFlakHits; h++) {
      const shellPending = createPendingRoll(ctx, 'O-4', `Shell hits from flak hit ${h}`);
      const shellRoll: number = (yield { type: 'pending', roll: shellPending, events: ctx.eventBuffer }) ?? autoRoll(shellPending.diceType, rng);
      ctx.eventBuffer = [];

      const shellResult = tables.lookupWithValue('O-4', shellRoll);
      const shellHits = shellResult ? parseInt(shellResult.entry.shell_hits as string ?? '1', 10) : 1;

      ctx.emit('BOMB_RUN', `Flak hit ${h}: ${plural(shellHits, 'shell hit')}`, 'damage', 'bad', zone, 'outbound',
        [{ table: 'O-4', rollType: '2d6', rolled: shellRoll, result: `${shellHits} shells`, description: 'Effect of flak hits' }]);

      // ── O-5: Area affected by each shell hit ──
      for (let s = 1; s <= shellHits; s++) {
        const areaPending = createPendingRoll(ctx, 'O-5', `Where does flak shell ${s} hit?`);
        const areaRoll: number = (yield { type: 'pending', roll: areaPending, events: ctx.eventBuffer }) ?? autoRoll(areaPending.diceType, rng);
        ctx.eventBuffer = [];

        const areaResult = tables.lookupWithValue('O-5', areaRoll);
        const area = areaResult?.entry?.area_affected as string ?? 'Superficial';

        ctx.emit('DAMAGE', `Flak shell ${s}: Hit to ${area}`, 'damage', 'warn', zone, 'outbound',
          [{ table: 'O-5', rollType: '2d6', rolled: areaRoll, result: area, description: 'Area affected by flak' }]);

        // Resolve damage on the appropriate compartment table
        const dmgTable = FLAK_AREA_DAMAGE_TABLE[area];
        if (dmgTable) {
          yield* resolveCompartmentHitGen(ctx, area, dmgTable, zone, 'outbound', executeBailout);
        }
      }
    }

    // Check if aircraft destroyed
    if (countEnginesOut(ctx.state.campaign.aircraft) >= 4) {
      ctx.emit('DAMAGE', 'ALL ENGINES OUT! Going down!', 'damage', 'critical', zone, 'outbound', undefined, true);
      return;
    }
  }

  // ── O-6: Bomb run on/off target ──
  // Note (c): If Bombardier is KIA or seriously wounded, bomb run is automatically off target
  const bombardier = getCrewByPosition(ctx.state.campaign.crew, 'bombardier');
  if (bombardier && (bombardier.woundSeverity === 'kia' || bombardier.woundSeverity === 'serious')) {
    const reason = bombardier.woundSeverity === 'kia' ? 'KIA' : 'seriously wounded';
    ctx.emit('BOMB_RUN', `Bomb run: OFF target — Bombardier ${bombardier.name} is ${reason}, automatic miss (O-6 note c)`, 'bombing', 'warn', zone, 'outbound');

    // Skip O-6 roll, proceed directly to O-7 with Off target
    const accuracyPending = createPendingRoll(ctx, 'O-7', `Bombing accuracy (OFF target)`, 0, 'Off');
    const accuracyRoll: number = (yield { type: 'pending', roll: accuracyPending, events: ctx.eventBuffer }) ?? autoRoll(accuracyPending.diceType, rng);
    ctx.eventBuffer = [];

    const accuracyResult = tables.lookupWithValue('O-7', accuracyRoll);
    let accuracy = 0;
    if (accuracyResult?.entry) {
      const accData = accuracyResult.entry['Off'] as Record<string, any> | undefined;
      if (accData) {
        accuracy = parseInt(accData.bombing_accuracy as string ?? '0', 10);
      } else {
        accuracy = parseInt(accuracyResult.entry.bombing_accuracy as string ?? '0', 10);
      }
    }

    mission.bombsAboard = false;
    mission.bombsDropped = true;

    ctx.emit('BOMB_RUN', `Bombs away over ${target.name}! Accuracy: ${accuracy}%`, 'bombing',
      accuracy >= 30 ? 'good' : accuracy > 0 ? 'warn' : 'bad', zone, 'outbound',
      [{ table: 'O-7', rollType: '2d6', rolled: accuracyRoll, result: `${accuracy}% accuracy`, description: `Bombing accuracy (OFF target)` }], true);
    return;
  }

  const bombRunMod = mission.bombRunModifier || 0;
  const bombRunPending = createPendingRoll(ctx, 'O-6', `Bomb run — on or off target?`, bombRunMod);
  const bombRunRoll: number = (yield { type: 'pending', roll: bombRunPending, events: ctx.eventBuffer }) ?? autoRoll(bombRunPending.diceType, rng);
  ctx.eventBuffer = [];

  const modifiedBombRun = bombRunRoll + bombRunMod;
  const bombRunResult = tables.lookupWithValue('O-6', modifiedBombRun);
  const onTarget = bombRunResult?.entry?.bomb_run_on_target as string ?? 'Off';
  const onOff = onTarget === 'On' ? 'ON target' : 'OFF target';

  ctx.emit('BOMB_RUN', `Bomb run: ${onOff}!${bombRunMod ? ` (roll ${bombRunRoll}, modifier ${bombRunMod})` : ''}`, 'bombing', onTarget === 'On' ? 'good' : 'warn', zone, 'outbound',
    [{ table: 'O-6', rollType: '1d6', rolled: bombRunRoll, modifier: bombRunMod, modifiedRoll: modifiedBombRun, result: onOff, description: 'Bomb run accuracy' }]);

  // ── O-7: Bombing accuracy ──
  const accuracyPending = createPendingRoll(ctx, 'O-7', `Bombing accuracy (${onOff})`, 0, onTarget);
  const accuracyRoll: number = (yield { type: 'pending', roll: accuracyPending, events: ctx.eventBuffer }) ?? autoRoll(accuracyPending.diceType, rng);
  ctx.eventBuffer = [];

  const accuracyResult = tables.lookupWithValue('O-7', accuracyRoll);
  let accuracy = 0;
  if (accuracyResult?.entry) {
    const accData = accuracyResult.entry[onTarget] as Record<string, any> | undefined;
    if (accData) {
      accuracy = parseInt(accData.bombing_accuracy as string ?? '0', 10);
    } else {
      accuracy = parseInt(accuracyResult.entry.bombing_accuracy as string ?? '0', 10);
    }
  }

  mission.bombsAboard = false;
  mission.bombsDropped = true;

  ctx.emit('BOMB_RUN', `Bombs away over ${target.name}! Accuracy: ${accuracy}%`, 'bombing',
    accuracy >= 30 ? 'good' : accuracy > 0 ? 'warn' : 'bad', zone, 'outbound',
    [{ table: 'O-7', rollType: '2d6', rolled: accuracyRoll, result: `${accuracy}% accuracy`, description: `Bombing accuracy (${onOff})` }], true);
}
