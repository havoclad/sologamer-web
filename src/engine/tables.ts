/**
 * Generic table loader & lookup system.
 * Reads JSON table files in Pat's SoloGamer format and provides typed lookups.
 */

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import type { RNG } from './rng.js';

// ─── JSON schema types (matching Pat's format) ───

export interface TableNote {
  table: string;
  modifier: number;
  why: string;
  scope?: 'global' | 'zone';
  stack?: number;
}

export interface RollEntry {
  [key: string]: unknown;
  description?: string;
  result?: string;
  notes?: TableNote[];
  next?: string;
  damage_effects?: DamageEffect[];
}

export interface DamageEffect {
  type: string;
  position?: string;
  severity?: string;
  damage_type?: string;
  engine?: number;
  location?: string;
}

export interface FlowStep {
  type: 'table' | 'choosemax' | 'loop' | 'flow' | 'process_wounds';
  Table?: string;
  pre?: string;
  post?: string;
  variable?: string;
  choices?: Array<{ max: string | number; Table: string }>;
  loop_table?: string;
  loop_variable?: string;
  reverse?: string | number;
  do?: string;
  flow_table?: string;
}

export interface RawTableData {
  Title: string;
  table_type: 'roll' | 'onlyif' | 'Flow';
  rolltype?: string;       // "1d6", "2d6", "d6d6"
  determines?: string;
  scope?: 'global' | 'zone';
  group_by?: 'sum' | 'join';
  table_count?: number;
  table_input?: string;
  table_skip?: string;
  roll_modifier?: { condition: string; value: number };
  rolls?: Record<string, RollEntry>;
  // Flow tables
  missions?: string;
  flow?: FlowStep[];
  // OnlyIf
  only_if?: string;
}

// ─── Parsed table types ───

export interface ParsedRollTable {
  kind: 'roll' | 'onlyif';
  name: string;
  title: string;
  raw: RawTableData;
  rolltype: string;
  determines?: string;
  /** Expanded map: individual roll value → entry */
  entries: Map<string, RollEntry>;
  minRoll: number;
  maxRoll: number;
}

export interface ParsedFlowTable {
  kind: 'flow';
  name: string;
  title: string;
  raw: RawTableData;
  steps: FlowStep[];
}

export type ParsedTable = ParsedRollTable | ParsedFlowTable;

// ─── Expand roll ranges ───

function expandRollKey(key: string): string[] {
  // Handle comma-separated: "2,3"
  if (key.includes(',')) return key.split(',').map(s => s.trim());
  // Handle range: "3-11"
  const m = key.match(/^(\d+)-(\d+)$/);
  if (m) {
    const lo = parseInt(m[1], 10);
    const hi = parseInt(m[2], 10);
    const result: string[] = [];
    for (let i = lo; i <= hi; i++) result.push(String(i));
    return result;
  }
  return [key];
}

function parseRollTable(name: string, data: RawTableData): ParsedRollTable {
  const entries = new Map<string, RollEntry>();
  let minRoll = Infinity;
  let maxRoll = -Infinity;

  if (data.rolls) {
    for (const [key, entry] of Object.entries(data.rolls)) {
      for (const expanded of expandRollKey(key)) {
        const num = parseInt(expanded, 10);
        if (!isNaN(num)) {
          if (num < minRoll) minRoll = num;
          if (num > maxRoll) maxRoll = num;
        }
        entries.set(expanded, entry);
      }
    }
  }

  return {
    kind: data.table_type === 'onlyif' ? 'onlyif' : 'roll',
    name,
    title: data.Title,
    raw: data,
    rolltype: data.rolltype ?? '1d6',
    determines: data.determines,
    entries,
    minRoll: minRoll === Infinity ? 1 : minRoll,
    maxRoll: maxRoll === -Infinity ? 6 : maxRoll,
  };
}

function parseFlowTable(name: string, data: RawTableData): ParsedFlowTable {
  return {
    kind: 'flow',
    name,
    title: data.Title,
    raw: data,
    steps: data.flow ?? [],
  };
}

// ─── Table Store ───

export class TableStore {
  private tables = new Map<string, ParsedTable>();

  /** Load all JSON files from a directory */
  loadDirectory(dir: string): void {
    const files = readdirSync(dir).filter(f => f.endsWith('.json'));
    for (const file of files) {
      const name = file.replace('.json', '');
      const raw = JSON.parse(readFileSync(join(dir, file), 'utf-8')) as RawTableData;
      this.addTable(name, raw);
    }
  }

  /** Add a single table from raw data */
  addTable(name: string, data: RawTableData): void {
    if (data.table_type === 'Flow') {
      this.tables.set(name, parseFlowTable(name, data));
    } else {
      this.tables.set(name, parseRollTable(name, data));
    }
  }

  get(name: string): ParsedTable | undefined {
    return this.tables.get(name);
  }

  getRoll(name: string): ParsedRollTable | undefined {
    const t = this.tables.get(name);
    return t && t.kind !== 'flow' ? t : undefined;
  }

  getFlow(name: string): ParsedFlowTable | undefined {
    const t = this.tables.get(name);
    return t && t.kind === 'flow' ? t : undefined;
  }

  /** All loaded table names */
  names(): string[] {
    return [...this.tables.keys()];
  }

  /** Roll on a table using provided RNG, with optional modifier. Returns the matched entry. */
  lookup(name: string, rng: RNG, modifier = 0): { roll: number; entry: RollEntry } | undefined {
    const table = this.getRoll(name);
    if (!table) return undefined;

    let roll: number;
    switch (table.rolltype) {
      case '2d6': roll = rng.twod6(); break;
      case 'd6d6': roll = rng.d6d6(); break;
      default: roll = rng.d6(); break;
    }

    const modified = Math.max(table.minRoll, Math.min(table.maxRoll, roll + modifier));
    const entry = table.entries.get(String(modified));
    if (!entry) return undefined;

    return { roll: modified, entry };
  }

  /** Direct lookup by value (no dice roll) */
  lookupValue(name: string, value: number | string): RollEntry | undefined {
    const table = this.getRoll(name);
    return table?.entries.get(String(value));
  }
}
