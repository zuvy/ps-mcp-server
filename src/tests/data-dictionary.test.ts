import { describe, it, expect, beforeAll } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';
import { DataDictionary } from '../lib/data-dictionary.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CSV_PATH = path.join(__dirname, '..', '..', '.docs', 'data_dictionary.csv');

let dict: DataDictionary;

beforeAll(() => {
  dict = DataDictionary.load(CSV_PATH);
});

describe('DataDictionary', () => {
  it('loads tables', () => {
    expect(dict.tableCount).toBeGreaterThan(0);
  });

  it('finds STUDENTS table', () => {
    const t = dict.getTable('STUDENTS');
    expect(t).toBeDefined();
    expect(t!.name).toBe('STUDENTS');
    expect(t!.fields.size).toBeGreaterThan(0);
  });

  it('is case-insensitive for table lookup', () => {
    expect(dict.getTable('students')).toBeDefined();
    expect(dict.getTable('Students')).toBeDefined();
  });

  it('finds a known field', () => {
    const f = dict.getField('STUDENTS', 'DCID');
    expect(f).toBeDefined();
  });

  it('hasField returns true for known field', () => {
    expect(dict.hasField('STUDENTS', 'DCID')).toBe(true);
  });

  it('hasField returns false for unknown field', () => {
    expect(dict.hasField('STUDENTS', 'NOTAFIELD_XYZ')).toBe(false);
  });

  it('hasTable returns false for unknown table', () => {
    expect(dict.hasTable('NOTATABLE_XYZ')).toBe(false);
  });

  it('getCustomTables returns U_-prefixed tables', () => {
    const custom = dict.getCustomTables();
    expect(custom.length).toBeGreaterThan(0);
    for (const t of custom) {
      expect(t.name.startsWith('U_')).toBe(true);
    }
  });

  it('searchTables finds tables by keyword', () => {
    const results = dict.searchTables('student');
    expect(results.length).toBeGreaterThan(0);
  });

  it('tableToJson serialises Map fields to array', () => {
    const t = dict.getTable('STUDENTS')!;
    const json = dict.tableToJson(t) as Record<string, unknown>;
    expect(Array.isArray(json['fields'])).toBe(true);
  });
});
