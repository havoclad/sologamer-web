/**
 * Random Events — Table B-7 (§18.0, optional rule).
 *
 * Per §18.0, random events trigger when a 66 is rolled on Table B-3.
 * Players may treat 66 as "No Attackers (c)" instead.
 *
 * Per Errata #7, the Random Events Table is B-7 (not G-11 as erroneously stated).
 *
 * Events:
 *   2: Engine failure (note a)
 *   3: Formation casualties (notes b, h)
 *   4: Loose formation — B-1/B-2 +1 (notes b, i)
 *   5: Aggressive "Little Friends" — M-4 +1 (note b)
 *   6,8: Tight formation — B-1/B-2 -1 (notes b, j)
 *   7: Rabbit's foot — one re-roll (note c)
 *   9: Bad Luftwaffe communications — remove 1 fighter/wave (note d)
 *   10: Extreme cold — guns may jam (note e)
 *   11: Ace for a day — one gunner +1 to hit (note f)
 *   12: Mid-air accident (note g)
 */

import type { RNG } from '../../../engine/rng.js';
import type { TableStore } from '../../../engine/tables.js';
import type { AircraftState, CrewPosition } from '../types.js';

// ─── Event types ───

export type RandomEventType =
  | 'engine_failure'
  | 'formation_casualties'
  | 'loose_formation'
  | 'aggressive_little_friends'
  | 'tight_formation'
  | 'rabbits_foot'
  | 'bad_luftwaffe_comms'
  | 'extreme_cold'
  | 'ace_for_a_day'
  | 'mid_air_accident';

export interface RandomEventResult {
  eventType: RandomEventType;
  roll: number;
  description: string;
  details: RandomEventDetails;
}

export type RandomEventDetails =
  | EngineFailureDetails
  | FormationCasualtiesDetails
  | ModifierDetails
  | RabbitsFootDetails
  | BadLuftwaffeCommsDetails
  | ExtremeColdDetails
  | AceForADayDetails
  | MidAirAccidentDetails;

export interface EngineFailureDetails {
  kind: 'engine_failure';
  engineIndex: number; // 0-3
}

export interface FormationCasualtiesDetails {
  kind: 'formation_casualties';
  newPosition: 'lead' | 'tail';
}

export interface ModifierDetails {
  kind: 'modifier';
  tables: Record<string, number>;
}

export interface RabbitsFootDetails {
  kind: 'rabbits_foot';
}

export interface BadLuftwaffeCommsDetails {
  kind: 'bad_luftwaffe_comms';
  active: boolean; // toggles on/off
}

export interface ExtremeColdDetails {
  kind: 'extreme_cold';
  jammedGuns: string[];
}

export interface AceForADayDetails {
  kind: 'ace_for_a_day';
  gunner: 'engineer' | 'ball_turret' | 'tail_gunner';
}

export interface MidAirAccidentDetails {
  kind: 'mid_air_accident';
  subRoll: number;
  effect: 'no_effect' | 'shallow_dive' | 'steep_dive' | 'mid_air_collision';
  wingsHold?: { left: boolean; right: boolean };
}

// ─── State tracking for re-roll logic ───

export interface RandomEventState {
  /** Track which non-repeatable events have occurred per notes b */
  occurred: Set<RandomEventType>;
  /** Engine that previously failed (for restart on re-roll per note a) */
  previousEngineFailure: number | null;
  /** Bad Luftwaffe comms toggle count per note d */
  badCommsCount: number;
  /** Accumulated rabbit's feet per note c */
  rabbitsFootCount: number;
  /** Ace for a day gunners already designated per note f */
  aceForADayGunners: Set<string>;
}

export function createRandomEventState(): RandomEventState {
  return {
    occurred: new Set(),
    previousEngineFailure: null,
    badCommsCount: 0,
    rabbitsFootCount: 0,
    aceForADayGunners: new Set(),
  };
}

// ─── Engine failure (note a) ───

/**
 * Determine which engine fails per note a.
 * Roll 2D: 2,3,7 = #1; 4,10-12 = #2; 5,6 = #3; 8,9 = #4.
 */
export function rollEngineFailure(rng: RNG): number {
  const roll = rng.twod6();
  if (roll === 2 || roll === 3 || roll === 7) return 0;
  if (roll === 4 || roll >= 10) return 1;
  if (roll === 5 || roll === 6) return 2;
  return 3; // 8, 9
}

// ─── Extreme cold (note e) ───

const GUN_POSITIONS = [
  'Nose', 'Port_Cheek', 'Starboard_Cheek', 'Top_Turret',
  'Ball_Turret', 'Port_Waist', 'Starboard_Waist', 'Radio', 'Tail',
];

