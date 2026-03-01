/**
 * Barrel export for all extracted generator modules.
 */

export type { GeneratorContext } from './generator-context.js';
export { yieldCombatRoll, createPendingRoll } from './yield-helpers.js';
export {
  resolveCompartmentHitGen, resolveFireExtinguisher,
  matchSubRollOutcome, resolveSubRollWound, applySubRollEffect,
  resolveGenericSubRoll,
} from './damage-generators.js';
export {
  combatView, playerRemoveFighters, resolveGunFire, resolveCombatRounds,
} from './combat-generators.js';
export { executeBombRun, FLAK_AREA_DAMAGE_TABLE } from './bomb-run-generator.js';
export { executeBailout } from './bailout-generator.js';
export { executeMission } from './mission-generator.js';
