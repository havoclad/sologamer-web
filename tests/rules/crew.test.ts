import { describe, it, expect } from 'vitest';
import {
  applyWound, applyLightWound, applySeriousWound, applyKia,
  isCrewActive, canFireGun, hasTwoLightWoundPenalty,
  resetMissionState, createCrewMember, createReplacement,
  getGunOperator, canGunFire, isExperienced, canBailOut,
  isAtNaturalPosition, hasWrongPositionPenalty, NATURAL_GUN_MAP,
  applyPostMissionSurvival, applyFrostbiteRecovery, applyBailoutFate,
} from '../../src/games/b17/rules/crew.js';
import { initializeGuns, getGun } from '../../src/games/b17/rules/guns.js';
import type { CrewMember } from '../../src/games/b17/types.js';

function makeCrew(overrides: Partial<CrewMember> = {}): CrewMember {
  return {
    id: 'crew-001',
    name: 'Sgt Test',
    position: 'pilot',
    status: 'active',
    missions: 0,
    kills: 0,
    isOriginal: true,
    woundSeverity: 'none',
    lightWounds: 0,
    frostbite: false,
    currentGunPosition: null,
    aceForADay: false,
    ...overrides,
  };
}

// ─── applyLightWound ───

describe('applyLightWound', () => {
  it('sets woundSeverity to light on first wound', () => {
    const c = makeCrew();
    applyLightWound(c);
    expect(c.woundSeverity).toBe('light');
    expect(c.lightWounds).toBe(1);
  });

  it('accumulates light wounds', () => {
    const c = makeCrew();
    applyLightWound(c);
    applyLightWound(c);
    expect(c.lightWounds).toBe(2);
    expect(c.woundSeverity).toBe('light');
  });

  it('escalates to serious at 3 light wounds', () => {
    const c = makeCrew();
    applyLightWound(c);
    applyLightWound(c);
    applyLightWound(c);
    expect(c.woundSeverity).toBe('serious');
    expect(c.lightWounds).toBe(3);
    expect(c.currentGunPosition).toBeNull();
  });

  it('escalates serious to KIA', () => {
    const c = makeCrew({ woundSeverity: 'serious', lightWounds: 3 });
    applyLightWound(c);
    expect(c.woundSeverity).toBe('kia');
    expect(c.status).toBe('kia');
    expect(c.currentGunPosition).toBeNull();
  });

  it('does nothing if already KIA', () => {
    const c = makeCrew({ woundSeverity: 'kia', status: 'kia' });
    applyLightWound(c);
    expect(c.woundSeverity).toBe('kia');
  });
});

// ─── applySeriousWound ───

describe('applySeriousWound', () => {
  it('sets wound to serious from none', () => {
    const c = makeCrew({ currentGunPosition: 'Tail' });
    applySeriousWound(c);
    expect(c.woundSeverity).toBe('serious');
    expect(c.currentGunPosition).toBeNull();
  });

  it('sets wound to serious from light', () => {
    const c = makeCrew({ woundSeverity: 'light', lightWounds: 1 });
    applySeriousWound(c);
    expect(c.woundSeverity).toBe('serious');
  });

  it('escalates serious to KIA', () => {
    const c = makeCrew({ woundSeverity: 'serious' });
    applySeriousWound(c);
    expect(c.woundSeverity).toBe('kia');
    expect(c.status).toBe('kia');
  });

  it('does nothing if already KIA', () => {
    const c = makeCrew({ woundSeverity: 'kia', status: 'kia' });
    applySeriousWound(c);
    expect(c.woundSeverity).toBe('kia');
  });
});

// ─── applyKia ───

describe('applyKia', () => {
  it('sets KIA from any state', () => {
    for (const sev of ['none', 'light', 'serious'] as const) {
      const c = makeCrew({ woundSeverity: sev, currentGunPosition: 'Tail' });
      applyKia(c);
      expect(c.woundSeverity).toBe('kia');
      expect(c.status).toBe('kia');
      expect(c.currentGunPosition).toBeNull();
    }
  });
});

// ─── applyWound ───

