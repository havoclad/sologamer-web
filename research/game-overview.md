# B-17: Queen of the Skies — Game Overview

## Reference for Digital Reproduction

**Publisher:** Avalon Hill (early 1980s)  
**Designer:** Not prominently credited (Avalon Hill house design)  
**Players:** 1 (solo game; rules mention 2 but impractical)  
**BGG:** https://boardgamegeek.com/boardgame/1032/b-17-queen-of-the-skies

---

## Historical Setting

The game simulates the USAAF 8th Air Force strategic bombing campaign over occupied Europe. The base game covers **November 1942 through May 1943**, flying B-17F Flying Fortress bombers from England. Variants expand this to August 1942–May 1945 and add other aircraft (B-17C/E/G, YB-40, B-24 variants, Avro Lancaster) and the 15th Air Force (from Italy).

The player commands a single B-17F bomber and its 10-man crew. The goal is to survive **25 missions** and rotate home (like the crew of the Memphis Belle). 

---

## Core Game Loop — What Happens Each Mission

A mission is a complete sortie from takeoff to landing (or crash/bailout). The sequence:

### 1. Mission Assignment
- **Target determination** — Roll on target table or select from available targets. Target determines:
  - Which zones the bomber flies through (concentric rings from base, zones 1–12)
  - Country/territory of each zone
  - Flak intensity at target
  - Target type (factory, marshalling yard, u-boat pen, airfield, etc.)
- **Formation position** — Roll for:
  - **Squadron position** within the group (Lead, High, Low)
  - **Bomber position** within the squadron (Lead, Left Wing, Right Wing, Tail End Charlie, etc.)
  - Position affects vulnerability to fighters and flak
- **Weather determination** — Roll for weather (Good, Poor, Bad; variants add Clear and Storm)

### 2. Takeoff
- Roll for takeoff accidents (modified by crew experience in variants)
- Possible crashes, aborts, or collisions on takeoff

### 3. Zone-by-Zone Flight (Outbound)
For each zone from base (Zone 1) to target zone, resolve in order:

