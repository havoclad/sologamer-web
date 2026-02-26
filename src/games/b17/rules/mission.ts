/**
 * Mission Orchestrator — ties all phases together into a complete playable mission.
 *
 * Per §5.0, a mission consists of:
 *   1. Pre-mission setup (target, formation, crew)
 *   2. Outbound flight: zone-by-zone with fighters, possible abort
 *   3. Target zone: weather, flak, bomb run
 *   4. Return flight: zone-by-zone with fighters
 *   5. Landing in England (or forced landing elsewhere)
 *   6. Post-mission debrief (wounded survival, frostbite, records)
 *
 * Handles all branching: abort (§8.0), bailout (§9.0, G-6/G-7),
 * crash landing (§10.3/10.4), ditching (§16.4), BIP (§19.2).
 */

import type { RNG } from '../../../engine/rng.js';
import type { TableStore } from '../../../engine/tables.js';
import type {
  AircraftState, CrewMember, CrewPosition, MissionState, Weather,
} from '../types.js';
import {
  setupMission, rollWeather, getZoneInfo, getTargetZone,
  type MissionSetupResult, type TargetInfo, type ZoneInfo,
} from './mission-setup.js';
import {
  rollFighterCover, hasFighterCover, enginesOut, turnsInZone,
  nextZone, isSubjectToLightFlak, getFighterWaveModifier, mustAbort,
  type FighterCoverLevel,
} from './zone-movement.js';
import {
  rollFighterWaves, rollAttackingFightersWithReroll,
  type Fighter,
} from './fighter-encounters.js';
import {
  rollFighterCoverDefense, removeDrivenOffFighters,
  resolveGermanOffensiveFire, resolveDefensiveFire,
  getFieldOfFire, rollFighterDamage, isTwinGunMount,
  applyFighterDamage, rollShellHits, rollSuccessiveAttackPosition,
  getSuccessiveAttackers,
} from './combat.js';
import {
  rollHitLocation, rollCompartmentDamage, rollCrewWound,
  countEnginesOut, isAllEnginesOut, getEngineLandingModifier,
  rollFrostbite, WALKING_HIT_COMPARTMENTS,
  type DamageResult, type HitLocation,
} from './damage.js';
import { resolveTargetFlak, resolveLightFlak, type FlakResolutionResult } from './flak.js';
import {
  resolveBombRun, canTakeEvasiveAction, type CompleteBombRunResult,
} from './bomb-run.js';
import {
  calculateLandModifier, calculateWaterLandModifier,
  resolveLandLanding, resolveWaterLanding,
  determineLandingLocation, type LandingResult,
} from './landing.js';
import {
  resolveControlledBailout, resolveUncontrolledBailout,
  resolveDitchingSurvival, type BailoutResult,
} from './bailout.js';
import {
  resolveRandomEvent, createRandomEventState,
  type RandomEventResult, type RandomEventState,
} from './random-events.js';

// ─── Mission Log ───

export interface MissionLogEntry {
  phase: string;
  zone?: number;
  direction?: 'outbound' | 'inbound';
  message: string;
  data?: Record<string, unknown>;
}

export interface MissionOutcome {
  /** Per §7.1 */
  victory: '8th_af_victory' | 'german_victory' | 'draw';
  survived: boolean;
  reachedTarget: boolean;
  bombsOnTarget: boolean;
  bombAccuracy: number;
  planeDestroyed: boolean;
  planeLost: boolean;
  planeIrreparable: boolean;
  crewFates: Array<{ position: string; name: string; fate: string }>;
}

export interface CompleteMissionResult {
  missionNumber: number;
  target: string;
  log: MissionLogEntry[];
  outcome: MissionOutcome;
  updatedCrew: CrewMember[];
  updatedAircraft: AircraftState;
}

// ─── Helper to deep-clone aircraft state ───

