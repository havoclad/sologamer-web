# Analysis of Pat's SoloGamer Perl Implementation

## Overview

The SoloGamer project is a **fully complete** Perl-based automation engine for B-17 Queen of the Skies. All 46 base game tables from the original board game rulebook are implemented. The architecture is data-driven, with game logic defined in JSON files and a Perl engine that interprets them.

**Repo:** https://github.com/havoclad/SoloGamer  
**Cloned to:** `/Users/clawbot/.openclaw/workspace/b17-queen/reference/SoloGamer`

---

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Language | Perl 5.42 |
| OOP Framework | Moose (with namespace::autoclean) |
| JSON | Mojo::JSON |
| Singleton | MooseX::Singleton (SaveGame) |
| File I/O | File::Slurp |
| User Input | IO::Prompter |
| Packaging | Docker |
| Type System | Moose type constraints + custom TypeLibrary |
| Output | Custom Formatter with ANSI color schemes |

---

## Architecture

### Core Design Pattern: Table-Driven Engine

The fundamental insight is that QotS is essentially a **state machine driven by table lookups**. The architecture separates:

1. **Game Data** (JSON files in `games/QotS/data/`) — the "what"
2. **Engine** (Perl modules in `perl/SoloGamer/`) — the "how"
3. **Game-Specific Logic** (Perl modules in `perl/SoloGamer/QotS/`) — game overrides

### Class Hierarchy

```
SoloGamer::Base (verbose/debug logging)
├── SoloGamer::Table (base table: data, file, name, title)
│   ├── SoloGamer::RollTable (dice rolling, modifiers, roll ranges)
│   │   └── SoloGamer::OnlyIfRollTable (conditional: skip if condition not met)
│   └── SoloGamer::FlowTable (ordered sequence of steps)
├── SoloGamer::Game (game runner, flow execution, roll orchestration)
│   └── SoloGamer::QotS::Game (QotS-specific: combat, damage, missions)
├── SoloGamer::SaveGame (singleton, JSON persistence, mission state)
└── SoloGamer::TableFactory (JSON → Table object creator)

SoloGamer::QotS::* (game-specific domain objects)
├── AircraftState (engines, guns, fuel, structural, oxygen, heating)
├── CombatState (waves, fighters, defensive fire queue, ace tracking)
├── Crew (10-member roster, replacement, wound healing)
├── CrewMember (name, position, wounds, frostbite, kills, disposition)
├── CrewNamer (random 1940s name generation from text files)
├── PlaneNamer (B-17 name selection from historical list)
└── DamageResolver (structured damage effect application)
```

### Key Patterns

#### 1. TableFactory Pattern
JSON files are loaded by `TableFactory::new_table()` which inspects `table_type` to instantiate the right class:
- `"Flow"` → `FlowTable`
- `"roll"` → `RollTable`  
- `"onlyif"` → `OnlyIfRollTable`

#### 2. Flow Execution (`do_flow`)
FlowTables contain an ordered array of steps. Each step has a `type` that dispatches to a handler:
- `table` → roll on a named table, store result
- `choosemax` → select sub-table based on mission number ranges
- `loop` → iterate through zones (outbound/inbound flight path)
- `flow` → nest into another flow table
- `process_wounds` → special post-landing wound resolution

#### 3. Die Rolling & Table Lookup (`RollTable::roll`)
The roll system is sophisticated:
- **Dice specs**: Supports `NdM` (sum) and `dNdM` (concatenated, e.g. `d6d6` → "35")
- **Roll ranges**: JSON keys like `"3-11"` or `"2,3"` are expanded into individual entries at load time
- **Modifiers**: Tables accumulate modifiers from other table results (with scope: global/zone)
- **Clamping**: Results are clamped to `[min_roll, max_roll]` so you can't fall off the table
- **Conditional modifiers**: `roll_modifier` with condition evaluation (e.g., `$target in [list]`)
- **Multi-roll**: `table_count` > 1 rolls multiple times, aggregated by `group_by` (sum or join)
- **Table input**: Some tables use a lookup variable (two-dimensional lookup: roll × input)
- **Table skip**: Skip the entire table if a condition matches
- **Stack control**: Modifiers can be non-stacking (duplicate prevention)

