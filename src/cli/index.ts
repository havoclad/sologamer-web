#!/usr/bin/env node
/**
 * B-17 Queen of the Skies — CLI Interface
 *
 * Play the classic Avalon Hill solitaire bomber game from the command line.
 * Renders mission events as a narrative text output.
 *
 * Usage:
 *   npx ts-node src/cli/index.ts [options]
 *
 * Options:
 *   --seed <number>    Deterministic RNG seed for replay
 *   --verbose          Show all die rolls and table lookups
 *   --name <string>    Name your bomber (default: "Memphis Belle")
 *   --missions <n>     Number of missions to fly (default: 1)
 */

import { createRNG, type RNG } from '../engine/rng.js';
import { TableStore } from '../engine/tables.js';
import { EventBus, type BaseEvent } from '../engine/events.js';
import { StateMachine } from '../engine/state-machine.js';
import { b17Module, createInitialB17State } from '../games/b17/index.js';
import type {
  B17GameState, B17Event, MissionState, CrewMember, CrewPosition,
  AircraftState, WoundSeverity, EngineStatus,
} from '../games/b17/types.js';
import type { B17Phase } from '../games/b17/phases.js';
import {
  setupMission, selectTarget, rollFormationPosition, rollSquadronPosition,
  rollWeather, getZoneInfo, getTargetZone,
  type TargetInfo, type MissionSetupResult, type WeatherResult,
} from '../games/b17/rules/mission-setup.js';
import {
  rollFighterCover, hasFighterCover, turnsInZone, nextZone,
  getFighterWaveModifier, mustAbort, enginesOut,
  type FighterCoverLevel,
} from '../games/b17/rules/zone-movement.js';
import {
  rollFighterWaves, rollAttackingFightersWithReroll, addLeadTailExtraFighter,
  type Fighter, type AttackPosition,
} from '../games/b17/rules/fighter-encounters.js';
import {
  getFieldOfFire, resolveDefensiveFire, rollFighterDamage, isTwinGunMount,
  applyFighterDamage, resolveGermanOffensiveFire, rollFighterCoverDefense,
  removeDrivenOffFighters, rollShellHits,
  rollSuccessiveAttackPosition, getSuccessiveAttackers,
  type GunPosition, type FighterDamageResult,
} from '../games/b17/rules/combat.js';
import {
  rollHitLocation, rollCompartmentDamage, rollCrewWound,
  countEnginesOut, WALKING_HIT_COMPARTMENTS,
  type ShellHitLocation, type DamageResult,
} from '../games/b17/rules/damage.js';
import { applyWound } from '../games/b17/rules/crew.js';

// ─── Parse CLI args (minimal, no commander needed for this) ───

interface CLIOptions {
  seed?: number;
  verbose: boolean;
  planeName: string;
  missionsToFly: number;
  crewNames: Map<CrewPosition, string>;
}

function parseArgs(): CLIOptions {
  const args = process.argv.slice(2);
  const opts: CLIOptions = {
    verbose: false,
    planeName: 'Memphis Belle',
    missionsToFly: 1,
    crewNames: new Map(),
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--seed':
        opts.seed = parseInt(args[++i], 10);
        break;
      case '--verbose':
      case '-v':
        opts.verbose = true;
        break;
      case '--name':
        opts.planeName = args[++i];
        break;
      case '--missions':
        opts.missionsToFly = parseInt(args[++i], 10);
        break;
      case '--help':
      case '-h':
        console.log(`
B-17: Queen of the Skies — CLI

Usage: npx ts-node src/cli/index.ts [options]

Options:
  --seed <number>     Deterministic seed for reproducible missions
  --verbose, -v       Show all die rolls and table lookups
  --name <string>     Name your bomber (default: "Memphis Belle")
  --missions <n>      Number of missions to fly (default: 1)
  --help, -h          Show this help
`);
        process.exit(0);
    }
  }
  return opts;
}

// ─── Output formatting ───

const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const CYAN = '\x1b[36m';
const MAGENTA = '\x1b[35m';
const WHITE = '\x1b[37m';

function header(text: string): void {
  console.log(`\n${BOLD}${CYAN}${'═'.repeat(60)}${RESET}`);
  console.log(`${BOLD}${CYAN}  ${text}${RESET}`);
  console.log(`${BOLD}${CYAN}${'═'.repeat(60)}${RESET}`);
}

function subheader(text: string): void {
  console.log(`\n${BOLD}${WHITE}── ${text} ──${RESET}`);
}

function narrative(text: string): void {
  console.log(text);
}

function good(text: string): void {
  console.log(`${GREEN}${text}${RESET}`);
}

function warn(text: string): void {
  console.log(`${YELLOW}${text}${RESET}`);
}

function bad(text: string): void {
  console.log(`${RED}${text}${RESET}`);
}

function info(text: string): void {
  console.log(`${DIM}${text}${RESET}`);
}

function verbose(text: string, isVerbose: boolean): void {
  if (isVerbose) {
    console.log(`${DIM}  [${text}]${RESET}`);
  }
}

// ─── Crew name generation ───

