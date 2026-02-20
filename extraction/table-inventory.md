# B-17: Queen of the Skies — Table Inventory

## Legend

- ✅ = Have complete data
- ⚠️ = Have but with issues (obscured cells, needs verification)
- ❌ = Missing entirely
- **Visual** = From PDF visual extraction (pages 19-39)
- **Perl** = From Pat's SoloGamer JSON data files
- **Rules** = From rules text extraction (embedded in rules text)

---

## Map Card Tables (M-series)

| Table | Name | Visual | Perl | Notes |
|-------|------|--------|------|-------|
| M-1 | B-17 Defensive Fire | ⚠️ | ⚠️ | Visual has many [obscured] cells. Perl JSON is **simplified** — uses single hit number per position, doesn't distinguish FW190/ME110/ME109 hit numbers (original table has different columns per fighter type). **GAP: Need complete M-1 with per-fighter-type hit numbers.** |
| M-2 | Hit Damage Against German Fighter | ⚠️ | ✅ | Visual has rolls 1-2 and 5-6 obscured. Perl JSON has full data. |
| M-3 | German Offensive Fire | ✅ | ✅ | Both sources agree. |
| M-4 | Fighter Cover Defense | ⚠️ | ✅ | Visual has roll of 6 obscured. Perl JSON has full data. |
| M-5 | B-17 Area Spray Fire | ⚠️ | ✅ | Visual has roll 6 obscured. Perl JSON has full data. |
| M-6 | Fighter Pilot Status | ⚠️ | ✅ | Visual has rolls 2-3 and 11-12 obscured. Perl JSON has full data. |

## Buff Card Tables (B-series)

| Table | Name | Visual | Perl | Notes |
|-------|------|--------|------|-------|
| B-1 | Number of German Fighter Waves (Non-Target) | ✅ | ✅ | Both agree. |
| B-2 | Number of German Fighter Waves (Target) | ✅ | ✅ | Both agree. |
| B-3 | Attacking Fighter Waves | ✅ | ✅ | Both agree. Full d6d6 table (36 entries). |
| B-4 | Shell Hits By Area | ✅ | ✅ | Both agree. 5-column table (attack direction × roll). |
| B-5 | Area Damage Tables | ✅ | ✅ | Visual extraction is complete (all 14 sub-tables). Perl JSON exists. Verify sub-table agreement. |
| B-6 | Successive Attacks | ✅ | ✅ | Both agree. |
| B-7 | Random Events | ✅ | ✅ | Both agree. Also in rules text §18.0. |

## Blue Card Tables (BL-series)

| Table | Name | Visual | Perl | Notes |
|-------|------|--------|------|-------|
| BL-1 | Wings | ✅ | ✅ | Both have full data with sub-rolls and notes. |
| BL-2 | Instruments | ✅ | ✅ | Both agree. |
| BL-3 | Hand Held Extinguishers | ✅ | ✅ | Both agree. Note errata: rules say 5 extinguishers, table card says 3. |
| BL-4 | Wounds | ✅ | ✅ | Both agree. |
| BL-5 | Frostbite | ✅ | ✅ | Both agree. |

## Green Card Tables (G-series)

| Table | Name | Visual | Perl | Notes |
|-------|------|--------|------|-------|
| G-1 | Missions 1-5 Targets | ✅ | ✅ | Both agree. |
| G-2 | Missions 6-10 Targets | ✅ | ✅ | Both agree. |
| G-3 | Missions 11-25 Targets | ✅ | ✅ | Both agree. d6d6 table. |
| G-4 | B-17 Formation Position | ✅ | ✅ | Both agree. Perl has G-4 and G-4a (split into two files). |
| G-5 | Fighter Cover | ✅ | ✅ | Both agree. |
| G-6 | Controlled Bailout | ✅ | ✅ | Both agree. |
| G-7 | Bailout From Uncontrolled Plane | ✅ | ✅ | Both agree. |
| G-8 | Bailout Over Water | ✅ | ✅ | Both agree. |
| G-9 | Landing on Land | ✅ | ✅ | Both agree. |
| G-10 | Landing in Water | ✅ | ✅ | Both agree. |
| G-11 | Flight Log Gazetteer | ✅ | ✅ | Both agree. 22 target cities × zones. |

