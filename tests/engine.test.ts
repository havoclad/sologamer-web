import { describe, it, expect } from 'vitest';
import { createRNG } from '../src/engine/rng.js';
import { TableStore } from '../src/engine/tables.js';
import { EventBus } from '../src/engine/events.js';
import { StateMachine } from '../src/engine/state-machine.js';
import { registry } from '../src/engine/registry.js';
import { join } from 'path';

// ─── RNG Tests ───

describe('RNG', () => {
  it('produces deterministic output with same seed', () => {
    const a = createRNG(42);
    const b = createRNG(42);
    const seqA = Array.from({ length: 20 }, () => a.next());
    const seqB = Array.from({ length: 20 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it('produces different output with different seeds', () => {
    const a = createRNG(42);
    const b = createRNG(99);
    const seqA = Array.from({ length: 10 }, () => a.next());
    const seqB = Array.from({ length: 10 }, () => b.next());
    expect(seqA).not.toEqual(seqB);
  });

  it('d6 returns 1-6', () => {
    const rng = createRNG(123);
    const rolls = Array.from({ length: 100 }, () => rng.d6());
    expect(rolls.every(r => r >= 1 && r <= 6)).toBe(true);
    // Should hit multiple values
    expect(new Set(rolls).size).toBeGreaterThan(1);
  });

  it('twod6 returns 2-12', () => {
    const rng = createRNG(456);
    const rolls = Array.from({ length: 100 }, () => rng.twod6());
    expect(rolls.every(r => r >= 2 && r <= 12)).toBe(true);
  });

  it('d6d6 returns values like 11-66', () => {
    const rng = createRNG(789);
    const rolls = Array.from({ length: 100 }, () => rng.d6d6());
    expect(rolls.every(r => {
      const tens = Math.floor(r / 10);
      const ones = r % 10;
      return tens >= 1 && tens <= 6 && ones >= 1 && ones <= 6;
    })).toBe(true);
  });

  it('state save/restore works', () => {
    const rng = createRNG(42);
    rng.next(); rng.next(); rng.next();
    const state = rng.getState();
    const v1 = rng.next();
    const v2 = rng.next();
    rng.setState(state);
    expect(rng.next()).toBe(v1);
    expect(rng.next()).toBe(v2);
  });

  it('string seeds work', () => {
    const a = createRNG('hello');
    const b = createRNG('hello');
    expect(Array.from({ length: 5 }, () => a.d6())).toEqual(
      Array.from({ length: 5 }, () => b.d6())
    );
  });
});

// ─── Table Tests ───

describe('TableStore', () => {
  const dataDir = join(__dirname, '..', 'src', 'games', 'b17', 'data');

  it('loads all B-17 table files', () => {
    const store = new TableStore();
    store.loadDirectory(dataDir);
    const names = store.names();
    expect(names.length).toBeGreaterThanOrEqual(40);
    expect(names).toContain('B-1');
    expect(names).toContain('G-1');
    expect(names).toContain('FLOW-start');
  });

  it('looks up B-1 table by value', () => {
    const store = new TableStore();
    store.loadDirectory(dataDir);
    // B-1: roll 1 or 2 = 0 waves
    const entry = store.lookupValue('B-1', 1);
    expect(entry).toBeDefined();
    expect(entry!.fighter_waves).toBe(0);
  });

  it('looks up B-1 roll 6 = 2 waves', () => {
    const store = new TableStore();
    store.loadDirectory(dataDir);
    const entry = store.lookupValue('B-1', 6);
    expect(entry).toBeDefined();
    expect(entry!.fighter_waves).toBe(2);
  });

  it('performs RNG-driven lookup', () => {
    const store = new TableStore();
    store.loadDirectory(dataDir);
    const rng = createRNG(42);
    const result = store.lookup('B-1', rng);
    expect(result).toBeDefined();
    expect(result!.roll).toBeGreaterThanOrEqual(1);
    expect(result!.roll).toBeLessThanOrEqual(6);
  });

  it('parses flow tables', () => {
    const store = new TableStore();
    store.loadDirectory(dataDir);
    const flow = store.getFlow('FLOW-start');
    expect(flow).toBeDefined();
    expect(flow!.kind).toBe('flow');
    expect(flow!.steps.length).toBeGreaterThan(0);
    expect(flow!.steps[0].type).toBe('choosemax');
  });

  it('expands roll ranges correctly', () => {
    const store = new TableStore();
    store.loadDirectory(dataDir);
    const table = store.getRoll('B-1');
    expect(table).toBeDefined();
    // "3-5" should expand to entries for 3, 4, 5
    expect(table!.entries.has('3')).toBe(true);
    expect(table!.entries.has('4')).toBe(true);
    expect(table!.entries.has('5')).toBe(true);
  });
});

// ─── Event Bus Tests ───

describe('EventBus', () => {
  it('emits and receives events', () => {
    const bus = new EventBus();
    const received: string[] = [];
    bus.on('TEST', e => received.push(e.type));
    bus.emit({ type: 'TEST' });
    bus.emit({ type: 'OTHER' });
    expect(received).toEqual(['TEST']);
  });

  it('records event log', () => {
    const bus = new EventBus();
    bus.emit({ type: 'A' });
    bus.emit({ type: 'B' });
    expect(bus.getLog()).toHaveLength(2);
    expect(bus.getLog()[0].type).toBe('A');
  });

  it('onAny receives all events', () => {
    const bus = new EventBus();
    const all: string[] = [];
    bus.onAny(e => all.push(e.type));
    bus.emit({ type: 'X' });
    bus.emit({ type: 'Y' });
    expect(all).toEqual(['X', 'Y']);
  });

  it('unsubscribe works', () => {
    const bus = new EventBus();
    const received: string[] = [];
    const unsub = bus.on('T', e => received.push(e.type));
    bus.emit({ type: 'T' });
    unsub();
    bus.emit({ type: 'T' });
    expect(received).toEqual(['T']);
  });
});

// ─── State Machine Tests ───

describe('StateMachine', () => {
  type Phase = 'A' | 'B' | 'C';
  interface TestState { count: number }

  const config = {
    phases: [
      { name: 'A' as Phase, next: ['B' as Phase] },
      { name: 'B' as Phase, next: ['C' as Phase, 'A' as Phase] },
      { name: 'C' as Phase, next: [] as Phase[], terminal: true },
    ],
    initialPhase: 'A' as Phase,
    createInitialState: () => ({ count: 0 }),
  };

  it('starts in initial phase', () => {
    const sm = new StateMachine(config);
    expect(sm.getPhase()).toBe('A');
    expect(sm.getState().count).toBe(0);
  });

  it('transitions to valid next phase', () => {
    const sm = new StateMachine(config);
    sm.transition('B', { count: 1 });
    expect(sm.getPhase()).toBe('B');
    expect(sm.getState().count).toBe(1);
  });

  it('rejects invalid transitions', () => {
    const sm = new StateMachine(config);
    expect(() => sm.transition('C')).toThrow(/Invalid transition/);
  });

  it('detects terminal state', () => {
    const sm = new StateMachine(config);
    expect(sm.isTerminal()).toBe(false);
    sm.transition('B');
    sm.transition('C');
    expect(sm.isTerminal()).toBe(true);
  });

  it('undo restores previous state', () => {
    const sm = new StateMachine(config);
    sm.transition('B', { count: 10 });
    expect(sm.getState().count).toBe(10);
    sm.undo();
    expect(sm.getPhase()).toBe('A');
    expect(sm.getState().count).toBe(0);
  });

  it('records snapshots', () => {
    const sm = new StateMachine(config);
    sm.transition('B', { count: 5 });
    sm.transition('C', { count: 99 });
    expect(sm.getSnapshots()).toHaveLength(3);
  });
});

// ─── Registry Tests ───

describe('Registry', () => {
  it('registers and retrieves a game', () => {
    // Import and register B-17
    // We test this inline since it depends on file paths
    registry.register({
      id: 'test-game',
      name: 'Test Game',
      description: 'A test',
      tableDirectory: '/tmp',
      phases: [{ name: 'START', next: ['END'] }, { name: 'END', next: [], terminal: true }],
      initialPhase: 'START',
      createInitialState: () => ({}),
    });

    expect(registry.has('test-game')).toBe(true);
    expect(registry.get('test-game')?.name).toBe('Test Game');
    expect(registry.list().length).toBeGreaterThanOrEqual(1);
  });
});