const FIRST_NAMES = [
  'James', 'Robert', 'John', 'William', 'Richard', 'Thomas', 'Charles', 'Donald',
  'George', 'Kenneth', 'Edward', 'Frank', 'Raymond', 'Harold', 'Paul', 'Jack',
  'Henry', 'Arthur', 'Ralph', 'Albert', 'Eugene', 'Howard', 'Carl', 'Walter',
  'Joseph', 'Lawrence', 'Earl', 'Roy', 'Leonard', 'Norman', 'Gerald', 'Herbert',
];

const LAST_NAMES = [
  'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Miller', 'Davis', 'Wilson',
  'Anderson', 'Taylor', 'Thomas', 'Moore', 'Martin', 'Jackson', 'Thompson', 'White',
  'Harris', 'Clark', 'Lewis', 'Robinson', 'Walker', 'Young', 'Allen', 'King',
  'Wright', 'Scott', 'Green', 'Baker', 'Adams', 'Nelson', 'Hill', 'Campbell',
  'Mitchell', 'Roberts', 'Carter', 'Phillips', 'Evans', 'Turner', 'Torres', 'Parker',
];

const POSITION_LABELS: Record<CrewPosition, string> = {
  pilot: 'Pilot',
  copilot: 'Co-Pilot',
  navigator: 'Navigator',
  bombardier: 'Bombardier',
  engineer: 'Engineer/Top Turret',
  radioman: 'Radio Operator',
  ball_turret: 'Ball Turret Gunner',
  left_waist: 'Left Waist Gunner',
  right_waist: 'Right Waist Gunner',
  tail_gunner: 'Tail Gunner',
};

const GUN_LABELS: Record<string, string> = {
  Nose: 'Nose guns',
  Port_Cheek: 'Port cheek gun',
  Starboard_Cheek: 'Starboard cheek gun',
  Top_Turret: 'Top turret',
  Ball_Turret: 'Ball turret',
  Port_Waist: 'Left waist gun',
  Starboard_Waist: 'Right waist gun',
  Radio: 'Radio room gun',
  Tail: 'Tail guns',
};

const GUN_TO_CREW: Record<string, CrewPosition> = {
  Nose: 'bombardier',
  Port_Cheek: 'navigator',
  Starboard_Cheek: 'navigator',
  Top_Turret: 'engineer',
  Ball_Turret: 'ball_turret',
  Port_Waist: 'left_waist',
  Starboard_Waist: 'right_waist',
  Radio: 'radioman',
  Tail: 'tail_gunner',
};

function generateCrewName(rng: RNG): string {
  const first = FIRST_NAMES[rng.int(0, FIRST_NAMES.length - 1)];
  const last = LAST_NAMES[rng.int(0, LAST_NAMES.length - 1)];
  return `${first} ${last}`;
}

function getCrewByPosition(crew: CrewMember[], pos: CrewPosition): CrewMember | undefined {
  return crew.find(c => c.position === pos);
}

// ─── Mission Runner ───

interface MissionResult {
  missionNumber: number;
  target: string;
  survived: boolean;
  aborted: boolean;
  bombsDropped: boolean;
  crewLosses: Array<{ name: string; position: string; status: string }>;
  fightersDestroyed: number;
  damageNotes: string[];
}