/**
 * Roll for extreme cold gun jams per note e.
 * Roll 1D for each gun position: 6 = jammed.
 * Per note e: if out of formation at 10,000 ft, ignore and re-roll.
 */
export function rollExtremeCold(rng: RNG): string[] {
  const jammed: string[] = [];
  for (const gun of GUN_POSITIONS) {
    if (rng.d6() === 6) {
      jammed.push(gun);
    }
  }
  return jammed;
}

// ─── Ace for a day (note f) ───

/**
 * Roll for ace-for-a-day gunner per note f.
 * 1D: 1,2 = Engineer; 3,4 = Ball Gunner; 5,6 = Tail Gunner.
 */
export function rollAceForADay(rng: RNG): 'engineer' | 'ball_turret' | 'tail_gunner' {
  const roll = rng.d6();
  if (roll <= 2) return 'engineer';
  if (roll <= 4) return 'ball_turret';
  return 'tail_gunner';
}

// ─── Mid-air accident (note g) ───

export interface MidAirAccidentResult {
  subRoll: number;
  effect: 'no_effect' | 'shallow_dive' | 'steep_dive' | 'mid_air_collision';
  wingsHold?: { left: boolean; right: boolean };
}

/**
 * Roll for mid-air accident per note g.
 * 2D: 2-8 = no effect; 9-10 = shallow dive; 11 = steep dive; 12 = collision.
 * Per note g: if out of formation, treat as engine failure instead.
 */
export function rollMidAirAccident(rng: RNG): MidAirAccidentResult {
  const roll = rng.twod6();

  if (roll <= 8) return { subRoll: roll, effect: 'no_effect' };
  if (roll <= 10) return { subRoll: roll, effect: 'shallow_dive' };
  if (roll === 11) {
    // Steep dive: roll 1D for each wing
    const leftHolds = rng.d6() <= 5;
    const rightHolds = rng.d6() <= 5;
    return {
      subRoll: roll,
      effect: 'steep_dive',
      wingsHold: { left: leftHolds, right: rightHolds },
    };
  }
  // 12 = mid-air collision
  return { subRoll: roll, effect: 'mid_air_collision' };
}

// ─── Main random event resolver ───

/**
 * Resolve a random event per Table B-7 (§18.0).
 *
 * Handles re-roll logic for non-repeatable events per various notes.
 * @param state - mutable event state tracking
 * @param outOfFormation - whether B-17 is currently out of formation
 * @param at10k - whether at 10,000 ft altitude
 * @param currentFormation - current formation position for note h
 */