describe('applyWound', () => {
  it('dispatches light wound', () => {
    const c = makeCrew();
    applyWound(c, 'light');
    expect(c.woundSeverity).toBe('light');
    expect(c.lightWounds).toBe(1);
  });

  it('dispatches serious wound', () => {
    const c = makeCrew();
    applyWound(c, 'serious');
    expect(c.woundSeverity).toBe('serious');
  });

  it('dispatches kia', () => {
    const c = makeCrew();
    applyWound(c, 'kia');
    expect(c.woundSeverity).toBe('kia');
    expect(c.status).toBe('kia');
  });

  it('no-ops for severity none', () => {
    const c = makeCrew();
    applyWound(c, 'none');
    expect(c.woundSeverity).toBe('none');
  });
});

// ─── Query functions ───

describe('isCrewActive', () => {
  it('returns true for healthy active crew', () => {
    expect(isCrewActive(makeCrew())).toBe(true);
  });

  it('returns true for lightly wounded crew', () => {
    expect(isCrewActive(makeCrew({ woundSeverity: 'light', lightWounds: 1 }))).toBe(true);
  });

  it('returns false for seriously wounded crew', () => {
    expect(isCrewActive(makeCrew({ woundSeverity: 'serious' }))).toBe(false);
  });

  it('returns false for KIA crew', () => {
    expect(isCrewActive(makeCrew({ woundSeverity: 'kia', status: 'kia' }))).toBe(false);
  });

  it('returns false for non-active status', () => {
    expect(isCrewActive(makeCrew({ status: 'hospital' }))).toBe(false);
  });
});

describe('canFireGun', () => {
  it('returns true for active crew with a gun', () => {
    expect(canFireGun(makeCrew({ currentGunPosition: 'Tail' }))).toBe(true);
  });

  it('returns false if no gun assigned', () => {
    expect(canFireGun(makeCrew({ currentGunPosition: null }))).toBe(false);
  });

  it('returns false if crew is wounded seriously', () => {
    expect(canFireGun(makeCrew({ woundSeverity: 'serious', currentGunPosition: 'Tail' }))).toBe(false);
  });
});

describe('hasTwoLightWoundPenalty', () => {
  it('returns false with 0 light wounds', () => {
    expect(hasTwoLightWoundPenalty(makeCrew())).toBe(false);
  });

  it('returns false with 1 light wound', () => {
    expect(hasTwoLightWoundPenalty(makeCrew({ woundSeverity: 'light', lightWounds: 1 }))).toBe(false);
  });

  it('returns true with 2 light wounds', () => {
    expect(hasTwoLightWoundPenalty(makeCrew({ woundSeverity: 'light', lightWounds: 2 }))).toBe(true);
  });

  it('returns false if escalated to serious (3 light wounds)', () => {
    expect(hasTwoLightWoundPenalty(makeCrew({ woundSeverity: 'serious', lightWounds: 3 }))).toBe(false);
  });
});

describe('isExperienced', () => {
  it('returns false for new crew', () => {
    expect(isExperienced(makeCrew({ missions: 0 }))).toBe(false);
  });

  it('returns false at 10 missions', () => {
    expect(isExperienced(makeCrew({ missions: 10 }))).toBe(false);
  });

  it('returns true at 11 missions', () => {
    expect(isExperienced(makeCrew({ missions: 11 }))).toBe(true);
  });

  it('returns true at 25 missions', () => {
    expect(isExperienced(makeCrew({ missions: 25 }))).toBe(true);
  });

  it('returns false at 26 missions', () => {
    expect(isExperienced(makeCrew({ missions: 26 }))).toBe(false);
  });
});

describe('canBailOut', () => {
  it('returns true for healthy crew', () => {
    expect(canBailOut(makeCrew())).toBe(true);
  });

  it('returns true for lightly wounded crew', () => {
    expect(canBailOut(makeCrew({ woundSeverity: 'light' }))).toBe(true);
  });

  it('returns false for seriously wounded crew', () => {
    expect(canBailOut(makeCrew({ woundSeverity: 'serious' }))).toBe(false);
  });

  it('returns false for KIA crew', () => {
    expect(canBailOut(makeCrew({ woundSeverity: 'kia' }))).toBe(false);
  });
});

describe('isAtNaturalPosition', () => {
  it('returns true when at natural gun', () => {
    const c = makeCrew({ position: 'tail_gunner', currentGunPosition: 'Tail' });
    expect(isAtNaturalPosition(c)).toBe(true);
  });

  it('returns false when at different gun', () => {
    const c = makeCrew({ position: 'tail_gunner', currentGunPosition: 'Radio' });
    expect(isAtNaturalPosition(c)).toBe(false);
  });

  it('returns true for pilot (no gun)', () => {
    const c = makeCrew({ position: 'pilot', currentGunPosition: null });
    expect(isAtNaturalPosition(c)).toBe(true);
  });
});