function flyMission(
  state: B17GameState,
  rng: RNG,
  tables: TableStore,
  opts: CLIOptions,
): MissionResult {
  const missionNumber = state.campaign.missionsCompleted + 1;
  let fightersDestroyed = 0;
  let nextFighterId = 1;
  const damageNotes: string[] = [];

  // ── Mission Setup ──
  header(`Mission #${missionNumber}: Pre-Mission Briefing`);

  const setup = setupMission(missionNumber, rng, tables);
  verbose(`Target roll on ${missionNumber <= 5 ? 'G-1' : missionNumber <= 10 ? 'G-2' : 'G-3'}`, opts.verbose);

  narrative(`\n  Target: ${BOLD}${setup.target.name}${RESET}`);
  narrative(`  Target type: ${setup.target.type}`);
  narrative(`  Target zone: ${setup.targetZone}`);

  const formLabel = setup.formationPosition === 'lead' ? 'Lead Bomber'
    : setup.formationPosition === 'tail' ? 'Tail Bomber' : 'Middle';
  narrative(`  Formation position: ${formLabel}`);
  verbose(`Formation roll on G-4 → ${setup.formationPosition}`, opts.verbose);

  if (setup.squadronPosition) {
    const sqLabel = setup.squadronPosition.position === 'high' ? 'High'
      : setup.squadronPosition.position === 'low' ? 'Low' : 'Middle';
    narrative(`  Squadron: ${sqLabel} Squadron`);
    verbose(`Squadron roll on G-4a → ${sqLabel} (B-1/B-2 modifier: ${setup.squadronPosition.b1b2Modifier >= 0 ? '+' : ''}${setup.squadronPosition.b1b2Modifier})`, opts.verbose);
  }

  if (setup.extraFighterPerWave) {
    warn(`  ⚠ ${formLabel} position: +1 fighter per wave!`);
  }

  // Initialize mission state
  const mission: MissionState = {
    missionNumber,
    target: setup.target.name,
    zone: 1,
    direction: 'outbound',
    formation: setup.squadronPosition?.position ?? 'lead',
    squadron: setup.squadronPosition?.position ?? 'lead',
    weather: 'clear',
    outOfFormation: false,
    altitude: 20000,
    bombsAboard: true,
    bombsDropped: false,
    aborted: false,
    evasiveAction: false,
    landingModifiers: 0,
  };
  state.mission = mission;

  // Show crew roster
  subheader('Crew Manifest');
  for (const crew of state.campaign.crew) {
    const statusIcon = crew.status === 'active' ? '✓' : '✗';
    const statusColor = crew.status === 'active' ? GREEN : RED;
    console.log(`  ${statusColor}${statusIcon}${RESET} ${POSITION_LABELS[crew.position]}: ${BOLD}${crew.name}${RESET}`);
  }

  // ── Fly outbound zones ──
  header('Mission Underway');
  narrative(`\n${BOLD}${state.campaign.planeName}${RESET} takes off from base and forms up...`);

  let landed = false;
  let destroyed = false;
  const squadronMod = setup.squadronPosition?.b1b2Modifier ?? 0;

  // Outbound: zone 2 → target zone
  for (let z = 2; z <= setup.targetZone && !landed && !destroyed; z++) {
    mission.zone = z;
    mission.direction = 'outbound';

    const isTargetZone = z === setup.targetZone;

    subheader(`Zone ${z} — ${isTargetZone ? `TARGET: ${setup.target.name}` : 'Outbound'}${mission.outOfFormation ? ' [OUT OF FORMATION]' : ''}`);

    // Zone info from gazetteer
    const zoneInfo = getZoneInfo(setup.target.name, z, tables);
    if (zoneInfo && zoneInfo.over.length > 0) {
      narrative(`  Over: ${zoneInfo.over.join(', ')}`);
    }

    // Weather at target zone
    if (isTargetZone) {
      const weather = rollWeather(rng, tables);
      mission.weather = weather.weather;
      verbose(`Weather roll on O-1 → ${weather.weather}`, opts.verbose);
      const weatherLabel = weather.weather === 'clear' ? `${GREEN}Clear${RESET}`
        : weather.weather === 'poor' ? `${YELLOW}Poor${RESET}`
          : `${RED}Overcast${RESET}`;
      narrative(`  Weather: ${weatherLabel}`);
    }

    // Fighter cover check (zones 2-4)
    let coverLevel: FighterCoverLevel | null = null;
    if (hasFighterCover(z)) {
      coverLevel = rollFighterCover(rng, tables);
      verbose(`Fighter cover roll on G-5 → ${coverLevel}`, opts.verbose);
      const coverColor = coverLevel === 'Good' ? GREEN : coverLevel === 'Fair' ? YELLOW : RED;
      narrative(`  Fighter cover: ${coverColor}${coverLevel}${RESET}`);
    } else {
      warn('  No fighter cover in this zone.');
    }

    // Fighter waves
    const waveMod = getFighterWaveModifier(zoneInfo ?? null, squadronMod, mission.outOfFormation, 0);
    const waveResult = rollFighterWaves(isTargetZone, waveMod, rng, tables);
    verbose(`Fighter wave roll on ${isTargetZone ? 'B-2' : 'B-1'} (mod ${waveMod >= 0 ? '+' : ''}${waveMod}) → ${waveResult.waveCount} waves`, opts.verbose);

    if (waveResult.waveCount === 0) {
      good('  No enemy fighters encountered.');
    }

    for (let w = 1; w <= waveResult.waveCount && !destroyed; w++) {
      narrative(`\n  ${BOLD}${RED}Fighter wave ${w}!${RESET}`);

      // Roll attacking fighters
      const attackResult = rollAttackingFightersWithReroll(rng, tables, mission.outOfFormation, nextFighterId);
      nextFighterId += attackResult.fighters.length + 1;
      verbose(`B-3 rolls: [${attackResult.rolls.join(', ')}]`, opts.verbose);

      let fighters = attackResult.fighters;

      if (fighters.length === 0) {
        good('  Fighters driven off by other B-17s in the formation.');
        continue;
      }

      // Add extra fighter for lead/tail bomber (if in formation)
      if (setup.extraFighterPerWave && !mission.outOfFormation) {
        fighters = addLeadTailExtraFighter(fighters, nextFighterId++);
      }

      // Describe incoming fighters
      const fighterDescs = fighters.map(f => `${f.type} at ${f.position}`);
      if (fighters.length === 1) {
        warn(`  ${fighters[0].type} approaching from ${fighters[0].position}`);
      } else {
        warn(`  ${fighters.length} fighters approaching: ${fighterDescs.join(', ')}`);
      }

      // Fighter cover defense
      if (coverLevel && hasFighterCover(z)) {
        const coverResult = rollFighterCoverDefense(coverLevel, rng, tables, 0);
        verbose(`M-4 fighter cover → ${coverResult.initialDrivenOff} driven off (${coverResult.successiveDrivenOff} on successive)`, opts.verbose);

        if (coverResult.initialDrivenOff > 0) {
          const { remaining, removed } = removeDrivenOffFighters(fighters, coverResult.initialDrivenOff);
          fighters = remaining;
          if (removed.length > 0) {
            good(`  Friendly fighters drive off ${removed.length} enemy fighter${removed.length > 1 ? 's' : ''}!`);
          }
        }
      }

      if (fighters.length === 0) {
        good('  All fighters driven off by fighter cover!');
        continue;
      }

      // ── Defensive Fire ──
      let attackRound = 0;
      let activeFighters = [...fighters];

      while (activeFighters.length > 0 && attackRound < 3) {
        attackRound++;
        if (attackRound > 1) {
          narrative(`\n  ${DIM}--- Successive attack round ${attackRound} ---${RESET}`);
        }

        // B-17 defensive fire
        for (const fighter of activeFighters) {
          const fieldOfFire = getFieldOfFire(fighter.position, tables);

          for (const [gun, hitReq] of fieldOfFire) {
            const crewPos = GUN_TO_CREW[gun];
            if (!crewPos) continue;
            const crewMember = getCrewByPosition(state.campaign.crew, crewPos);
            if (!crewMember || crewMember.status !== 'active') continue;
            if (crewMember.woundSeverity === 'serious' || crewMember.woundSeverity === 'kia') continue;

            const fireResult = resolveDefensiveFire(
              hitReq, rng, false, mission.evasiveAction, false,
              crewMember.frostbite,
              false, // TODO: track light wound count
            );

            verbose(`${GUN_LABELS[gun]} fires at ${fighter.type} (${fighter.position}): rolled ${fireResult.roll}, need ${hitReq}`, opts.verbose);

            if (fireResult.hit) {
              const dmgResult = rollFighterDamage(rng, tables, isTwinGunMount(gun));
              const dmgStatus = applyFighterDamage(fighter, dmgResult);
              verbose(`M-2 fighter damage: ${dmgResult}`, opts.verbose);

              if (dmgStatus.status === 'destroyed') {
                good(`  ${GUN_LABELS[gun]} (${crewMember.name}) fires at ${fighter.position}... ${BOLD}HIT! ${fighter.type} DESTROYED!${RESET}`);
                fightersDestroyed++;
                crewMember.kills++;
              } else if (dmgStatus.status === 'breaks_off') {
                good(`  ${GUN_LABELS[gun]} (${crewMember.name}) fires at ${fighter.position}... HIT! ${fighter.type} damaged, breaks off!`);
              } else {
                warn(`  ${GUN_LABELS[gun]} (${crewMember.name}) fires at ${fighter.position}... HIT! ${fighter.type} damaged, continues attack.`);
              }
            } else {
              narrative(`  ${DIM}${GUN_LABELS[gun]} fires at ${fighter.position}... miss${RESET}`);
            }
          }
        }

        // Remove destroyed/FBOA fighters
        activeFighters = activeFighters.filter(f => {
          const fboaCount = f.damage.filter(d => d === 'FBOA').length;
          const isDestroyed = f.damage.includes('FBOA') && f.damage.filter(d => d === 'FBOA').length >= 2;
          // Check actual status
          if (f.damage.some(d => d === 'FBOA')) return false;
          return true;
        });

        // Recheck after our simplification - destroyed fighters already removed by applyFighterDamage status
        // Just filter out any that had FBOA applied
        activeFighters = fighters.filter(f => {
          const fboaCount = f.damage.filter(d => d === 'FBOA').length;
          if (fboaCount > 0) return false;
          // Check if destroyed (2+ FCA also = breaks off)
          const fcaCount = f.damage.filter(d => d === 'FCA').length;
          if (fcaCount >= 2) return false;
          return true;
        });

        if (activeFighters.length === 0) {
          good('  All fighters driven off or destroyed!');
          break;
        }

        // ── German Offensive Fire ──
        narrative('');
        const engineMod = enginesOut(state.campaign.aircraft) >= 2 ? 1 : 0;
        const evasiveMod = mission.evasiveAction ? -1 : 0;

        for (const fighter of activeFighters) {
          const offResult = resolveGermanOffensiveFire(fighter, rng, tables, engineMod, evasiveMod);
          verbose(`M-3 ${fighter.type} offensive fire: rolled ${offResult.roll}`, opts.verbose);
          fighter.attacksMade++;

          if (offResult.hit) {
            fighter.scoredHit = true;
            bad(`  ${fighter.type} at ${fighter.position} fires... ${BOLD}HIT!${RESET}`);

            // Shell hits
            let shellHits: number;
            try {
              shellHits = rollShellHits(fighter, rng, tables);
            } catch {
              shellHits = rng.int(1, 3); // fallback
            }
            verbose(`B-4 shell hits: ${shellHits}`, opts.verbose);

            if (shellHits > 0) {
              bad(`    ${shellHits} shell hit${shellHits > 1 ? 's' : ''}!`);

              // Resolve each shell hit
              for (let s = 0; s < shellHits; s++) {
                let hitLoc: ShellHitLocation;
                try {
                  hitLoc = rollHitLocation(fighter.position, rng, tables);
                } catch {
                  hitLoc = { location: 'Superficial', isSuperificial: true };
                }
                verbose(`B-5 hit location: ${hitLoc.location}`, opts.verbose);

                if (hitLoc.isSuperificial) {
                  info(`    Shell ${s + 1}: Superficial damage`);
                  continue;
                }

                if (hitLoc.isWalkingHits) {
                  bad(`    Shell ${s + 1}: ${BOLD}Walking hits along fuselage!${RESET}`);
                  for (const compt of WALKING_HIT_COMPARTMENTS) {
                    resolveCompartmentHit(compt.location, compt.damageTable, state, rng, tables, opts, damageNotes);
                  }
                  continue;
                }

                narrative(`    Shell ${s + 1}: Hit to ${BOLD}${hitLoc.location}${RESET}`);
                if (hitLoc.damageTable) {
                  resolveCompartmentHit(hitLoc.location, hitLoc.damageTable, state, rng, tables, opts, damageNotes);
                }
              }
            }
          } else {
            narrative(`  ${DIM}${fighter.type} at ${fighter.position} fires... miss${RESET}`);
          }
        }

        // Check for abort/destruction
        if (countEnginesOut(state.campaign.aircraft) >= 4) {
          bad(`\n  ${BOLD}ALL ENGINES OUT! ${state.campaign.planeName} is going down!${RESET}`);
          destroyed = true;
          break;
        }

        // Successive attacks
        if (attackRound < 3) {
          activeFighters = getSuccessiveAttackers(activeFighters, mission.outOfFormation);
          if (activeFighters.length > 0) {
            for (const f of activeFighters) {
              try {
                const newPos = rollSuccessiveAttackPosition(rng, tables);
                f.position = newPos;
                verbose(`B-6 successive attack position: ${newPos}`, opts.verbose);
              } catch {
                // keep current position
              }
            }
          }
        }
      }
    }

    // Target zone: bomb run
    if (isTargetZone && !destroyed && !mission.aborted) {
      subheader('Bomb Run');
      if (mission.bombsAboard) {
        narrative(`  ${BOLD}Bombs away!${RESET} Target: ${setup.target.name}`);
        mission.bombsAboard = false;
        mission.bombsDropped = true;
        // TODO: roll bombing accuracy on O-6
        good('  Bombs dropped on target.');
      } else {
        warn('  No bombs to drop — already jettisoned.');
      }
    }

    // Check abort conditions
    const navDown = isCrewDown(state.campaign.crew, 'navigator');
    const pilotsDown = isCrewDown(state.campaign.crew, 'pilot') && isCrewDown(state.campaign.crew, 'copilot');
    if (!destroyed && mustAbort(state.campaign.aircraft, mission.outOfFormation, navDown, pilotsDown)) {
      warn('\n  ⚠ Mission abort conditions met!');
      mission.aborted = true;
    }
  }

  // ── Fly inbound ──
  if (!destroyed) {
    for (let z = setup.targetZone - 1; z >= 2 && !destroyed; z--) {
      mission.zone = z;
      mission.direction = 'inbound';

      subheader(`Zone ${z} — Inbound${mission.outOfFormation ? ' [OUT OF FORMATION]' : ''}`);

      const zoneInfo = getZoneInfo(setup.target.name, z, tables);
      if (zoneInfo?.over?.length) {
        narrative(`  Over: ${zoneInfo.over.join(', ')}`);
      }

      // Fighter cover
      let coverLevel: FighterCoverLevel | null = null;
      if (hasFighterCover(z)) {
        coverLevel = rollFighterCover(rng, tables);
        verbose(`Fighter cover roll → ${coverLevel}`, opts.verbose);
        const coverColor = coverLevel === 'Good' ? GREEN : coverLevel === 'Fair' ? YELLOW : RED;
        narrative(`  Fighter cover: ${coverColor}${coverLevel}${RESET}`);
      }

      // Fighter waves (inbound)
      const waveMod = getFighterWaveModifier(zoneInfo ?? null, squadronMod, mission.outOfFormation, 0);
      const waveResult = rollFighterWaves(false, waveMod, rng, tables);
      verbose(`B-1 fighter wave roll (mod ${waveMod >= 0 ? '+' : ''}${waveMod}) → ${waveResult.waveCount}`, opts.verbose);

      if (waveResult.waveCount === 0) {
        good('  No enemy fighters encountered.');
      } else {
        // Simplified inbound combat (same logic, abbreviated output)
        for (let w = 1; w <= waveResult.waveCount && !destroyed; w++) {
          narrative(`\n  ${BOLD}${RED}Fighter wave ${w}!${RESET}`);

          const attackResult = rollAttackingFightersWithReroll(rng, tables, mission.outOfFormation, nextFighterId);
          nextFighterId += attackResult.fighters.length + 1;

          let inboundFighters = attackResult.fighters;

          if (inboundFighters.length === 0) {
            good('  Fighters driven off by formation.');
            continue;
          }

          if (setup.extraFighterPerWave && !mission.outOfFormation) {
            inboundFighters = addLeadTailExtraFighter(inboundFighters, nextFighterId++);
          }

          const fighterDescs = inboundFighters.map(f => `${f.type} at ${f.position}`);
          warn(`  ${inboundFighters.length} fighter${inboundFighters.length > 1 ? 's' : ''}: ${fighterDescs.join(', ')}`);

          // Fighter cover
          if (coverLevel && hasFighterCover(z)) {
            const coverResult = rollFighterCoverDefense(coverLevel, rng, tables, 0);
            if (coverResult.initialDrivenOff > 0) {
              const { remaining, removed } = removeDrivenOffFighters(inboundFighters, coverResult.initialDrivenOff);
              inboundFighters = remaining;
              if (removed.length > 0) good(`  Escort drives off ${removed.length}!`);
            }
          }

          // Quick combat resolution for inbound
          for (const fighter of inboundFighters) {
            // Defensive fire (simplified)
            const fieldOfFire = getFieldOfFire(fighter.position, tables);
            let shotDown = false;
            for (const [gun, hitReq] of fieldOfFire) {
              const crewPos = GUN_TO_CREW[gun];
              if (!crewPos) continue;
              const cm = getCrewByPosition(state.campaign.crew, crewPos);
              if (!cm || cm.status !== 'active' || cm.woundSeverity === 'serious' || cm.woundSeverity === 'kia') continue;

              const fr = resolveDefensiveFire(hitReq, rng, false, mission.evasiveAction, false, cm.frostbite, false);
              if (fr.hit) {
                const dmg = rollFighterDamage(rng, tables, isTwinGunMount(gun));
                const status = applyFighterDamage(fighter, dmg);
                if (status.status === 'destroyed') {
                  good(`  ${GUN_LABELS[gun]} (${cm.name}): ${fighter.type} ${BOLD}DESTROYED!${RESET}`);
                  fightersDestroyed++;
                  cm.kills++;
                  shotDown = true;
                  break;
                } else if (status.status === 'breaks_off') {
                  good(`  ${GUN_LABELS[gun]} (${cm.name}): ${fighter.type} breaks off!`);
                  shotDown = true;
                  break;
                }
              }
            }

            if (shotDown) continue;

            // German offensive fire
            const offResult = resolveGermanOffensiveFire(
              fighter, rng, tables,
              enginesOut(state.campaign.aircraft) >= 2 ? 1 : 0,
              mission.evasiveAction ? -1 : 0,
            );
            fighter.attacksMade++;

            if (offResult.hit) {
              fighter.scoredHit = true;
              bad(`  ${fighter.type} at ${fighter.position}: ${BOLD}HIT!${RESET}`);
              let shellHits: number;
              try { shellHits = rollShellHits(fighter, rng, tables); } catch { shellHits = rng.int(1, 2); }
              for (let s = 0; s < shellHits; s++) {
                let hitLoc: ShellHitLocation;
                try { hitLoc = rollHitLocation(fighter.position, rng, tables); } catch { hitLoc = { location: 'Superficial', isSuperificial: true }; }
                if (hitLoc.isSuperificial) { info(`    Superficial damage`); continue; }
                narrative(`    Hit to ${hitLoc.location}`);
                if (hitLoc.damageTable) {
                  resolveCompartmentHit(hitLoc.location, hitLoc.damageTable, state, rng, tables, opts, damageNotes);
                }
              }
            } else {
              narrative(`  ${DIM}${fighter.type} at ${fighter.position}: miss${RESET}`);
            }
          }

          if (countEnginesOut(state.campaign.aircraft) >= 4) {
            bad(`\n  ${BOLD}ALL ENGINES OUT!${RESET}`);
            destroyed = true;
          }
        }
      }
    }
  }

  // ── Landing ──
  if (!destroyed) {
    subheader('Landing');
    narrative(`  ${state.campaign.planeName} approaches the airfield...`);

    // TODO: proper landing roll on G-8/G-9/G-10
    // For now, simulate a simple landing
    const landingRoll = rng.twod6();
    const landingMod = mission.landingModifiers + (countEnginesOut(state.campaign.aircraft) >= 3 ? -3 : 0);
    const modifiedLanding = landingRoll + landingMod;
    verbose(`Landing roll: ${landingRoll} (mod ${landingMod}) = ${modifiedLanding}`, opts.verbose);

    if (modifiedLanding >= 5) {
      good(`  ${BOLD}Safe landing!${RESET} ${state.campaign.planeName} touches down.`);
    } else if (modifiedLanding >= 2) {
      warn(`  Rough landing! Some minor damage on touchdown.`);
      damageNotes.push('Rough landing');
    } else {
      bad(`  ${BOLD}Crash landing!${RESET}`);
      damageNotes.push('Crash landing');
      // Roll for crew injuries on crash
      for (const crew of state.campaign.crew) {
        if (crew.status === 'active' && rng.d6() <= 2) {
          applyWound(crew, 'light');
          bad(`    ${crew.name} injured in crash!`);
        }
      }
    }
  } else {
    subheader('Bailout / Crash');
    bad(`  ${state.campaign.planeName} has been shot down!`);
    // TODO: bail out per G-6/G-7
    for (const crew of state.campaign.crew) {
      if (crew.status === 'active') {
        const bailRoll = rng.d6();
        if (bailRoll <= 3) {
          crew.status = 'pow';
          bad(`    ${crew.name}: Captured (POW)`);
        } else if (bailRoll <= 5) {
          crew.status = 'active'; // made it back
          good(`    ${crew.name}: Bailed out, evaded capture!`);
        } else {
          crew.status = 'kia';
          bad(`    ${crew.name}: KIA`);
        }
      }
    }
  }

  // ── Post-mission summary ──
  const survived = !destroyed;
  state.campaign.missionsCompleted++;
  for (const crew of state.campaign.crew) {
    if (crew.status === 'active') crew.missions++;
  }

  const crewLosses: MissionResult['crewLosses'] = [];
  for (const crew of state.campaign.crew) {
    if (crew.status !== 'active' || crew.woundSeverity === 'kia' || crew.woundSeverity === 'serious') {
      crewLosses.push({
        name: crew.name,
        position: POSITION_LABELS[crew.position],
        status: crew.woundSeverity === 'kia' ? 'KIA' : crew.woundSeverity === 'serious' ? 'Seriously wounded' : crew.status.toUpperCase(),
      });
    }
  }

  return {
    missionNumber,
    target: setup.target.name,
    survived,
    aborted: mission.aborted,
    bombsDropped: mission.bombsDropped,
    crewLosses,
    fightersDestroyed,
    damageNotes,
  };
}

