/**
 * Game Session — wraps the B-17 engine for step-by-step web play.
 * 
 * Runs the full mission eagerly but captures a rich event log with
 * table/roll details. The frontend steps through events one at a time.
 */

import { createRNG, type RNG } from '../engine/rng.js';
import { TableStore } from '../engine/tables.js';
import { b17Module, createInitialB17State } from '../games/b17/index.js';
import type {
  B17GameState, CrewMember, CrewPosition, AircraftState,
  WoundSeverity, MissionState,
} from '../games/b17/types.js';
import type { B17Phase } from '../games/b17/phases.js';
import {
  setupMission, rollWeather, getZoneInfo, getTargetZone,
  type MissionSetupResult, type TargetInfo,
} from '../games/b17/rules/mission-setup.js';
import {
  rollFighterCover, hasFighterCover, turnsInZone, getFighterWaveModifier,
  mustAbort, enginesOut, type FighterCoverLevel,
} from '../games/b17/rules/zone-movement.js';
import {
  rollFighterWaves, rollAttackingFightersWithReroll, addLeadTailExtraFighter,
  type Fighter,
} from '../games/b17/rules/fighter-encounters.js';
import {
  getFieldOfFire, resolveDefensiveFire, rollFighterDamage, isTwinGunMount,
  applyFighterDamage, resolveGermanOffensiveFire, rollFighterCoverDefense,
  removeDrivenOffFighters, rollShellHits, rollSuccessiveAttackPosition,
  getSuccessiveAttackers,
} from '../games/b17/rules/combat.js';
import {
  rollHitLocation, rollCompartmentDamage, rollCrewWound, accumulateWound,
  countEnginesOut, WALKING_HIT_COMPARTMENTS,
  type ShellHitLocation, type DamageResult,
} from '../games/b17/rules/damage.js';

// ─── Rich event types for the frontend ───

export interface RollDetail {
  table: string;
  tableTitle?: string;
  rollType: string;
  rolled: number;
  modifier?: number;
  modifiedRoll?: number;
  result: string;
  description?: string;
}

export interface GameEvent {
  id: number;
  phase: string;
  zone?: number;
  direction?: 'outbound' | 'inbound';
  category: 'setup' | 'movement' | 'combat' | 'damage' | 'flak' | 'bombing' | 'landing' | 'debrief' | 'system';
  severity: 'info' | 'good' | 'warn' | 'bad' | 'critical';
  message: string;
  details?: RollDetail[];
  /** Snapshot of crew/aircraft state at this point */
  stateSnapshot?: {
    crew: CrewMember[];
    aircraft: AircraftState;
    mission: Partial<MissionState> | null;
  };
}

// ─── Crew name generation ───

const FIRST_NAMES = [
  'James', 'Robert', 'John', 'William', 'Richard', 'Thomas', 'Charles', 'Donald',
  'George', 'Kenneth', 'Edward', 'Frank', 'Raymond', 'Harold', 'Paul', 'Jack',
  'Henry', 'Arthur', 'Ralph', 'Albert', 'Eugene', 'Howard', 'Carl', 'Walter',
];
const LAST_NAMES = [
  'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Miller', 'Davis', 'Wilson',
  'Anderson', 'Taylor', 'Thomas', 'Moore', 'Martin', 'Jackson', 'Thompson', 'White',
  'Harris', 'Clark', 'Lewis', 'Robinson', 'Walker', 'Young', 'Allen', 'King',
  'Wright', 'Scott', 'Green', 'Baker', 'Adams', 'Nelson', 'Hill', 'Campbell',
];

const POSITION_LABELS: Record<CrewPosition, string> = {
  pilot: 'Pilot', copilot: 'Co-Pilot', navigator: 'Navigator', bombardier: 'Bombardier',
  engineer: 'Engineer/Top Turret', radioman: 'Radio Operator',
  ball_turret: 'Ball Turret Gunner', left_waist: 'Left Waist Gunner',
  right_waist: 'Right Waist Gunner', tail_gunner: 'Tail Gunner',
};

const GUN_LABELS: Record<string, string> = {
  Nose: 'Nose guns', Port_Cheek: 'Port cheek gun', Starboard_Cheek: 'Starboard cheek gun',
  Top_Turret: 'Top turret', Ball_Turret: 'Ball turret',
  Port_Waist: 'Left waist gun', Starboard_Waist: 'Right waist gun',
  Radio: 'Radio room gun', Tail: 'Tail guns',
};

const GUN_TO_CREW: Record<string, CrewPosition> = {
  Nose: 'bombardier', Port_Cheek: 'navigator', Starboard_Cheek: 'navigator',
  Top_Turret: 'engineer', Ball_Turret: 'ball_turret',
  Port_Waist: 'left_waist', Starboard_Waist: 'right_waist',
  Radio: 'radioman', Tail: 'tail_gunner',
};

