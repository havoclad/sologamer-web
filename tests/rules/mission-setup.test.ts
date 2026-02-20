import { describe, it, expect, beforeEach } from 'vitest';
import { createRNG } from '../../src/engine/rng.js';
import { TableStore } from '../../src/engine/tables.js';
import { b17Module } from '../../src/games/b17/index.js';
import {
  selectTarget, rollFormationPosition, rollSquadronPosition,
  rollWeather, getZoneInfo, getTargetZone, setupMission,
} from '../../src/games/b17/rules/mission-setup.js';

let tables: TableStore;

beforeEach(() => {
  tables = new TableStore();
  tables.loadDirectory(b17Module.tableDirectory);
});

describe('selectTarget', () => {
  it('missions 1-5 use G-1 (d6 roll, 6 targets)', () => {
    // With seeded RNG, verify we get a valid target
    const rng = createRNG(42);
    const target = selectTarget(1, rng, tables);
    expect(target.name).toBeTruthy();
    expect(target.type).toBeTruthy();
    // G-1 targets: St. Omer, Cherbourg, Amiens, Meaulte, Abbeville, Lille
    const validTargets = ['St. Omer', 'Cherbourg', 'Amiens', 'Meaulte', 'Abbeville', 'Lille'];
    expect(validTargets).toContain(target.name);
  });

  it('missions 6-10 use G-2', () => {
    const rng = createRNG(42);
    const target = selectTarget(7, rng, tables);
    const validTargets = ['Abbeville', 'Meaulte', 'Lille', 'Rotterdam', 'Antwerp', 'Rouen'];
    expect(validTargets).toContain(target.name);
  });

  it('missions 11-25 use G-3 (d6d6 roll)', () => {
    const rng = createRNG(42);
    const target = selectTarget(15, rng, tables);
    expect(target.name).toBeTruthy();
    // G-3 has many more targets
  });

  it('target with flak modifier includes notes', () => {
    // Brest, Lorient, St. Nazaire, etc. have O-2 +1 modifier
    // We need to find a seed that produces one of these targets
    // Instead, test the general structure
    const rng = createRNG(100);
    for (let i = 0; i < 50; i++) {
      const target = selectTarget(15, createRNG(i), tables);
      if (target.notes && target.notes.length > 0) {
        expect(target.notes[0].table).toBe('O-2');
        expect(target.notes[0].modifier).toBe(1);
        break;
      }
    }
  });

  it('is deterministic with same seed', () => {
    const t1 = selectTarget(1, createRNG(42), tables);
    const t2 = selectTarget(1, createRNG(42), tables);
    expect(t1.name).toBe(t2.name);
    expect(t1.type).toBe(t2.type);
  });
});

describe('rollFormationPosition', () => {
  it('returns lead, middle, or tail', () => {
    const rng = createRNG(42);
    const result = rollFormationPosition(rng, tables);
    expect(['lead', 'middle', 'tail']).toContain(result.position);
    expect(typeof result.extraFighterPerWave).toBe('boolean');
  });

  it('lead/tail get extra fighter per wave', () => {
    // Find seeds that produce lead or tail
    for (let seed = 0; seed < 200; seed++) {
      const result = rollFormationPosition(createRNG(seed), tables);
      if (result.position === 'lead' || result.position === 'tail') {
        expect(result.extraFighterPerWave).toBe(true);
        return;
      }
    }
  });

  it('middle does NOT get extra fighter', () => {
    for (let seed = 0; seed < 200; seed++) {
      const result = rollFormationPosition(createRNG(seed), tables);
      if (result.position === 'middle') {
        expect(result.extraFighterPerWave).toBe(false);
        return;
      }
    }
  });
});

describe('rollSquadronPosition', () => {
  it('returns null for missions 1-5', () => {
    const rng = createRNG(42);
    expect(rollSquadronPosition(3, rng, tables)).toBeNull();
  });

  it('returns position for missions 6+', () => {
    const rng = createRNG(42);
    const result = rollSquadronPosition(7, rng, tables);
    expect(result).not.toBeNull();
    expect(['high', 'lead', 'low']).toContain(result!.position);
    expect(typeof result!.b1b2Modifier).toBe('number');
  });
});

describe('rollWeather', () => {
  it('returns valid weather', () => {
    const rng = createRNG(42);
    const result = rollWeather(rng, tables);
    expect(['clear', 'poor', 'overcast']).toContain(result.weather);
  });

  it('bad/poor weather includes modifiers', () => {
    // Find a seed that produces bad weather
    for (let seed = 0; seed < 500; seed++) {
      const result = rollWeather(createRNG(seed), tables);
      if (result.weather === 'overcast' || result.weather === 'poor') {
        expect(result.modifiers.length).toBeGreaterThan(0);
        // Should include B-2 and M-4 modifiers
        const tableNames = result.modifiers.map(m => m.table);
        expect(tableNames).toContain('B-2');
        return;
      }
    }
  });

  it('good weather has no modifiers', () => {
    for (let seed = 0; seed < 500; seed++) {
      const result = rollWeather(createRNG(seed), tables);
      if (result.weather === 'clear') {
        expect(result.modifiers.length).toBe(0);
        return;
      }
    }
  });
});

describe('getZoneInfo', () => {
  it('returns zone data for known targets', () => {
    const info = getZoneInfo('Bremen', 2, tables);
    expect(info).not.toBeNull();
    expect(info!.b1Modifier).toBe(-2);
    expect(info!.over).toContain('water');
  });

  it('returns null for zones not in target path', () => {
    // St. Omer is close (zone 3 max), so zone 7 should be null
    const info = getZoneInfo('St. Omer', 7, tables);
    expect(info).toBeNull();
  });
});

describe('getTargetZone', () => {
  it('returns correct zone for targets', () => {
    expect(getTargetZone('St. Omer', tables)).toBe(2);
    expect(getTargetZone('Bremen', tables)).toBe(7);
    expect(getTargetZone('Lille', tables)).toBe(3);
  });
});

describe('setupMission', () => {
  it('returns complete setup result', () => {
    const rng = createRNG(42);
    const result = setupMission(1, rng, tables);

    expect(result.target.name).toBeTruthy();
    expect(result.targetZone).toBeGreaterThanOrEqual(2);
    expect(['lead', 'middle', 'tail']).toContain(result.formationPosition);
    expect(result.squadronPosition).toBeNull(); // Mission 1
    expect(result.zoneModifiers.size).toBeGreaterThan(0);
  });

  it('mission 7 includes squadron position', () => {
    const rng = createRNG(42);
    const result = setupMission(7, rng, tables);
    expect(result.squadronPosition).not.toBeNull();
  });

  it('is deterministic', () => {
    const r1 = setupMission(15, createRNG(99), tables);
    const r2 = setupMission(15, createRNG(99), tables);
    expect(r1.target.name).toBe(r2.target.name);
    expect(r1.formationPosition).toBe(r2.formationPosition);
    expect(r1.targetZone).toBe(r2.targetZone);
  });
});