// ─── Compartment hit resolution helper ───

function resolveCompartmentHit(
  location: string,
  damageTable: string,
  state: B17GameState,
  rng: RNG,
  tables: TableStore,
  opts: CLIOptions,
  damageNotes: string[],
): void {
  let dmg: DamageResult;
  try {
    dmg = rollCompartmentDamage(damageTable, rng, tables);
  } catch {
    dmg = { result: 'Superficial', description: 'No effect', effects: [{ type: 'superficial' }] };
  }
  verbose(`${damageTable} damage: ${dmg.result} — ${dmg.description}`, opts.verbose);

  for (const effect of dmg.effects) {
    switch (effect.type) {
      case 'superficial':
        info(`      ${location}: Superficial — no effect`);
        break;
      case 'crew_wound': {
        const pos = effect.position as CrewPosition;
        const crew = getCrewByPosition(state.campaign.crew, pos);
        if (crew) {
          let severity: WoundSeverity;
          try { severity = rollCrewWound(rng, tables); } catch { severity = 'light'; }
          applyWound(crew, severity);
          if (crew.woundSeverity === 'kia') {
            bad(`      ${BOLD}${crew.name} (${POSITION_LABELS[pos]}) — KIA!${RESET}`);
          } else if (severity === 'serious') {
            bad(`      ${crew.name} (${POSITION_LABELS[pos]}) — seriously wounded!`);
          } else {
            warn(`      ${crew.name} (${POSITION_LABELS[pos]}) — light wound`);
          }
          damageNotes.push(`${POSITION_LABELS[pos]} ${severity} wound`);
        }
        break;
      }
      case 'engine_damage': {
        const engIdx = (effect.engine ?? rng.int(0, 3));
        if (state.campaign.aircraft.engines[engIdx] !== 'out') {
          state.campaign.aircraft.engines[engIdx] = 'out';
          bad(`      Engine #${engIdx + 1} knocked out!`);
          damageNotes.push(`Engine #${engIdx + 1} out`);
          const out = countEnginesOut(state.campaign.aircraft);
          if (out >= 2 && !state.mission!.outOfFormation) {
            state.mission!.outOfFormation = true;
            warn(`      ⚠ ${out} engines out — dropping out of formation!`);
          }
        }
        break;
      }
      case 'fire':
        bad(`      ${BOLD}FIRE in ${location}!${RESET}`);
        damageNotes.push(`Fire in ${location}`);
        break;
      case 'oxygen_hit':
        warn(`      Oxygen system hit in ${location}`);
        state.campaign.aircraft.oxygenOut = true;
        damageNotes.push('Oxygen system damaged');
        break;
      case 'gun_damage':
        warn(`      Gun damaged: ${effect.position ?? location}`);
        damageNotes.push(`Gun damage: ${effect.position ?? location}`);
        break;
      case 'control_damage':
        bad(`      Control surface damage!`);
        damageNotes.push('Control damage');
        state.mission!.landingModifiers -= 1;
        break;
      case 'destroyed':
        bad(`      ${BOLD}CATASTROPHIC DAMAGE — B-17 DESTROYED!${RESET}`);
        damageNotes.push('Aircraft destroyed');
        break;
      case 'landing_modifier':
        warn(`      Landing gear/surface damage (landing modifier ${effect.modifier ?? -1})`);
        state.mission!.landingModifiers += (effect.modifier ?? -1);
        damageNotes.push('Landing modifier');
        break;
      default:
        if (dmg.description) {
          info(`      ${location}: ${dmg.description}`);
        }
        damageNotes.push(`${location}: ${dmg.result}`);
    }
  }
}

