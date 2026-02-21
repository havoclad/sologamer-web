# B-17 Queen of the Skies — Full Table Audit Report
**Date:** 2026-02-21
**Source:** High-quality phone scans of game cards

## Summary
Audited all tables on scanned cards (P-1 through P-6, B-1 through B-7, BL-1 through BL-5, O-1 through O-7, G-1 through G-11) against JSON files in both `src/games/b17/data/` and `reference/SoloGamer/games/QotS/data/`.

## Discrepancies Found and Fixed

### P-1 NOSE COMPARTMENT — **COMPLETELY REWRITTEN**
Every single die roll result was wrong. The old JSON had completely fabricated results that didn't match the game card at all:
- Roll 2: Was "Starboard Cheek Gun" → Fixed to "Norden Sight" (bomb run off target)
- Roll 3: Was "Bomb Controls" → Fixed to "Armament" (sub-roll for nose/port cheek/starboard cheek gun)
- Roll 4: Was "Bomb Release" → Fixed to "Bombardier and Navigator" (wound roll for each)
- Roll 5: Was "Nose Gun" → Fixed to "Navigator" (wound roll)
- Roll 6: Was correct (Bombardier) but details wrong
- Rolls 7-9: Was only 7=Superficial, 8=Nose Gun, 9=Navigator → Fixed to 7-9 all Superficial
- Roll 10: Sub-roll ranges wrong (was 4-6=bomb run; fixed to 1-3=nav equip, 4-6=bomb controls)
- Roll 11: Was "Windshield" → Fixed to "Compartment Heat Out" (sub-roll)
- Roll 12: Was "Port Cheek Gun" → Fixed to "Oxygen Supply Hit" (sub-roll)

### P-2 PILOT COMPARTMENT — **COMPLETELY REWRITTEN**
Every die roll result was wrong:
- Roll 2: Was "Instruments" → Fixed to "Compartment Heat" (pilot/co-pilot heat out)
- Roll 3: Was "Top Turret" → Fixed to "Pilot and Co-Pilot" (wound roll for each)
- Roll 4: Was "Engineer" → Fixed to "Pilot" (wound roll)
- Roll 5: Correct (Co-Pilot)
- Rolls 6-7: Correct (Superficial)
- Roll 8: Was "Pilot" → Fixed to "Top Turret" (sub-roll: 1-2 guns out, 3-5 engineer wound, 6 both)
- Roll 9: Was "Intercom" → Fixed to "Instruments" (go to BL-2)
- Roll 10: Was simple "Oxygen System" → Fixed to "Oxygen Supply" (detailed sub-roll by crew member)
- Roll 11: Was "Windshield" → Fixed to "Window Heat Out" (cumulative)
- Roll 12: Was complex sub-roll → Fixed to "Control Cables" (cumulative, 2nd hit effect)

### P-3 BOMB BAY — **COMPLETELY REWRITTEN**
Every die roll result was wrong:
- Roll 2: Was "Bomb Detonation" → Fixed to "Bomb Release Mechanism" (bomb run -3)
- Roll 3: Was sub-roll 1-5/6 → Fixed to sub-roll 1-4/5-6 for bomb detonation
- Roll 4: Was "Rubber Rafts -6" → Fixed to "Rubber Rafts -2"
- Roll 5: Was "Superficial" → Fixed to "Bomb Bay Doors" (sub-roll 1-2 inop, 3-6 no effect)
- Rolls 6-8: Fixed to all Superficial
- Roll 9: Was "Bomb Controls" → Fixed to "Bombs" (see roll 3)
- Roll 10: Was "Bomb Sight" → Fixed to "Bomb Bay Doors" (see roll 5)
- Roll 11: Was "Ball Turret" → Fixed to "Bombs" (see roll 3)
- Roll 12: Was "Ball Turret Mechanism" → Fixed to "Control Cables" (see P-2:12)

