/**
 * Seedable PRNG module — generic, used by all games.
 * Uses xoshiro128** for deterministic, high-quality randomness.
 */

export interface RNG {
  /** Raw float in [0, 1) */
  next(): number;
  /** Integer in [min, max] inclusive */
  int(min: number, max: number): number;
  /** Roll NdM and sum */
  roll(count: number, sides: number): number;
  /** Roll 1d6 */
  d6(): number;
  /** Roll 2d6 (sum) */
  twod6(): number;
  /** Roll d6d6 — two dice concatenated as tens+units (11–66) */
  d6d6(): number;
  /** Percentile roll 1–100 */
  percentile(): number;
  /** Current seed state (for snapshot/restore) */
  getState(): RNGState;
  /** Restore from state */
  setState(state: RNGState): void;
}

export type RNGState = [number, number, number, number];

function splitmix32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x9e3779b9) | 0;
    let t = seed ^ (seed >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t = t ^ (t >>> 15);
    t = Math.imul(t, 0x735a2d97);
    t = t ^ (t >>> 15);
    return (t >>> 0);
  };
}

function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}

export function createRNG(seed: number | string = Date.now()): RNG {
  const numericSeed = typeof seed === 'string'
    ? [...seed].reduce((h, c) => (Math.imul(31, h) + c.charCodeAt(0)) | 0, 0)
    : seed;

  const sm = splitmix32(numericSeed);
  const state: RNGState = [sm(), sm(), sm(), sm()];

  function nextU32(): number {
    const result = (rotl(Math.imul(state[1], 5), 7) * 9) >>> 0;
    const t = (state[1] << 9) >>> 0;
    state[2] ^= state[0];
    state[3] ^= state[1];
    state[1] ^= state[2];
    state[0] ^= state[3];
    state[2] ^= t;
    state[3] = rotl(state[3], 11);
    return result;
  }

  const rng: RNG = {
    next() {
      return nextU32() / 0x100000000;
    },
    int(min, max) {
      return min + (nextU32() % (max - min + 1));
    },
    roll(count, sides) {
      let sum = 0;
      for (let i = 0; i < count; i++) sum += rng.int(1, sides);
      return sum;
    },
    d6() { return rng.int(1, 6); },
    twod6() { return rng.roll(2, 6); },
    d6d6() { return rng.d6() * 10 + rng.d6(); },
    percentile() { return rng.int(1, 100); },
    getState() { return [...state] as RNGState; },
    setState(s) { state[0] = s[0]; state[1] = s[1]; state[2] = s[2]; state[3] = s[3]; },
  };

  return rng;
}