function isCrewDown(crew: CrewMember[], pos: CrewPosition): boolean {
  const member = crew.find(c => c.position === pos);
  return !member || member.status !== 'active' || member.woundSeverity === 'serious' || member.woundSeverity === 'kia';
}

// ─── Campaign summary ───

function printCampaignSummary(state: B17GameState, result: MissionResult): void {
  header('Mission Debrief');

  const statusIcon = result.survived ? `${GREEN}✓ SURVIVED${RESET}` : `${RED}✗ LOST${RESET}`;
  narrative(`\n  Mission #${result.missionNumber} to ${BOLD}${result.target}${RESET}: ${statusIcon}`);

  if (result.aborted) warn('  Mission was aborted.');
  if (result.bombsDropped) good('  Bombs successfully dropped on target.');
  else if (result.survived) warn('  Bombs were not dropped on target.');

  narrative(`  Enemy fighters destroyed: ${result.fightersDestroyed}`);

  if (result.crewLosses.length > 0) {
    subheader('Crew Losses');
    for (const loss of result.crewLosses) {
      bad(`    ${loss.position}: ${loss.name} — ${loss.status}`);
    }
  }

  if (result.damageNotes.length > 0) {
    subheader('Damage Report');
    for (const note of result.damageNotes) {
      warn(`    • ${note}`);
    }
  }

  // Aircraft status
  subheader('Aircraft Status');
  const aircraft = state.campaign.aircraft;
  for (let i = 0; i < 4; i++) {
    const status = aircraft.engines[i];
    const color = status === 'ok' ? GREEN : RED;
    console.log(`    Engine #${i + 1}: ${color}${status.toUpperCase()}${RESET}`);
  }
  if (aircraft.oxygenOut) warn('    ⚠ Oxygen system damaged');
  if (aircraft.fuelLeak) warn('    ⚠ Fuel leak');
  if (aircraft.radioOut) warn('    ⚠ Radio out');

  // Crew status
  subheader('Crew Status');
  for (const crew of state.campaign.crew) {
    const statusColor = crew.status === 'active' && crew.woundSeverity === 'none' ? GREEN
      : crew.status === 'active' ? YELLOW : RED;
    const woundStr = crew.woundSeverity !== 'none' ? ` (${crew.woundSeverity} wound)` : '';
    const statusStr = crew.status !== 'active' ? ` [${crew.status.toUpperCase()}]` : '';
    console.log(`    ${statusColor}${POSITION_LABELS[crew.position]}: ${crew.name}${woundStr}${statusStr} — ${crew.missions} missions, ${crew.kills} kills${RESET}`);
  }

  // Campaign progress
  subheader('Campaign Progress');
  const completed = state.campaign.missionsCompleted;
  const total = state.campaign.missionsTotal;
  const bar = '█'.repeat(completed) + '░'.repeat(total - completed);
  narrative(`    [${bar}] ${completed}/${total} missions`);
  if (completed >= total) {
    header('🎖  TOUR COMPLETE! YOUR CREW SURVIVED 25 MISSIONS! 🎖');
  }
}

