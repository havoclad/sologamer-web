/**
 * Crew name generation — WWII-era American first and last names.
 */

import type { RNG } from '../../../engine/rng.js';

export const FIRST_NAMES = [
  'James', 'Robert', 'John', 'William', 'Richard', 'Thomas', 'Charles', 'Donald',
  'George', 'Kenneth', 'Edward', 'Frank', 'Raymond', 'Harold', 'Paul', 'Jack',
  'Henry', 'Arthur', 'Ralph', 'Albert', 'Eugene', 'Howard', 'Carl', 'Walter',
  'Joseph', 'Lawrence', 'Earl', 'Roy', 'Leonard', 'Norman', 'Gerald', 'Herbert',
];

export const LAST_NAMES = [
  'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Miller', 'Davis', 'Wilson',
  'Anderson', 'Taylor', 'Thomas', 'Moore', 'Martin', 'Jackson', 'Thompson', 'White',
  'Harris', 'Clark', 'Lewis', 'Robinson', 'Walker', 'Young', 'Allen', 'King',
  'Wright', 'Scott', 'Green', 'Baker', 'Adams', 'Nelson', 'Hill', 'Campbell',
  'Mitchell', 'Roberts', 'Carter', 'Phillips', 'Evans', 'Turner', 'Torres', 'Parker',
];

export function generateCrewName(rng: RNG): string {
  return `${FIRST_NAMES[rng.int(0, FIRST_NAMES.length - 1)]} ${LAST_NAMES[rng.int(0, LAST_NAMES.length - 1)]}`;
}