#### 4. Variable/State System
Game state flows through `SaveGame` (a singleton):
- Mission data stored as an array of hashes (`save.mission[n]`)
- `add_save(key, value)` writes to current mission
- `get_from_current_mission(key)` reads from current mission
- Results from one table feed as modifiers/inputs to later tables via `notes` arrays in JSON

#### 5. Modifier Propagation
When a table roll produces a result with `notes`, those notes can add modifiers to other tables:
```json
"notes": [{"table": "O-2", "modifier": 1, "why": "Increased flak", "scope": "global", "stack": 1}]
```
This is how the game chains effects — e.g., target selection affects flak intensity.

---

## What's Implemented (Complete)

### All 46 Base Game Tables

| Category | Tables | Description |
|----------|--------|-------------|
| **Flow** | FLOW-start, FLOW-target-zone, FLOW-landing, FLOW-fighter-attack, FLOW-fighter-combat, FLOW-successive-attacks, FLOW-zone-movement, FLOW-damage-resolution | Mission sequencing |
| **G-series** (12) | G-1 through G-11 | Mission selection, formation, crew status, bailout, landing, gazetteer |
| **O-series** (7) | O-1 through O-7 | Weather, flak, bombing accuracy |
| **B-series** (7) | B-1 through B-7 | Fighter waves, composition, shell hits, damage areas, successive attacks, random events |
| **M-series** (6) | M-1 through M-6 | Defensive fire, fighter damage, German offensive fire, fighter cover, spray fire, pilot status |
| **P-series** (6) | P-1 through P-6 | Compartment damage (nose, pilot, bomb bay, radio, waist, tail) |
| **BL-series** (5) | BL-1 through BL-5 | Wings, instruments, fire extinguishers, wounds, frostbite |

### Game Systems Implemented
- ✅ Full 25-mission campaign flow
- ✅ Target selection by mission number (3 era-based tables)
- ✅ Formation and squadron positioning
- ✅ Zone-by-zone flight (outbound + inbound via G-11 gazetteer)
- ✅ Fighter encounter waves per zone
- ✅ Fighter composition and attack positions
- ✅ B-17 defensive fire (gun positions vs attack positions)
- ✅ Fighter damage results (FCA/FBOA/Destroyed)
- ✅ German offensive fire
- ✅ Successive attacks (up to 3 per fighter)
- ✅ Fighter cover/escort
- ✅ Flak over target (with target-specific modifiers)
- ✅ Bomb run and accuracy
- ✅ Complete damage resolution (all 6 compartments + wings)
- ✅ Crew wounds (light/serious/mortal → KIA)
- ✅ Frostbite
- ✅ Engine damage (fire, runaway, oil, supercharger)
- ✅ Gun damage (jam, destroy)
- ✅ Fuel system damage (leak, fire, explosion, self-sealing)
- ✅ Control surface damage
- ✅ Oxygen and heating systems
- ✅ Bailout procedures (controlled, uncontrolled, over water)
- ✅ Landing (normal, water ditching)
- ✅ Crew replacement between missions
- ✅ Light wound healing between missions
- ✅ Serious wound survival rolls (post-landing)
- ✅ Kill tracking and ace status (5+ kills)
- ✅ Mission record display (composite table)
- ✅ Save/load game (JSON persistence)
- ✅ Plane and crew naming (1940s-era name lists)
- ✅ Automated and interactive modes

---

## What's NOT Implemented (Optional Enhancements)

These are ideas from the codebase docs, **not** in the original board game:
- Crew experience progression (Green/Seasoned/Veteran)
- Historical scenario missions
- Navigation uncertainty/errors
- Detailed fuel consumption
- Between-mission repair decisions
- Late war period (1944-45)
- Alternative bomber types (B-24)
- Multi-plane formations
- Achievement system

---

## Lessons Learned & Design Insights

### What Works Well

1. **Data-driven tables in JSON** — Clean separation. Adding a new table = adding a JSON file. No code changes needed for pure data additions.

2. **Modifier propagation via `notes`** — Elegant way to chain table effects. A target roll can influence flak, which influences damage, etc.

3. **Roll range expansion at load time** — Converting `"3-11"` into individual entries simplifies lookup at roll time.

