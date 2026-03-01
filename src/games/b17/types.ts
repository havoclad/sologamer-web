/**
 * B-17 Queen of the Skies — game-specific types.
 */

// ─── Crew ───

export type CrewPosition =
  | 'pilot' | 'copilot' | 'navigator' | 'bombardier'
  | 'engineer' | 'radioman'
  | 'ball_turret' | 'left_waist' | 'right_waist' | 'tail_gunner';

export type WoundSeverity = 'none' | 'light' | 'serious' | 'kia';

/** Campaign-level crew status. Determines availability for future missions. */
export type CrewStatus =
  | 'active'      // available for missions
  | 'hospital'    // recovering from serious wounds (survival roll passed)
  | 'grounded'    // permanent frostbite — cannot fly again
  | 'pow'         // prisoner of war
  | 'mia'         // missing in action
  | 'kia'         // killed in action
  | 'evaded';     // evaded capture, returned via Underground

export type { GunPosition } from './rules/combat.js';

export interface CrewMember {
  // Identity
  id: string;                    // unique, stable id (e.g., 'crew-001')
  name: string;                  // display name
  position: CrewPosition;        // assigned/natural crew position

  // Campaign State (persists across missions)
  status: CrewStatus;            // default: 'active'
  missions: number;              // missions completed, default: 0
  kills: number;                 // confirmed fighter kills, default: 0
  isOriginal: boolean;           // true for starting crew, false for replacements

  // Mission State (reset at start of each mission)
  woundSeverity: WoundSeverity;  // worst wound this mission, default: 'none'
  lightWounds: number;           // count of light wounds, 0–3. At 3 → escalate to serious. default: 0
  frostbite: boolean;            // frostbitten this mission, default: false
  currentGunPosition: import('./rules/combat.js').GunPosition | null;  // gun currently operating
  aceForADay: boolean;           // random event: temporary ace bonus this mission, default: false
}

/** @deprecated Use woundSeverity field. Kept for old code that references 'mortal'. */
export type LegacyWoundSeverity = WoundSeverity | 'mortal';

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

  // ── Damage sub-roll tracking ──
  navigatorEquipInop: boolean;
  bombControlsInop: boolean;
  autopilotInop: boolean;
  tailWheelDamaged: boolean;
  brakesOut: boolean;
  landingGearInop: boolean;
  ballTurretTrapped: boolean;
  portFlapInop: boolean;
  starboardFlapInop: boolean;
  portAileronInop: boolean;
  starboardAileronInop: boolean;
  portElevatorInop: boolean;
  starboardElevatorInop: boolean;
  portWingRootHits: number;
  starboardWingRootHits: number;
  superficialHits: number;
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
  landingModifierReasons: string[];
  bombRunModifier: number;
  bombRunModifierReasons: string[];
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
