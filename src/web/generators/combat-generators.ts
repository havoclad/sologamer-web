/**
 * Combat resolution generators — extracted from GameSession.
 *
 * These handle the combat rounds loop (allocation → defensive fire →
 * German offensive fire → successive attacks), individual gun fire
 * resolution, and player fighter removal choices.
 */

import type { CrewPosition, MissionState, AmmoState } from '../../games/b17/types.js';
import type { Fighter } from '../../games/b17/rules/fighter-encounters.js';
import { canBeDrivenOffByCover } from '../../games/b17/rules/fighter-encounters.js';
import {
  getFieldOfFire, resolveDefensiveFire, rollFighterDamage,
  applyFighterDamage, resolveGermanOffensiveFire,
  rollShellHits, isFighterOutOfAction, getSuccessiveAttackers,
  type GunPosition,
} from '../../games/b17/rules/combat.js';
import {
  rollHitLocation, countEnginesOut, WALKING_HIT_COMPARTMENTS,
  type ShellHitLocation,
} from '../../games/b17/rules/damage.js';
import { getCrewByPosition, isCrewDown } from '../../games/b17/rules/crew.js';
import { getGun } from '../../games/b17/rules/guns.js';
import { GUN_LABELS, plural } from '../../games/b17/rules/display-labels.js';
import { enginesOut } from '../../games/b17/rules/zone-movement.js';
import type { CombatViewState, PendingChoice, MissionYield, PendingRoll } from '../types.js';
import { buildM3Rows, buildB4Rows, buildB5Rows } from '../table-display.js';
import type { GeneratorContext } from './generator-context.js';
import { yieldCombatRoll } from './yield-helpers.js';
import { resolveCompartmentHitGen } from './damage-generators.js';

/** Build a CombatViewState from active fighters. */
export function combatView(fighters: Fighter[]): CombatViewState {
  return {
    fighters: fighters.map(f => ({ id: f.id, type: f.type, position: f.position })),
  };
}

// ─── playerRemoveFighters ───

/**
 * Player chooses which fighters to remove (Rule 6.2).
 * Yields a PendingChoice if in manual mode; auto-picks in autoplay.
 */
