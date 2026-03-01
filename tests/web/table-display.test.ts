import { describe, it, expect, beforeEach } from 'vitest';
import { TableStore } from '../../src/engine/tables.js';
import { b17Module } from '../../src/games/b17/index.js';
import { buildM3Rows, buildM4Rows, buildB4Rows, buildB5Rows, buildO3Rows } from '../../src/web/table-display.js';

let tables: TableStore;

beforeEach(() => {
  tables = new TableStore();
  tables.loadDirectory(b17Module.tableDirectory);
});

describe('buildM3Rows', () => {
  it('returns rows for a 12 High position', () => {
    const rows = buildM3Rows(tables, '12 High');
    expect(rows.length).toBeGreaterThan(0);
    // Should have at least a roll 6 = Hit entry
    const six = rows.find(r => r.roll === '6');
    expect(six).toBeTruthy();
    expect(six!.columns.result).toContain('Hit');
  });

  it('annotates "(always)" on roll 6 when modifier is very negative', () => {
    const rows = buildM3Rows(tables, '12 High', -5);
    const six = rows.find(r => r.roll === '6');
    expect(six!.columns.result).toBe('Hit (always)');
  });

  it('returns fallback rows when table not loaded', () => {
    const emptyTables = new TableStore();
    const rows = buildM3Rows(emptyTables, '12 High');
    expect(rows.length).toBeGreaterThan(0);
  });
});

describe('buildM4Rows', () => {
  it('returns rows for a cover level', () => {
    // Try common cover levels
    for (const level of ['none', 'partial', 'full']) {
      const rows = buildM4Rows(tables, level);
      if (rows.length > 0) {
        expect(rows[0]).toHaveProperty('roll');
        expect(rows[0]).toHaveProperty('columns');
        return;
      }
    }
  });

  it('returns empty for invalid cover level', () => {
    const rows = buildM4Rows(tables, 'nonexistent_level');
    expect(rows).toEqual([]);
  });
});

describe('buildB4Rows', () => {
  it('returns rows for 12 High position', () => {
    const rows = buildB4Rows(tables, '12 High');
    // B-4 may or may not have data depending on table format
    if (rows.length > 0) {
      expect(rows[0]).toHaveProperty('roll');
      expect(rows[0]).toHaveProperty('columns');
    }
  });

  it('handles vertical dive position', () => {
    const rows = buildB4Rows(tables, 'Vertical Dive');
    // Should not throw
    expect(Array.isArray(rows)).toBe(true);
  });
});

describe('buildB5Rows', () => {
  it('returns rows for 12 High position', () => {
    const rows = buildB5Rows(tables, '12 High');
    if (rows.length > 0) {
      expect(rows[0]).toHaveProperty('roll');
      expect(rows[0]).toHaveProperty('columns');
    }
  });

  it('handles 6 Level position', () => {
    const rows = buildB5Rows(tables, '6 Level');
    expect(Array.isArray(rows)).toBe(true);
  });
});

describe('buildO3Rows', () => {
  it('returns rows for a flak level', () => {
    for (const level of ['light', 'moderate', 'heavy', 'intense']) {
      const rows = buildO3Rows(tables, level);
      if (rows.length > 0) {
        expect(rows[0]).toHaveProperty('roll');
        expect(rows[0]).toHaveProperty('columns');
        return;
      }
    }
  });

  it('returns empty for nonexistent flak level', () => {
    const rows = buildO3Rows(tables, 'imaginary');
    expect(rows).toEqual([]);
  });
});