### P-4 RADIO ROOM — **COMPLETELY REWRITTEN**
Every die roll result was wrong:
- Roll 2: Was "Radio Equipment" → Fixed to "Compartment Heat"
- Roll 3: Was "Radio Room Gun" → Fixed to "Intercom System Out" (see BL-2:4)
- Rolls 4-5: Was "Superficial" → Fixed to "Radio Out" (no Mayday, G-10 -6 if out of formation)
- Roll 6: Correct (Radio Operator wound)
- Rolls 7-10: Was mixed results → Fixed to all Superficial
- Roll 11: Was "Suit Heater" → Fixed to "Oxygen Supply Hit" (sub-roll: 1-5 oxygen hit, 6 fire)
- Roll 12: Was "Ball Turret Power" → Fixed to "Control Cables" (see P-2:12)

### B-3 ATTACKING FIGHTER WAVES
- Roll 23: Fighter type was FW190 → Fixed to Me109 (three 109's, not 190's)
- Roll 35: Fighter type was FW190 → Fixed to Me109 (two 109's, not 190's)

### B-4 SHELL HITS BY AREA — **EXTENSIVELY CORRECTED**
Almost every value in every column was wrong:
- **12/1:30/10:30 column**: 18 out of 22 values corrected (was scrambled/random values)
- **3/9 column**: All 11 values corrected
- **6 column**: Rolls 2 (5→6) and 11 (1→5) corrected
- **Vertical Dive**: Rolls 3 (4→2) and 11 (1→2) corrected
- **Vertical Climb**: Rolls 7 (2→1) and 11 (3→4) corrected

### B-5 AREA DAMAGE TABLES
- 3/9 Low, Roll 12: Walking hits type was "c" → Fixed to "a" (fuselage hits, not just wing-side)

### O-7 BOMBING ACCURACY
- On Target Roll 12: Was "75" → Fixed to "88+2D" (was incorrectly grouped with roll 2)

### G-6 CONTROLLED BAILOUT
- Roll 1: Was automatic "Crewman killed in accident" → Fixed to sub-roll (1D: 1-5 = Bailout OK, 6 = KIA)

### G-10 LANDING IN WATER
- Note g: Was "If landing with the radio out, landing roll is -6" → Fixed to "If landing in water with the radio out and out of formation, landing roll is -6"

### G-11 FLIGHT LOG GAZETTEER
- **Rouen**: Was 3 zones (all -2/W) → Fixed to 4 zones matching scan and errata #22:
  - Zone 2: -2/W, Zone 3: -1/W, Zone 4: 0/F, Zone 5: 0/F

## Tables Verified Correct (No Changes Needed)
- P-5 WAIST ✓
- P-6 TAIL SECTION ✓
- B-1 FIGHTER WAVES (NON-TARGET) ✓
- B-2 FIGHTER WAVES (TARGET) ✓
- B-6 SUCCESSIVE ATTACKS ✓
- B-7 RANDOM EVENTS ✓
- BL-1 WINGS ✓
- BL-2 INSTRUMENTS ✓
- BL-3 HAND HELD EXTINGUISHERS ✓
- BL-4 WOUNDS ✓
- BL-5 FROSTBITE ✓
- O-1 WEATHER ✓
- O-2 FLAK OVER TARGET ✓
- O-3 FLAK TO HIT B-17 ✓
- O-4 EFFECT OF FLAK HITS ✓
- O-5 AREA AFFECTED BY FLAK HITS ✓
- O-6 BOMB RUN ✓
- G-1 MISSIONS 1-5 ✓
- G-2 MISSIONS 6-10 ✓
- G-3 MISSIONS 11-25 ✓
- G-4 FORMATION POSITION ✓
- G-5 FIGHTER COVER ✓
- G-7 BAILOUT FROM UNCONTROLLED PLANE ✓
- G-8 BAILOUT OVER WATER ✓
- G-9 LANDING ON LAND ✓

## Tables Not Audited (No Scans Available)
- M-1 through M-6 (no card scans provided for these tables)

## Errata Applied
All errata from Scan 5 (official errata sheet) have been cross-referenced. Key errata already reflected:
- #10: B-5 6 O'Clock High roll 11 = Walking Hits type (a) ✓
- #22: Rouen in Zone 4 (fixed in G-11) ✓
- #36: O-5 rolls 6, 8, 11 refer to BL-1 (text note, doesn't affect numeric JSON values)

## Both Repos Updated
All fixes applied to both:
- `src/games/b17/data/` (sologamer-web)
- `reference/SoloGamer/games/QotS/data/` (SoloGamer Perl)