## Orange Card Tables (O-series)

| Table | Name | Visual | Perl | Notes |
|-------|------|--------|------|-------|
| O-1 | Weather | ✅ | ✅ | Both agree. |
| O-2 | Flak Over Target | ✅ | ✅ | Both agree. |
| O-3 | Flak To Hit B-17 | ✅ | ✅ | Both agree. |
| O-4 | Effect of Flak Hits | ✅ | ✅ | Both agree. |
| O-5 | Area Affected by Flak Hits | ✅ | ✅ | Both agree. Errata #36 applied. |
| O-6 | Bomb Run | ✅ | ✅ | Both agree. |
| O-7 | Bombing Accuracy | ✅ | ✅ | Both agree. |

## Pink Card Tables (P-series)

| Table | Name | Visual | Perl | Notes |
|-------|------|--------|------|-------|
| P-1 | Nose | ❌ | ✅ | Not in visual extraction. Perl JSON complete. Verify against rules text references. |
| P-2 | Pilot Compartment | ❌ | ✅ | Not in visual extraction. Perl JSON complete. |
| P-3 | Bomb Bay | ❌ | ✅ | Not in visual extraction. Perl JSON complete. Errata #3 applies. |
| P-4 | Radio Room | ❌ | ✅ | Not in visual extraction. Perl JSON complete. |
| P-5 | Waist | ✅ | ✅ | Visual extraction complete (from pages 30-39). Perl JSON complete. |
| P-6 | Tail Section | ✅ | ✅ | Visual extraction complete (from pages 30-39). Perl JSON complete. |

---

## Summary

| Category | Total Tables | Complete (Both) | Perl Only | Visual Only | Gaps |
|----------|-------------|-----------------|-----------|-------------|------|
| M-series | 6 | 1 (M-3) | 4 (M-2,4,5,6) | 0 | 1 (M-1 per-fighter detail) |
| B-series | 7 | 7 | 0 | 0 | 0 |
| BL-series | 5 | 5 | 0 | 0 | 0 |
| G-series | 11 | 11 | 0 | 0 | 0 |
| O-series | 7 | 7 | 0 | 0 | 0 |
| P-series | 6 | 2 | 4 (P-1,2,3,4) | 0 | 0 |
| **Total** | **42** | **33** | **8** | **0** | **1** |

## Critical Gaps

### 1. M-1 B-17 Defensive Fire — Per-Fighter-Type Hit Numbers
The original board game table M-1 has **three columns** for hit numbers: FW190, ME110, ME109. The visual extraction captured this structure but many cells are [obscured]. Pat's Perl JSON simplified this to a **single hit number per position**, losing the per-fighter-type differentiation.

**What the visual extraction shows:** For most positions the hit number is the same across all three fighter types (e.g., 6 for all). But for broadside attacks (3/9 High, 9 Level), the ME110 column shows different (easier) hit numbers — e.g., 4,5,6 for Top & Ball Turrets vs. ME110 at 3 High, vs. [obscured] for FW190 and ME109.

**Resolution needed:** Either find a cleaner scan of the Map card, or cross-reference with the VB6 emulator database, or accept Pat's simplification (which may reflect errata or common house rules).

### 2. P-1 through P-4 — No Visual Extraction
These four Pink card tables were not included in the visual extraction (pages 30-39 focused on Buff, Blue, Green, Orange cards). The Perl JSON data covers them completely. Should be verified against any available secondary source.

### 3. Fire Extinguisher Count Discrepancy
Rules §12.2 says 5 portable fire extinguishers. Table BL-3 card text says 3. Errata #2 says "only five should be in play" (referring to the 6 counters provided). **Resolution: 5 is correct.**

## Errata Integration Status

The 37-item errata list (from visual extraction pages 30-39) needs to be applied across all table data. Key errata affecting table values:
- #3: P-3 roll 4 = Rubber Rafts (landing in water -6)
- #6: G-3 Brest and St. Nazaire get asterisk (+1 flak)
- #10: B-5 6 High roll 11 should be Walking Hits type (a)
- #25: Vegesack is U-Boat target (+1 on O-2)
- #36: O-5 rolls 6, 8, 11 refer to BL-1 Wings, not BL-4
