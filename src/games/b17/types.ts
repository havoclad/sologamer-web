/**
 * B-17 Queen of the Skies — game-specific types.
 */

// ─── Crew ───

export type CrewPosition =
  | 'pilot' | 'copilot' | 'navigator' | 'bombardier'
  | 'engineer' | 'radioman'
  | 'ball_turret' | 'left_waist' | 'right_waist' | 'tail_gunner';

export type WoundSeverity = 'none' | 'light' | 'serious' | 'mortal' | 'kia';

export interface CrewMember {
  position: CrewPosition;
  name: string;
  wounds: WoundSeverity;
  frostbite: boolean;
  kills: number;
  missions: number;
  status: 'active' | 'hospital' | 'pow' | 'kia' | 'mia';
}

// ─── Aircraft ───

export type EngineStatus = 'ok' | 'fire' | 'runaway' | 'oil_leak' | 'supercharger_out' | 'out';

// Re-export Gun type from guns module
export type { Gun } from './rules/guns.js';

/** Ammo tracking per gun position. Each value = rounds remaining.
 *  @deprecated Use aircraft.guns instead. Kept for backward compatibility. */
export interface AmmoState {
  Nose: number;
  Port_Cheek: number;
  Starboard_Cheek: number;
  Top_Turret: number;
  Ball_Turret: number;
  Port_Waist: number;
  Starboard_Waist: number;
  Radio: number;
  Tail: number;
}

/** Default ammo loadout per gun position (number of shots per mission).
 *  @deprecated Use initializeGuns() instead. */
export const DEFAULT_AMMO: AmmoState = {
  Nose: 12,
  Port_Cheek: 12,
  Starboard_Cheek: 12,
  Top_Turret: 16,
  Ball_Turret: 16,
  Port_Waist: 12,
  Starboard_Waist: 12,
  Radio: 8,
  Tail: 16,
};

export interface AircraftState {
  engines: [EngineStatus, EngineStatus, EngineStatus, EngineStatus];
  fuelLeak: boolean;
  fuelFire: boolean;
  oxygenOut: boolean;
  heatingOut: boolean;
  ballTurretInop: boolean;
  bombBayDoorsInop: boolean;
  radioOut: boolean;
  tailWheelInop: boolean;
  wingSurfaceDamage: { left: number; right: number };
  controlDamage: { rudder: boolean; elevator: boolean; ailerons: boolean };
  fireExtinguishersUsed: number;
  guns: import('./rules/guns.js').Gun[];
  /** @deprecated Use guns array instead. Computed from guns for backward compat. */
  ammo: AmmoState;
}

// ─── Mission ───

export type FormationPosition = 'lead' | 'high' | 'low';
export type SquadronPosition = 'lead' | 'high' | 'low';
export type Weather = 'clear' | 'poor' | 'overcast';

export interface MissionState {
  missionNumber: number;
  target: string;
  zone: number;
  direction: 'outbound' | 'inbound';
  formation: FormationPosition;
  squadron: SquadronPosition;
  weather: Weather;
  outOfFormation: boolean;
  altitude: 20000 | 10000;
  bombsAboard: boolean;
  bombsDropped: boolean;
  aborted: boolean;
  evasiveAction: boolean;
  landingModifiers: number;
}

// ─── Campaign ───

export interface CampaignState {
  missionsCompleted: number;
  missionsTotal: number;
  planeName: string;
  crew: CrewMember[];
  aircraft: AircraftState;
}

// ─── Top-level game state ───

export interface B17GameState {
  campaign: CampaignState;
  mission: MissionState | null;
}

// ─── B-17 event types ───

export type B17Event =
  | { type: 'DICE_ROLL'; dice: number[]; table: string; result: string }
  | { type: 'PHASE_CHANGE'; from: string; to: string }
  | { type: 'MISSION_START'; missionNumber: number; target: string }
  | { type: 'MISSION_END'; missionNumber: number; survived: boolean }
  | { type: 'ZONE_ENTER'; zone: number; direction: string }
  | { type: 'FIGHTER_WAVE'; waveCount: number }
  | { type: 'CREW_WOUND'; position: CrewPosition; severity: WoundSeverity }
  | { type: 'DAMAGE'; description: string }
  | { type: 'LANDING'; landingType: string };