function generateCrewName(rng: RNG): string {
  return `${FIRST_NAMES[rng.int(0, FIRST_NAMES.length - 1)]} ${LAST_NAMES[rng.int(0, LAST_NAMES.length - 1)]}`;
}

function getCrewByPosition(crew: CrewMember[], pos: CrewPosition): CrewMember | undefined {
  return crew.find(c => c.position === pos);
}

function isCrewDown(crew: CrewMember[], pos: CrewPosition): boolean {
  const m = crew.find(c => c.position === pos);
  return !m || m.status !== 'active' || m.wounds === 'serious' || m.wounds === 'kia';
}

function cloneCrew(crew: CrewMember[]): CrewMember[] {
  return crew.map(c => ({ ...c }));
}

function cloneAircraft(ac: AircraftState): AircraftState {
  return {
    ...ac,
    engines: [...ac.engines] as AircraftState['engines'],
    wingSurfaceDamage: { ...ac.wingSurfaceDamage },
    controlDamage: { ...ac.controlDamage },
  };
}

// ─── Session ───

export class GameSession {
  private state: B17GameState;
  private rng: RNG;
  private tables: TableStore;
  private events: GameEvent[] = [];
  private eventId = 0;
  private seed: number;
  private missionInProgress = false;

  constructor(seed?: number, bomberName?: string) {
    this.seed = seed ?? Date.now();
    this.rng = createRNG(this.seed);
    this.tables = new TableStore();
    this.tables.loadDirectory(b17Module.tableDirectory);
    this.state = createInitialB17State();
    this.state.campaign.planeName = bomberName ?? 'Memphis Belle';
    for (const crew of this.state.campaign.crew) {
      crew.name = generateCrewName(this.rng);
    }
  }

  getSeed(): number { return this.seed; }

  getState(): B17GameState { return this.state; }

  getEvents(): GameEvent[] { return this.events; }

  getEventsFrom(fromId: number): GameEvent[] {
    return this.events.filter(e => e.id >= fromId);
  }

  isMissionInProgress(): boolean { return this.missionInProgress; }

  private emit(
    phase: string, message: string, category: GameEvent['category'],
    severity: GameEvent['severity'], zone?: number,
    direction?: 'outbound' | 'inbound', details?: RollDetail[],
    includeSnapshot = false,
  ): GameEvent {
    const event: GameEvent = {
      id: this.eventId++,
      phase, zone, direction, category, severity, message, details,
    };
    if (includeSnapshot) {
      event.stateSnapshot = {
        crew: cloneCrew(this.state.campaign.crew),
        aircraft: cloneAircraft(this.state.campaign.aircraft),
        mission: this.state.mission ? { ...this.state.mission } : null,
      };
    }
    this.events.push(event);
    return event;
  }

  /** Run next step — for now runs a full mission in one go and returns all events */
  runMission(): { events: GameEvent[]; complete: boolean } {
    if (this.missionInProgress) {
      return { events: [], complete: false };
    }

    const startId = this.eventId;
    this.missionInProgress = true;
    this._executeMission();
    this.missionInProgress = false;

    return {
      events: this.events.filter(e => e.id >= startId),
      complete: true,
    };
  }

