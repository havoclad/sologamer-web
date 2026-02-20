/**
 * B-17 Queen of the Skies — mission phase definitions.
 */

import type { PhaseDefinition } from '../../engine/state-machine.js';

export type B17Phase =
  | 'PRE_MISSION'
  | 'TARGET_SELECTION'
  | 'FORMATION_SETUP'
  | 'ZONE_ENTER'
  | 'FIGHTER_COVER_CHECK'
  | 'DETERMINE_ATTACKERS'
  | 'WAVE_START'
  | 'DEFENSIVE_FIRE'
  | 'GERMAN_OFFENSIVE_FIRE'
  | 'DAMAGE_RESOLUTION'
  | 'SUCCESSIVE_ATTACK_CHECK'
  | 'TARGET_ZONE_FLAK'
  | 'BOMB_RUN'
  | 'ZONE_EXIT'
  | 'LANDING'
  | 'POST_MISSION'
  | 'CAMPAIGN_END';

export const B17_PHASES: PhaseDefinition<B17Phase>[] = [
  { name: 'PRE_MISSION',             next: ['TARGET_SELECTION'] },
  { name: 'TARGET_SELECTION',        next: ['FORMATION_SETUP'] },
  { name: 'FORMATION_SETUP',         next: ['ZONE_ENTER'] },
  { name: 'ZONE_ENTER',              next: ['FIGHTER_COVER_CHECK', 'TARGET_ZONE_FLAK', 'ZONE_EXIT'] },
  { name: 'FIGHTER_COVER_CHECK',     next: ['DETERMINE_ATTACKERS', 'ZONE_EXIT'] },
  { name: 'DETERMINE_ATTACKERS',     next: ['WAVE_START', 'ZONE_EXIT'] },
  { name: 'WAVE_START',              next: ['DEFENSIVE_FIRE'] },
  { name: 'DEFENSIVE_FIRE',          next: ['GERMAN_OFFENSIVE_FIRE'] },
  { name: 'GERMAN_OFFENSIVE_FIRE',   next: ['DAMAGE_RESOLUTION'] },
  { name: 'DAMAGE_RESOLUTION',       next: ['SUCCESSIVE_ATTACK_CHECK', 'WAVE_START', 'ZONE_EXIT'] },
  { name: 'SUCCESSIVE_ATTACK_CHECK', next: ['DEFENSIVE_FIRE', 'WAVE_START', 'ZONE_EXIT'] },
  { name: 'TARGET_ZONE_FLAK',        next: ['BOMB_RUN'] },
  { name: 'BOMB_RUN',                next: ['ZONE_EXIT'] },
  { name: 'ZONE_EXIT',               next: ['ZONE_ENTER', 'LANDING'] },
  { name: 'LANDING',                 next: ['POST_MISSION'] },
  { name: 'POST_MISSION',            next: ['PRE_MISSION', 'CAMPAIGN_END'] },
  { name: 'CAMPAIGN_END',            next: [], terminal: true },
];