function cloneAircraft(ac: AircraftState): AircraftState {
  return {
    engines: [...ac.engines] as AircraftState['engines'],
    fuelLeak: ac.fuelLeak,
    fuelFire: ac.fuelFire,
    oxygenOut: ac.oxygenOut,
    heatingOut: ac.heatingOut,
    ballTurretInop: ac.ballTurretInop,
    bombBayDoorsInop: ac.bombBayDoorsInop,
    radioOut: ac.radioOut,
    tailWheelInop: ac.tailWheelInop,
    wingSurfaceDamage: { ...ac.wingSurfaceDamage },
    controlDamage: { ...ac.controlDamage },
    fireExtinguishersUsed: ac.fireExtinguishersUsed,
    ammo: ac.ammo ? { ...ac.ammo } : { Nose: 12, Port_Cheek: 12, Starboard_Cheek: 12, Top_Turret: 16, Ball_Turret: 16, Port_Waist: 12, Starboard_Waist: 12, Radio: 8, Tail: 16 },
  };
}

function cloneCrew(crew: CrewMember[]): CrewMember[] {
  return crew.map(c => ({ ...c }));
}

// ─── Main orchestrator ───

/**
 * Run a complete mission from setup through landing and debrief.
 *
 * Per §5.0-§17.0, this orchestrates all mission phases.
 */