// ─── Mutations ───

describe('resetMissionState', () => {
  it('clears wound state and restores natural gun position', () => {
    const c = makeCrew({
      position: 'tail_gunner',
      woundSeverity: 'light',
      lightWounds: 2,
      frostbite: true,
      aceForADay: true,
      currentGunPosition: 'Radio',
    });
    resetMissionState(c);
    expect(c.woundSeverity).toBe('none');
    expect(c.lightWounds).toBe(0);
    expect(c.frostbite).toBe(false);
    expect(c.aceForADay).toBe(false);
    expect(c.currentGunPosition).toBe('Tail');
  });
});

describe('applyPostMissionSurvival', () => {
  it('roll 1 = rapid recovery', () => {
    const c = makeCrew({ woundSeverity: 'serious' });
    applyPostMissionSurvival(c, 1);
    expect(c.status).toBe('active');
  });

  it('roll 2-5 = hospital', () => {
    for (const roll of [2, 3, 4, 5]) {
      const c = makeCrew({ woundSeverity: 'serious' });
      applyPostMissionSurvival(c, roll);
      expect(c.status).toBe('hospital');
    }
  });

  it('roll 6 = KIA', () => {
    const c = makeCrew({ woundSeverity: 'serious' });
    applyPostMissionSurvival(c, 6);
    expect(c.status).toBe('kia');
  });
});

describe('applyFrostbiteRecovery', () => {
  it('roll 1-3 = grounded', () => {
    for (const roll of [1, 2, 3]) {
      const c = makeCrew({ frostbite: true });
      applyFrostbiteRecovery(c, roll);
      expect(c.status).toBe('grounded');
    }
  });

  it('roll 4-6 = recovers', () => {
    for (const roll of [4, 5, 6]) {
      const c = makeCrew({ frostbite: true });
      applyFrostbiteRecovery(c, roll);
      expect(c.frostbite).toBe(false);
    }
  });
});

describe('applyBailoutFate', () => {
  it('rescued = active', () => {
    const c = makeCrew();
    applyBailoutFate(c, 'rescued');
    expect(c.status).toBe('active');
  });

  it('evaded = evaded', () => {
    const c = makeCrew();
    applyBailoutFate(c, 'evaded');
    expect(c.status).toBe('evaded');
  });

  it('pow = pow', () => {
    const c = makeCrew();
    applyBailoutFate(c, 'pow');
    expect(c.status).toBe('pow');
  });

  it('drowned = kia', () => {
    const c = makeCrew();
    applyBailoutFate(c, 'drowned');
    expect(c.status).toBe('kia');
  });

  it('kia = kia', () => {
    const c = makeCrew();
    applyBailoutFate(c, 'kia');
    expect(c.status).toBe('kia');
  });
});

// ─── Factory functions ───

describe('createCrewMember', () => {
  it('creates an active original crew member', () => {
    const c = createCrewMember('crew-001', 'Sgt Smith', 'tail_gunner');
    expect(c.id).toBe('crew-001');
    expect(c.name).toBe('Sgt Smith');
    expect(c.position).toBe('tail_gunner');
    expect(c.status).toBe('active');
    expect(c.isOriginal).toBe(true);
    expect(c.missions).toBe(0);
    expect(c.kills).toBe(0);
    expect(c.woundSeverity).toBe('none');
    expect(c.lightWounds).toBe(0);
    expect(c.frostbite).toBe(false);
    expect(c.currentGunPosition).toBe('Tail');
    expect(c.aceForADay).toBe(false);
  });

  it('assigns correct natural gun for each position', () => {
    expect(createCrewMember('id', 'n', 'pilot').currentGunPosition).toBeNull();
    expect(createCrewMember('id', 'n', 'copilot').currentGunPosition).toBeNull();
    expect(createCrewMember('id', 'n', 'bombardier').currentGunPosition).toBe('Nose');
    expect(createCrewMember('id', 'n', 'navigator').currentGunPosition).toBe('Port_Cheek');
    expect(createCrewMember('id', 'n', 'engineer').currentGunPosition).toBe('Top_Turret');
    expect(createCrewMember('id', 'n', 'radioman').currentGunPosition).toBe('Radio');
    expect(createCrewMember('id', 'n', 'ball_turret').currentGunPosition).toBe('Ball_Turret');
    expect(createCrewMember('id', 'n', 'left_waist').currentGunPosition).toBe('Port_Waist');
    expect(createCrewMember('id', 'n', 'right_waist').currentGunPosition).toBe('Starboard_Waist');
    expect(createCrewMember('id', 'n', 'tail_gunner').currentGunPosition).toBe('Tail');
  });
});

