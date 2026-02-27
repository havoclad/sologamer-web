import { describe, it, expect } from 'vitest';
import {
  initializeGuns, getGun, isGunEligible, disableGun, jamGun,
  gunsToAmmo, cloneGuns, type Gun,
} from '../../src/games/b17/rules/guns.js';
import type { CrewMember } from '../../src/games/b17/types.js';

function makeCrew(overrides: Partial<CrewMember> = {}): CrewMember {
  return {
    position: 'tail_gunner',
    name: 'Sgt Test',
    wounds: 'none',
    frostbite: false,
    kills: 0,
    missions: 0,
    status: 'active',
    ...overrides,
  };
}

describe('initializeGuns', () => {
  it('returns 9 guns', () => {
    const guns = initializeGuns();
    expect(guns).toHaveLength(9);
  });

  it('all guns start with full ammo, not jammed, not disabled', () => {
    for (const gun of initializeGuns()) {
      expect(gun.ammo).toBe(gun.ammoCapacity);
      expect(gun.jammed).toBe(false);
      expect(gun.disabled).toBe(false);
    }
  });

  it('twin mounts are correct', () => {
    const guns = initializeGuns();
    expect(getGun(guns, 'Ball_Turret').twin).toBe(true);
    expect(getGun(guns, 'Top_Turret').twin).toBe(true);
    expect(getGun(guns, 'Tail').twin).toBe(true);
    expect(getGun(guns, 'Nose').twin).toBe(false);
    expect(getGun(guns, 'Port_Waist').twin).toBe(false);
    expect(getGun(guns, 'Radio').twin).toBe(false);
  });

  it('ammo capacities match legacy defaults', () => {
    const guns = initializeGuns();
    expect(getGun(guns, 'Nose').ammoCapacity).toBe(12);
    expect(getGun(guns, 'Top_Turret').ammoCapacity).toBe(16);
    expect(getGun(guns, 'Ball_Turret').ammoCapacity).toBe(16);
    expect(getGun(guns, 'Radio').ammoCapacity).toBe(8);
    expect(getGun(guns, 'Tail').ammoCapacity).toBe(16);
  });
});

describe('getGun', () => {
  it('finds gun by id', () => {
    const guns = initializeGuns();
    expect(getGun(guns, 'Tail').id).toBe('Tail');
    expect(getGun(guns, 'Nose').crewPosition).toBe('bombardier');
  });

  it('throws for unknown gun', () => {
    expect(() => getGun([], 'Tail')).toThrow('Gun not found');
  });
});

describe('isGunEligible', () => {
  it('eligible when gun is operational and crew is active', () => {
    const gun = getGun(initializeGuns(), 'Tail');
    const crew = [makeCrew({ position: 'tail_gunner', status: 'active', wounds: 'none' })];
    expect(isGunEligible(gun, crew)).toBe(true);
  });

  it('ineligible when gun is disabled', () => {
    const guns = initializeGuns();
    disableGun(guns, 'Tail');
    const gun = getGun(guns, 'Tail');
    const crew = [makeCrew()];
    expect(isGunEligible(gun, crew)).toBe(false);
  });

  it('ineligible when gun is jammed', () => {
    const guns = initializeGuns();
    jamGun(guns, 'Tail');
    const gun = getGun(guns, 'Tail');
    const crew = [makeCrew()];
    expect(isGunEligible(gun, crew)).toBe(false);
  });

  it('ineligible when ammo is 0', () => {
    const gun: Gun = { id: 'Tail', name: 'Tail guns', crewPosition: 'tail_gunner', twin: true, ammoCapacity: 16, ammo: 0, jammed: false, disabled: false };
    const crew = [makeCrew()];
    expect(isGunEligible(gun, crew)).toBe(false);
  });

  it('ineligible when crew is KIA', () => {
    const gun = getGun(initializeGuns(), 'Tail');
    const crew = [makeCrew({ status: 'kia', wounds: 'kia' })];
    expect(isGunEligible(gun, crew)).toBe(false);
  });

  it('ineligible when crew has serious wounds', () => {
    const gun = getGun(initializeGuns(), 'Tail');
    const crew = [makeCrew({ wounds: 'serious' })];
    expect(isGunEligible(gun, crew)).toBe(false);
  });

  it('ineligible when crew member is missing', () => {
    const gun = getGun(initializeGuns(), 'Tail');
    expect(isGunEligible(gun, [])).toBe(false);
  });
});

describe('disableGun', () => {
  it('sets disabled to true', () => {
    const guns = initializeGuns();
    disableGun(guns, 'Tail');
    expect(getGun(guns, 'Tail').disabled).toBe(true);
  });

  it('does not affect other guns', () => {
    const guns = initializeGuns();
    disableGun(guns, 'Tail');
    expect(getGun(guns, 'Nose').disabled).toBe(false);
  });
});

describe('jamGun', () => {
  it('sets jammed to true', () => {
    const guns = initializeGuns();
    jamGun(guns, 'Ball_Turret');
    expect(getGun(guns, 'Ball_Turret').jammed).toBe(true);
  });

  it('does not affect other guns', () => {
    const guns = initializeGuns();
    jamGun(guns, 'Ball_Turret');
    expect(getGun(guns, 'Tail').jammed).toBe(false);
  });
});

describe('gunsToAmmo', () => {
  it('converts guns array to legacy ammo object', () => {
    const guns = initializeGuns();
    guns[0].ammo = 5; // Nose
    const ammo = gunsToAmmo(guns);
    expect(ammo['Nose']).toBe(5);
    expect(ammo['Tail']).toBe(16);
  });
});

describe('cloneGuns', () => {
  it('creates independent copy', () => {
    const guns = initializeGuns();
    const cloned = cloneGuns(guns);
    cloned[0].ammo = 0;
    expect(guns[0].ammo).toBe(12); // original unchanged
  });
});