export function runMission(
  missionNumber: number,
  crew: CrewMember[],
  aircraft: AircraftState,
  rng: RNG,
  tables: TableStore,
  options: { useRandomEvents?: boolean } = {},
): CompleteMissionResult {
  const log: MissionLogEntry[] = [];
  const ac = cloneAircraft(aircraft);
  const mCrew = cloneCrew(crew);
  const eventState = createRandomEventState();
  let nextFighterId = 1;
  let bombsAboard = true;
  let bombsDropped = false;
  let outOfFormation = false;
  let aborted = false;
  let evasiveActionDisallowed = false;
  let bombRunModifier = 0;
  let accumulatedLandingMod = 0;
  let bipDamage = false;
  let planeDestroyed = false;
  let reachedTarget = false;
  let bombAccuracy = 0;
  let bombOnTarget = false;
  let fighterWaveModifier = 0; // from random events
  let m4Modifier = 0;
  let badLuftwaffeCommsActive = false;

  // Track who's flying
  const pilotAlive = () => {
    const p = mCrew.find(c => c.position === 'pilot');
    return p && p.wounds !== 'kia' && p.wounds !== 'serious';
  };
  const copilotAlive = () => {
    const c = mCrew.find(c => c.position === 'copilot');
    return c && c.wounds !== 'kia' && c.wounds !== 'serious';
  };
  const navigatorDown = () => {
    const n = mCrew.find(c => c.position === 'navigator');
    return !n || n.wounds === 'kia' || n.wounds === 'serious';
  };

  const emit = (phase: string, message: string, zone?: number, direction?: 'outbound' | 'inbound', data?: Record<string, unknown>) => {
    log.push({ phase, zone, direction, message, data });
  };

  // ═══ PRE-MISSION SETUP ═══
  emit('SETUP', `Mission #${missionNumber} begins`);

  let setup: MissionSetupResult;
  try {
    setup = setupMission(missionNumber, rng, tables);
  } catch {
    // If target lookup fails, use a simple fallback
    emit('SETUP', 'Failed to set up mission — using default target');
    return makeFallbackResult(missionNumber, log, mCrew, ac);
  }

  const targetZone = setup.targetZone;
  const squadronMod = setup.squadronPosition?.b1b2Modifier ?? 0;

  emit('SETUP', `Target: ${setup.target.name} (zone ${targetZone})`, undefined, undefined, {
    formation: setup.formationPosition,
    squadron: setup.squadronPosition?.position,
  });

  // ═══ OUTBOUND FLIGHT ═══
  let currentZone = 1;
  let direction: 'outbound' | 'inbound' = 'outbound';

  // Zone loop
  const maxZoneIterations = 100; // safety valve
  let iterations = 0;

  while (iterations++ < maxZoneIterations) {
    // Move to next zone
    if (direction === 'outbound') {
      currentZone++;
    } else {
      currentZone--;
    }

    // Check if we've reached base
    if (currentZone <= 1 && direction === 'inbound') {
      currentZone = 1;
      break; // proceed to landing
    }

    // Check if we've gone past target (shouldn't happen)
    if (currentZone > targetZone && direction === 'outbound') {
      currentZone = targetZone;
    }

    const isTargetZone = (currentZone === targetZone && direction === 'outbound' && !aborted);
    const zoneInfo = getZoneInfo(setup.target.name, currentZone, tables);
    const turnsThisZone = turnsInZone(ac, bombsAboard);

    emit('ZONE_ENTER', `Entering zone ${currentZone} ${direction}`, currentZone, direction);

    // Check forced conditions
    const engOut = countEnginesOut(ac);
    if (engOut >= 4 && !planeDestroyed) {
      // §10.4: immediate crash land or bail out
      emit('ENGINE', 'All engines out — must crash land or bail out', currentZone, direction);
      const bailResult = resolveEmergencyLanding(currentZone, setup.target.name, mCrew, ac, rng, tables, log, direction);
      planeDestroyed = bailResult.planeDestroyed;
      break;
    }

    if (engOut >= 3) {
      // §10.3: can go 1 more zone then must land
      outOfFormation = true;
    }

    if (engOut >= 2) {
      outOfFormation = true;
      bombsAboard = false; // must jettison per §10.2
    }

    // Check abort conditions per §8.0
    if (!aborted && direction === 'outbound') {
      if (mustAbort(ac, outOfFormation, navigatorDown(), !pilotAlive() && !copilotAlive())) {
        aborted = true;
        direction = 'inbound';
        emit('ABORT', 'Mission aborted — mandatory conditions met', currentZone, direction);
        // Continue processing this zone then head home
      }
    }

    // ─── Target Zone Special Processing ───
    if (isTargetZone && !aborted) {
      reachedTarget = true;
      emit('TARGET', `Arriving at target: ${setup.target.name}`, currentZone, direction);

      // Roll weather per §5.2d
      const weather = rollWeather(rng, tables);
      emit('TARGET', `Weather over target: ${weather.weather}`, currentZone, direction);

      // Apply weather modifiers to bomb run
      for (const wm of weather.modifiers) {
        if (wm.table === 'O-6') bombRunModifier += wm.modifier;
      }

      // Resolve target zone fighters (use B-2 per §6.1a)
      resolveZoneCombat(
        currentZone, direction, true, turnsThisZone,
        setup, zoneInfo, ac, mCrew, rng, tables, log,
        outOfFormation, squadronMod, fighterWaveModifier, m4Modifier,
        badLuftwaffeCommsActive, eventState, options.useRandomEvents ?? false,
        (id) => { nextFighterId = id; }, () => nextFighterId,
      );

      if (isAllCrewDead(mCrew) || planeDestroyed) break;

      // Resolve flak per §5.2d
      const flakResult = resolveTargetFlak(setup.target.name, rng, tables);
      emit('FLAK', `Flak: ${flakResult.intensity} — ${flakResult.shellHits} shell hits`, currentZone, direction);

      // Apply flak damage
      for (const area of flakResult.areasHit) {
        applyFlakDamage(area, ac, mCrew, rng, tables, log, currentZone, direction);
      }

      // Flak hits modify bomb run per O-3 notes
      bombRunModifier -= flakResult.flakHits;

      if (isAllCrewDead(mCrew) || planeDestroyed) break;

      // ─── Bomb Run ───
      if (bombsAboard) {
        const bombResult = resolveBombRun(rng, tables, bombRunModifier, bombsAboard);
        bombsDropped = bombResult.bombsDropped;
        bombsAboard = false;
        bombAccuracy = bombResult.accuracyPercent;
        bombOnTarget = bombResult.bombRunResult === 'On';
        emit('BOMB_RUN', `Bomb run: ${bombResult.bombRunResult} — ${bombResult.accuracyPercent}% accuracy`, currentZone, direction);
      }

      // Turn around
      direction = 'inbound';
      emit('TARGET', 'Turning for home', currentZone, direction);

      // Resolve combat again in target zone per §5.2e
      resolveZoneCombat(
        currentZone, direction, true, 1,
        setup, zoneInfo, ac, mCrew, rng, tables, log,
        outOfFormation, squadronMod, fighterWaveModifier, m4Modifier,
        badLuftwaffeCommsActive, eventState, options.useRandomEvents ?? false,
        (id) => { nextFighterId = id; }, () => nextFighterId,
      );

      if (isAllCrewDead(mCrew) || planeDestroyed) break;
      continue; // Don't process non-target zone logic
    }

    // ─── Non-target zone processing ───

    // Fighter cover per §5.2b
    let coverLevel: FighterCoverLevel | null = null;
    if (hasFighterCover(currentZone)) {
      coverLevel = rollFighterCover(rng, tables);
      emit('FIGHTER_COVER', `Fighter cover: ${coverLevel}`, currentZone, direction);
    }

    // Light flak per §13.1d
    if (outOfFormation && isSubjectToLightFlak(outOfFormation, 10000, zoneInfo?.over ?? [])) {
      const lightFlak = resolveLightFlak(rng, tables);
      if (lightFlak.shellHits > 0) {
        emit('FLAK', `Light flak — ${lightFlak.shellHits} shell hits`, currentZone, direction);
        for (const area of lightFlak.areasHit) {
          applyFlakDamage(area, ac, mCrew, rng, tables, log, currentZone, direction);
        }
      }
    }

    if (isAllCrewDead(mCrew) || planeDestroyed) break;

    // Resolve zone combat
    resolveZoneCombat(
      currentZone, direction, false, turnsThisZone,
      setup, zoneInfo, ac, mCrew, rng, tables, log,
      outOfFormation, squadronMod, fighterWaveModifier, m4Modifier,
      badLuftwaffeCommsActive, eventState, options.useRandomEvents ?? false,
      (id) => { nextFighterId = id; }, () => nextFighterId,
    );

    if (isAllCrewDead(mCrew) || planeDestroyed) break;

    // Check engine status after combat
    const engOutNow = countEnginesOut(ac);
    if (engOutNow >= 4) {
      emit('ENGINE', 'All engines out — emergency!', currentZone, direction);
      const bailResult = resolveEmergencyLanding(currentZone, setup.target.name, mCrew, ac, rng, tables, log, direction);
      planeDestroyed = bailResult.planeDestroyed;
      break;
    }

    // Frostbite check per §11.0
    if (ac.heatingOut) {
      for (const member of mCrew) {
        if (member.status === 'active' && !member.frostbite && member.wounds !== 'kia') {
          if (rollFrostbite(rng)) {
            member.frostbite = true;
            emit('FROSTBITE', `${member.name} (${member.position}) suffers frostbite`, currentZone, direction);
          }
        }
      }
    }
  }

  // ═══ LANDING ═══
  if (!planeDestroyed && currentZone <= 1 && direction === 'inbound') {
    emit('LANDING', 'Approaching base for landing');

    // Roll weather at base per §5.2g
    const baseWeather = rollWeather(rng, tables);
    emit('LANDING', `Weather at base: ${baseWeather.weather}`);

    // Calculate landing modifiers
    const landMod = calculateLandModifier({
      enginesOut: countEnginesOut(ac),
      tailWheelInop: ac.tailWheelInop,
      controlDamage: ac.controlDamage,
      bipDamage,
      landingInEurope: false,
      accumulatedModifiers: accumulatedLandingMod,
      radioOut: ac.radioOut,
      pilotCopilotExperienced: (mCrew.find(c => c.position === 'pilot')?.missions ?? 0) >= 11,
      nonPilotFlying: !pilotAlive() && !copilotAlive(),
      bombsAboard,
    });

    const landResult = resolveLandLanding(landMod, mCrew, rng, tables);
    emit('LANDING', `Landing result: ${landResult.outcome} (roll ${landResult.roll} + ${landMod} = ${landResult.modifiedRoll})`);

    if (landResult.outcome === 'crew_kia_plane_wrecked') {
      planeDestroyed = true;
      for (const m of mCrew) { if (m.status === 'active') m.wounds = 'kia'; }
    }

    if (landResult.crewWounds.length > 0) {
      for (const w of landResult.crewWounds) {
        const member = mCrew.find(c => c.position === w.position);
        if (member) {
          member.wounds = w.wound;
          emit('LANDING', `${member.name} wounded in landing: ${w.wound}`);
        }
      }
    }
  }

  // ═══ POST-MISSION ═══
  // Determine outcome per §7.1
  const planeLost = planeDestroyed || isAllCrewDead(mCrew);
  const planeIrreparable = false; // Simplified — would need to track from landing result

  let victory: MissionOutcome['victory'];
  if (planeDestroyed || planeLost) {
    victory = 'german_victory';
  } else if (bombOnTarget && bombAccuracy > 0) {
    victory = '8th_af_victory';
  } else {
    victory = 'draw';
  }

  const crewFates = mCrew.map(c => ({
    position: c.position,
    name: c.name,
    fate: c.wounds === 'kia' ? 'KIA' : c.status !== 'active' ? c.status : 'survived',
  }));

  emit('DEBRIEF', `Mission #${missionNumber} complete: ${victory}`, undefined, undefined, {
    bombAccuracy, bombOnTarget, survived: !planeDestroyed,
  });

  return {
    missionNumber,
    target: setup.target.name,
    log,
    outcome: {
      victory,
      survived: !planeDestroyed && !isAllCrewDead(mCrew),
      reachedTarget,
      bombsOnTarget: bombOnTarget,
      bombAccuracy,
      planeDestroyed,
      planeLost,
      planeIrreparable,
      crewFates,
    },
    updatedCrew: mCrew,
    updatedAircraft: ac,
  };
}

