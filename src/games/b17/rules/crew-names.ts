/**
 * Crew name generation — WWII-era American first and last names.
 *
 * Names sourced from 1940s SSA baby name frequency data, 1940 US Census
 * surname distributions, and general demographic patterns of the era.
 * These are statistically common names of the period — NOT names of
 * specific identified servicemen.
 *
 * Ethnic distribution reflects the USAAF demographic reality:
 * predominantly Anglo/Northern European, with significant Irish-American,
 * Italian-American, Polish-American, German-American, and other immigrant
 * communities. A small percentage of Black airmen (Tuskegee Airmen era)
 * is historically accurate.
 */

import type { RNG } from '../../../engine/rng.js';

// ── First Names ─────────────────────────────────────────────────────
// Top male names from SSA data 1920s-1940s (birth cohort that served in WWII)

export const FIRST_NAMES = [
  // Top-tier popularity (very common)
  'James', 'Robert', 'John', 'William', 'Richard', 'Charles', 'Donald',
  'George', 'Thomas', 'Joseph', 'Edward', 'David', 'Frank', 'Harold',
  'Raymond', 'Paul', 'Jack', 'Kenneth', 'Henry', 'Arthur', 'Walter',
  'Albert', 'Ralph', 'Eugene', 'Howard', 'Carl', 'Lawrence', 'Earl',
  'Roy', 'Leonard', 'Norman', 'Gerald', 'Herbert', 'Fred', 'Louis',
  'Daniel', 'Harry', 'Samuel', 'Peter', 'Francis', 'Michael', 'Patrick',

  // High popularity
  'Andrew', 'Anthony', 'Bernard', 'Bobby', 'Bruce', 'Calvin', 'Cecil',
  'Chester', 'Clarence', 'Claude', 'Clifford', 'Clyde', 'Curtis',
  'Dale', 'Darrell', 'Dean', 'Dennis', 'Douglas', 'Duane', 'Dwight',
  'Edgar', 'Edwin', 'Elmer', 'Ernest', 'Floyd', 'Frederick', 'Gene',
  'Gilbert', 'Glen', 'Glenn', 'Gordon', 'Harvey', 'Herman', 'Homer',
  'Hubert', 'Hugh', 'Irving', 'Ivan', 'Jesse', 'Jimmy', 'Johnnie',

  // Moderate popularity
  'Keith', 'Leroy', 'Leslie', 'Lester', 'Lewis', 'Lloyd', 'Lyle',
  'Marvin', 'Maurice', 'Melvin', 'Merle', 'Milton', 'Morris', 'Murray',
  'Nathan', 'Neil', 'Oliver', 'Oscar', 'Otis', 'Owen', 'Perry',
  'Philip', 'Randolph', 'Rex', 'Roger', 'Roland', 'Russell', 'Sam',
  'Seymour', 'Sidney', 'Stanley', 'Stephen', 'Stuart', 'Theodore',
  'Vernon', 'Victor', 'Vincent', 'Virgil', 'Wallace', 'Warren',
  'Wayne', 'Wendell', 'Wesley', 'Willard', 'Willis', 'Woodrow',

  // Italian-American names
  'Angelo', 'Dominic', 'Salvatore', 'Pasquale', 'Rocco', 'Vito',
  'Carmine', 'Gaetano', 'Gennaro', 'Luigi', 'Mario', 'Nunzio',
  'Orazio', 'Rosario', 'Tommaso',

  // Polish-American names
  'Casimir', 'Stanislaus', 'Thaddeus', 'Zigmund', 'Bronislaw',
  'Ladislaus', 'Wladyslaw', 'Zygmunt',

  // German-American names
  'Fritz', 'Hans', 'Karl', 'Otto', 'Rudolph', 'Siegfried', 'Wilhelm',

  // Irish-American (many overlap with Anglo — these are distinctly Irish-favored)
  'Brendan', 'Cornelius', 'Desmond', 'Emmett', 'Fergus', 'Liam',
  'Seamus', 'Timothy',

  // Scandinavian-American names
  'Arvid', 'Gunnar', 'Lars', 'Nils', 'Olaf', 'Sven', 'Thorvald',

  // Jewish-American names
  'Abraham', 'Benjamin', 'Hyman', 'Isadore', 'Jacob', 'Max',
  'Meyer', 'Morrie', 'Saul', 'Solomon',

  // Black American names (common in the era)
  'Alonzo', 'Booker', 'Cleveland', 'Elijah', 'Isaiah', 'Jefferson',
  'Lemuel', 'Moses', 'Nathaniel', 'Roosevelt', 'Ulysses', 'Washington',

  // Additional era-appropriate names
  'Alvin', 'Archie', 'Arnold', 'Barney', 'Benny', 'Bert', 'Billy',
  'Burton', 'Buster', 'Carroll', 'Clay', 'Clem', 'Delbert', 'Dewey',
  'Earle', 'Elbert', 'Ellis', 'Ervin', 'Forrest', 'Franklin',
  'Grover', 'Gus', 'Harlan', 'Harley', 'Horace', 'Ira', 'Irvin',
  'Jasper', 'Jay', 'Jerome', 'Lowell', 'Luther', 'Lyman', 'Marshall',
  'Myron', 'Ned', 'Norbert', 'Orville', 'Otho', 'Percy', 'Preston',
  'Quentin', 'Reuben', 'Rufus', 'Russel', 'Sheldon', 'Sherman',
  'Sterling', 'Sylvester', 'Travis', 'Troy', 'Vern', 'Wilbur',
  'Wilfred', 'Wyatt',
];

