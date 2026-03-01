import { describe, it, expect } from 'vitest';
import { GUN_LABELS, woundToEventSeverity, plural } from '../../src/games/b17/rules/display-labels.js';

describe('GUN_LABELS', () => {
  it('has entries for all 9 gun positions', () => {
    const positions = [
      'Nose', 'Port_Cheek', 'Starboard_Cheek', 'Top_Turret',
      'Ball_Turret', 'Port_Waist', 'Starboard_Waist', 'Radio', 'Tail',
    ];
    for (const pos of positions) {
      expect(GUN_LABELS[pos]).toBeTruthy();
    }
  });
});

describe('woundToEventSeverity', () => {
  it('maps kia to critical', () => {
    expect(woundToEventSeverity('kia')).toBe('critical');
  });

  it('maps serious to bad', () => {
    expect(woundToEventSeverity('serious')).toBe('bad');
  });

  it('maps light to warn', () => {
    expect(woundToEventSeverity('light')).toBe('warn');
  });

  it('maps none to warn', () => {
    expect(woundToEventSeverity('none')).toBe('warn');
  });
});

describe('plural', () => {
  it('returns singular for count 1', () => {
    expect(plural(1, 'fighter')).toBe('1 fighter');
  });

  it('returns plural for count > 1', () => {
    expect(plural(3, 'fighter')).toBe('3 fighters');
  });

  it('returns plural for count 0', () => {
    expect(plural(0, 'fighter')).toBe('0 fighters');
  });

  it('uses custom plural form', () => {
    expect(plural(2, 'die', 'dice')).toBe('2 dice');
  });

  it('uses custom plural form even for 0', () => {
    expect(plural(0, 'die', 'dice')).toBe('0 dice');
  });
});