export function* playerRemoveFighters(
  ctx: GeneratorContext,
  fighters: Fighter[], count: number,
  m4RollValue: number, coverLevel: string,
  zone: number, direction: 'outbound' | 'inbound',
): Generator<MissionYield, Fighter[], number | number[] | undefined> {
  const removable = fighters.filter(f => canBeDrivenOffByCover(f.position));
  const nonRemovable = fighters.filter(f => !canBeDrivenOffByCover(f.position));
  const actualCount = Math.min(count, removable.length);

  if (actualCount === 0) {
    ctx.emit('COMBAT', `${count} fighters should be driven off, but none are eligible (Vertical Dive immune)`, 'combat', 'warn', zone, direction,
      [{ table: 'M-4', rollType: '1d6', rolled: m4RollValue, result: `${count} driven off (${coverLevel} cover) — none eligible` }]);
    return fighters;
  }

  // If only one possible set of removals, skip the choice
  if (actualCount >= removable.length) {
    ctx.emit('COMBAT', `Friendly fighters drive off ${removable.length} ${removable.length === 1 ? 'enemy' : 'enemies'}!`, 'combat', 'good', zone, direction,
      [{ table: 'M-4', rollType: '1d6', rolled: m4RollValue, result: `${actualCount} driven off (${coverLevel} cover)` }]);
    return nonRemovable;
  }

  ctx.emit('COMBAT', `Friendly fighters can drive off ${actualCount} ${actualCount === 1 ? 'enemy' : 'enemies'} — choose which to remove`, 'combat', 'good', zone, direction,
    [{ table: 'M-4', rollType: '1d6', rolled: m4RollValue, result: `${actualCount} driven off (${coverLevel} cover)` }]);

  // Yield a choice for the player — include field-of-fire info so they can make informed decisions
  const tables = ctx.tables;
  const choice: PendingChoice = {
    id: ctx.pendingRollId++,
    type: 'choice',
    purpose: `Choose ${actualCount} fighter${actualCount > 1 ? 's' : ''} to drive off`,
    prompt: `Select ${actualCount} fighter${actualCount > 1 ? 's' : ''} to remove:`,
    options: fighters.map(f => {
      // Build field-of-fire summary for this fighter
      const fieldOfFire = getFieldOfFire(f.position, tables);
      const gunDescs: string[] = [];
      for (const [gun, hitReq] of fieldOfFire) {
        const gunObj = getGun(ctx.state.campaign.aircraft.guns, gun);
        if (isCrewDown(ctx.state.campaign.crew, gunObj.crewPosition)) continue;
        if (gunObj.ammo <= 0 || gunObj.disabled || gunObj.jammed) continue;
        gunDescs.push(`${GUN_LABELS[gun]} (${hitReq}+)`);
      }
      const gunInfo = gunDescs.length > 0 ? ` — ${gunDescs.join(', ')}` : ' — no guns in range';
      const isVerticalDive = !canBeDrivenOffByCover(f.position);
      return {
        id: f.id,
        label: `${f.type} at ${f.position}${gunInfo}`,
        disabled: isVerticalDive,
        reason: isVerticalDive ? 'Vertical Dive — cannot be driven off' : undefined,
      };
    }),
    minSelections: actualCount,
    maxSelections: actualCount,
  };

  const removEventsToSend = ctx.eventBuffer;
  ctx.eventBuffer = [];
  const response = yield { type: 'choice' as const, choice, events: removEventsToSend };
  ctx.eventBuffer = [];

  // Parse response — should be number[] of fighter IDs
  let selectedIds: number[] = [];
  if (Array.isArray(response)) {
    selectedIds = response;
  } else {
    // Fallback: auto-select first N removable
    selectedIds = removable.slice(0, actualCount).map(f => f.id);
  }

  // Validate: only remove removable fighters, up to actualCount
  const validIds = new Set(selectedIds.filter(id => removable.some(f => f.id === id)).slice(0, actualCount));
  // If player didn't select enough, fill in
  if (validIds.size < actualCount) {
    for (const f of removable) {
      if (validIds.size >= actualCount) break;
      validIds.add(f.id);
    }
  }

  const removed = fighters.filter(f => validIds.has(f.id));
  const remaining = fighters.filter(f => !validIds.has(f.id));

  const removedDescs = removed.map(f => `${f.type} at ${f.position}`).join(', ');
  ctx.emit('COMBAT', `Driven off: ${removedDescs}`, 'combat', 'good', zone, direction);

  return remaining;
}

// ─── resolveGunFire ───

/**
 * Resolve a single gun firing at a fighter — yields M-1 roll and if hit, M-2 roll.
 */