// ── Nicknames ───────────────────────────────────────────────────────
// Common 1940s-era nicknames used as callsigns or informal names

export const NICKNAMES = [
  // Classic military/aviator nicknames
  'Ace', 'Bud', 'Buck', 'Buzz', 'Cap', 'Chief', 'Doc', 'Duke',
  'Flash', 'Hap', 'Hot Shot', 'Junior', 'Mac', 'Pappy', 'Red',
  'Shorty', 'Skip', 'Slim', 'Smokey', 'Sparky', 'Spike', 'Tex',
  'Whitey',

  // Regional/origin nicknames
  'Brooklyn', 'Chicago', 'Dixie', 'Jersey', 'Philly', 'Okie',
  'Yank',

  // Personality/appearance nicknames
  'Beanpole', 'Blondie', 'Bones', 'Champ', 'Chip', 'Curly',
  'Dusty', 'Freckles', 'Gabby', 'Happy', 'Lefty', 'Lucky',
  'Moose', 'Muscles', 'Peewee', 'Pinky', 'Rusty', 'Sandy',
  'Sarge', 'Scooter', 'Slick', 'Snuffy', 'Sonny', 'Stinky',
  'Stretch', 'Swede', 'Tiny', 'Tug', 'Woody',

  // Common name-derived nicknames
  'Al', 'Andy', 'Barney', 'Bill', 'Bob', 'Charlie', 'Chuck',
  'Dan', 'Dick', 'Ed', 'Gil', 'Hank', 'Jake', 'Jerry', 'Jim',
  'Joe', 'Johnny', 'Ken', 'Larry', 'Lou', 'Mack', 'Mike', 'Nick',
  'Pat', 'Pete', 'Phil', 'Ray', 'Rick', 'Rudy', 'Sam', 'Stan',
  'Steve', 'Ted', 'Tom', 'Tony', 'Vince', 'Walt', 'Wally',
];

// ── Last Names ──────────────────────────────────────────────────────
// Based on 1940 US Census surname frequency data, weighted toward
// demographics that served in the USAAF.

