import { describe, it, expect, beforeEach } from 'vitest';
import { createRNG } from '../../src/engine/rng.js';
import { TableStore } from '../../src/engine/tables.js';
import { b17Module } from '../../src/games/b17/index.js';
import { runMission } from '../../src/games/b17/rules/mission.js';
import { runCampaign } from '../../src/games/b17/rules/campaign.js';
import type { AircraftState, CrewMember } from '../../src/games/b17/types.js';

let tables: TableStore;

function defaultAircraft(): AircraftState {
  return {
    engines: ['ok', 'ok', 'ok', 'ok'],
    fuelLeak: false, fuelFire: false, oxygenOut: false, heatingOut: false,
    ballTurretInop: false, bombBayDoorsInop: false, radioOut: false, tailWheelInop: false,
    wingSurfaceDamage: { left: 0, right: 0 },
    controlDamage: { rudder: false, elevator: false, ailerons: false },
    fireExtinguishersUsed: 0, ammo: { Nose: 12, Port_Cheek: 12, Starboard_Cheek: 12, Top_Turret: 16, Ball_Turret: 16, Port_Waist: 12, Starboard_Waist: 12, Radio: 8, Tail: 16 },
  };
}

function defaultCrew(): CrewMember[] {
  return ['pilot', 'copilot', 'navigator', 'bombardier', 'engineer',
    'radioman', 'ball_turret', 'left_waist', 'right_waist', 'tail_gunner'].map(p => ({
    position: p as any, name: `Sgt ${p}`, wounds: 'none' as const,
    frostbite: false, kills: 0, missions: 0, status: 'active' as const,
  }));
}

beforeEach(() => {
  tables = new TableStore();
  tables.loadDirectory(b17Module.tableDirectory);
});

describe('runMission', () => {
  it('completes a full mission with seeded RNG', () => {
    const result = runMission(1, defaultCrew(), defaultAircraft(), createRNG(42), tables);
    expect(result.missionNumber).toBe(1);
    expect(result.target).toBeTruthy();
    expect(result.log.length).toBeGreaterThan(0);
    expect(result.outcome).toHaveProperty('victory');
    expect(['8th_af_victory', 'german_victory', 'draw']).toContain(result.outcome.victory);
    expect(result.updatedCrew).toHaveLength(10);
  });

  it('is deterministic with same seed', () => {
    const r1 = runMission(1, defaultCrew(), defaultAircraft(), createRNG(42), tables);
    const r2 = runMission(1, defaultCrew(), defaultAircraft(), createRNG(42), tables);
    expect(r1.target).toBe(r2.target);
    expect(r1.outcome.victory).toBe(r2.outcome.victory);
    expect(r1.log.length).toBe(r2.log.length);
  });

  it('handles multiple mission numbers', () => {
    for (const m of [1, 5, 10, 15, 25]) {
      const result = runMission(m, defaultCrew(), defaultAircraft(), createRNG(m * 100), tables);
      expect(result.missionNumber).toBe(m);
      expect(result.log.length).toBeGreaterThan(0);
    }
  });

  it('logs contain expected phases', () => {
    const result = runMission(1, defaultCrew(), defaultAircraft(), createRNG(42), tables);
    const phases = new Set(result.log.map(e => e.phase));
    expect(phases.has('SETUP')).toBe(true);
    expect(phases.has('ZONE_ENTER')).toBe(true);
    expect(phases.has('DEBRIEF')).toBe(true);
  });

  it('produces different results with different seeds', () => {
    const r1 = runMission(1, defaultCrew(), defaultAircraft(), createRNG(1), tables);
    const r2 = runMission(1, defaultCrew(), defaultAircraft(), createRNG(999), tables);
    // At least targets or outcomes should differ across many seeds
    const differ = r1.target !== r2.target || r1.outcome.victory !== r2.outcome.victory
      || r1.log.length !== r2.log.length;
    expect(differ).toBe(true);
  });
});

describe('runCampaign', () => {
  it('runs a short campaign (3 missions)', () => {
    const result = runCampaign(createRNG(42), tables, { totalMissions: 3 });
    expect(result.missionsCompleted).toBe(3);
    expect(result.missions).toHaveLength(3);
    expect(result.eightAfVictories + result.germanVictories + result.draws).toBe(3);
    expect(['8th_af', 'german', 'tie']).toContain(result.campaignVictor);
  });

  it('tracks crew losses', () => {
    const result = runCampaign(createRNG(42), tables, { totalMissions: 5 });
    expect(result.totalCrewLost).toBeGreaterThanOrEqual(0);
    expect(result.crewSurvivors).toHaveLength(10);
  });

  it('is deterministic', () => {
    const r1 = runCampaign(createRNG(42), tables, { totalMissions: 3 });
    const r2 = runCampaign(createRNG(42), tables, { totalMissions: 3 });
    expect(r1.eightAfVictories).toBe(r2.eightAfVictories);
    expect(r1.germanVictories).toBe(r2.germanVictories);
    expect(r1.planesLost).toBe(r2.planesLost);
  });
});

describe('full mission integration', () => {
  it('plays 10 missions with varied seeds and all complete sensibly', () => {
    for (let seed = 0; seed < 10; seed++) {
      const result = runMission(seed + 1, defaultCrew(), defaultAircraft(), createRNG(seed * 37 + 7), tables);
      // Basic sanity checks
      expect(result.missionNumber).toBe(seed + 1);
      expect(result.log.length).toBeGreaterThan(3);
      expect(result.outcome.crewFates).toHaveLength(10);
      
      // Crew fates should be valid
      for (const fate of result.outcome.crewFates) {
        expect(typeof fate.position).toBe('string');
        expect(typeof fate.fate).toBe('string');
      }
    }
  });
});