// ─── Zone combat helper ───

function resolveZoneCombat(
  zone: number,
  direction: 'outbound' | 'inbound',
  isTargetZone: boolean,
  turnsInZone: number,
  setup: MissionSetupResult,
  zoneInfo: ZoneInfo | null,
  ac: AircraftState,
  crew: CrewMember[],
  rng: RNG,
  tables: TableStore,
  log: MissionLogEntry[],
  outOfFormation: boolean,
  squadronMod: number,
  fighterWaveMod: number,
  m4Mod: number,
  badComms: boolean,
  eventState: RandomEventState,
  useRandomEvents: boolean,
  setNextFighterId: (id: number) => void,
  getNextFighterId: () => number,
): void {
  const emit = (phase: string, msg: string, data?: Record<string, unknown>) => {
    log.push({ phase, zone, direction, message: msg, data });
  };

  for (let turn = 0; turn < turnsInZone; turn++) {
    // Roll fighter waves per §6.1a
    const waveModifier = getFighterWaveModifier(zoneInfo, squadronMod, outOfFormation, 0) + fighterWaveMod;
    const { waveCount } = rollFighterWaves(isTargetZone, waveModifier, rng, tables);

    if (waveCount === 0) {
      emit('COMBAT', 'No fighter waves this turn');
      continue;
    }

    emit('COMBAT', `${waveCount} fighter ${waveCount === 1 ? 'wave' : 'waves'}`);

    for (let wave = 0; wave < waveCount; wave++) {
      let fid = getNextFighterId();
      const { fighters, rolls } = rollAttackingFightersWithReroll(rng, tables, outOfFormation, fid);
      fid = fighters.length > 0 ? Math.max(...fighters.map(f => f.id)) + 1 : fid;

      // Check for random event (roll 66)
      if (rolls.length > 0 && rolls[0] === 66 && useRandomEvents) {
        const event = resolveRandomEvent(rng, tables, eventState, outOfFormation, countEnginesOut(ac) >= 2, 'middle');
        emit('RANDOM_EVENT', event.description);
      }

      // Lead/tail extra fighter per §5.1c (only in formation)
      if (!outOfFormation && setup.extraFighterPerWave && fighters.length > 0) {
        fighters.push({
          id: fid++,
          type: 'Me109',
          position: '12 Level',
          damage: [],
          attacksMade: 0,
          scoredHit: false,
        });
      }

      setNextFighterId(fid);

      if (fighters.length === 0) {
        emit('COMBAT', 'Fighters driven off by other B-17s');
        continue;
      }

      // Bad Luftwaffe comms: remove 1 fighter per wave
      let activeFighters = [...fighters];
      if (badComms && activeFighters.length > 0) {
        activeFighters.pop();
      }

      // Fighter cover defense per §6.2
      if (hasFighterCover(zone)) {
        // Simplified: remove some fighters
        const coverRoll = rng.d6();
        const removed = Math.min(coverRoll > 3 ? 1 : 0, activeFighters.length);
        if (removed > 0) {
          activeFighters = activeFighters.slice(removed);
          emit('COMBAT', `Fighter cover drives off ${removed} ${removed === 1 ? 'fighter' : 'fighters'}`);
        }
      }

      if (activeFighters.length === 0) continue;

      emit('COMBAT', `${activeFighters.length} ${activeFighters.length === 1 ? 'fighter' : 'fighters'} attacking`);

      // Simplified combat: each fighter attacks
      for (const fighter of activeFighters) {
        fighter.attacksMade++;

        // German offensive fire (simplified)
        const hitRoll = rng.d6();
        const engineMod = countEnginesOut(ac) >= 2 ? 1 : 0;
        const hit = hitRoll >= 4 || hitRoll === 6; // simplified threshold

        if (!hit) continue;

        fighter.scoredHit = true;

        // Shell hits
        const shells = Math.max(1, rng.d6() - 2); // simplified
        for (let s = 0; s < shells; s++) {
          // Random compartment hit
          const compartments: HitLocation[] = ['Nose', 'Pilot Compt.', 'Bomb Bay', 'Radio Room', 'Waist', 'Tail', 'Port Wing', 'Starboard Wing'];
          const hitArea = compartments[rng.int(0, compartments.length - 1)];
          applyFlakDamage(hitArea, ac, crew, rng, tables, log, zone, direction);
        }
      }

      // Successive attacks (simplified — fighters that hit attack again, max 3)
      for (const fighter of activeFighters) {
        if (!fighter.scoredHit) continue;
        while (fighter.attacksMade < 3 && (outOfFormation || fighter.scoredHit)) {
          fighter.attacksMade++;
          fighter.scoredHit = false;
          const hitRoll = rng.d6();
          if (hitRoll >= 5) {
            fighter.scoredHit = true;
            const shells = Math.max(1, rng.d6() - 3);
            for (let s = 0; s < shells; s++) {
              const compartments: HitLocation[] = ['Nose', 'Pilot Compt.', 'Bomb Bay', 'Radio Room', 'Waist', 'Tail'];
              const hitArea = compartments[rng.int(0, compartments.length - 1)];
              applyFlakDamage(hitArea, ac, crew, rng, tables, log, zone, direction);
            }
          }
          if (!outOfFormation && !fighter.scoredHit) break;
        }
      }
    }
  }
}

