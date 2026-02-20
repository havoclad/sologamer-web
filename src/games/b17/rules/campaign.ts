/**
 * Campaign Manager — 25-mission tour tracking, crew replacement, victory conditions.
 *
 * Per §7.2, at end of 25 missions, total 8th AF victories vs German victories.
 * Side with most wins the campaign.
 *
 * Per §7.3, performance ratings for individual crew and aircraft survival.
 *
 * Per §17.0, post-mission: resolve wounded survival, frostbite effects,
 * replace lost crew, assign new aircraft if needed.
 */

import type { RNG } from '../../../engine/rng.js';
import type { TableStore } from '../../../engine/tables.js';
import type {
  AircraftState, CampaignState, CrewMember, CrewPosition,
} from '../types.js';
import { createInitialB17State } from '../index.js';
import { runMission, type CompleteMissionResult, type MissionOutcome } from './mission.js';
import { rollFrostbiteRecovery } from './damage.js';

// ─── Campaign types ───

export interface CampaignResult {
  missions: CompleteMissionResult[];
  missionsCompleted: number;
  eightAfVictories: number;
  germanVictories: number;
  draws: number;
  campaignVictor: '8th_af' | 'german' | 'tie';
  crewSurvivors: CrewMember[];
  totalCrewLost: number;
  planesLost: number;
}

export interface CampaignOptions {
  planeName?: string;
  crewNames?: Record<CrewPosition, string>;
  totalMissions?: number;
  useRandomEvents?: boolean;
}

// ─── Crew names ───

const DEFAULT_CREW_POSITIONS: CrewPosition[] = [
  'pilot', 'copilot', 'navigator', 'bombardier',
  'engineer', 'radioman',
  'ball_turret', 'left_waist', 'right_waist', 'tail_gunner',
];

function createFreshCrew(names?: Record<CrewPosition, string>): CrewMember[] {
  return DEFAULT_CREW_POSITIONS.map(pos => ({
    position: pos,
    name: names?.[pos] ?? `Crew ${pos}`,
    wounds: 'none' as const,
    frostbite: false,
    kills: 0,
    missions: 0,
    status: 'active' as const,
  }));
}

function createFreshAircraft(): AircraftState {
  return createInitialB17State().campaign.aircraft;
}

// ─── Post-mission crew processing ───

/**
 * Process crew after a mission per §17.0.
 *
 * - Seriously wounded: roll for survival per BL-4 note b (simplified: 1D, 1-2 = dies, 3-6 = survives but can't fly)
 * - Frostbitten: roll for recovery per Errata #5 (1D: 1-3 = grounded, 4-6 = recovers)
 * - KIA crew replaced with fresh replacements
 * - Increment missions for surviving active crew
 */
export function processPostMission(
  crew: CrewMember[],
  rng: RNG,
): { updatedCrew: CrewMember[]; replacements: string[] } {
  const replacements: string[] = [];
  const updatedCrew: CrewMember[] = [];

  for (const member of crew) {
    if (member.wounds === 'kia') {
      // Replace KIA crew
      const replacement: CrewMember = {
        position: member.position,
        name: `Replacement ${member.position}`,
        wounds: 'none',
        frostbite: false,
        kills: 0,
        missions: 0,
        status: 'active',
      };
      updatedCrew.push(replacement);
      replacements.push(`${member.name} (${member.position}) KIA — replaced`);
      continue;
    }

    if (member.wounds === 'serious') {
      // Roll for survival: 1D, 1-2 = dies of wounds, 3-6 = survives (hospitalized)
      const survivalRoll = rng.d6();
      if (survivalRoll <= 2) {
        const replacement: CrewMember = {
          position: member.position,
          name: `Replacement ${member.position}`,
          wounds: 'none',
          frostbite: false,
          kills: 0,
          missions: 0,
          status: 'active',
        };
        updatedCrew.push(replacement);
        replacements.push(`${member.name} (${member.position}) died of wounds — replaced`);
      } else {
        // Hospitalized — replace for next mission
        const replacement: CrewMember = {
          position: member.position,
          name: `Replacement ${member.position}`,
          wounds: 'none',
          frostbite: false,
          kills: 0,
          missions: 0,
          status: 'active',
        };
        updatedCrew.push(replacement);
        replacements.push(`${member.name} (${member.position}) hospitalized — replaced`);
      }
      continue;
    }

    // Frostbite resolution per Errata #5
    if (member.frostbite) {
      const recovery = rollFrostbiteRecovery(rng);
      if (recovery === 'grounded') {
        const replacement: CrewMember = {
          position: member.position,
          name: `Replacement ${member.position}`,
          wounds: 'none',
          frostbite: false,
          kills: 0,
          missions: 0,
          status: 'active',
        };
        updatedCrew.push(replacement);
        replacements.push(`${member.name} (${member.position}) grounded by frostbite — replaced`);
        continue;
      }
    }

    // Surviving crew: increment missions, heal light wounds
    const healed: CrewMember = {
      ...member,
      wounds: 'none',
      frostbite: false,
      missions: member.missions + 1,
    };
    updatedCrew.push(healed);
  }

  return { updatedCrew, replacements };
}

// ─── Campaign runner ───

/**
 * Run a complete 25-mission campaign per §7.2.
 *
 * Continues until 25 missions completed or entire crew lost.
 */
export function runCampaign(
  rng: RNG,
  tables: TableStore,
  options: CampaignOptions = {},
): CampaignResult {
  const totalMissions = options.totalMissions ?? 25;
  const missions: CompleteMissionResult[] = [];
  let crew = createFreshCrew(options.crewNames);
  let aircraft = createFreshAircraft();
  let planesLost = 0;
  let totalCrewLost = 0;
  let eightAfVictories = 0;
  let germanVictories = 0;
  let draws = 0;

  for (let m = 1; m <= totalMissions; m++) {
    const result = runMission(m, crew, aircraft, rng, tables, {
      useRandomEvents: options.useRandomEvents,
    });

    missions.push(result);

    // Tally victory
    switch (result.outcome.victory) {
      case '8th_af_victory': eightAfVictories++; break;
      case 'german_victory': germanVictories++; break;
      case 'draw': draws++; break;
    }

    // Check if plane is lost
    if (result.outcome.planeDestroyed || result.outcome.planeLost) {
      planesLost++;
      aircraft = createFreshAircraft(); // New plane
    } else {
      aircraft = result.updatedAircraft;
    }

    // Process crew
    const crewLostThisMission = result.updatedCrew.filter(c => c.wounds === 'kia').length;
    totalCrewLost += crewLostThisMission;

    const postMission = processPostMission(result.updatedCrew, rng);
    crew = postMission.updatedCrew;

    // If all crew dead and plane destroyed, the campaign can still continue
    // (fresh crew and plane assigned per game rules)
  }

  // Campaign victor per §7.2
  let campaignVictor: CampaignResult['campaignVictor'];
  if (eightAfVictories > germanVictories) campaignVictor = '8th_af';
  else if (germanVictories > eightAfVictories) campaignVictor = 'german';
  else campaignVictor = 'tie';

  return {
    missions,
    missionsCompleted: missions.length,
    eightAfVictories,
    germanVictories,
    draws,
    campaignVictor,
    crewSurvivors: crew,
    totalCrewLost,
    planesLost,
  };
}