// ─── Main ───

async function main(): Promise<void> {
  const opts = parseArgs();

  console.log(`${BOLD}${CYAN}`);
  console.log('  ╔══════════════════════════════════════════════════╗');
  console.log('  ║     B-17: QUEEN OF THE SKIES                    ║');
  console.log('  ║     Avalon Hill Solitaire Bomber Game (1981)     ║');
  console.log('  ╚══════════════════════════════════════════════════╝');
  console.log(`${RESET}`);

  // Initialize RNG
  const seed = opts.seed ?? Date.now();
  const rng = createRNG(seed);
  if (opts.seed !== undefined) {
    info(`  Deterministic mode: seed = ${seed}`);
  }

  // Load tables
  const tables = new TableStore();
  tables.loadDirectory(b17Module.tableDirectory);
  info(`  Loaded ${tables.names().length} game tables`);

  // Create game state
  const state = createInitialB17State();
  state.campaign.planeName = opts.planeName;

  // Generate crew names
  for (const crew of state.campaign.crew) {
    crew.name = generateCrewName(rng);
  }

  narrative(`\n  Your bomber: ${BOLD}${state.campaign.planeName}${RESET}`);
  narrative(`  Tour of duty: ${state.campaign.missionsTotal} missions over occupied Europe\n`);

  // Fly missions
  for (let m = 0; m < opts.missionsToFly; m++) {
    if (state.campaign.missionsCompleted >= state.campaign.missionsTotal) {
      good('\n  Tour complete!');
      break;
    }

    // Check if we still have enough active crew
    const activeCrew = state.campaign.crew.filter(c => c.status === 'active');
    if (activeCrew.length < 6) {
      bad('\n  Not enough crew to fly. Campaign over.');
      break;
    }

    const result = flyMission(state, rng, tables, opts);
    printCampaignSummary(state, result);

    if (!result.survived) {
      bad(`\n  ${state.campaign.planeName} has been lost. Campaign over.`);
      break;
    }
  }

  console.log('');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
