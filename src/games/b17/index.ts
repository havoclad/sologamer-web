/**
 * B-17 Queen of the Skies — game module registration.
 */

import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { registry, type GameModule } from '../../engine/registry.js';
import { B17_PHASES, type B17Phase } from './phases.js';
import type {
  B17GameState, CampaignState, AircraftState, CrewMember, CrewPosition,
} from './types.js';
import { initializeGuns } from './rules/guns.js';

const CREW_POSITIONS: CrewPosition[] = [
  'pilot', 'copilot', 'navigator', 'bombardier',
  'engineer', 'radioman',
  'ball_turret', 'left_waist', 'right_waist', 'tail_gunner',
];

function createDefaultAircraft(): AircraftState {
  const guns = initializeGuns();
  return {
    engines: ['ok', 'ok', 'ok', 'ok'],
    fuelLeak: false,
    fuelFire: false,
    oxygenOut: false,
    heatingOut: false,
    ballTurretInop: false,
    bombBayDoorsInop: false,
    radioOut: false,
    tailWheelInop: false,
    wingSurfaceDamage: { left: 0, right: 0 },
    controlDamage: { rudder: false, elevator: false, ailerons: false },
    fireExtinguishersUsed: 0,
    guns,
    ammo: Object.fromEntries(guns.map(g => [g.id, g.ammo])) as any,
  };
}

function createDefaultCrew(): CrewMember[] {
  return CREW_POSITIONS.map(pos => ({
    position: pos,
    name: `Crew ${pos}`,
    wounds: 'none',
    frostbite: false,
    kills: 0,
    missions: 0,
    status: 'active',
  }));
}

export function createInitialB17State(): B17GameState {
  return {
    campaign: {
      missionsCompleted: 0,
      missionsTotal: 25,
      planeName: 'Unnamed Fortress',
      crew: createDefaultCrew(),
      aircraft: createDefaultAircraft(),
    },
    mission: null,
  };
}

// Resolve data directory relative to this file
const __dirname_resolved = typeof __dirname !== 'undefined'
  ? __dirname
  : dirname(fileURLToPath(import.meta.url));

export const b17Module: GameModule<B17Phase, B17GameState> = {
  id: 'b17-queen-of-the-skies',
  name: 'B-17: Queen of the Skies',
  description: 'Avalon Hill solitaire bomber game (1981). Fly 25 missions over occupied Europe.',
  tableDirectory: join(__dirname_resolved, 'data'),
  phases: B17_PHASES,
  initialPhase: 'PRE_MISSION',
  createInitialState: createInitialB17State,
};

/** Register with the global engine registry */
export function registerB17(): void {
  registry.register(b17Module);
}