export function* resolveGunFire(
  ctx: GeneratorContext,
  gun: GunPosition,
  fighter: Fighter,
  hitReq: number,
  crewPos: CrewPosition,
  mission: MissionState,
  zone: number,
  direction: 'outbound' | 'inbound',
  getDestroyed: () => number,
  setDestroyed: (v: number) => void,
): Generator<MissionYield, void, number | number[] | undefined> {
  const rng = ctx.rng;
  const tables = ctx.tables;
  const cm = getCrewByPosition(ctx.state.campaign.crew, crewPos);
  if (!cm) return;

  // Check fighter is still active (may have been destroyed by earlier gun in same phase)
  if (isFighterOutOfAction(fighter)) return;

  // Deduct ammo when gun actually fires (not at allocation time)
  const gunObj = getGun(ctx.state.campaign.aircraft.guns, gun);
  gunObj.ammo--;
  // Keep legacy ammo in sync
  ctx.state.campaign.aircraft.ammo[gun as keyof AmmoState]--;

  const defRollValue: number = yield* yieldCombatRoll(
    ctx,
    'M-1', 'Defensive Fire',
    `${GUN_LABELS[gun]} (${cm.name}) fires at ${fighter.type} at ${fighter.position} — need ${hitReq}+ to hit`,
    '1d6',
    [
      ...(hitReq > 1 ? [{ roll: `1-${hitReq - 1}`, columns: { result: 'Miss' } }] : []),
      { roll: `${hitReq}-6`, columns: { result: 'Hit' } },
    ],
  );

  const fr = resolveDefensiveFire(hitReq, ctx.createFixedRng(defRollValue), false, mission.evasiveAction, false, cm.frostbite, false);
  if (fr.hit) {
    const m2Mods: string[] = [];
    if (gunObj.twin) m2Mods.push('twin mount +1');
    if (fighter.type === 'FW190') m2Mods.push('FW190 -1 (note b)');
    const m2ModStr = m2Mods.length > 0 ? ` (${m2Mods.join(', ')})` : '';

    const dmgRollValue: number = yield* yieldCombatRoll(
      ctx,
      'M-2', 'Fighter Damage',
      `Damage to ${fighter.type} hit by ${GUN_LABELS[gun]}${m2ModStr}`,
      '1d6',
      [
        { roll: '1-3', columns: { result: 'FCA — continues attack' } },
        { roll: '4-5', columns: { result: 'FBOA — breaks off' } },
        { roll: '6', columns: { result: 'Destroyed' } },
      ],
    );

    const dmg = rollFighterDamage(ctx.createFixedRng(dmgRollValue), tables, gunObj.twin, fighter.type);
    const status = applyFighterDamage(fighter, dmg);

    if (status.status === 'destroyed') {
      setDestroyed(getDestroyed() + 1);
      cm.kills++;
      ctx.emit('COMBAT', `${GUN_LABELS[gun]} (${cm.name}) — ${fighter.type} DESTROYED!`, 'combat', 'good', zone, direction,
        [
          { table: 'M-1', rollType: '1d6', rolled: defRollValue, result: `Hit (need ${hitReq}+)`, description: `${GUN_LABELS[gun]} vs ${fighter.position}` },
          { table: 'M-2', rollType: '1d6', rolled: dmgRollValue, result: 'Destroyed', description: 'Fighter damage result' },
        ], true);
    } else if (status.status === 'breaks_off') {
      ctx.emit('COMBAT', `${GUN_LABELS[gun]} (${cm.name}) — ${fighter.type} damaged, breaks off!`, 'combat', 'good', zone, direction,
        [
          { table: 'M-1', rollType: '1d6', rolled: defRollValue, result: `Hit (need ${hitReq}+)` },
          { table: 'M-2', rollType: '1d6', rolled: dmgRollValue, result: 'Breaks off' },
        ]);
    } else {
      ctx.emit('COMBAT', `${GUN_LABELS[gun]} (${cm.name}) — ${fighter.type} hit, continues!`, 'combat', 'warn', zone, direction,
        [
          { table: 'M-1', rollType: '1d6', rolled: defRollValue, result: `Hit (need ${hitReq}+)` },
          { table: 'M-2', rollType: '1d6', rolled: dmgRollValue, result: 'Continues attack' },
        ]);
    }
  } else {
    ctx.emit('COMBAT', `${GUN_LABELS[gun]} (${cm.name}) fires at ${fighter.position}... miss`, 'combat', 'info', zone, direction,
      [{ table: 'M-1', rollType: '1d6', rolled: defRollValue, result: `Miss (need ${hitReq}+)`, description: `${GUN_LABELS[gun]} vs ${fighter.position}` }], true);
  }
}

// ─── resolveCombatRounds ───

/**
 * Main combat loop: allocation → defensive fire → German offensive fire → successive attacks.
 *
 * executeBailout is passed through to resolveCompartmentHitGen for when
 * engine fires cannot be controlled.
 */
