/**
 * Gun model and helper functions for the B-17 defensive armament.
 */

import type { CrewPosition, CrewMember } from '../types.js';
import type { GunPosition } from './combat.js';

export interface Gun {
  id: GunPosition;
  name: string;
  crewPosition: CrewPosition;
  twin: boolean;
  ammoCapacity: number;
  ammo: number;
  jammed: boolean;
  disabled: boolean;
}

/** Gun configuration data used to initialize guns */
const GUN_CONFIGS: Array<{
  id: GunPosition;
  name: string;
  crewPosition: CrewPosition;
  twin: boolean;
  ammoCapacity: number;
}> = [
  { id: 'Nose', name: 'Nose gun', crewPosition: 'bombardier', twin: false, ammoCapacity: 15 },
  { id: 'Port_Cheek', name: 'Port cheek gun', crewPosition: 'navigator', twin: false, ammoCapacity: 10 },
  { id: 'Starboard_Cheek', name: 'Starboard cheek gun', crewPosition: 'navigator', twin: false, ammoCapacity: 10 },
  { id: 'Top_Turret', name: 'Top turret', crewPosition: 'engineer', twin: true, ammoCapacity: 16 },
  { id: 'Ball_Turret', name: 'Ball turret', crewPosition: 'ball_turret', twin: true, ammoCapacity: 20 },
  { id: 'Port_Waist', name: 'Left waist gun', crewPosition: 'left_waist', twin: false, ammoCapacity: 20 },
  { id: 'Starboard_Waist', name: 'Right waist gun', crewPosition: 'right_waist', twin: false, ammoCapacity: 20 },
  { id: 'Radio', name: 'Radio room gun', crewPosition: 'radioman', twin: false, ammoCapacity: 10 },
  { id: 'Tail', name: 'Tail guns', crewPosition: 'tail_gunner', twin: true, ammoCapacity: 23 },
];

/** Create the full set of 9 guns with default ammo loadout. */
export function initializeGuns(): Gun[] {
  return GUN_CONFIGS.map(cfg => ({
    ...cfg,
    ammo: cfg.ammoCapacity,
    jammed: false,
    disabled: false,
  }));
}

/** Get a gun by position from the aircraft's guns array. Throws if not found. */
export function getGun(guns: Gun[], id: GunPosition): Gun {
  const gun = guns.find(g => g.id === id);
  if (!gun) throw new Error(`Gun not found: ${id}`);
  return gun;
}

/** Check if a gun can fire: not disabled, not jammed, has ammo, crew is active. */
export function isGunEligible(gun: Gun, crew: CrewMember[]): boolean {
  if (gun.disabled || gun.jammed || gun.ammo <= 0) return false;
  const member = crew.find(c => c.position === gun.crewPosition);
  if (!member) return false;
  return member.status === 'active' && member.woundSeverity !== 'serious' && member.woundSeverity !== 'kia';
}

/** Mark a gun as permanently disabled (inoperable). */
export function disableGun(guns: Gun[], id: GunPosition): void {
  getGun(guns, id).disabled = true;
}

/** Mark a gun as temporarily jammed. */
export function jamGun(guns: Gun[], id: GunPosition): void {
  getGun(guns, id).jammed = true;
}

/** Build a legacy AmmoState object from the guns array (backward compat). */
export function gunsToAmmo(guns: Gun[]): Record<string, number> {
  const ammo: Record<string, number> = {};
  for (const g of guns) {
    ammo[g.id] = g.ammo;
  }
  return ammo;
}

/** Clone a guns array (deep copy). */
export function cloneGuns(guns: Gun[]): Gun[] {
  return guns.map(g => ({ ...g }));
}
