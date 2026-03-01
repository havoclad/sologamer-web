import { describe, it, expect } from 'vitest';
import { createRNG } from '../../src/engine/rng.js';
import { normalizeDiceType, autoRoll } from '../../src/web/types.js';

describe('normalizeDiceType', () => {
  it('normalizes d6 to 1d6', () => {
    expect(normalizeDiceType('d6')).toBe('1d6');
  });

  it('keeps 1d6 as 1d6', () => {
    expect(normalizeDiceType('1d6')).toBe('1d6');
  });

  it('keeps 2d6 as 2d6', () => {
    expect(normalizeDiceType('2d6')).toBe('2d6');
  });

  it('keeps d6d6 as d6d6', () => {
    expect(normalizeDiceType('d6d6')).toBe('d6d6');
  });

  it('passes through unknown types', () => {
    expect(normalizeDiceType('3d8')).toBe('3d8');
  });
});

describe('autoRoll', () => {
  it('rolls 1d6 by default', () => {
    const rng = createRNG(42);
    const result = autoRoll('1d6', rng);
    expect(result).toBeGreaterThanOrEqual(1);
    expect(result).toBeLessThanOrEqual(6);
  });

  it('rolls 2d6 for 2d6 type', () => {
    const rng = createRNG(42);
    const result = autoRoll('2d6', rng);
    expect(result).toBeGreaterThanOrEqual(2);
    expect(result).toBeLessThanOrEqual(12);
  });

  it('rolls d6d6 for d6d6 type', () => {
    const rng = createRNG(42);
    const result = autoRoll('d6d6', rng);
    expect(result).toBeGreaterThanOrEqual(11);
    expect(result).toBeLessThanOrEqual(66);
    // d6d6 should be a two-digit number with each digit 1-6
    const tens = Math.floor(result / 10);
    const ones = result % 10;
    expect(tens).toBeGreaterThanOrEqual(1);
    expect(tens).toBeLessThanOrEqual(6);
    expect(ones).toBeGreaterThanOrEqual(1);
    expect(ones).toBeLessThanOrEqual(6);
  });

  it('is deterministic with same seed', () => {
    expect(autoRoll('1d6', createRNG(42))).toBe(autoRoll('1d6', createRNG(42)));
    expect(autoRoll('2d6', createRNG(42))).toBe(autoRoll('2d6', createRNG(42)));
    expect(autoRoll('d6d6', createRNG(42))).toBe(autoRoll('d6d6', createRNG(42)));
  });
});