export const LAST_NAMES = [
  // Most common American surnames (English/Scottish/Welsh origin)
  'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Miller', 'Davis',
  'Wilson', 'Anderson', 'Taylor', 'Thomas', 'Moore', 'Martin', 'Jackson',
  'Thompson', 'White', 'Harris', 'Clark', 'Lewis', 'Robinson', 'Walker',
  'Young', 'Allen', 'King', 'Wright', 'Scott', 'Green', 'Baker', 'Adams',
  'Nelson', 'Hill', 'Campbell', 'Mitchell', 'Roberts', 'Carter', 'Phillips',
  'Evans', 'Turner', 'Parker', 'Collins', 'Edwards', 'Stewart', 'Morris',
  'Rogers', 'Reed', 'Cook', 'Morgan', 'Bell', 'Murphy', 'Bailey',
  'Cooper', 'Richardson', 'Cox', 'Howard', 'Ward', 'Brooks', 'Watson',
  'Wood', 'James', 'Bennett', 'Gray', 'Russell', 'Mason', 'Webb',
  'Shaw', 'Rice', 'Hunt', 'Palmer', 'Stone', 'Gordon', 'Harvey',
  'Knight', 'Porter', 'Spencer', 'Warren', 'Fox', 'Burns', 'Wells',
  'Hamilton', 'Fisher', 'Crawford', 'Gibson', 'Armstrong', 'Cole',
  'Barker', 'Barnes', 'Carpenter', 'Carroll', 'Chapman', 'Curtis',
  'Day', 'Dixon', 'Dunn', 'Elliott', 'Ferguson', 'Fletcher', 'Ford',
  'Foster', 'Fuller', 'Gardner', 'Grant', 'Graves', 'Griffin', 'Hale',
  'Hall', 'Hanson', 'Hardy', 'Harper', 'Hart', 'Hayes', 'Hicks',
  'Hoffman', 'Holland', 'Holmes', 'Hopkins', 'Hudson', 'Hughes',
  'Hunter', 'Jenkins', 'Jordan', 'Keller', 'Kelly', 'Kennedy', 'Lane',
  'Lawrence', 'Long', 'Lyons', 'Manning', 'Marshall', 'Matthews',
  'May', 'Mills', 'Morrison', 'Moss', 'Munoz', 'Murray', 'Myers',
  'Newman', 'Nichols', 'Norton', 'Owens', 'Page', 'Payne', 'Perkins',
  'Perry', 'Peters', 'Pierce', 'Pope', 'Powell', 'Price', 'Quinn',
  'Reynolds', 'Riley', 'Rose', 'Sanders', 'Sharp', 'Simmons', 'Simpson',
  'Snyder', 'Stephens', 'Stevens', 'Sullivan', 'Sutton', 'Tate',
  'Tucker', 'Tyler', 'Wagner', 'Wallace', 'Walsh', 'Watts', 'West',
  'Wheeler', 'Wolfe',

  // Irish-American surnames
  'Brady', 'Brennan', 'Burke', 'Byrne', 'Casey', 'Connolly', 'Daly',
  'Doherty', 'Doyle', 'Duffy', 'Dunne', 'Farrell', 'Fitzgerald',
  'Flanagan', 'Flynn', 'Gallagher', 'Gorman', 'Higgins', 'Keane',
  'Lynch', 'Malone', 'McCarthy', 'McGrath', 'McLaughlin', 'McMahon',
  'McNamara', 'Nolan', 'OBrien', 'OConnor', 'ONeill', 'ORourke',
  'Reilly', 'Regan', 'Ryan', 'Shea', 'Sheridan', 'Sweeney',

  // German-American surnames
  'Bauer', 'Beck', 'Becker', 'Berg', 'Brandt', 'Braun', 'Brenner',
  'Dietrich', 'Fischer', 'Hartmann', 'Hauser', 'Heinz', 'Herman',
  'Herzog', 'Huber', 'Kaiser', 'Klein', 'Koch', 'Kramer', 'Krause',
  'Lang', 'Lehmann', 'Mayer', 'Mueller', 'Pfeiffer', 'Richter',
  'Roth', 'Schaefer', 'Schmidt', 'Schneider', 'Schultz', 'Schwartz',
  'Seidel', 'Stark', 'Strauss', 'Vogel', 'Weber', 'Weiss', 'Werner',
  'Zimmerman',

  // Italian-American surnames
  'Amato', 'Barbieri', 'Benedetti', 'Bruno', 'Caruso', 'Colombo',
  'Costa', 'DeLuca', 'DiMaggio', 'Esposito', 'Ferraro', 'Gallo',
  'Giordano', 'Greco', 'Leone', 'Lombardi', 'Mancini', 'Marchetti',
  'Marino', 'Moretti', 'Orlando', 'Pagano', 'Pellegrino', 'Ricci',
  'Romano', 'Rossi', 'Russo', 'Santoro', 'Sorrentino', 'Vitale',

  // Polish-American surnames
  'Bartkowski', 'Borkowski', 'Chmielewski', 'Dabrowski', 'Grabowski',
  'Jankowski', 'Kaminski', 'Kowalski', 'Kowalczyk', 'Kozlowski',
  'Krawczyk', 'Lewandowski', 'Majewski', 'Mazur', 'Nowak',
  'Pawlowski', 'Piotrowski', 'Sikorski', 'Szymanski', 'Wisniewski',
  'Wojciechowski', 'Wroblewski', 'Zielinski',

  // Scandinavian-American surnames
  'Andersen', 'Bergstrom', 'Carlson', 'Christensen', 'Dahl',
  'Erickson', 'Gustafson', 'Hagen', 'Halvorsen', 'Hendrickson',
  'Jensen', 'Johannsen', 'Larsen', 'Lindberg', 'Lundgren', 'Nilsen',
  'Nygaard', 'Olsen', 'Pedersen', 'Petersen', 'Rasmussen', 'Sorensen',
  'Strand', 'Swanson', 'Thorsen',

  // Jewish-American surnames
  'Abramowitz', 'Cohen', 'Epstein', 'Feldman', 'Friedman', 'Goldberg',
  'Goldman', 'Goldstein', 'Greenberg', 'Horowitz', 'Kaplan', 'Katz',
  'Levi', 'Levine', 'Rosen', 'Rosenthal', 'Shapiro', 'Silverman',
  'Stein', 'Weiner',

  // French-American / Cajun surnames
  'Beaumont', 'Bouchard', 'Chevalier', 'Dubois', 'Fontaine',
  'Gauthier', 'LeBlanc', 'Moreau', 'Rousseau', 'Thibodeau',

  // Czech/Slovak-American surnames
  'Dvorak', 'Hajek', 'Horak', 'Novak', 'Svoboda',

  // Hungarian-American surnames
  'Horvath', 'Kovacs', 'Nagy', 'Szabo', 'Varga',

  // Additional common surnames
  'Abbott', 'Aldrich', 'Avery', 'Baldwin', 'Barton', 'Bates',
  'Bishop', 'Blackwell', 'Blair', 'Blake', 'Bolton', 'Booth',
  'Bowen', 'Boyd', 'Bradford', 'Bridges', 'Brock', 'Bryan',
  'Buchanan', 'Burgess', 'Caldwell', 'Chambers', 'Chandler',
  'Clayton', 'Cobb', 'Conner', 'Conway', 'Craig', 'Dalton',
  'Daniels', 'Davidson', 'Dawson', 'Drake', 'Duncan', 'Eaton',
  'Emerson', 'Faulkner', 'Fleming', 'Fowler', 'Franklin', 'Frost',
  'Garrett', 'Goodwin', 'Graham', 'Harding', 'Harrison', 'Haynes',
  'Henderson', 'Hensley', 'Holcomb', 'Holt', 'Ingram', 'Jennings',
  'Kearney', 'Kimball', 'Lambert', 'Lancaster', 'Larkin', 'Lawson',
  'Logan', 'Lowe', 'Maddox', 'Marsh', 'Maxwell', 'McAllister',
  'McCoy', 'McDaniel', 'McGuire', 'Mercer', 'Merrill', 'Monroe',
  'Montague', 'Montgomery', 'Norris', 'Osborne', 'Parsons',
  'Patterson', 'Pearson', 'Pittman', 'Pratt', 'Preston', 'Ramsey',
  'Randall', 'Reeves', 'Robbins', 'Robertson', 'Rowland', 'Rucker',
  'Saunders', 'Shelton', 'Shepherd', 'Sinclair', 'Sloan', 'Stafford',
  'Stanton', 'Steele', 'Thornton', 'Townsend', 'Underwood', 'Vaughn',
  'Vernon', 'Walters', 'Weaver', 'Webster', 'Whitaker', 'Whitfield',
  'Wilkins', 'Winters', 'Woodward',
];

// ── Generation Functions ────────────────────────────────────────────

/** Pick a random first name. */
export function randomFirstName(rng: RNG): string {
  return FIRST_NAMES[rng.int(0, FIRST_NAMES.length - 1)];
}

/** Pick a random last name. */
export function randomLastName(rng: RNG): string {
  return LAST_NAMES[rng.int(0, LAST_NAMES.length - 1)];
}

/** Pick a random nickname (or undefined ~70% of the time). */
export function randomNickname(rng: RNG): string | undefined {
  if (rng.int(1, 10) <= 3) {
    return NICKNAMES[rng.int(0, NICKNAMES.length - 1)];
  }
  return undefined;
}

/**
 * Generate a full crew member name.
 * ~30% chance of including a nickname in quotes, e.g. James "Tex" Miller
 */
export function generateCrewName(rng: RNG): string {
  const first = randomFirstName(rng);
  const last = randomLastName(rng);
  const nick = randomNickname(rng);
  if (nick) {
    return `${first} "${nick}" ${last}`;
  }
  return `${first} ${last}`;
}