export function resolveRandomEvent(
  rng: RNG,
  tables: TableStore,
  state: RandomEventState,
  outOfFormation: boolean,
  at10k: boolean,
  currentFormation: 'lead' | 'middle' | 'tail',
): RandomEventResult {
  const maxRetries = 20;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const roll = rng.twod6();

    switch (roll) {
      case 2: {
        // Engine failure (note a)
        if (state.previousEngineFailure !== null) {
          // Re-roll restarts previous engine
          const engineIdx = state.previousEngineFailure;
          state.previousEngineFailure = null;
          return {
            eventType: 'engine_failure',
            roll,
            description: `Engine #${engineIdx + 1} restarts`,
            details: { kind: 'engine_failure', engineIndex: engineIdx },
          };
        }
        const engineIdx = rollEngineFailure(rng);
        state.previousEngineFailure = engineIdx;
        return {
          eventType: 'engine_failure',
          roll,
          description: `Engine #${engineIdx + 1} failure`,
          details: { kind: 'engine_failure', engineIndex: engineIdx },
        };
      }

      case 3: {
        // Formation casualties (notes b, h)
        if (state.occurred.has('formation_casualties')) continue; // re-roll per note b
        if (outOfFormation) continue; // re-roll per note h
        if (currentFormation === 'lead' || currentFormation === 'tail') continue; // note h

        const posRoll = rng.d6();
        const newPos = posRoll <= 3 ? 'lead' as const : 'tail' as const;
        state.occurred.add('formation_casualties');
        return {
          eventType: 'formation_casualties',
          roll,
          description: `Formation casualties — you are now the ${newPos} bomber`,
          details: { kind: 'formation_casualties', newPosition: newPos },
        };
      }

      case 4: {
        // Loose formation (notes b, i)
        if (state.occurred.has('loose_formation')) continue;

        state.occurred.add('loose_formation');
        const mod = outOfFormation ? -1 : 1; // note i
        return {
          eventType: 'loose_formation',
          roll,
          description: outOfFormation
            ? 'Loose formation — B-1/B-2 -1 (out of formation)'
            : 'Loose formation — B-1/B-2 +1',
          details: { kind: 'modifier', tables: { 'B-1': mod, 'B-2': mod } },
        };
      }

      case 5: {
        // Aggressive "Little Friends" (note b)
        if (state.occurred.has('aggressive_little_friends')) continue;

        state.occurred.add('aggressive_little_friends');
        return {
          eventType: 'aggressive_little_friends',
          roll,
          description: 'Aggressive "Little Friends" — M-4 +1',
          details: { kind: 'modifier', tables: { 'M-4': 1 } },
        };
      }

      case 6:
      case 8: {
        // Tight formation (notes b, j)
        if (state.occurred.has('tight_formation')) continue;

        state.occurred.add('tight_formation');
        const mod = outOfFormation ? -1 : -1; // note j: same -1 either way
        return {
          eventType: 'tight_formation',
          roll,
          description: 'Tight formation — B-1/B-2 -1',
          details: { kind: 'modifier', tables: { 'B-1': mod, 'B-2': mod } },
        };
      }

      case 7: {
        // Rabbit's foot (note c)
        state.rabbitsFootCount++;
        return {
          eventType: 'rabbits_foot',
          roll,
          description: `Rabbit's foot! (total: ${state.rabbitsFootCount})`,
          details: { kind: 'rabbits_foot' },
        };
      }

      case 9: {
        // Bad Luftwaffe communications (note d)
        state.badCommsCount++;
        const active = state.badCommsCount % 2 === 1;
        return {
          eventType: 'bad_luftwaffe_comms',
          roll,
          description: active
            ? 'Bad Luftwaffe communications — remove 1 fighter per wave'
            : 'Bad Luftwaffe communications restored',
          details: { kind: 'bad_luftwaffe_comms', active },
        };
      }

      case 10: {
        // Extreme cold (note e)
        if (outOfFormation && at10k) continue; // note e: ignore if out at 10k

        const jammed = rollExtremeCold(rng);
        return {
          eventType: 'extreme_cold',
          roll,
          description: jammed.length > 0
            ? `Extreme cold — guns jammed: ${jammed.join(', ')}`
            : 'Extreme cold — no guns jammed',
          details: { kind: 'extreme_cold', jammedGuns: jammed },
        };
      }

      case 11: {
        // Ace for a day (note f)
        const gunner = rollAceForADay(rng);
        if (state.aceForADayGunners.has(gunner)) {
          // note f: if same crewman rolled twice, ignore (don't roll again)
          return {
            eventType: 'ace_for_a_day',
            roll,
            description: `Ace for a day — ${gunner} already designated, no effect`,
            details: { kind: 'ace_for_a_day', gunner },
          };
        }
        state.aceForADayGunners.add(gunner);
        return {
          eventType: 'ace_for_a_day',
          roll,
          description: `Ace for a day — ${gunner} gets +1 to hit`,
          details: { kind: 'ace_for_a_day', gunner },
        };
      }

      case 12: {
        // Mid-air accident (note g)
        if (outOfFormation) {
          // note g: treat as engine failure instead
          const engineIdx = rollEngineFailure(rng);
          if (state.previousEngineFailure !== null) {
            const restartIdx = state.previousEngineFailure;
            state.previousEngineFailure = null;
            return {
              eventType: 'engine_failure',
              roll,
              description: `Mid-air accident (out of formation) → Engine #${restartIdx + 1} restarts`,
              details: { kind: 'engine_failure', engineIndex: restartIdx },
            };
          }
          state.previousEngineFailure = engineIdx;
          return {
            eventType: 'engine_failure',
            roll,
            description: `Mid-air accident (out of formation) → Engine #${engineIdx + 1} failure`,
            details: { kind: 'engine_failure', engineIndex: engineIdx },
          };
        }

        const accident = rollMidAirAccident(rng);
        return {
          eventType: 'mid_air_accident',
          roll,
          description: `Mid-air accident — ${accident.effect.replace(/_/g, ' ')}`,
          details: {
            kind: 'mid_air_accident',
            subRoll: accident.subRoll,
            effect: accident.effect,
            wingsHold: accident.wingsHold,
          },
        };
      }

      default:
        continue; // shouldn't happen with 2d6
    }
  }

  // Fallback if all retries exhausted (extremely unlikely)
  return {
    eventType: 'rabbits_foot',
    roll: 7,
    description: "Rabbit's foot! (fallback after re-roll exhaustion)",
    details: { kind: 'rabbits_foot' },
  };
}