  private _executeMission(): void {
    const missionNumber = this.state.campaign.missionsCompleted + 1;
    const rng = this.rng;
    const tables = this.tables;
    let nextFighterId = 1;
    let fightersDestroyed = 0;

    // Check crew availability
    const activeCrew = this.state.campaign.crew.filter(c => c.status === 'active');
    if (activeCrew.length < 6) {
      this.emit('CAMPAIGN', 'Not enough crew to fly. Campaign over.', 'system', 'critical');
      return;
    }

    // ═══ SETUP ═══
    this.emit('SETUP', `Mission #${missionNumber} begins`, 'setup', 'info', undefined, undefined, undefined, true);

    let setup: MissionSetupResult;
    try {
      setup = setupMission(missionNumber, rng, tables);
    } catch (e) {
      this.emit('SETUP', `Failed to set up mission: ${e}`, 'system', 'critical');
      return;
    }

    const targetZone = setup.targetZone;
    const squadronMod = setup.squadronPosition?.b1b2Modifier ?? 0;

    const formLabel = setup.formationPosition === 'lead' ? 'Lead Bomber'
      : setup.formationPosition === 'tail' ? 'Tail Bomber' : 'Middle';

    this.emit('SETUP', `Target: ${setup.target.name} (${setup.target.type})`, 'setup', 'info',
      undefined, undefined, [{
        table: missionNumber <= 5 ? 'G-1' : missionNumber <= 10 ? 'G-2' : 'G-3',
        rollType: '2d6',
        rolled: 0,
        result: setup.target.name,
        description: `Target selection for missions ${missionNumber <= 5 ? '1-5' : missionNumber <= 10 ? '6-10' : '11-25'}`,
      }]);

    this.emit('SETUP', `Formation: ${formLabel}`, 'setup', 'info',
      undefined, undefined, [{
        table: 'G-4', rollType: '2d6', rolled: 0, result: formLabel,
        description: 'Formation position within squadron',
      }]);

    if (setup.squadronPosition) {
      const sqLabel = setup.squadronPosition.position === 'high' ? 'High'
        : setup.squadronPosition.position === 'low' ? 'Low' : 'Middle';
      this.emit('SETUP', `Squadron: ${sqLabel} (B-1/B-2 mod: ${squadronMod >= 0 ? '+' : ''}${squadronMod})`, 'setup', 'info',
        undefined, undefined, [{
          table: 'G-4a', rollType: '1d6', rolled: 0, result: sqLabel,
          description: 'Squadron position (missions 6+)',
        }]);
    }

    if (setup.extraFighterPerWave) {
      this.emit('SETUP', `${formLabel} position: +1 fighter per wave!`, 'setup', 'warn');
    }

    this.emit('SETUP', `Target zone: ${targetZone}`, 'setup', 'info');

    // Initialize mission
    const mission: MissionState = {
      missionNumber, target: setup.target.name, zone: 1,
      direction: 'outbound', formation: setup.squadronPosition?.position ?? 'lead',
      squadron: setup.squadronPosition?.position ?? 'lead',
      weather: 'clear', outOfFormation: false, altitude: 20000,
      bombsAboard: true, bombsDropped: false, aborted: false,
      evasiveAction: false, landingModifiers: 0,
    };
    this.state.mission = mission;

    // Crew roster event
    this.emit('SETUP', 'Crew manifest', 'setup', 'info', undefined, undefined, undefined, true);

    // ═══ ZONE LOOP ═══
    let destroyed = false;
    let landed = false;

    // Outbound
    for (let z = 2; z <= targetZone && !landed && !destroyed; z++) {
      mission.zone = z;
      mission.direction = 'outbound';
      const isTarget = z === targetZone;
      const zoneInfo = getZoneInfo(setup.target.name, z, tables);
      const overText = zoneInfo?.over?.length ? ` (over ${zoneInfo.over.join(', ')})` : '';

      this.emit('ZONE', `Entering Zone ${z}${isTarget ? ' — TARGET' : ''} outbound${overText}`,
        'movement', 'info', z, 'outbound', undefined, true);

      // Weather at target
      if (isTarget) {
        const weather = rollWeather(rng, tables);
        mission.weather = weather.weather;
        const wsev = weather.weather === 'clear' ? 'good' : weather.weather === 'poor' ? 'warn' : 'bad';
        this.emit('WEATHER', `Weather over target: ${weather.weather}`, 'movement', wsev as any,
          z, 'outbound', [{
            table: 'O-1', rollType: '1d6', rolled: 0, result: weather.weather,
            description: 'Weather determination',
          }]);
      }

      // Fighter cover
      let coverLevel: FighterCoverLevel | null = null;
      if (hasFighterCover(z)) {
        coverLevel = rollFighterCover(rng, tables);
        const csev = coverLevel === 'Good' ? 'good' : coverLevel === 'Fair' ? 'info' : 'warn';
        this.emit('COVER', `Fighter escort: ${coverLevel}`, 'combat', csev as any,
          z, 'outbound', [{
            table: 'G-5', rollType: '1d6', rolled: 0, result: coverLevel,
            description: 'Allied fighter cover level',
          }]);
      } else {
        this.emit('COVER', 'No fighter cover in this zone', 'combat', 'warn', z, 'outbound');
      }

      // Fighter waves
      const waveMod = getFighterWaveModifier(zoneInfo ?? null, squadronMod, mission.outOfFormation, 0);
      const waveResult = rollFighterWaves(isTarget, waveMod, rng, tables);
      const waveTable = isTarget ? 'B-2' : 'B-1';

      if (waveResult.waveCount === 0) {
        this.emit('COMBAT', 'No enemy fighters encountered', 'combat', 'good', z, 'outbound',
          [{ table: waveTable, rollType: '2d6', rolled: 0, modifier: waveMod, result: '0 waves' }]);
      } else {
        this.emit('COMBAT', `${waveResult.waveCount} fighter wave(s)!`, 'combat', 'bad', z, 'outbound',
          [{ table: waveTable, rollType: '2d6', rolled: 0, modifier: waveMod, result: `${waveResult.waveCount} waves` }]);
      }

      // Process waves
      for (let w = 1; w <= waveResult.waveCount && !destroyed; w++) {
        this.emit('WAVE', `Fighter Wave ${w}`, 'combat', 'bad', z, 'outbound');

        const attackResult = rollAttackingFightersWithReroll(rng, tables, mission.outOfFormation, nextFighterId);
        nextFighterId += attackResult.fighters.length + 1;

        let fighters = attackResult.fighters;
        if (fighters.length === 0) {
          this.emit('COMBAT', 'Fighters driven off by other B-17s', 'combat', 'good', z, 'outbound',
            [{ table: 'B-3', rollType: 'd6d6', rolled: attackResult.rolls[0] ?? 0, result: 'No attackers' }]);
          continue;
        }

        if (setup.extraFighterPerWave && !mission.outOfFormation) {
          fighters = addLeadTailExtraFighter(fighters, nextFighterId++);
        }

        // Describe fighters
        const fDescs = fighters.map(f => `${f.type} at ${f.position}`);
        this.emit('COMBAT', `${fighters.length} fighter(s): ${fDescs.join(', ')}`, 'combat', 'warn', z, 'outbound',
          attackResult.rolls.map((r, i) => ({
            table: 'B-3', rollType: 'd6d6', rolled: r,
            result: i < fighters.length ? `${fighters[i].type} at ${fighters[i].position}` : 'reroll/extra',
          })));

        // Fighter cover defense
        if (coverLevel && hasFighterCover(z)) {
          const coverResult = rollFighterCoverDefense(coverLevel, rng, tables, 0);
          if (coverResult.initialDrivenOff > 0) {
            const { remaining, removed } = removeDrivenOffFighters(fighters, coverResult.initialDrivenOff);
            fighters = remaining;
            if (removed.length > 0) {
              this.emit('COMBAT', `Friendly fighters drive off ${removed.length} enemy!`, 'combat', 'good', z, 'outbound',
                [{ table: 'M-4', rollType: '1d6', rolled: 0, result: `${coverResult.initialDrivenOff} driven off` }]);
            }
          }
        }

        if (fighters.length === 0) {
          this.emit('COMBAT', 'All fighters driven off!', 'combat', 'good', z, 'outbound');
          continue;
        }

        // Combat rounds
        let activeFighters = [...fighters];
        let attackRound = 0;

        while (activeFighters.length > 0 && attackRound < 3 && !destroyed) {
          attackRound++;
          if (attackRound > 1) {
            this.emit('COMBAT', `Successive attack round ${attackRound}`, 'combat', 'warn', z, 'outbound');
          }

          // Defensive fire
          for (const fighter of activeFighters) {
            const fieldOfFire = getFieldOfFire(fighter.position, tables);
            for (const [gun, hitReq] of fieldOfFire) {
              const crewPos = GUN_TO_CREW[gun];
              if (!crewPos) continue;
              const cm = getCrewByPosition(this.state.campaign.crew, crewPos);
              if (!cm || cm.status !== 'active' || cm.wounds === 'serious' || cm.wounds === 'kia') continue;

              const fr = resolveDefensiveFire(hitReq, rng, false, mission.evasiveAction, false, cm.frostbite, false);
              if (fr.hit) {
                const dmg = rollFighterDamage(rng, tables, isTwinGunMount(gun));
                const status = applyFighterDamage(fighter, dmg);

                if (status.status === 'destroyed') {
                  fightersDestroyed++;
                  cm.kills++;
                  this.emit('COMBAT', `${GUN_LABELS[gun]} (${cm.name}) — ${fighter.type} DESTROYED!`, 'combat', 'good', z, 'outbound',
                    [
                      { table: 'M-1', rollType: '1d6', rolled: fr.roll, result: `Hit (need ${hitReq}+)`, description: `${GUN_LABELS[gun]} vs ${fighter.position}` },
                      { table: 'M-2', rollType: '2d6', rolled: 0, result: 'Destroyed', description: 'Fighter damage result' },
                    ], true);
                } else if (status.status === 'breaks_off') {
                  this.emit('COMBAT', `${GUN_LABELS[gun]} (${cm.name}) — ${fighter.type} damaged, breaks off!`, 'combat', 'good', z, 'outbound',
                    [
                      { table: 'M-1', rollType: '1d6', rolled: fr.roll, result: `Hit (need ${hitReq}+)` },
                      { table: 'M-2', rollType: '2d6', rolled: 0, result: 'Breaks off' },
                    ]);
                } else {
                  this.emit('COMBAT', `${GUN_LABELS[gun]} (${cm.name}) — ${fighter.type} hit, continues!`, 'combat', 'warn', z, 'outbound',
                    [
                      { table: 'M-1', rollType: '1d6', rolled: fr.roll, result: `Hit (need ${hitReq}+)` },
                      { table: 'M-2', rollType: '2d6', rolled: 0, result: 'Continues attack' },
                    ]);
                }
              } else {
                this.emit('COMBAT', `${GUN_LABELS[gun]} (${cm.name}) fires at ${fighter.position}... miss`, 'combat', 'info', z, 'outbound',
                  [{ table: 'M-1', rollType: '1d6', rolled: fr.roll, result: `Miss (need ${hitReq}+)`, description: `${GUN_LABELS[gun]} vs ${fighter.position}` }]);
              }
            }
          }

          // Filter destroyed/broken-off fighters
          activeFighters = fighters.filter(f => {
            const fboa = f.damage.filter(d => d === 'FBOA').length;
            if (fboa > 0) return false;
            const fca = f.damage.filter(d => d === 'FCA').length;
            if (fca >= 2) return false;
            return true;
          });

          if (activeFighters.length === 0) {
            this.emit('COMBAT', 'All fighters driven off or destroyed!', 'combat', 'good', z, 'outbound');
            break;
          }

          // German offensive fire
          const engineMod = enginesOut(this.state.campaign.aircraft) >= 2 ? 1 : 0;
          const evasiveMod = mission.evasiveAction ? -1 : 0;

          for (const fighter of activeFighters) {
            const offResult = resolveGermanOffensiveFire(fighter, rng, tables, engineMod, evasiveMod);
            fighter.attacksMade++;

            if (offResult.hit) {
              fighter.scoredHit = true;
              this.emit('COMBAT', `${fighter.type} at ${fighter.position} fires — HIT!`, 'combat', 'bad', z, 'outbound',
                [{ table: 'M-3', rollType: '1d6', rolled: offResult.roll, result: 'Hit', description: 'German offensive fire' }]);

              let shellHits: number;
              try { shellHits = rollShellHits(fighter, rng, tables); } catch { shellHits = rng.int(1, 3); }

              this.emit('DAMAGE', `${shellHits} shell hit(s)!`, 'damage', 'bad', z, 'outbound',
                [{ table: 'B-4', rollType: '1d6', rolled: 0, result: `${shellHits} shells` }]);

              for (let s = 0; s < shellHits; s++) {
                let hitLoc: ShellHitLocation;
                try { hitLoc = rollHitLocation(fighter.position, rng, tables); } catch { hitLoc = { location: 'Superficial', isSuperificial: true }; }

                if (hitLoc.isSuperificial) {
                  this.emit('DAMAGE', `Shell ${s + 1}: Superficial damage`, 'damage', 'info', z, 'outbound',
                    [{ table: 'B-5', rollType: '1d6', rolled: 0, result: 'Superficial' }]);
                  continue;
                }

                if (hitLoc.isWalkingHits) {
                  this.emit('DAMAGE', `Shell ${s + 1}: Walking hits along fuselage!`, 'damage', 'critical', z, 'outbound',
                    [{ table: 'B-5', rollType: '1d6', rolled: 0, result: 'Walking hits' }]);
                  for (const compt of WALKING_HIT_COMPARTMENTS) {
                    this._resolveCompartmentHit(compt.location, compt.damageTable, z, 'outbound');
                  }
                  continue;
                }

                this.emit('DAMAGE', `Shell ${s + 1}: Hit to ${hitLoc.location}`, 'damage', 'warn', z, 'outbound',
                  [{ table: 'B-5', rollType: '1d6', rolled: 0, result: hitLoc.location }]);

                if (hitLoc.damageTable) {
                  this._resolveCompartmentHit(hitLoc.location, hitLoc.damageTable, z, 'outbound');
                }
              }
            } else {
              this.emit('COMBAT', `${fighter.type} at ${fighter.position} fires — miss`, 'combat', 'info', z, 'outbound',
                [{ table: 'M-3', rollType: '1d6', rolled: offResult.roll, result: 'Miss' }]);
            }
          }

          // Check destruction
          if (countEnginesOut(this.state.campaign.aircraft) >= 4) {
            this.emit('DAMAGE', 'ALL ENGINES OUT! Going down!', 'damage', 'critical', z, 'outbound', undefined, true);
            destroyed = true;
            break;
          }

          // Successive attacks
          if (attackRound < 3) {
            activeFighters = getSuccessiveAttackers(activeFighters, mission.outOfFormation);
            for (const f of activeFighters) {
              try {
                const newPos = rollSuccessiveAttackPosition(rng, tables);
                f.position = newPos;
              } catch { /* keep position */ }
            }
          }
        }
      }

      // Abort check
      if (!destroyed && !mission.aborted && mission.direction === 'outbound') {
        const navDown = isCrewDown(this.state.campaign.crew, 'navigator');
        const pilotsDown = isCrewDown(this.state.campaign.crew, 'pilot') && isCrewDown(this.state.campaign.crew, 'copilot');
        if (mustAbort(this.state.campaign.aircraft, mission.outOfFormation, navDown, pilotsDown)) {
          mission.aborted = true;
          this.emit('ABORT', 'Mission aborted — mandatory conditions met!', 'movement', 'bad', z, 'outbound', undefined, true);
        }
      }

      // Target zone bomb run
      if (isTarget && !destroyed && !mission.aborted) {
        if (mission.bombsAboard) {
          this.emit('BOMB_RUN', `Bombs away over ${setup.target.name}!`, 'bombing', 'good', z, 'outbound', undefined, true);
          mission.bombsAboard = false;
          mission.bombsDropped = true;
        } else {
          this.emit('BOMB_RUN', 'No bombs to drop — already jettisoned', 'bombing', 'warn', z, 'outbound');
        }
        this.emit('TURN', 'Turning for home', 'movement', 'info', z, 'outbound');
      }
    }

    // ═══ INBOUND ═══
    if (!destroyed) {
      for (let z = targetZone - 1; z >= 2 && !destroyed; z--) {
        mission.zone = z;
        mission.direction = 'inbound';
        const zoneInfo = getZoneInfo(setup.target.name, z, tables);
        const overText = zoneInfo?.over?.length ? ` (over ${zoneInfo.over.join(', ')})` : '';

        this.emit('ZONE', `Entering Zone ${z} inbound${overText}`, 'movement', 'info', z, 'inbound', undefined, true);

        // Fighter cover
        let coverLevel: FighterCoverLevel | null = null;
        if (hasFighterCover(z)) {
          coverLevel = rollFighterCover(rng, tables);
          this.emit('COVER', `Fighter escort: ${coverLevel}`, 'combat',
            coverLevel === 'Good' ? 'good' : 'info', z, 'inbound',
            [{ table: 'G-5', rollType: '1d6', rolled: 0, result: coverLevel }]);
        }

        // Fighter waves
        const waveMod = getFighterWaveModifier(zoneInfo ?? null, squadronMod, mission.outOfFormation, 0);
        const waveResult = rollFighterWaves(false, waveMod, rng, tables);

        if (waveResult.waveCount === 0) {
          this.emit('COMBAT', 'No enemy fighters', 'combat', 'good', z, 'inbound',
            [{ table: 'B-1', rollType: '2d6', rolled: 0, modifier: waveMod, result: '0 waves' }]);
          continue;
        }

        this.emit('COMBAT', `${waveResult.waveCount} fighter wave(s)!`, 'combat', 'bad', z, 'inbound',
          [{ table: 'B-1', rollType: '2d6', rolled: 0, modifier: waveMod, result: `${waveResult.waveCount} waves` }]);

        // Simplified inbound combat (same structure, less verbose)
        for (let w = 1; w <= waveResult.waveCount && !destroyed; w++) {
          this.emit('WAVE', `Fighter Wave ${w}`, 'combat', 'bad', z, 'inbound');

          const attackResult = rollAttackingFightersWithReroll(rng, tables, mission.outOfFormation, nextFighterId);
          nextFighterId += attackResult.fighters.length + 1;
          let fighters = attackResult.fighters;

          if (fighters.length === 0) {
            this.emit('COMBAT', 'Fighters driven off by formation', 'combat', 'good', z, 'inbound');
            continue;
          }

          if (setup.extraFighterPerWave && !mission.outOfFormation) {
            fighters = addLeadTailExtraFighter(fighters, nextFighterId++);
          }

          // Fighter cover defense
          if (coverLevel && hasFighterCover(z)) {
            const coverResult = rollFighterCoverDefense(coverLevel, rng, tables, 0);
            if (coverResult.initialDrivenOff > 0) {
              const { remaining } = removeDrivenOffFighters(fighters, coverResult.initialDrivenOff);
              fighters = remaining;
            }
          }

          if (fighters.length === 0) { continue; }

          this.emit('COMBAT', `${fighters.length} fighter(s) attacking`, 'combat', 'warn', z, 'inbound');

          // Quick combat
          for (const fighter of fighters) {
            // Defensive fire
            const fieldOfFire = getFieldOfFire(fighter.position, tables);
            let shotDown = false;
            for (const [gun, hitReq] of fieldOfFire) {
              const crewPos = GUN_TO_CREW[gun];
              if (!crewPos) continue;
              const cm = getCrewByPosition(this.state.campaign.crew, crewPos);
              if (!cm || cm.status !== 'active' || cm.wounds === 'serious' || cm.wounds === 'kia') continue;
              const fr = resolveDefensiveFire(hitReq, rng, false, mission.evasiveAction, false, cm.frostbite, false);
              if (fr.hit) {
                const dmg = rollFighterDamage(rng, tables, isTwinGunMount(gun));
                const status = applyFighterDamage(fighter, dmg);
                if (status.status === 'destroyed') {
                  fightersDestroyed++; cm.kills++;
                  this.emit('COMBAT', `${GUN_LABELS[gun]} (${cm.name}) — ${fighter.type} DESTROYED!`, 'combat', 'good', z, 'inbound',
                    [{ table: 'M-1', rollType: '1d6', rolled: fr.roll, result: `Hit (need ${hitReq}+)` },
                     { table: 'M-2', rollType: '2d6', rolled: 0, result: 'Destroyed' }], true);
                  shotDown = true; break;
                } else if (status.status === 'breaks_off') {
                  this.emit('COMBAT', `${GUN_LABELS[gun]} (${cm.name}) — ${fighter.type} breaks off`, 'combat', 'good', z, 'inbound',
                    [{ table: 'M-1', rollType: '1d6', rolled: fr.roll, result: `Hit` },
                     { table: 'M-2', rollType: '2d6', rolled: 0, result: 'Breaks off' }]);
                  shotDown = true; break;
                }
              }
            }
            if (shotDown) continue;

            // German fire
            const offResult = resolveGermanOffensiveFire(fighter, rng, tables,
              enginesOut(this.state.campaign.aircraft) >= 2 ? 1 : 0,
              mission.evasiveAction ? -1 : 0);
            fighter.attacksMade++;

            if (offResult.hit) {
              fighter.scoredHit = true;
              this.emit('COMBAT', `${fighter.type} at ${fighter.position} — HIT!`, 'combat', 'bad', z, 'inbound',
                [{ table: 'M-3', rollType: '1d6', rolled: offResult.roll, result: 'Hit' }]);
              let shellHits: number;
              try { shellHits = rollShellHits(fighter, rng, tables); } catch { shellHits = rng.int(1, 2); }
              for (let s = 0; s < shellHits; s++) {
                let hitLoc: ShellHitLocation;
                try { hitLoc = rollHitLocation(fighter.position, rng, tables); } catch { hitLoc = { location: 'Superficial', isSuperificial: true }; }
                if (hitLoc.isSuperificial) { this.emit('DAMAGE', 'Superficial damage', 'damage', 'info', z, 'inbound'); continue; }
                this.emit('DAMAGE', `Hit to ${hitLoc.location}`, 'damage', 'warn', z, 'inbound',
                  [{ table: 'B-5', rollType: '1d6', rolled: 0, result: hitLoc.location }]);
                if (hitLoc.damageTable) {
                  this._resolveCompartmentHit(hitLoc.location, hitLoc.damageTable, z, 'inbound');
                }
              }
            } else {
              this.emit('COMBAT', `${fighter.type} at ${fighter.position} — miss`, 'combat', 'info', z, 'inbound',
                [{ table: 'M-3', rollType: '1d6', rolled: offResult.roll, result: 'Miss' }]);
            }
          }

          if (countEnginesOut(this.state.campaign.aircraft) >= 4) {
            this.emit('DAMAGE', 'ALL ENGINES OUT!', 'damage', 'critical', z, 'inbound', undefined, true);
            destroyed = true;
          }
        }
      }
    }

    // ═══ LANDING ═══
    if (!destroyed) {
      this.emit('LANDING', `${this.state.campaign.planeName} approaches the airfield...`, 'landing', 'info', 1, 'inbound');

      const landingRoll = rng.twod6();
      const landingMod = mission.landingModifiers + (countEnginesOut(this.state.campaign.aircraft) >= 3 ? -3 : 0);
      const modifiedLanding = landingRoll + landingMod;

      if (modifiedLanding >= 5) {
        this.emit('LANDING', 'Safe landing!', 'landing', 'good', 1, 'inbound',
          [{ table: 'G-8', rollType: '2d6', rolled: landingRoll, modifier: landingMod, modifiedRoll: modifiedLanding, result: 'Safe landing' }], true);
      } else if (modifiedLanding >= 2) {
        this.emit('LANDING', 'Rough landing — minor damage', 'landing', 'warn', 1, 'inbound',
          [{ table: 'G-8', rollType: '2d6', rolled: landingRoll, modifier: landingMod, modifiedRoll: modifiedLanding, result: 'Rough landing' }], true);
      } else {
        this.emit('LANDING', 'Crash landing!', 'landing', 'bad', 1, 'inbound',
          [{ table: 'G-8', rollType: '2d6', rolled: landingRoll, modifier: landingMod, modifiedRoll: modifiedLanding, result: 'Crash landing' }], true);
        for (const crew of this.state.campaign.crew) {
          if (crew.status === 'active' && rng.d6() <= 2) {
            crew.wounds = accumulateWound(crew.wounds, 'light');
            this.emit('LANDING', `${crew.name} injured in crash!`, 'damage', 'bad', 1, 'inbound');
          }
        }
      }
    } else {
      this.emit('BAILOUT', `${this.state.campaign.planeName} has been shot down!`, 'landing', 'critical', undefined, undefined, undefined, true);
      for (const crew of this.state.campaign.crew) {
        if (crew.status === 'active' && crew.wounds !== 'kia') {
          const bailRoll = rng.d6();
          if (bailRoll <= 3) {
            crew.status = 'pow';
            this.emit('BAILOUT', `${crew.name}: Captured (POW)`, 'landing', 'bad',
              undefined, undefined, [{ table: 'G-6', rollType: '1d6', rolled: bailRoll, result: 'POW' }]);
          } else if (bailRoll <= 5) {
            this.emit('BAILOUT', `${crew.name}: Evaded capture!`, 'landing', 'good',
              undefined, undefined, [{ table: 'G-6', rollType: '1d6', rolled: bailRoll, result: 'Evaded' }]);
          } else {
            crew.status = 'kia'; crew.wounds = 'kia';
            this.emit('BAILOUT', `${crew.name}: KIA`, 'landing', 'critical',
              undefined, undefined, [{ table: 'G-6', rollType: '1d6', rolled: bailRoll, result: 'KIA' }]);
          }
        }
      }
    }

    // ═══ DEBRIEF ═══
    this.state.campaign.missionsCompleted++;
    for (const crew of this.state.campaign.crew) {
      if (crew.status === 'active') crew.missions++;
    }

    const survived = !destroyed;
    this.emit('DEBRIEF', `Mission #${missionNumber} to ${setup.target.name}: ${survived ? 'SURVIVED' : 'LOST'}`, 'debrief',
      survived ? 'good' : 'critical', undefined, undefined,
      [{ table: '', rollType: '', rolled: 0, result: survived ? 'Survived' : 'Lost', description: `Fighters destroyed: ${fightersDestroyed}` }], true);

    this.state.mission = null;
    this.missionInProgress = false;
  }