#### a. Fighter Encounter Check
- Roll to determine if enemy fighters appear
- Modified by: zone location (over Germany vs. France), weather, formation position, altitude, fighter escort presence
- If fighters appear, determine:
  - **Number of fighters** (roll on table)
  - **Type of fighters** (Fw-190, Bf-109, Me-110, Me-210, Ju-88, etc.) — rolled per fighter
  - **Approach direction** (12 o'clock high, 6 o'clock low, 3 o'clock level, etc.) — determines which guns can fire

#### b. Friendly Fighter Escort
- Roll to see if friendly escorts are present in this zone
- Modified by zone distance and time period
- Friendly fighters can drive off enemy fighters before they attack (player chooses which to remove)

#### c. Fighter Combat Resolution (per wave)
Multiple waves of fighters may attack. For each wave:

1. **Determine approach direction** for each fighter (12 positions × 3 levels = 36 possible vectors, simplified to chart results)
2. **Player assigns defensive fire** — the key player decision:
   - Each gun position has a **field of fire** (arc of coverage)
   - Player assigns guns to targets within their arc
   - Multiple guns can fire at one fighter; one gun can only fire at one fighter
   - Option for **spray fire** (uses 3× ammo, higher jam chance, better hit chance vs. side/rear attacks)
3. **Resolve bomber defensive fire** — Roll 2d6 per gun firing:
   - Compare to to-hit number (varies by attack direction, gun type, crew status)
   - Modified by: ace gunner (+), wounded crew (−), frostbite (−), intercom out (−), temporary position (−)
   - Results: Miss, Damage (fighter driven off), Kill
4. **Resolve fighter attack on bomber** — Roll 2d6 per attacking fighter:
   - Results: Miss, or hit (proceed to damage)
5. **Passing fire** — After fighters pass, tail gunner may get a shot
6. **Repeat** for additional waves

#### d. Flak
- Only in certain zones (over enemy-occupied territory and especially at target)
- Roll for flak intensity and accuracy
- Flak at target is typically heaviest
- Resolve damage if hit

#### e. Damage Resolution (from fighters or flak)
- Roll on **Damage Table** to determine where the hit lands
- Possible damage areas include every system on the aircraft (see Damage System below)

#### f. Crew Casualty Check
- If a compartment is hit, roll to see if crew in that area are wounded or killed
- Wound levels: Light Wound (×1 or ×2), Serious Wound, KIA

#### g. Abort Check
- If damage is severe enough, bomber may be forced to abort
- Certain damage forces automatic abort (bombsight destroyed, severe fuel leak, multiple engines out)
- Player may choose to abort with moderate damage

### 4. Target Zone — Bomb Run
- **Flak over target** — Usually intense; roll for damage
- **Bombing accuracy** — Roll to determine if bombs hit target:
  - Modified by: weather, bombsight status, crew experience, evasive action
  - Results: On target (with % accuracy) or off target
  - If near Switzerland and off target: possible international incident
- **Additional fighter attacks** possible in target zone

### 5. Zone-by-Zone Flight (Return)
- Same sequence as outbound but in reverse
- Damaged bombers may struggle:
  - Lost engines reduce range (may run out of fuel)
  - Out-of-formation bombers are more vulnerable
  - Low altitude (10,000 ft) makes bomber vulnerable to light flak over enemy territory
  - Can jettison excess weight for range
  - Crew can bail out or crash-land if bomber can't maintain flight

### 6. Landing
- Roll for landing:
  - Modified by: damage to landing gear, flaps, control surfaces, weather, crew experience, number of engines
  - Results: Safe landing, rough landing (additional damage), crash landing
- If over water when bomber fails: ditch (water landing) with survival roll

### 7. Post-Mission
- Record crew mission count (each crew member tracks individually)
- Record kills (5+ = Ace status, gives combat bonus)
- Wound recovery — seriously wounded crew may be invalided (replaced)
- Award decorations based on performance
- Bomber damage may take it off duty for repairs
- **25 missions completed = Tour Complete** — crew rotates home

---

## Crew Positions and Their Roles

The B-17F carries a **10-man crew**:

| Position | Compartment | Gun(s) Operated | Notes |
|----------|-------------|-----------------|-------|
| **Pilot** | Cockpit | — | Flies the plane; affects landing, evasion |
| **Co-Pilot** | Cockpit | — | Backup pilot; can take over if pilot hit |
| **Navigator** | Nose | Nose gun, Port Cheek gun, Starboard Cheek gun | Can switch between cheek guns freely; if wounded, cheek guns affected |
| **Bombardier** | Nose | Nose gun (chin turret on G model) | Operates bombsight; critical for bomb run |
| **Engineer/Top Turret** | Upper fuselage | Top turret (2 guns) | Wide field of fire; covers top arc |
| **Radio Operator** | Radio room | Radio room gun (single, fires up/rear) | Operates radio (needed for sea rescue) |
| **Ball Turret Gunner** | Belly | Ball turret (2 guns) | Covers bottom arc; very exposed position |
| **Left Waist Gunner** | Waist | Left waist gun | Covers left side |
| **Right Waist Gunner** | Waist | Right waist gun | Covers right side |
| **Tail Gunner** | Tail | Tail guns (2 guns) | Covers 6 o'clock; gets passing fire shots |

Crew skills tracked:
- **Mission count** — More experienced = better modifiers
- **Kill count** — 5+ kills = Ace (better to-hit)
- **Wound status** — Light wound ×1, ×2, Serious wound, KIA
- **Frostbite** — From heater failure at altitude

---

## Gun Positions and Fields of Fire

Each gun position covers specific attack directions. The key mechanic is that **attack direction determines which guns can respond**:

- **Nose/Chin guns** — Forward arc (12 o'clock attacks)
- **Cheek guns (Port/Starboard)** — Forward-side arcs
- **Top turret** — Upper hemisphere, wide coverage
- **Ball turret** — Lower hemisphere, wide coverage
- **Radio room gun** — Upper rear
- **Waist guns (L/R)** — Side arcs (9 and 3 o'clock)
- **Tail guns** — Rear arc (6 o'clock attacks); also passing fire

Each gun has:
- **Ammunition supply** (finite; tracked per gun; can swap between guns)
- **Jam status** (guns can jam, especially with spray fire)
- **Operational status** (can be destroyed by damage)

---

## Tables and Charts

The game is entirely table-driven. All "decisions" except gun assignment are die rolls. Key tables:

### Mission Setup Tables
- **Table G-1: Target Assignment** — Roll 2d6 for target (missions 1-10 vs. 11-25 have different tables; early missions get "milk run" targets)
- **Table G-2: Formation Position** — Squadron position within group
- **Table G-3: Bomber Position** — Position within squadron formation
- **Weather Table** — Determines mission weather

### Fighter Encounter Tables
- **Table F-1: Fighter Appearance** — Whether fighters show up this zone (2d6, modified by zone/country)
- **Table F-2: Number of Fighters** — How many appear (1-6+ typically)
- **Table F-3: Fighter Type** — What kind (Fw-190, Bf-109, Me-110, etc.)
- **Table F-4: Approach Direction** — Where the fighter comes from (determines gun coverage)
- **Table F-5: Number of Waves** — How many attack passes

### Combat Tables  
- **Table C-1: Bomber Defensive Fire** — To-hit numbers for each gun vs. each attack direction
- **Table C-2: Fighter Attack Results** — Whether fighter hits the bomber
- **Table C-3: Fighter Damage** — Result of bomber hitting a fighter (driven off, damaged, destroyed)

### Damage Tables
- **Table D-1: Hit Location** — Where on the bomber the hit lands (nose, cockpit, bomb bay, waist, tail, wing, engine, etc.)
- **Table D-2: Specific Damage** — Detailed damage within each area:
  - **Nose/cockpit hits**: bombsight, navigation equipment, controls, oxygen, heater, crew
  - **Fuselage hits**: radio, intercom, control cables, crew
  - **Wing hits**: engines (specific), fuel tanks, control surfaces (ailerons, flaps)
  - **Tail hits**: rudder, elevator, tail wheel, control cables
  - **Engine hits**: on fire, oil leak, feathered, destroyed
- **Table D-3: Crew Casualties** — Wound severity when crew compartment hit
- **Table D-4: Fire/Explosion** — If hit causes fire; can lead to bailout or loss of aircraft

### Flak Tables
- **Table FL-1: Flak Intensity** — How much flak in this zone
- **Table FL-2: Flak Accuracy** — Whether flak hits (modified by altitude, evasion)
- **Table FL-3: Flak Damage** — Uses same damage tables as fighter hits

### Bombing Tables
- **Table B-1: Bombing Results** — On/off target, percentage

### Landing Tables
- **Table L-1: Landing** — Success modified by damage
- **Table L-2: Crash Landing/Ditching** — Crew survival in emergency

### Bailout/Survival Tables
- **Table S-1: Bailout** — Per crew member, can they get out?
- **Table S-2: Parachute** — Does chute open?
- **Table S-3: Capture/Evasion** — Over enemy territory: POW vs. evasion back to friendly lines (modified by country and date)

### Special Tables
- **Random Events Table** — Mid-air collision, lucky breaks, etc. (Optional Rule 18.0)
- **Mechanical Failure Table** — Supercharger failure, etc. (variant)
- **Frostbite Table** — Risk per zone if heater out at altitude

---

## Damage System

Damage is tracked at a granular component level. The bomber has dozens of damageable systems:

### Structural
- **Fuselage** — Superficial or structural damage; enough structural = breakup
- **Wings** — Left/right; can be shot off (catastrophic)
- **Tail section** — Can be shot off

### Flight Controls (each can be destroyed)
- Ailerons (L/R) — Roll control
- Elevators (L/R) — Pitch control  
- Rudder — Yaw control
- Flaps (L/R) — Landing
- Control cables — If cut, related surfaces inoperable

### Engines (4 total, numbered 1–4 outboard-to-inboard)
- Each can be: running, damaged, on fire, feathered (shut down), destroyed
- Oil system per engine — leak leads to seizure
- Losing engines: 1 = manageable; 2 = serious (altitude/speed loss); 3 = critical (may not maintain flight); 4 = going down

### Landing Gear
- Main gear (L/R)
- Tail/nose wheel
- Controls

### Systems
- Bombsight — Destroyed = can't bomb accurately (may force abort)
- Bomb bay doors — Destroyed = can't drop bombs or jettison cargo
- Navigation equipment — Out = must spend extra time in zones (if out of formation)
- Radio — Out = no sea rescue if ditching
- Intercom — Out = gunner penalties, no passing fire, possible abort
- Oxygen system — Out = must descend to 10,000 ft
- Heating system — Out = frostbite risk per zone

### Fuel System
- Fuel tanks can leak (fuel gauge depletes faster)
- Self-sealing tanks may stop leaks
- Running out of fuel = forced landing wherever you are

### Cumulative Damage
The emulator tracks "Peckham Points" — a cumulative damage metric named after variant designer Bruce Peckham. This determines overall aircraft condition and whether the bomber is repairable between missions.

---

## Mission Structure — The 25-Mission Tour

- Each crew member individually tracks their mission count
- Replacements for casualties start at mission 1 regardless of bomber's count
- **Missions 1–3** (base game): Easier targets ("milk runs") — short range, less opposition
- **Missions 4–10**: Medium difficulty targets
- **Missions 11–25**: Full target list including deep penetration raids (Schweinfurt, Regensburg, etc.)
- **Note**: The emulator designer notes this graduated difficulty was "gamey" — historically, the Memphis Belle's first missions were to heavily defended targets. The variant rules allow full target lists from mission 1.

### Between Missions
- Wounded crew recover or are replaced
- Bomber is repaired (may miss missions if heavily damaged)  
- Crew can be reassigned between bombers
- New crew members can be added

### Victory Conditions
- **Win**: Entire crew (or individual crew member) completes 25 missions
- **Loss**: Bomber shot down, crash lands fatally, or crew killed
- There's no strategic victory — it's purely a survival/RPG experience

---

## Existing Digital Implementations

### B17QotS Emulator (Preston V. McMurry III)
- **Repository**: https://github.com/Hawke/B17QoTS
- **Language**: Visual Basic 6 + Microsoft Access database
- **Status**: Last significant development ~2005; maintained/improved by "Hawke" on GitHub
- **License**: GPL v3
- **Features**: 
  - All known variants through mid-2005
  - B-17C/E/F/G, YB-40, B-24D/E/G/H/J/L/M, Avro Lancaster
  - 120+ targets (vs. original ~28)
  - 8th and 15th Air Force
  - Crew experience, German pilot skill, JG-26 variant
  - Full mission automation with mission log output
  - HTML mission report export
- **Design docs** for a v2.0 (PHP/MySQL) exist in the repo but were never implemented

### No other significant digital implementations found
- The VB6 emulator appears to be the only substantial computer version
- The game is well-suited to digital implementation due to its solo, table-driven nature

---

## Key Variants Published in "The General" Magazine

1. **Expanded Target List** — The General Vol 23 #5 — Many additional targets
2. **15th Air Force** — The General Vol 23 #1 — Southern Europe theater from Italy  
3. **Theater Modifications** — The General Vol 23 #1 — Mechanical failures, time-period formations, crew experience, formation gunnery, evasive flak
4. **Lancaster/Battle of Berlin** — The General Vol 28 #4 — RAF Bomber Command night missions
5. **German Fighter Pilot Skill** — Optional Rule 20.0 in original rules
6. **Random Events** — Optional Rule 18.0 in original rules
7. **JG-26 "Schlageter"** — Bruce Peckham variant — Elite German fighter unit
8. **Ju-88s as Fighters** — Bruce Peckham variant
9. **B-24 "Flying Boxcar"** — Preston McMurry variant — Consolidated B-24 Liberator

---

## Design Notes for Digital Reproduction

### What makes this game work as software:
1. **Pure table lookups + dice** — Every outcome is a probability distribution; trivial to implement
2. **Single meaningful player decision** — Gun assignment to targets (the rest is automated)
3. **Rich narrative output** — The mission log tells a compelling story automatically
4. **Persistent state** — Crew advancement, damage carry-over, mission counting create campaign feel
5. **Solo play** — No AI opponent needed; German fighters are automata

### Key implementation considerations:
- All tables need to be faithfully reproduced (the tables ARE the game)
- Gun field-of-fire mapping to attack directions is critical
- Damage tracking is detailed but finite — a component checklist
- The campaign layer (crew roster, bomber maintenance, 25-mission tracking) is as important as the tactical mission
- Random events and mechanical failures are optional toggles
- Weather, formation position, and zone location create the probability modifiers that make each mission feel different
- The emotional core is the crew — names, accumulated experience, the tension of mission #24

---

*Research compiled Feb 2026. Sources: GitHub B17QoTS emulator documentation, emulator help files, community knowledge. BGG was not accessible due to Cloudflare protection. Web search API was unavailable.*
