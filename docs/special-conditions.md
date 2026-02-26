# B-17: Queen of the Skies — Special Conditions, Exceptions & Edge Cases

A comprehensive checklist of every special rule, conditional modifier, exception, and edge case found in the game tables and source code. Organized by game phase/topic.

---

## 1. Defensive Fire (Tables M-1, M-2, M-5)

### 1.1 Nose Gun Restriction (§9.1)
- **Only 2 of 3 nose-area guns may fire in any single attack** (Nose, Port Cheek, Starboard Cheek).
- Reason: only 2 crew (Navigator + Bombardier) are in the nose compartment.

### 1.2 Tail Gun Delayed Fire (§9.2, M-1 Notes)
- Tail guns may be **allocated** to fire at fighters attacking from **10:30, 12, or 1:30** (any altitude).
- This fire is **resolved last** — after all other defensive fire AND all German offensive fire.
- Consequences:
  - **(a)** The target fighter could be **destroyed** before the tail fires → tail does NOT fire, no ammo spent.
  - **(b)** The tail guns themselves could be **knocked out** during German offensive fire → tail does NOT fire, no ammo spent.
  - **(c)** The **intercom** could be knocked out during German offensive fire → tail does NOT fire (see §1.3).
- Tail guns firing in this manner must **always roll 6 to hit**, regardless of fighter position.
- "No ammunition is marked off unless the Tail Guns actually shoot."

### 1.3 Tail Gun + Intercom Dependency
- **Tail guns may NOT fire at 10:30/12/1:30 if the intercom is out.**
- Two timing effects:
  - **(a)** During gun allocation: if intercom already out, tail cannot be assigned to 10:30/12/1:30 targets.
  - **(b)** During combat: if intercom gets knocked out during the German attack phase (before delayed tail fire resolves), tail gun doesn't fire and no ammo is expended.

### 1.4 Destroyed Fighters Don't Receive Fire
- A fighter destroyed during defensive fire should **not** receive offensive fire or further defensive fire from other guns.
- Delayed tail gun should also **not** fire at already-destroyed targets. **(Needs fix per Pat)**

### 1.5 Twin Gun Bonus (M-2 Notes)
- **Ball Turret, Top Turret, and Tail** are twin-mount guns.
- Twin guns get **+1 to M-2 damage roll** vs fighters.
- **Exception:** Twin gun bonus does **NOT** apply against **FW 190** fighters.

### 1.6 FW 190 Damage Penalty (M-2 Notes)
- All damage die rolls against FW 190 are **-1** (harder to damage).
- **Exception:** Twin guns roll damage **normally** vs FW 190 (no +1 bonus, but no -1 penalty either).

### 1.7 Cumulative Fighter Damage (M-2 Notes)
- 2+ FCA = FBOA (breaks off)
- 2+ FBOA = Destroyed
- FCA + FBOA = FBOA
- Single FBOA = breaks off immediately

### 1.8 Spray Fire Restrictions (M-5 Notes)
- Spray fire may **only** be used against attacks from **3, 6, 9, or Vertical Climb** positions.
- **Cannot** be used against 12, 1:30, 10:30, or Vertical Dive attacks.
- Ace gunner bonus does **NOT** apply during spray fire (§9.5).

### 1.9 Jammed Gun Repair (M-5 Notes)
- A gunner may attempt to fix a jammed gun each time the B-17 enters a **new zone**.
- Roll 1D: 1-2 = gun fixed; 3-5 = remains jammed; 6 = **permanently broken**.

### 1.10 Hit Roll Overrides
- **Always-6 rule:** Regardless of any modifiers, a roll of **6 always hits** (defensive fire) — per M-3 notes.
- Conditions that force requiring a 6 to hit:
  - Evasive action (§15.1b)
  - Gunner in wrong position / substitute crew (§14.2b)
  - Frostbitten gunner (§11.0)
  - Two light wounds on gunner (BL-4 notes)
  - Intercom out — all gunners must roll 6 **except Tail which hits on 5-6** (BL-2 roll 4)

### 1.11 Ace Gunner Bonus (§9.3)
- Ace gunner adds **+1 to defensive fire roll**.
- Does **NOT** apply during spray fire (§9.5).

### 1.12 Substitute Crew / Wrong Position (§14.2b)
- A gunner operating a gun not at their normal position must roll **6 to hit**.
- **Exception:** Ball↔Top turret and Waist↔Waist swaps do NOT incur this penalty.