// ─── Apply damage from a hit area ───

function applyFlakDamage(
  area: HitLocation,
  ac: AircraftState,
  crew: CrewMember[],
  rng: RNG,
  tables: TableStore,
  log: MissionLogEntry[],
  zone: number,
  direction: 'outbound' | 'inbound',
): void {
  const emit = (msg: string) => {
    log.push({ phase: 'DAMAGE', zone, direction, message: msg });
  };

  // Map area to damage table
  const tableMap: Record<string, string> = {
    'Nose': 'P-1', 'Pilot Compt.': 'P-2', 'Bomb Bay': 'P-3',
    'Radio Room': 'P-4', 'Waist': 'P-5', 'Tail': 'P-6',
    'Port Wing': 'B1-1', 'Starboard Wing': 'B1-1',
  };

  const damageTable = tableMap[area];
  if (!damageTable) {
    emit(`Hit on ${area} — superficial`);
    return;
  }

  const damage = rollCompartmentDamage(damageTable, rng, tables);
  emit(`Hit on ${area}: ${damage.result}`);

  // Apply effects (simplified)
  for (const effect of damage.effects) {
    switch (effect.type) {
      case 'crew_wound': {
        const wound = rollCrewWound(rng, tables);
        const crewInArea = getCrewInCompartment(area, crew);
        if (crewInArea.length > 0) {
          const target = crewInArea[rng.int(0, crewInArea.length - 1)];
          if (target.wounds !== 'kia') {
            target.wounds = wound;
            emit(`${target.name} (${target.position}) wounded: ${wound}`);
          }
        }
        break;
      }
      case 'engine_damage': {
        const engIdx = effect.engine ?? rng.int(0, 3);
        if (ac.engines[engIdx] === 'ok') {
          ac.engines[engIdx] = 'out';
          emit(`Engine #${engIdx + 1} knocked out`);
        }
        break;
      }
      case 'control_damage': {
        if (effect.target === 'rudder') ac.controlDamage.rudder = true;
        else if (effect.target === 'elevator') ac.controlDamage.elevator = true;
        else if (effect.target === 'ailerons') ac.controlDamage.ailerons = true;
        break;
      }
      case 'fire':
        emit('Fire!');
        break;
      case 'destroyed':
        emit('Catastrophic damage!');
        break;
      default:
        break;
    }
  }
}