export function* resolveCombatRounds(
  ctx: GeneratorContext,
  activeFighters: Fighter[],
  allFighters: Fighter[],
  mission: MissionState,
  zone: number,
  direction: 'outbound' | 'inbound',
  getDestroyed: () => number,
  setDestroyed: (v: number) => void,
  executeBailout: (controlled: boolean) => Generator<MissionYield, void, number | number[] | undefined>,
  successiveCoverDrivenOff = 0,
): Generator<MissionYield, { destroyed: boolean }, number | number[] | undefined> {
  const rng = ctx.rng;
  const tables = ctx.tables;
  const crew = ctx.state.campaign.crew;
  const aircraft = ctx.state.campaign.aircraft;
  let attackRound = 0;

  type GunTarget = { fighterId: number; fighter: Fighter; hitReq: number; isDelayed: boolean };
  type GunEntry = { gun: GunPosition; crewPos: CrewPosition; targets: GunTarget[] };
  type Allocation = { gun: GunPosition; fighter: Fighter; hitReq: number; isDelayed: boolean; crewPos: CrewPosition };

  /** Track what happened each round for successive attack context */
  let lastRoundSummary: string[] = [];

  while (activeFighters.length > 0 && attackRound < 3) {
    attackRound++;
    if (attackRound > 1) {
      // Provide context: what happened in the previous round
      ctx.emit('COMBAT', `═══ Successive Attack Round ${attackRound} ═══`, 'combat', 'warn', zone, direction);
      for (const line of lastRoundSummary) {
        ctx.emit('COMBAT', line, 'combat', 'info', zone, direction);
      }

      // Fighter cover drives off additional fighters each successive round (M-4 successive value)
      if (successiveCoverDrivenOff > 0 && activeFighters.length > 0) {
        const removable = activeFighters.filter(f => canBeDrivenOffByCover(f.position));
        const toRemove = Math.min(successiveCoverDrivenOff, removable.length);
        if (toRemove > 0) {
          // If player needs to choose which to remove
          activeFighters = yield* playerRemoveFighters(ctx, activeFighters, toRemove, 0, 'successive cover', zone, direction);
          allFighters = allFighters.filter(f => activeFighters.includes(f) || !f.damage.includes('Destroyed'));
        }
        if (activeFighters.length === 0) {
          ctx.emit('COMBAT', 'All fighters driven off by cover!', 'combat', 'good', zone, direction, undefined, true, combatView([]));
          break;
        }
      }

      const survDescs = activeFighters.map(f => `${f.type} at ${f.position}`);
      ctx.emit('COMBAT', `${plural(activeFighters.length, 'fighter')} pressing the attack: ${survDescs.join(', ')}`, 'combat', 'warn', zone, direction,
        undefined, false, combatView(activeFighters));
    }
    lastRoundSummary = [];

    // ═══ ALLOCATION PHASE (Rule 6.3a) ═══
    // Build gun→targets map from M-1 field of fire data
    const gunEntries: GunEntry[] = [];

    for (const fighter of activeFighters) {
      const fieldOfFire = getFieldOfFire(fighter.position, tables);
      for (const [gun, hitReq] of fieldOfFire) {
        let entry = gunEntries.find(e => e.gun === gun);
        if (!entry) {
          const gunObj = getGun(aircraft.guns, gun);
          const crewPos = gunObj.crewPosition;
          if (!crewPos) continue;
          entry = { gun, crewPos, targets: [] };
          gunEntries.push(entry);
        }
        entry.targets.push({ fighterId: fighter.id, fighter, hitReq, isDelayed: false });
      }

      // Tail gun special rule: can fire at 10:30, 12, 1:30 positions (need 6, resolves LAST)
      const posLower = fighter.position.toLowerCase();
      const isTailSpecialPos = posLower.startsWith('10:30') || posLower.startsWith('12 ') || posLower.startsWith('1:30');
      if (isTailSpecialPos && !posLower.includes('vertical')) {
        if (!fieldOfFire.has('Tail')) {
          // Tail isn't already listed — add as special delayed target
          let entry = gunEntries.find(e => e.gun === 'Tail');
          if (!entry) {
            entry = { gun: 'Tail', crewPos: 'tail_gunner', targets: [] };
            gunEntries.push(entry);
          }
          entry.targets.push({ fighterId: fighter.id, fighter, hitReq: 6, isDelayed: true });
        }
      }
    }

    // Filter guns by crew availability, ammo, and gun operability
    const eligibleGuns = gunEntries.filter(ge => {
      const cm = getCrewByPosition(crew, ge.crewPos);
      if (!cm || cm.status !== 'active' || cm.woundSeverity === 'serious' || cm.woundSeverity === 'kia') return false;
      const gunObj = getGun(aircraft.guns, ge.gun);
      if (gunObj.ammo <= 0 || gunObj.disabled || gunObj.jammed) return false;
      if (ge.gun === 'Ball_Turret' && aircraft.ballTurretInop) return false;
      return true;
    });

    let delayedAllocations: Allocation[] = [];

    if (eligibleGuns.length === 0) {
      ctx.emit('COMBAT', 'No guns available to fire!', 'combat', 'warn', zone, direction);
    } else {
      // Yield gun allocation choice to player
      const allocationChoice: PendingChoice = {
        id: ctx.pendingRollId++,
        type: 'choice',
        choiceType: 'gun-allocation',
        purpose: 'Allocate Defensive Fire (Rule 6.3a)',
        prompt: 'Assign each gun to a target fighter, or hold fire to conserve ammo.',
        options: [], // Not used for allocation type
        minSelections: 0,
        maxSelections: eligibleGuns.length,
        allocations: eligibleGuns.map(ge => {
          const cm = getCrewByPosition(crew, ge.crewPos)!;
          const gunObj = getGun(aircraft.guns, ge.gun);
          // Determine if ALL targets for this gun are delayed (tail special only)
          const allDelayed = ge.targets.every(t => t.isDelayed);
          return {
            gunId: ge.gun,
            gunLabel: GUN_LABELS[ge.gun] || ge.gun,
            crewName: cm.name,
            ammoRemaining: gunObj.ammo,
            isTailSpecial: allDelayed,
            targets: ge.targets.map(t => ({
              fighterId: t.fighterId,
              label: `${t.fighter.type} at ${t.fighter.position} (need ${t.hitReq}+)${t.isDelayed ? ' ⏳ fires after German attack' : ''}`,
              hitReq: t.hitReq,
            })),
          };
        }),
      };

      const eventsToSend = ctx.eventBuffer;
      ctx.eventBuffer = [];
      const response = yield { type: 'choice' as const, choice: allocationChoice, events: eventsToSend };
      ctx.eventBuffer = [];

      // Parse allocation response: array where response[i] = fighterId for gun i, or -1 for hold
      const allocationResponse: number[] = Array.isArray(response) ? response : [];

      const regularAllocations: Allocation[] = [];

      for (let i = 0; i < eligibleGuns.length; i++) {
        const fighterId = allocationResponse[i] ?? -1;
        if (fighterId === -1) continue; // Hold fire

        const ge = eligibleGuns[i];
        const target = ge.targets.find(t => t.fighterId === fighterId);
        if (!target) continue;

        const alloc: Allocation = {
          gun: ge.gun,
          fighter: target.fighter,
          hitReq: target.hitReq,
          isDelayed: target.isDelayed,
          crewPos: ge.crewPos,
        };

        if (target.isDelayed) {
          delayedAllocations.push(alloc);
        } else {
          regularAllocations.push(alloc);
        }
      }

      const heldCount = eligibleGuns.length - regularAllocations.length - delayedAllocations.length;
      if (heldCount > 0) {
        ctx.emit('COMBAT', `${plural(heldCount, 'gun')} holding fire`, 'combat', 'info', zone, direction);
      }

      // ═══ RESOLVE REGULAR DEFENSIVE FIRE ═══
      if (regularAllocations.length > 0) {
        ctx.emit('COMBAT', `Resolving defensive fire — ${plural(regularAllocations.length, 'gun')} firing`, 'combat', 'info', zone, direction, undefined, true);
      }

      for (const alloc of regularAllocations) {
        yield* resolveGunFire(ctx, alloc.gun, alloc.fighter, alloc.hitReq, alloc.crewPos, mission, zone, direction, getDestroyed, setDestroyed);
      }

      // Build summary for successive attack context
      const firedGunNames = regularAllocations.map(a => GUN_LABELS[a.gun] || a.gun);
      if (firedGunNames.length > 0) lastRoundSummary.push(`Defensive fire: ${firedGunNames.join(', ')}`);
      if (delayedAllocations.length > 0) lastRoundSummary.push(`Delayed tail fire: ${plural(delayedAllocations.length, 'target')}`);
      if (heldCount > 0) lastRoundSummary.push(`${plural(heldCount, 'gun')} held fire`);
    }

    // Filter destroyed/broken-off fighters after defensive fire
    activeFighters = allFighters.filter(f => !isFighterOutOfAction(f));

    if (activeFighters.length === 0) {
      ctx.emit('COMBAT', 'All fighters driven off or destroyed!', 'combat', 'good', zone, direction, undefined, true, combatView([]));
      break;
    }

    // ═══ GERMAN OFFENSIVE FIRE (Rule 6.4) ═══
    const engineMod = enginesOut(ctx.state.campaign.aircraft) >= 2 ? 1 : 0;
    const evasiveMod = mission.evasiveAction ? -1 : 0;

    for (const fighter of activeFighters) {
      const offRollValue: number = yield* yieldCombatRoll(
        ctx,
        'M-3', 'German Offensive Fire',
        `${fighter.type} at ${fighter.position} attacks your B-17`,
        '1d6',
        buildM3Rows(tables, fighter.position, engineMod + evasiveMod - fighter.damage.filter(d => d === 'FCA').length),
      );

      let offResult: { roll: number; hit: boolean };
      try {
        offResult = resolveGermanOffensiveFire(fighter, ctx.createFixedRng(offRollValue), tables, engineMod, evasiveMod);
      } catch {
        offResult = { roll: offRollValue, hit: offRollValue === 6 };
      }
      fighter.attacksMade++;

      if (offResult.hit) {
        fighter.scoredHit = true;
        ctx.emit('COMBAT', `${fighter.type} at ${fighter.position} fires — HIT!`, 'combat', 'bad', zone, direction,
          [{ table: 'M-3', rollType: '1d6', rolled: offRollValue, result: 'Hit', description: 'German offensive fire' }]);

        const shellRollValue: number = yield* yieldCombatRoll(
          ctx,
          'B-4', 'Shell Hits', `Number of shell hits from ${fighter.type} at ${fighter.position}`,
          '2d6', buildB4Rows(tables, fighter.position),
        );

        let shellHits: number;
        try { shellHits = rollShellHits(fighter, ctx.createFixedRng(shellRollValue), tables); } catch { shellHits = rng.int(1, 3); }

        ctx.emit('DAMAGE', `${plural(shellHits, 'shell hit')}!`, 'damage', 'bad', zone, direction,
          [{ table: 'B-4', rollType: '2d6', rolled: shellRollValue, result: `${shellHits} shells` }]);

        for (let s = 0; s < shellHits; s++) {
          const hitLocRollValue: number = yield* yieldCombatRoll(
            ctx,
            'B-5', 'Hit Location', `Where does shell ${s + 1} hit? (${fighter.type} at ${fighter.position})`,
            '2d6', buildB5Rows(tables, fighter.position),
          );

          let hitLoc: ShellHitLocation;
          try { hitLoc = rollHitLocation(fighter.position, ctx.createFixedRng(hitLocRollValue), tables); } catch { hitLoc = { location: 'Superficial', isSuperificial: true }; }

          if (hitLoc.isSuperificial) {
            ctx.state.campaign.aircraft.superficialHits = (ctx.state.campaign.aircraft.superficialHits || 0) + 1;
            ctx.emit('DAMAGE', `Shell ${s + 1}: Superficial damage`, 'damage', 'info', zone, direction,
              [{ table: 'B-5', rollType: '2d6', rolled: hitLocRollValue, result: 'Superficial' }]);
            continue;
          }

          if (hitLoc.isWalkingHits) {
            ctx.emit('DAMAGE', `Shell ${s + 1}: Walking hits along fuselage!`, 'damage', 'critical', zone, direction,
              [{ table: 'B-5', rollType: '2d6', rolled: hitLocRollValue, result: 'Walking hits' }]);
            for (const compt of WALKING_HIT_COMPARTMENTS) {
              yield* resolveCompartmentHitGen(ctx, compt.location, compt.damageTable, zone, direction, executeBailout);
            }
            continue;
          }

          ctx.emit('DAMAGE', `Shell ${s + 1}: Hit to ${hitLoc.location}`, 'damage', 'warn', zone, direction,
            [{ table: 'B-5', rollType: '2d6', rolled: hitLocRollValue, result: hitLoc.location as string }]);

          if (hitLoc.damageTable) {
            yield* resolveCompartmentHitGen(ctx, hitLoc.location as string, hitLoc.damageTable, zone, direction, executeBailout);
          }
        }
      } else {
        ctx.emit('COMBAT', `${fighter.type} at ${fighter.position} fires — miss`, 'combat', 'info', zone, direction,
          [{ table: 'M-3', rollType: '1d6', rolled: offRollValue, result: 'Miss' }]);
      }
    }

    // Track German fire results for successive attack summary
    const germanHits = activeFighters.filter(f => f.scoredHit).length;
    const germanMisses = activeFighters.length - germanHits;
    if (germanHits > 0) lastRoundSummary.push(`German fire: ${plural(germanHits, 'hit')}, ${plural(germanMisses, 'miss', 'misses')}`);
    else lastRoundSummary.push(`German fire: all missed`);

    // ═══ DELAYED TAIL GUN FIRE (M-1 Notes) ═══
    // Tail guns firing at 10:30/12/1:30 resolve AFTER all other defensive fire AND German offensive fire
    if (delayedAllocations.length > 0) {
      // Check tail gunner is still alive and gun is still operational
      const tailGunner = getCrewByPosition(crew, 'tail_gunner');
      const tailGunObj = getGun(aircraft.guns, 'Tail');
      if (tailGunner && tailGunner.status === 'active' && tailGunner.woundSeverity !== 'serious' && tailGunner.woundSeverity !== 'kia' && !tailGunObj.disabled) {
        ctx.emit('COMBAT', `Tail guns firing (delayed) — ${plural(delayedAllocations.length, 'target')}`, 'combat', 'info', zone, direction);
        for (const alloc of delayedAllocations) {
          yield* resolveGunFire(ctx, alloc.gun, alloc.fighter, alloc.hitReq, alloc.crewPos, mission, zone, direction, getDestroyed, setDestroyed);
        }
      } else {
        ctx.emit('COMBAT', 'Tail guns cannot fire — gunner down or gun knocked out', 'combat', 'warn', zone, direction);
      }

      // Re-filter after tail gun fire (must also exclude destroyed fighters)
      activeFighters = allFighters.filter(f => !isFighterOutOfAction(f));
    }

    // Check destruction
    if (countEnginesOut(ctx.state.campaign.aircraft) >= 4) {
      ctx.emit('DAMAGE', 'ALL ENGINES OUT! Going down!', 'damage', 'critical', zone, direction, undefined, true);
      return { destroyed: true };
    }

    // Successive attacks — roll B-6 for new attack position per §6.5a
    if (attackRound < 3) {
      activeFighters = getSuccessiveAttackers(activeFighters, mission.outOfFormation);
      const b6Display = tables.getTableDisplayData('B-6');
      for (const f of activeFighters) {
        const b6RollValue: number = yield* yieldCombatRoll(
          ctx,
          'B-6', 'Successive Attack Position',
          `${f.type} coming around — roll for new attack position`,
          '2d6',
          b6Display?.rows ?? [],
        );
        try {
          const result = tables.lookupWithValue('B-6', b6RollValue);
          if (result) {
            f.position = (result.entry as any).position ?? (result.entry as any).result ?? f.position;
          }
        } catch { /* keep position */ }
        ctx.emit('COMBAT', `${f.type} repositions to ${f.position}`, 'combat', 'info', zone, direction,
          [{ table: 'B-6', rollType: '2d6', rolled: b6RollValue, result: f.position }]);
      }
    }
  }

  return { destroyed: false };
}