describe('createReplacement', () => {
  it('creates a non-original crew member', () => {
    const c = createReplacement('crew-r100', 'Replacement pilot', 'pilot');
    expect(c.isOriginal).toBe(false);
    expect(c.status).toBe('active');
    expect(c.missions).toBe(0);
    expect(c.currentGunPosition).toBeNull(); // pilot has no gun
  });
});

// ─── Gun assignment ───

describe('getGunOperator', () => {
  it('finds crew at gun position', () => {
    const crew = [
      makeCrew({ position: 'tail_gunner', currentGunPosition: 'Tail' }),
      makeCrew({ position: 'pilot', currentGunPosition: null }),
    ];
    expect(getGunOperator(crew, 'Tail')?.position).toBe('tail_gunner');
  });

  it('returns undefined if no one at gun', () => {
    const crew = [makeCrew({ position: 'pilot', currentGunPosition: null })];
    expect(getGunOperator(crew, 'Tail')).toBeUndefined();
  });
});

describe('canGunFire', () => {
  it('returns true for operational gun with active operator', () => {
    const guns = initializeGuns();
    const tailGun = getGun(guns, 'Tail')!;
    const crew = [makeCrew({ position: 'tail_gunner', currentGunPosition: 'Tail' })];
    expect(canGunFire(tailGun, crew)).toBe(true);
  });

  it('returns false for disabled gun', () => {
    const guns = initializeGuns();
    const tailGun = getGun(guns, 'Tail')!;
    tailGun.disabled = true;
    const crew = [makeCrew({ position: 'tail_gunner', currentGunPosition: 'Tail' })];
    expect(canGunFire(tailGun, crew)).toBe(false);
  });

  it('returns false for jammed gun', () => {
    const guns = initializeGuns();
    const tailGun = getGun(guns, 'Tail')!;
    tailGun.jammed = true;
    const crew = [makeCrew({ position: 'tail_gunner', currentGunPosition: 'Tail' })];
    expect(canGunFire(tailGun, crew)).toBe(false);
  });

  it('returns false when gun out of ammo', () => {
    const guns = initializeGuns();
    const tailGun = getGun(guns, 'Tail')!;
    tailGun.ammo = 0;
    const crew = [makeCrew({ position: 'tail_gunner', currentGunPosition: 'Tail' })];
    expect(canGunFire(tailGun, crew)).toBe(false);
  });

  it('returns false when no operator', () => {
    const guns = initializeGuns();
    const tailGun = getGun(guns, 'Tail')!;
    const crew = [makeCrew({ position: 'pilot', currentGunPosition: null })];
    expect(canGunFire(tailGun, crew)).toBe(false);
  });

  it('returns false when operator is KIA', () => {
    const guns = initializeGuns();
    const tailGun = getGun(guns, 'Tail')!;
    const crew = [makeCrew({ position: 'tail_gunner', currentGunPosition: 'Tail', woundSeverity: 'kia', status: 'kia' })];
    expect(canGunFire(tailGun, crew)).toBe(false);
  });
});

describe('hasWrongPositionPenalty', () => {
  it('returns false when operator is at natural position', () => {
    const guns = initializeGuns();
    const tailGun = getGun(guns, 'Tail')!;
    const crew = [makeCrew({ position: 'tail_gunner', currentGunPosition: 'Tail' })];
    expect(hasWrongPositionPenalty(tailGun, crew)).toBe(false);
  });

  it('returns true when operator is at non-natural position', () => {
    const guns = initializeGuns();
    const tailGun = getGun(guns, 'Tail')!;
    // radioman moved to tail gun (not their natural position)
    const crew = [makeCrew({ position: 'radioman', currentGunPosition: 'Tail' })];
    expect(hasWrongPositionPenalty(tailGun, crew)).toBe(true);
  });

  it('returns false when no operator', () => {
    const guns = initializeGuns();
    const tailGun = getGun(guns, 'Tail')!;
    const crew: CrewMember[] = [];
    expect(hasWrongPositionPenalty(tailGun, crew)).toBe(false);
  });
});
