import fs from 'fs';
import { parse } from 'csv-parse/sync';

// CSV columns: CORE_TABLE, TABLE_NAME, FIELD_NAME, TABLE_TITLE, TABLE_DESC,
//              FIELD_VERSION, FIELD_DATA_TYPE, FIELD_DESC, IS_CORE

export interface DictField {
  name: string;
  dataType: string;
  description: string;
  version: string;
}

export interface DictTable {
  name: string;
  coreTable: string;
  title: string;
  description: string;
  isCore: boolean;
  fields: Map<string, DictField>;
}

interface CsvRow {
  CORE_TABLE: string;
  TABLE_NAME: string;
  FIELD_NAME: string;
  TABLE_TITLE: string;
  TABLE_DESC: string;
  FIELD_VERSION: string;
  FIELD_DATA_TYPE: string;
  FIELD_DESC: string;
  IS_CORE: string;
}

export class DataDictionary {
  /** Keyed by uppercase TABLE_NAME */
  private readonly _tables = new Map<string, DictTable>();

  private constructor() {}

  static load(csvPath: string): DataDictionary {
    const dict = new DataDictionary();
    const content = fs.readFileSync(csvPath, 'utf8');
    const rows: CsvRow[] = parse(content, {
      columns: true,
      skip_empty_lines: true,
      relax_quotes: true,
    });

    for (const row of rows) {
      const tableName = row.TABLE_NAME.toUpperCase();
      let table = dict._tables.get(tableName);
      if (!table) {
        table = {
          name: tableName,
          coreTable: row.CORE_TABLE.toUpperCase(),
          title: row.TABLE_TITLE,
          description: row.TABLE_DESC,
          isCore: row.IS_CORE === '1',
          fields: new Map(),
        };
        dict._tables.set(tableName, table);
      }
      if (row.FIELD_NAME) {
        table.fields.set(row.FIELD_NAME.toUpperCase(), {
          name: row.FIELD_NAME.toUpperCase(),
          dataType: row.FIELD_DATA_TYPE,
          description: row.FIELD_DESC,
          version: row.FIELD_VERSION,
        });
      }
    }

    return dict;
  }

  /** Look up a table by name (case-insensitive). */
  getTable(name: string): DictTable | undefined {
    return this._tables.get(name.toUpperCase());
  }

  /** Look up a specific field within a table. */
  getField(table: string, field: string): DictField | undefined {
    return this._tables.get(table.toUpperCase())?.fields.get(field.toUpperCase());
  }

  /** Returns true if the table/field pair exists in the dictionary. */
  hasField(table: string, field: string): boolean {
    return this.getField(table, field) !== undefined;
  }

  /** Returns true if the table exists in the dictionary. */
  hasTable(name: string): boolean {
    return this._tables.has(name.toUpperCase());
  }

  /** All U_-prefixed tables (custom tables installed across PS). */
  getCustomTables(): DictTable[] {
    const results: DictTable[] = [];
    for (const table of this._tables.values()) {
      if (table.name.startsWith('U_')) results.push(table);
    }
    return results.sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Search tables by keyword (matches name, title, or description). */
  searchTables(query: string): DictTable[] {
    const q = query.toLowerCase();
    const results: DictTable[] = [];
    for (const table of this._tables.values()) {
      if (
        table.name.toLowerCase().includes(q) ||
        table.title.toLowerCase().includes(q) ||
        table.description.toLowerCase().includes(q)
      ) {
        results.push(table);
      }
    }
    return results.sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Search fields by keyword across all tables. */
  searchFields(query: string): Array<{ table: DictTable; field: DictField }> {
    const q = query.toLowerCase();
    const results: Array<{ table: DictTable; field: DictField }> = [];
    for (const table of this._tables.values()) {
      for (const field of table.fields.values()) {
        if (
          field.name.toLowerCase().includes(q) ||
          field.description.toLowerCase().includes(q)
        ) {
          results.push({ table, field });
        }
      }
    }
    return results;
  }

  get tableCount(): number {
    return this._tables.size;
  }

  /** All table names, sorted. */
  get tableNames(): string[] {
    return Array.from(this._tables.keys()).sort();
  }

  /** Serialise a table for JSON output (converts Map fields to array). */
  tableToJson(table: DictTable): object {
    return {
      name: table.name,
      coreTable: table.coreTable,
      title: table.title,
      description: table.description,
      isCore: table.isCore,
      fieldCount: table.fields.size,
      fields: Array.from(table.fields.values()),
    };
  }
}