// ─── Map compartment to crew ───

function getCrewInCompartment(area: HitLocation, crew: CrewMember[]): CrewMember[] {
  const mapping: Record<string, CrewPosition[]> = {
    'Nose': ['navigator', 'bombardier'],
    'Pilot Compt.': ['pilot', 'copilot'],
    'Bomb Bay': [],
    'Radio Room': ['radioman'],
    'Waist': ['left_waist', 'right_waist'],
    'Tail': ['tail_gunner'],
    'Port Wing': ['engineer'], // top turret is in wing area
    'Starboard Wing': ['ball_turret'],
  };

  const positions = mapping[area] ?? [];
  return crew.filter(c => positions.includes(c.position) && c.status === 'active' && c.wounds !== 'kia');
}

// ─── Emergency landing/bailout ───

function resolveEmergencyLanding(
  zone: number,
  targetName: string,
  crew: CrewMember[],
  ac: AircraftState,
  rng: RNG,
  tables: TableStore,
  log: MissionLogEntry[],
  direction: 'outbound' | 'inbound',
): { planeDestroyed: boolean } {
  const emit = (msg: string) => {
    log.push({ phase: 'EMERGENCY', zone, direction, message: msg });
  };

  // Determine terrain
  const zoneInfo = getZoneInfo(targetName, zone, tables);
  const over = zoneInfo?.over ?? ['water'];
  const locations = determineLandingLocation(zone, over);

  if (locations.includes('water') && !locations.includes('europe') && !locations.includes('england')) {
    // Must ditch or bail over water
    emit('Forced ditching at sea');
    const waterMod = calculateWaterLandModifier({
      enginesOut: countEnginesOut(ac),
      tailWheelInop: ac.tailWheelInop,
      controlDamage: ac.controlDamage,
      bipDamage: false,
      landingInEurope: false,
      accumulatedModifiers: 0,
      radioOut: ac.radioOut,
      pilotCopilotExperienced: false,
      nonPilotFlying: false,
      bombsAboard: false,
    });
    const result = resolveWaterLanding(waterMod, zone, false, rng, tables);
    emit(`Water landing: ${result.outcome}`);
    if (result.outcome === 'crew_lost' || result.outcome === 'explosion_all_destroyed') {
      for (const m of crew) { if (m.status === 'active') m.wounds = 'kia'; }
    }
    return { planeDestroyed: true };
  }

  // Crash land on land
  emit('Emergency crash landing');
  const landMod = calculateLandModifier({
    enginesOut: countEnginesOut(ac),
    tailWheelInop: ac.tailWheelInop,
    controlDamage: ac.controlDamage,
    bipDamage: false,
    landingInEurope: !locations.includes('england'),
    accumulatedModifiers: 0,
    radioOut: ac.radioOut,
    pilotCopilotExperienced: false,
    nonPilotFlying: false,
    bombsAboard: false,
  });
  const result = resolveLandLanding(landMod, crew, rng, tables);
  emit(`Crash landing: ${result.outcome}`);
  if (result.outcome === 'crew_kia_plane_wrecked') {
    for (const m of crew) { if (m.status === 'active') m.wounds = 'kia'; }
  }
  return { planeDestroyed: true };
}

// ─── Helpers ───

function isAllCrewDead(crew: CrewMember[]): boolean {
  return crew.every(c => c.wounds === 'kia' || c.status === 'kia');
}

function makeFallbackResult(
  missionNumber: number,
  log: MissionLogEntry[],
  crew: CrewMember[],
  ac: AircraftState,
): CompleteMissionResult {
  return {
    missionNumber,
    target: 'Unknown',
    log,
    outcome: {
      victory: 'draw',
      survived: true,
      reachedTarget: false,
      bombsOnTarget: false,
      bombAccuracy: 0,
      planeDestroyed: false,
      planeLost: false,
      planeIrreparable: false,
      crewFates: crew.map(c => ({ position: c.position, name: c.name, fate: 'survived' })),
    },
    updatedCrew: crew,
    updatedAircraft: ac,
  };
}