4. **Scope-based modifiers** — Modifiers can be global or zone-scoped, which handles the game's "this modifier applies only in certain zones" rules.

5. **Flow tables as sequences** — Clean representation of "do A, then B, then C" game phases.

### What Could Be Better

1. **SaveGame as Singleton** — Creates tight coupling. Multiple parts of the code reach into the singleton directly. A new implementation should use dependency injection.

2. **Mixed responsibilities in QotS::Game** — The Game class is 700+ lines handling combat, damage resolution, hit locations, walking hits, etc. These should be separate services.

3. **Hardcoded damage tables in Perl** — `get_b5_12_high_result()`, `get_b5_6_result()`, etc. have B-5 table data hardcoded in Perl rather than in JSON. The JSON `B-5.json` exists but the Perl code duplicates/overrides it.

4. **Simplified combat flow** — Despite having all the JSON tables, the actual `zone_process()` and `process_fighter_combat()` methods in QotS::Game are marked with TODOs and simplifications. The flow tables (FLOW-fighter-attack, etc.) exist but aren't fully wired into the main loop.

5. **No test coverage for integration** — Tests exist but are limited. The full 25-mission campaign path hasn't been validated through automated testing.

6. **`rand()` usage** — Direct `rand()` calls scattered throughout combat code. Should centralize RNG for testability and replay.

---

## Die Roll & Table Lookup Structure (Key for New Implementation)

### Dice Specifications
```
"1d6"  → roll 1 six-sided die, result is sum (1-6)
"2d6"  → roll 2 six-sided dice, result is sum (2-12)
"d6d6" → roll 2 dice, concatenate digits (11-66, 36 possible values)
```

### JSON Table Structure
```json
{
  "Title": "Human-readable name",
  "table_type": "roll|onlyif|Flow",
  "rolltype": "1d6|2d6|d6d6",
  "determines": "variable_name_to_set",
  "scope": "global|zone",
  "group_by": "sum|join",
  "table_count": 1,
  "table_input": "optional_lookup_variable",
  "table_skip": "skip_if_input_equals_this",
  "roll_modifier": { "condition": "...", "value": N },
  "rolls": {
    "1": { "result": "value", "notes": [...] },
    "2-5": { "result": "other_value" },
    "6": { "result": "special", "damage_effects": [...] }
  }
}
```

### Modifier Notes Structure
```json
{
  "table": "target_table_name",
  "modifier": 1,
  "why": "human-readable reason",
  "scope": "global|zone",
  "stack": 1
}
```

### Damage Effects Structure
```json
{
  "type": "crew_wound|engine_damage|gun_damage|fuel_damage|structural_damage|control_damage|equipment_damage",
  "position": "crew_position_or_compartment",
  "severity": "light|serious|mortal",
  "damage_type": "fire|out|runaway|jam|destroy|leak",
  "engine": 1,
  "location": "wound_location"
}
```

### Flow Step Structure
```json
{
  "type": "table|choosemax|loop|flow|process_wounds",
  "Table": "table_name",
  "pre": "message before",
  "post": "message after with <1> placeholder",
  "variable": "for choosemax",
  "choices": [{"max": N, "Table": "name"}],
  "loop_table": "for loops",
  "loop_variable": "zone",
  "reverse": 1,
  "do": "zone_process",
  "flow_table": "for nested flows"
}
```

---

## Recommendations for New Implementation

1. **Keep the JSON data format** — It's well-designed. Port the 46 JSON files as-is or with minor schema improvements.

2. **Use a proper state machine** — Replace the implicit flow with an explicit state machine (e.g., XState in TypeScript or a Rust enum-based FSM).

3. **Centralize RNG** — Create a seedable RNG service for reproducibility and testing.

4. **Separate concerns** — Split combat, damage, crew, and aircraft into independent modules/services with clear interfaces.

5. **Event system** — Instead of direct `buffer()` calls for output, emit typed events that a UI layer can render however it wants (terminal, web, Discord, etc.).

6. **Immutable state + transitions** — Model game state as immutable snapshots with transition functions, enabling undo/replay/analysis.

7. **Type the JSON schema** — Define TypeScript interfaces or Rust structs for the table JSON format. This catches data errors at load time.

8. **Test against known outcomes** — Seed the RNG and verify specific scenarios produce correct results per the board game rules.
