import { describe, it, expect } from 'vitest';
import { createInitialB17State, b17Module } from '../src/games/b17/index.js';
import { StateMachine } from '../src/engine/state-machine.js';
import { TableStore } from '../src/engine/tables.js';
import type { B17Phase } from '../src/games/b17/phases.js';
import type { B17GameState } from '../src/games/b17/types.js';

describe('B-17 Game Module', () => {
  it('creates valid initial state', () => {
    const state = createInitialB17State();
    expect(state.campaign.missionsTotal).toBe(25);
    expect(state.campaign.missionsCompleted).toBe(0);
    expect(state.campaign.crew).toHaveLength(10);
    expect(state.campaign.aircraft.engines).toEqual(['ok', 'ok', 'ok', 'ok']);
    expect(state.mission).toBeNull();
  });

  it('has all 10 crew positions', () => {
    const state = createInitialB17State();
    const positions = state.campaign.crew.map(c => c.position);
    expect(positions).toContain('pilot');
    expect(positions).toContain('tail_gunner');
    expect(positions).toContain('ball_turret');
  });

  it('module definition is complete', () => {
    expect(b17Module.id).toBe('b17-queen-of-the-skies');
    expect(b17Module.phases.length).toBeGreaterThanOrEqual(15);
    expect(b17Module.initialPhase).toBe('PRE_MISSION');
  });

  it('state machine works with B-17 phases', () => {
    const sm = new StateMachine<B17Phase, B17GameState>({
      phases: b17Module.phases,
      initialPhase: b17Module.initialPhase,
      createInitialState: b17Module.createInitialState,
    });

    expect(sm.getPhase()).toBe('PRE_MISSION');
    sm.transition('TARGET_SELECTION');
    expect(sm.getPhase()).toBe('TARGET_SELECTION');
    sm.transition('FORMATION_SETUP');
    sm.transition('ZONE_ENTER');
    expect(sm.getPhase()).toBe('ZONE_ENTER');

    // Can go to fighter cover or target zone flak or zone exit
    const valid = sm.validTransitions();
    expect(valid).toContain('FIGHTER_COVER_CHECK');
    expect(valid).toContain('TARGET_ZONE_FLAK');
    expect(valid).toContain('ZONE_EXIT');
  });

  it('loads all B-17 tables', () => {
    const store = new TableStore();
    store.loadDirectory(b17Module.tableDirectory);
    const names = store.names();
    // Should have all the standard tables
    expect(names).toContain('B-1');
    expect(names).toContain('G-11');
    expect(names).toContain('P-6');
    expect(names).toContain('FLOW-start');
    expect(names.length).toBeGreaterThanOrEqual(46);
  });
});