  private _resolveCompartmentHit(
    location: string, damageTable: string,
    zone: number, direction: 'outbound' | 'inbound',
  ): void {
    const rng = this.rng;
    const tables = this.tables;
    let dmg: DamageResult;
    try {
      dmg = rollCompartmentDamage(damageTable, rng, tables);
    } catch {
      dmg = { result: 'Superficial', description: 'No effect', effects: [{ type: 'superficial' }] };
    }

    for (const effect of dmg.effects) {
      switch (effect.type) {
        case 'superficial':
          this.emit('DAMAGE', `${location}: Superficial — no effect`, 'damage', 'info', zone, direction,
            [{ table: damageTable, rollType: '1d6', rolled: 0, result: 'Superficial' }]);
          break;
        case 'crew_wound': {
          const pos = effect.position as CrewPosition;
          const crew = getCrewByPosition(this.state.campaign.crew, pos);
          if (crew && crew.wounds !== 'kia') {
            let severity: WoundSeverity;
            try { severity = rollCrewWound(rng, tables); } catch { severity = 'light'; }
            crew.wounds = accumulateWound(crew.wounds, severity);
            if (severity === 'kia') crew.status = 'kia';
            const sev = severity === 'kia' ? 'critical' : severity === 'serious' ? 'bad' : 'warn';
            this.emit('DAMAGE', `${crew.name} (${POSITION_LABELS[pos]}): ${severity} wound`, 'damage', sev as any, zone, direction,
              [
                { table: damageTable, rollType: '1d6', rolled: 0, result: 'Crew wound', description: `${location} damage` },
                { table: 'G-9', rollType: '1d6', rolled: 0, result: severity, description: 'Wound severity' },
              ], true);
            if (countEnginesOut(this.state.campaign.aircraft) >= 2 && this.state.mission) {
              this.state.mission.outOfFormation = true;
            }
          }
          break;
        }
        case 'engine_damage': {
          const engIdx = effect.engine ?? rng.int(0, 3);
          if (this.state.campaign.aircraft.engines[engIdx] !== 'out') {
            this.state.campaign.aircraft.engines[engIdx] = 'out';
            this.emit('DAMAGE', `Engine #${engIdx + 1} knocked out!`, 'damage', 'bad', zone, direction,
              [{ table: damageTable, rollType: '1d6', rolled: 0, result: `Engine #${engIdx + 1} out` }], true);
            const out = countEnginesOut(this.state.campaign.aircraft);
            if (out >= 2 && this.state.mission) {
              this.state.mission.outOfFormation = true;
              this.emit('DAMAGE', `${out} engines out — out of formation!`, 'damage', 'bad', zone, direction);
            }
          }
          break;
        }
        case 'fire':
          this.emit('DAMAGE', `FIRE in ${location}!`, 'damage', 'critical', zone, direction,
            [{ table: damageTable, rollType: '1d6', rolled: 0, result: 'Fire' }], true);
          break;
        case 'oxygen_hit':
          this.state.campaign.aircraft.oxygenOut = true;
          this.emit('DAMAGE', `Oxygen system damaged`, 'damage', 'warn', zone, direction,
            [{ table: damageTable, rollType: '1d6', rolled: 0, result: 'Oxygen hit' }]);
          break;
        case 'control_damage':
          this.emit('DAMAGE', `Control surface damage`, 'damage', 'bad', zone, direction,
            [{ table: damageTable, rollType: '1d6', rolled: 0, result: 'Control damage' }]);
          if (this.state.mission) this.state.mission.landingModifiers -= 1;
          break;
        case 'destroyed':
          this.emit('DAMAGE', `CATASTROPHIC DAMAGE — aircraft destroyed!`, 'damage', 'critical', zone, direction,
            [{ table: damageTable, rollType: '1d6', rolled: 0, result: 'Destroyed' }], true);
          break;
        default:
          this.emit('DAMAGE', `${location}: ${dmg.description || dmg.result}`, 'damage', 'info', zone, direction,
            [{ table: damageTable, rollType: '1d6', rolled: 0, result: dmg.result }]);
          break;
      }
    }
  }
}
