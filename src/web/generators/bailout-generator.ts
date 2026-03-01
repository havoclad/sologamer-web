/**
 * Bailout generator — handles crew bailout sequences (G-6/G-7).
 *
 * Per Tables G-6 (controlled) / G-7 (uncontrolled):
 *   - Seriously wounded → cannot bail out, KIA
 *   - Otherwise → player rolls 1d6 per crewman
 *   - Light wound modifier: -1 (errata: applies to both G-6 and G-7)
 *   - Natural 6 always succeeds even with modifier
 *
 * Post-bailout fate per G-6/G-7 notes + G-11 terrain:
 *   - Germany/Netherlands → automatically captured (POW)
 *   - France/Belgium → roll 1d6: 1-5 captured, 6 returned to England
 *   - Water → roll on G-8: 1-4 drowned, 5-6 rescued (radio out → all die)
 *
 * After all crew resolved: summary, mark aircraft destroyed, check campaign end.
 */

import { getZoneInfo } from '../../games/b17/rules/mission-setup.js';
import { POSITION_LABELS } from '../../games/b17/rules/crew.js';
import type { MissionYield } from '../types.js';
import type { GeneratorContext } from './generator-context.js';
import { yieldCombatRoll } from './yield-helpers.js';

export function* executeBailout(
  ctx: GeneratorContext,
  controlled: boolean,
): Generator<MissionYield, void, number | number[] | undefined> {
  const mission = ctx.state.mission!;
  const zone = mission.zone;
  const direction = mission.direction;
  const crew = ctx.state.campaign.crew;
  const ac = ctx.state.campaign.aircraft;
  const tableId = controlled ? 'G-6' : 'G-7';
  const tableTitle = controlled ? 'Controlled Bailout' : 'Bailout from Uncontrolled Plane';

  // Determine terrain from G-11
  const zoneInfo = getZoneInfo(mission.target, zone, ctx.tables);
  const terrains: string[] = zoneInfo?.over ?? ['unknown'];
  // Pick primary terrain (first non-water if mixed, e.g. "water, France" for Cherbourg zone 3)
  // For bailout, if there are multiple terrains, use the land one (crew bailing over land)
  // But if only water, use water
  const terrain = terrains.length === 1 ? terrains[0].toLowerCase()
    : (terrains.find(t => t.toLowerCase() !== 'water') ?? terrains[0]).toLowerCase();

  ctx.emit('DAMAGE', `${controlled ? 'Controlled' : 'Uncontrolled'} bailout! Zone ${zone} — over ${terrains.join(', ')}`,
    'damage', 'critical', zone, direction, undefined, true);

  let kiaCount = 0;
  let capturedCount = 0;
  let returnedCount = 0;
  let drownedCount = 0;

  // G-6 table rows for display
  const bailoutRows = controlled
    ? [
        { roll: '1', columns: { result: 'Roll 1D: 1-5 OK, 6 KIA in accident' } },
        { roll: '2-6', columns: { result: 'Bailout OK' } },
      ]
    : [
        { roll: '1-5', columns: { result: 'No bailout — goes down with plane' } },
        { roll: '6', columns: { result: 'Bailout OK' } },
      ];

  for (const member of crew) {
    const label = `${member.name} (${POSITION_LABELS[member.position]})`;

    // Already KIA — skip
    if (member.woundSeverity === 'kia' || member.status === 'kia') {
      continue;
    }

    // Seriously wounded → cannot bail out, goes down with plane
    if (member.woundSeverity === 'serious') {
      member.status = 'kia';
      member.woundSeverity = 'kia';
      kiaCount++;
      ctx.emit('DAMAGE', `${label}: Seriously wounded — cannot bail out. KIA.`,
        'damage', 'critical', zone, direction, undefined, true);
      continue;
    }

    // Roll for bailout
    const modifier = member.woundSeverity === 'light' ? -1 : 0;
    const modText = modifier !== 0 ? ` (light wound: ${modifier})` : '';
    const rollValue: number = yield* yieldCombatRoll(
      ctx,
      tableId, tableTitle,
      `Bailout roll for ${label}${modText}`, '1d6',
      bailoutRows, modifier, modifier !== 0 ? 'Light wound -1' : undefined,
    );

    // Determine if bailed out
    let bailedOut: boolean;
    if (controlled) {
      // G-6: Roll 1 → sub-roll (but we simplify: 1 with modifier applied)
      // Actually per G-6: raw 1 needs sub-roll 1-5 OK, 6 KIA
      // But with modifier, effective roll matters
      // Natural 6 always OK
      if (rollValue === 6) {
        bailedOut = true;
      } else {
        const effective = rollValue + modifier;
        if (effective <= 1) {
          // Per G-6 roll "1": sub-roll needed. Roll again.
          const subRoll: number = yield* yieldCombatRoll(
            ctx,
            'G-6', 'Bailout Accident Check',
            `${label} stumbled — roll for accident (1-5 OK, 6 KIA)`, '1d6',
            [
              { roll: '1-5', columns: { result: 'Bailout OK' } },
              { roll: '6', columns: { result: 'Crewman killed in accident' } },
            ],
          );
          bailedOut = subRoll <= 5;
        } else {
          bailedOut = true; // effective 2+ = OK
        }
      }
    } else {
      // G-7: 1-5 = KIA, 6 = OK. Natural 6 always OK.
      if (rollValue === 6) {
        bailedOut = true;
      } else {
        const effective = rollValue + modifier;
        bailedOut = effective >= 6;
      }
    }

    if (!bailedOut) {
      member.status = 'kia';
      member.woundSeverity = 'kia';
      kiaCount++;
      ctx.emit('DAMAGE', `${label}: Failed to bail out — KIA.`,
        'damage', 'critical', zone, direction,
        [{ table: tableId, rollType: '1d6', rolled: rollValue, result: 'KIA' }], true);
      continue;
    }

    // Successful bailout — determine fate by terrain
    if (terrain === 'germany' || terrain === 'netherlands') {
      member.status = 'pow';
      capturedCount++;
      ctx.emit('DAMAGE', `${label}: Bailed out over ${terrain} — captured (POW).`,
        'damage', 'bad', zone, direction,
        [{ table: tableId, rollType: '1d6', rolled: rollValue, result: 'Bailout OK → POW' }], true);
    } else if (terrain === 'france' || terrain === 'belgium') {
      // Roll for evasion
      const evadeRoll: number = yield* yieldCombatRoll(
        ctx,
        tableId, 'Evasion Roll',
        `${label} landed in ${terrain} — roll for evasion (6 = returns to England)`, '1d6',
        [
          { roll: '1-5', columns: { result: 'Captured' } },
          { roll: '6', columns: { result: 'Returned to England by Underground' } },
        ],
      );
      if (evadeRoll >= 6) {
        member.status = 'evaded';
        returnedCount++;
        ctx.emit('DAMAGE', `${label}: Evaded capture! Returned to England by the Underground.`,
          'damage', 'good', zone, direction,
          [{ table: tableId, rollType: '1d6', rolled: evadeRoll, result: 'Evaded' }], true);
      } else {
        member.status = 'pow';
        capturedCount++;
        ctx.emit('DAMAGE', `${label}: Captured in ${terrain} (POW).`,
          'damage', 'bad', zone, direction,
          [{ table: tableId, rollType: '1d6', rolled: evadeRoll, result: 'Captured' }], true);
      }
    } else if (terrain === 'water') {
      // G-8: radio out → all die
      if (ac.radioOut) {
        member.status = 'kia';
        drownedCount++;
        kiaCount++;
        ctx.emit('DAMAGE', `${label}: Bailed out over water — radio not operating, drowned.`,
          'damage', 'critical', zone, direction, undefined, true);
      } else {
        const waterRoll: number = yield* yieldCombatRoll(
          ctx,
          'G-8', 'Bailout Over Water',
          `${label} bailed out over water — roll for rescue (5-6 = rescued)`, '1d6',
          [
            { roll: '1-4', columns: { result: 'Drowned' } },
            { roll: '5-6', columns: { result: 'Rescued' } },
          ],
        );
        if (waterRoll >= 5) {
          // Per §16.4 / G-10 notes: zones 6-7 rescued → captured
          if (zone >= 6) {
            member.status = 'pow';
            capturedCount++;
            ctx.emit('DAMAGE', `${label}: Rescued from water — but captured (zone ${zone}).`,
              'damage', 'bad', zone, direction,
              [{ table: 'G-8', rollType: '1d6', rolled: waterRoll, result: 'Rescued → POW' }], true);
          } else {
            member.status = 'evaded';
            returnedCount++;
            ctx.emit('DAMAGE', `${label}: Rescued from water — returned to England!`,
              'damage', 'good', zone, direction,
              [{ table: 'G-8', rollType: '1d6', rolled: waterRoll, result: 'Rescued' }], true);
          }
        } else {
          member.status = 'kia';
          member.woundSeverity = 'kia';
          drownedCount++;
          kiaCount++;
          ctx.emit('DAMAGE', `${label}: Drowned after bailing out over water.`,
            'damage', 'critical', zone, direction,
            [{ table: 'G-8', rollType: '1d6', rolled: waterRoll, result: 'Drowned' }], true);
        }
      }
    } else {
      // Unknown terrain — treat as England (safe)
      member.status = 'evaded';
      returnedCount++;
      ctx.emit('DAMAGE', `${label}: Bailed out safely.`,
        'damage', 'good', zone, direction, undefined, true);
    }
  }

  // ── Summary ──
  const summaryParts: string[] = [];
  if (kiaCount > 0) summaryParts.push(`${kiaCount} KIA`);
  if (drownedCount > 0) summaryParts.push(`${drownedCount} drowned`);
  if (capturedCount > 0) summaryParts.push(`${capturedCount} captured`);
  if (returnedCount > 0) summaryParts.push(`${returnedCount} returned to England`);
  ctx.emit('DAMAGE', `Bailout complete: ${summaryParts.join(', ')}`,
    'damage', returnedCount > 0 ? 'warn' : 'critical', zone, direction, undefined, true);

  // Mark aircraft destroyed
  for (let i = 0; i < 4; i++) ac.engines[i as 0|1|2|3] = 'out';

  // Campaign end check
  const anyReturned = returnedCount > 0;
  if (!anyReturned) {
    ctx.emit('DAMAGE', 'All crewmen KIA or captured — campaign ended.',
      'damage', 'critical', zone, direction, undefined, true);
  } else {
    ctx.emit('DAMAGE', `${returnedCount} crewmen returned to England. Campaign may continue with a new plane and replacement crew.`,
      'damage', 'warn', zone, direction, undefined, true);
  }

  // Mark mission as aborted (it's over)
  mission.aborted = true;
}