---

## 2. Fighter Encounters (Tables B-1, B-2, B-3, B-6, B-7)

### 2.1 Fighter Wave Modifiers
- **B-2 (target zone):** Poor or Bad weather over target subtracts **-1** from roll.
- **Gazetteer modifiers (G-11):** Zone-specific B-1 modifiers per target city.
- **Squadron position:** Low +1, Middle -1, High 0.
- **Out of formation:** Squadron position modifier is **ignored** (set to 0) per §13.1b.

### 2.2 Vertical Dive Fighters (B-3 Notes)
- B-17 **cannot** fire at Vertical Dive fighters (normal defensive fire).
- **Exception:** Only Top Turret and Radio Room may fire, but must roll **6 to hit**.
- Vertical Dive fighters **cannot** be driven off by fighter cover.

### 2.3 Vertical Climb Fighters (B-3 Notes)
- Only **Ball Turret** may fire at Vertical Climb fighters.
- Ball Turret hits on **3-6** (favorable odds vs normal 6).
- Vertical Climb fighters **CAN** be driven off by fighter cover.

### 2.4 "No Attackers" Results (B-3 Notes)
- Certain B-3 rolls produce "No Attackers — fighters driven off by other B-17s."
- **If out of formation:** re-roll until a different result is obtained (other B-17s aren't protecting you).

### 2.5 Successive Attacks (B-6 Notes, §6.5)
- Any fighter that scores a hit (even if no effect) attacks again.
- Max **3 attacks** per fighter per wave (1 initial + 2 successive).
- After 2nd successive attack, fighter removed even if it hit every time.
- Fighter cover (M-4 successive number) removes fighters between successive attack rounds.

### 2.6 Out-of-Formation Successive Attacks (§13.1c)
- **Every** fighter makes all 3 attacks regardless of whether it hits.
- Only exception: fighter is destroyed or breaks off (FBOA).

### 2.7 Extra Fighter for Lead/Tail Bomber (§5.1c)
- Lead or tail bomber gets **+1 Me109 at 12 Level** per wave.
- **NOT added** when out of formation (§13.1b).

### 2.8 Out-of-Formation Extra Fighter (§13.1a)
- When out of formation, add **+1 Me109 at 12 Level** per wave (different from lead/tail bonus).

---

## 3. German Offensive Fire (Table M-3)

### 3.1 Always-Hit Rule (M-3 Notes)
- "Regardless of any modifiers in effect, a **roll of 6 is always a hit**."

### 3.2 Engine Damage Modifier (§10.2)
- Two or more engines out → fighters add **+1 to M-3 roll** (easier to hit damaged B-17).

### 3.3 Evasive Action Modifier (§15.1a)
- Evasive action → fighters subtract **-1 from M-3 roll** (harder to hit maneuvering B-17).
- But the 6-always-hits rule still applies.

### 3.4 FCA Modifier
- Each FCA on a fighter gives **-1 to its M-3 roll** (damaged fighter is less accurate).

---

## 4. Shell Hits & Hit Location (Tables B-4, B-5)

### 4.1 FW 190 Shell Hit Multiplier (B-4 Notes)
- FW 190: multiply shell hits by **1.5 (round down)**.

### 4.2 Me 110 Shell Hit Bonus (B-4 Notes)
- Me 110: add **+1** to number of shell hits.

### 4.3 Walking Hits (B-5 Notes)
- A "Walking Hits" result **negates all other shell hits** by this fighter for this attack.
- Walking Hits deal:
  - **(a)** 1 hit each to: Nose, Pilot Compartment, Bomb Bay, Radio Room, Waist, and Tail.
  - **(b)** 2 hits on each Wing.
- Variant (c): 1 hit each to Nose, attacking-side Wing, Waist, and Tail.

### 4.4 Wings Hit Resolution
- "Wings" result on B-5: roll 1D — 1-3 = Port Wing, 4-6 = Starboard Wing.

---

## 5. Damage Effects (Tables P-1 through P-6, BL-1, BL-2)

### 5.1 Wing Root Hits (BL-1 Notes)
- Wing root hits are tracked **cumulatively per wing**.
- **5 cumulative hits** to a wing root → wing rips off → **immediate bailout**.

### 5.2 Engine Damage (BL-1)
- Port wing engines = #1, #2; Starboard wing engines = #3, #4.
- Engine damage varies by which wing is hit.

### 5.3 Fuel Tank Damage (BL-1)
- Fuel tank hits can cause: fires, fuel leakage, or self-seal with no effect.
- Fires require extinguisher resolution (see §5.10).

### 5.4 Intercom Out (BL-2 Roll 4)
- All gunners must roll **6 to hit**.
- **Exception:** Tail gunners hit on **5 or 6** (better than other positions when intercom out).
- Mission may be aborted.
- If intercom out **AND** autopilot out → bomb run is **automatically off target**.

### 5.5 Autopilot Out (BL-2 Roll 2)
- Bomb run roll on O-6 gets **-2 modifier**.
- Combined with intercom out → automatic off target (see §5.4).

### 5.6 Oxygen System Out (BL-2 Roll 5, §12.0)
- Must drop out of formation to 10,000 ft in next zone.
- 2 cumulative hits to a compartment's oxygen → knockout for that compartment.
- Oxygen fires must be fought with extinguishers.

### 5.7 Electrical System Out (BL-2 Roll 12)
- Crew must **immediately bail out** on Table G-6.

### 5.8 Propeller Feathering Out (BL-2 Roll 10)
- Crew must immediately bail out (G-6) if a subsequent **runaway engine** result occurs.

### 5.9 Engine Fire Extinguishers Out (BL-2 Roll 11)
- Crew must immediately bail out (G-6) if an **engine fire** occurs.

### 5.10 Fire Extinguishers (BL-3 Notes)
- **5 portable fire extinguishers** total on the B-17.
- Each may be used **once** then removed.
- A crewman fighting fire **may not operate a gun** during that attack.
- A crewman may use up to **3 extinguishers** consecutively on one fire.
- If fire not out after 3rd try → **immediate bailout** on Table G-6.
- BL-3 roll: 1-4 = fire out, 5-6 = fire continues.

### 5.11 Ball Turret Mechanism (P-5 Roll 9, sub-roll 6)
- Turret mechanism inoperable → gunner **trapped**.
- Trapped gunner: cannot fire guns, **cannot bail out**.
- If landing gear is also inoperable → gunner is **automatically KIA on landing**.

### 5.12 Both Elevators Out (P-6 Notes)
- If both elevators inoperable → landing rolls on G-9 and G-10 get **-1**.

### 5.13 Tailplane Root Hits (P-6 Notes)
- 3 cumulative hits to tailplane root → tailplane rips off.
- 1 tailplane off → landing rolls **-1**.
- **Both tailplanes off → immediate bailout** on Table G-7.

### 5.14 Both Flaps Inoperable (BL-1 Notes)
- If both port and starboard flaps inoperable → landing roll **-1**.

### 5.15 Both Ailerons Inoperable (BL-1 Notes)
- If both port and starboard ailerons inoperable → landing roll **-1**.

---

## 6. Crew Wounds & Casualties (Table BL-4)

### 6.1 Light Wound Accumulation (BL-4 Notes)
- **2nd light wound:** Gunners must roll 6 to hit; Bombardier loses 11-25th mission bonus; Bomb Run O-6 gets -1; Bailout (G-6) gets -1 for this crewman.
- **3 light wounds = serious wound**.
- **4 light wounds = KIA**.
- **Light wound + serious wound = KIA**.

### 6.2 Pilot/Co-Pilot 2 Light Wounds (BL-4 Notes)
- Lose their 11-25th mission landing bonus.
- **But:** If the other pilot hasn't taken 2 light wounds, **they** can land using their bonus.

### 6.3 Serious Wound Survival (BL-4 Notes)
- After landing, roll 1D per seriously wounded crewman:
  - 1 = Rapid recovery, may fly next mission
  - 2-5 = Recovery, may not fly any more missions
  - 6 = Wounds fatal, crewman dies

### 6.4 Bombardier KIA/Serious Wound (P-1 Notes)
- If Bombardier is KIA or seriously wounded → bomb run is **automatically off target**.

---

## 7. Frostbite & Heat (Table BL-5, §11.0)

### 7.1 Frostbite Check
- Each zone at altitude, roll 1D per affected crewman: 1-3 = frostbite, 4-6 = OK.

### 7.2 Frostbite Effects (BL-5 Notes)
- Once frostbitten, **remains frostbitten for rest of mission**.
- Frostbitten gunners can only hit by rolling **6**, regardless of attack position.
- Frostbitten + seriously wounded crewman: **+1 to serious wound survival die roll** (worse odds).

### 7.3 Frostbite Recovery (BL-5 Notes, Errata #5)
- After landing, roll 1D per frostbitten crewman: 1-3 = grounded forever; 4-6 = recovers.

---

## 8. Formation & Out-of-Formation Effects (§13.0)

### 8.1 Extra Fighter Per Wave (§13.1a)
- Out of formation: +1 Me109 at 12 Level per wave.

### 8.2 Ignore Squadron Position (§13.1b)
- Out of formation: squadron position modifier set to **0**.
- Lead/tail extra fighter bonus is **NOT** added.

### 8.3 All Fighters Make 3 Attacks (§13.1c)
- Out of formation: every fighter makes all 3 attacks (unless destroyed/FBOA).

### 8.4 Light Flak (§13.1d)
- Out of formation at 10,000 ft over land (not England): roll 2D **twice** on Light Flak column of O-3 per zone.

### 8.5 No Attackers Re-Roll (B-3 Notes)
- "No Attackers" results require re-roll when out of formation.

### 8.6 Bombs Jettison (§13.2c)
- Bombs may be jettisoned at any time when out of formation.

---

## 9. Engine Damage Progressive Effects (§10.0)

### 9.1 One Engine Out (§10.1)
- Must jettison bombs to stay in formation.
- If keeping bombs: 2 turns per zone, out of formation.
- May still bomb from target zone if bombs kept.

### 9.2 Two-Three Engines Out (§10.2)
- **Must** drop out of formation to 10,000 ft.
- 2 turns per zone.
- Fighters get **+1 to M-3** offensive fire.

### 9.3 Three Engines Out / One Operating (§10.3)
- Can go **1 more zone** then must crash land or bail out.
- Landing roll **-3**.

### 9.4 All Four Engines Out (§10.4)
- **Immediate** crash land or bail out.
- Landing roll: **-7** on G-9, **-4** on G-10.

---

## 10. Evasive Action (§15.0)

### 10.1 Eligibility Requirements (§15.2)
All of the following must be true:
- Must be **out of formation**.
- **NOT** with 2+ engines out.
- Control cables (rudder, elevator, ailerons) must be **intact**.
- Must **NOT** have 3+ negative landing modifiers.
- **Pilot or Co-Pilot** must be flying (not substitute).
- No specific damage that disallows evasive action.

### 10.2 Defensive Fire Penalty (§15.1b)
- When taking evasive action: gunners must roll **6 to hit** (ace bonus still applies).

### 10.3 Offensive Fire Penalty (§15.1a)
- When taking evasive action: fighters get **-1 to M-3 roll** (but 6 always hits).

---

## 11. Bomb Run (Tables O-6, O-7)

### 11.1 Auto Off-Target Conditions
- Bombardier KIA or seriously wounded → **automatically off target** (P-1 Notes).
- Autopilot out **AND** intercom out → **automatically off target** (BL-2 Notes).

### 11.2 Bomb Run Modifiers (O-6)
- Flak hits: **-1 per hit** on O-6 roll.
- Autopilot out: **-2** on O-6 roll.
- Bombardier's 2nd light wound: loses 11-25th mission bonus AND **-1** on O-6.
- Poor/Bad weather: **-1** on B-2 roll (fighter waves, not bomb run directly — but weather effects propagate).

### 11.3 Target of Opportunity (§8.0)
- Aborting B-17 with bombs may bomb a target of opportunity.
- Always treated as **Off Target** bombing.

---

## 12. Flak (Tables O-2 through O-5)

### 12.1 Heavy Flak Targets (O-2)
- The following targets get **+1 on O-2 flak intensity roll**: Brest, Lorient, St. Nazaire, Wilhelmshaven, Vegesack, La Rochelle, Kiel.

### 12.2 Flak Resolution Chain
- O-2 (intensity) → O-3 (3 rolls to hit) → O-4 (shell hits per flak hit) → O-5 (area affected) → damage tables.

### 12.3 Light Flak for Out-of-Formation (§13.1d)
- Out of formation at 10,000 ft over land: roll 2D **twice** on O-3 Light Flak column per zone.

---

## 13. Fighter Cover (Tables G-5, M-4)

### 13.1 Zone Restriction (§6.2)
- Fighter cover only available in **Zones 2, 3, and 4**.

### 13.2 Vertical Dive Exception
- Vertical Dive fighters **cannot** be removed by fighter cover.

### 13.3 Aggressive Little Friends (Random Event)
- M-4 roll gets **+1 for remainder of mission**.

---

## 14. Bailout & Survival (Tables G-6, G-7, G-8)

### 14.1 Controlled Bailout (G-6)
- 1D per crewman: 1 = KIA, 2-6 = OK.
- Roll of **6 always succeeds** even with light wound modifier.
- Seriously wounded crewmen **may not bail out** (go down with plane).

### 14.2 Uncontrolled Bailout (G-7)
- 1D per crewman: 1-5 = KIA (goes down with plane), 6 = OK.
- Lightly wounded: **-1 to die roll**.
- Seriously wounded: **may not bail out**.

### 14.3 Water Bailout (G-8)
- 1D per crewman: 1-4 = drowned, 5-6 = rescued.
- **If radio not operating → ALL crew bailing over water die.**

### 14.4 Capture/Evade After Bailout
- **Germany or Netherlands:** automatically captured (POW).
- **France or Belgium:** 1D per crewman: 1-5 = captured, 6 = returned by Underground.
- Seriously wounded crewmen in France/Belgium are **automatically captured**.

### 14.5 Ball Turret Trapped
- If ball turret mechanism is inoperable, gunner is trapped and **cannot bail out**.
- If landing gear also inoperable → **KIA on landing**.

---

## 15. Landing (Tables G-9, G-10)

### 15.1 Always-Safe Rule (G-10 Notes)
- A roll of **12 is always "crew safe"** regardless of negative modifiers.

### 15.2 Experienced Pilot/Co-Pilot Landing Bonus (G-10 Notes)
- Pilot and/or Co-Pilot on 11-25th mission: **+1 to landing roll**.
- Lost if that pilot has 2+ light wounds.

### 15.3 Non-Pilot Flying (G-10 Notes, §14.2c)
- If Pilot and Co-Pilot are both dead or seriously wounded and another crewman flies: **-11 to landing roll**.

### 15.4 Water Landing + Radio Out (G-10 Notes)
- Landing in water with radio out AND out of formation: **-6 to landing roll**.

### 15.5 Engine Landing Modifiers
- 1 engine operating (3 out): **-3** on G-9 and G-10.
- No engines operating: **-7** on G-9, **-4** on G-10.

### 15.6 Bombs Aboard Explosion Risk (G-10 Notes)
- If landing roll ≤ 0 and bombs still aboard: roll 1D — 1-5 = no effect, **6 = explosion, all destroyed**.

### 15.7 Crash Landing in Europe (G-9)
- **-3 modifier**. Plane is lost.
- Landing in Germany/Netherlands → entire crew captured.
- Landing in France/Belgium → roll per crewman: 1-5 = captured, 6 = rescued by Underground. Seriously wounded automatically captured.

### 15.8 Water Rescue Zones (G-10 Notes)
- Zones 2-5: rescued crew returned to England.
- Zones 6-7: rescued crew **captured**.

### 15.9 Cumulative Landing Modifiers
All landing modifiers are cumulative:
- Tail wheel inop: -1
- Brakes inop: -1  
- Landing gear inop: -1
- Rudder controls: -1
- Elevator controls: -1
- Aileron controls: -1
- Both flaps inop: -1
- Both ailerons inop: -1
- Both elevators inop: -1
- Landing gear indicator out: -3
- Wing flaps indicator out: -1
- BIP damage: -4

---

## 16. Mandatory Abort Conditions (§8.0)

### 16.1 Must Abort
- Two or more engines out (§8.0h).
- Navigator seriously wounded/KIA **AND** out of formation (§8.0d).
- Both Pilot and Co-Pilot seriously wounded/KIA **AND** out of formation (§8.0e).

---

## 17. Random Events (Table B-7, §18.0)

### 17.1 Trigger
- Roll of 66 on B-3. Optional rule — may treat as "No Attackers" instead.

### 17.2 Engine Failure (Roll 2)
- If rolled again: previously failed engine **restarts**.

### 17.3 Formation Casualties (Roll 3)
- B-17 becomes lead or tail bomber (roll 1D: 1-3 lead, 4-6 tail).
- **Ignore** if already lead/tail or out of formation — re-roll.
- Non-repeatable.

### 17.4 Loose Formation (Roll 4)
- B-1/B-2 modifier **+1** (more fighters).
- If out of formation: modifier is **-1** instead.
- Non-repeatable.

### 17.5 Aggressive Little Friends (Roll 5)
- M-4 fighter cover defense **+1 for rest of mission**.
- Non-repeatable.

### 17.6 Tight Formation (Roll 6, 8)
- B-1/B-2 modifier **-1** (fewer fighters).
- Non-repeatable.

### 17.7 Rabbit's Foot (Roll 7)
- One free re-roll of any die roll you don't like.
- **Stackable** — multiple rabbit's feet can be accumulated.
- **Carries over** to next mission.
- Once used, it's gone.

### 17.8 Bad Luftwaffe Communications (Roll 9)
- Remove 1 fighter per wave.
- **Toggles**: 2nd occurrence cancels, 3rd restores, etc.

### 17.9 Extreme Cold (Roll 10)
- Roll 1D per gun position: 6 = jammed.
- **Ignore** if out of formation at 10,000 ft — re-roll.

### 17.10 Ace for a Day (Roll 11)
- Random gunner gets **+1 to hit** for rest of mission.
- Roll 1D: 1-2 Engineer, 3-4 Ball, 5-6 Tail.
- If same crewman rolled twice: **ignore** (no re-roll).
- A legitimate ace (from experience) is unaffected.

### 17.11 Mid-Air Accident (Roll 12)
- If out of formation: **treat as engine failure** instead.
- Sub-roll 2D: 2-8 no effect, 9-10 shallow dive, 11 steep dive (roll for wings holding), 12 mid-air collision.

---

## 18. BIP — Burst Inside Plane (§19.2)

### 18.1 All Crew KIA
- All crewmen in the affected compartment are KIA.

### 18.2 Structural BIP (§19.2b)
- Wing, Tail, or Pilot Compartment BIP → B-17 dives, crew bails on **G-7** (uncontrolled).

### 18.3 Bomb Bay BIP with Bombs (§19.2c)
- **B-17 destroyed** — no bailout possible.

### 18.4 Other Compartment BIP (§19.2d)
- Nose, empty Bomb Bay, Radio Room, or Waist.
- Effects: out of formation, 2 turns/zone, **all damage from that compartment's table assumed**, landing **-4**, **no evasive action**.

---

## 19. Campaign / Post-Mission (§17.0)

### 19.1 Serious Wound Survival (BL-4 Notes)
- Roll 1D: 1 = rapid recovery (fly next mission), 2-5 = hospitalized (can't fly), 6 = dies.

### 19.2 Frostbite Recovery (BL-5 Notes, Errata #5)
- Roll 1D: 1-3 = grounded permanently, 4-6 = recovers for next mission.

### 19.3 Light Wounds Heal Between Missions
- Light wounds are healed between missions (crew returns to none).

### 19.4 Replacement Crew
- KIA/hospitalized/grounded crew replaced with **fresh replacements** (0 missions, no experience).

### 19.5 Experience Bonuses (11-25 Missions)
- Pilot/Co-Pilot: **+1 to landing roll**.
- Bombardier: **bonus on bomb run** (specifics in O-6).
- Gunners: ace bonus thresholds (per §9.3).
- These bonuses can be **lost** by 2 light wounds (BL-4 notes).

---

## 20. Zone Movement & Speed

### 20.1 Maximum 2 Turns Per Zone (§2.2)
- Regardless of damage, B-17 **never** spends more than 2 turns in a zone.

### 20.2 Slow Movement Conditions
- 1 engine out + bombs aboard: 2 turns/zone.
- 2+ engines out: 2 turns/zone.
- BIP in certain compartments: 2 turns/zone.

---

## 21. Weather Effects

### 21.1 B-2 Modifier
- Poor or Bad weather over target zone: **-1** on B-2 roll (fewer fighter waves in target zone).

### 21.2 Fighter Cover
- Bad/Poor weather: **-1** on M-4 fighter cover roll.

---

## 22. Known Implementation Issues (Flagged by Pat)

1. ✅ **Destroyed fighters should not receive offensive fire** — already fixed.
2. ⚠️ **Delayed tail gun fires at already-destroyed target** — needs fix. If the fighter is destroyed before tail gun resolves, tail should not fire and no ammo expended.
3. ⚠️ **Intercom knockout during attack phase** — verify that tail gun delayed fire is properly cancelled if intercom is knocked out during German offensive fire phase.
4. ⚠️ **Nose gun 2-of-3 limit** — verify enforcement during gun allocation.

---

*Generated from game tables (data/*.json) and rule source files (rules/*.ts). Last updated: 2026-02-24.*
