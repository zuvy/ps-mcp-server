import { XMLParser } from 'fast-xml-parser';
import { create } from 'xmlbuilder2';
import fs from 'fs';
import path from 'path';

// ---- Types -----------------------------------------------------------------

export interface QueryArg {
  name: string;
  type?: string;
  /** TABLE.FIELD reference for type="array" args */
  column?: string;
  required?: boolean;
  description?: string;
  /** PS expression default, e.g. "~(curyearid)" */
  default?: string;
}

export interface QueryColumn {
  /** TABLE.FIELD reference (Pattern A: column attr; Pattern B: text content) */
  fieldRef: string;
  /** Display alias (Pattern A: text content; Pattern B: description attr) */
  alias?: string;
  /** Human-readable label (Pattern B: description attr) */
  description?: string;
}

export interface NamedQuery {
  name: string;
  coreTable?: string;
  flattened?: boolean;
  dat?: boolean;
  summary?: string;
  description?: string;
  args: QueryArg[];
  columns: QueryColumn[];
  sql: string;
}

export interface QueryFile {
  queries: NamedQuery[];
  /** Absolute path to the source file */
  sourceFile?: string;
}

// ---- Parser ----------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Obj = Record<string, any>;

function asStr(v: unknown): string | undefined {
  if (typeof v === 'string' && v.trim() !== '') return v.trim();
  return undefined;
}

function asBool(v: unknown, fallback?: boolean): boolean | undefined {
  if (v === 'true' || v === true) return true;
  if (v === 'false' || v === false) return false;
  return fallback;
}

const QUERY_PARSER = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  allowBooleanAttributes: true,
  isArray: (name) => ['query', 'column', 'arg'].includes(name),
  textNodeName: '#text',
  // CDATA is automatically merged with text content by default
  cdataPropName: false as unknown as string,
  processEntities: false,
});

function parseColumn(c: Obj): QueryColumn {
  const colAttr = asStr(c['@_column']);
  const descAttr = asStr(c['@_description']);
  const textContent = asStr(c['#text']);

  if (colAttr) {
    // Pattern A: column attr = TABLE.FIELD, text = alias
    return { fieldRef: colAttr, alias: textContent };
  }
  // Pattern B: description attr = label, text = TABLE.FIELD
  return { fieldRef: textContent ?? '', description: descAttr, alias: descAttr };
}

function parseArg(a: Obj): QueryArg {
  const required = asBool(a['@_required']);
  return {
    name: asStr(a['@_name']) ?? '',
    ...(asStr(a['@_type']) ? { type: a['@_type'] } : {}),
    ...(asStr(a['@_column']) ? { column: a['@_column'] } : {}),
    ...(required !== undefined ? { required } : {}),
    ...(asStr(a['@_description']) ? { description: a['@_description'] } : {}),
    ...(asStr(a['@_default']) ? { default: a['@_default'] } : {}),
  };
}

export function parseQueryXml(xmlString: string): QueryFile {
  const parsed = QUERY_PARSER.parse(xmlString) as Obj;
  const queriesBlock: Obj = parsed['queries'] ?? {};

  const rawQueries: unknown[] = Array.isArray(queriesBlock['query'])
    ? queriesBlock['query']
    : queriesBlock['query']
    ? [queriesBlock['query']]
    : [];

  const queries: NamedQuery[] = rawQueries.map((q) => {
    const qobj = q as Obj;

    // Args
    const argsBlock = qobj['args'];
    const rawArgs: unknown[] =
      argsBlock && typeof argsBlock === 'object' && argsBlock['arg']
        ? Array.isArray(argsBlock['arg'])
          ? argsBlock['arg']
          : [argsBlock['arg']]
        : [];

    // Columns
    const colsBlock = qobj['columns'];
    const rawCols: unknown[] =
      colsBlock && typeof colsBlock === 'object' && colsBlock['column']
        ? Array.isArray(colsBlock['column'])
          ? colsBlock['column']
          : [colsBlock['column']]
        : [];

    // SQL — may be text or object with #text
    let sql = '';
    const sqlRaw = qobj['sql'];
    if (typeof sqlRaw === 'string') {
      sql = sqlRaw.trim();
    } else if (sqlRaw && typeof sqlRaw === 'object') {
      const sqlText = asStr(sqlRaw['#text']) ?? asStr(sqlRaw['__cdata']) ?? '';
      sql = sqlText;
    }

    return {
      name: asStr(qobj['@_name']) ?? '',
      // Preserve empty string coreTable="" — valid per PS spec for multi-table queries
      ...('@_coreTable' in qobj ? { coreTable: typeof qobj['@_coreTable'] === 'string' ? qobj['@_coreTable'] : '' } : {}),
      flattened: asBool(qobj['@_flattened'], true),
      ...(qobj['@_dat'] === 'true' || qobj['@_dat'] === true ? { dat: true } : {}),
      ...(asStr(qobj['summary']) ? { summary: asStr(qobj['summary']) } : {}),
      ...(asStr(qobj['description']) ? { description: asStr(qobj['description']) } : {}),
      args: rawArgs.map((a) => parseArg(a as Obj)),
      columns: rawCols.map((c) => parseColumn(c as Obj)),
      sql,
    };
  });

  return { queries };
}

export function readQueryXml(filePath: string): QueryFile {
  const xml = fs.readFileSync(filePath, 'utf-8');
  const result = parseQueryXml(xml);
  result.sourceFile = filePath;
  return result;
}

/** Read all *.named_queries.xml files in a directory */
export function readQueryDir(dirPath: string): QueryFile[] {
  if (!fs.existsSync(dirPath)) return [];
  const files = fs.readdirSync(dirPath).filter((f) => f.endsWith('.named_queries.xml'));
  return files.map((f) => readQueryXml(path.join(dirPath, f)));
}

// ---- Builder ---------------------------------------------------------------

export function buildQueryXml(file: QueryFile): string {
  const doc = create({ version: '1.0', encoding: 'UTF-8' });
  const queries = doc.ele('queries');

  for (const q of file.queries) {
    const attrs: Record<string, string> = { name: q.name };
    if (q.coreTable !== undefined) attrs['coreTable'] = q.coreTable;
    if (q.flattened !== undefined) attrs['flattened'] = String(q.flattened);
    if (q.dat) attrs['dat'] = 'true';

    const qEl = queries.ele('query', attrs);

    if (q.summary) qEl.ele('summary').txt(q.summary);
    if (q.description) qEl.ele('description').txt(q.description);

    const argsEl = qEl.ele('args');
    for (const arg of q.args) {
      const argAttrs: Record<string, string> = { name: arg.name };
      if (arg.type) argAttrs['type'] = arg.type;
      if (arg.column) argAttrs['column'] = arg.column;
      if (arg.required !== undefined) argAttrs['required'] = String(arg.required);
      if (arg.description) argAttrs['description'] = arg.description;
      if (arg.default !== undefined) argAttrs['default'] = arg.default;
      argsEl.ele('arg', argAttrs);
    }

    const colsEl = qEl.ele('columns');
    for (const col of q.columns) {
      if (col.alias && col.fieldRef && !col.description) {
        // Pattern A: column attr + text alias
        colsEl.ele('column', { column: col.fieldRef }).txt(col.alias);
      } else {
        // Pattern B: description attr + text fieldRef
        const colAttrs: Record<string, string> = {};
        if (col.description) colAttrs['description'] = col.description;
        colsEl.ele('column', colAttrs).txt(col.fieldRef);
      }
    }

    // SQL with CDATA
    qEl.ele('sql').dat(q.sql.trim() ? `\n      ${q.sql.trim()}\n    ` : '');
  }

  return doc.end({ prettyPrint: true });
}

export function writeQueryXml(filePath: string, file: QueryFile): void {
  fs.writeFileSync(filePath, buildQueryXml(file), 'utf-8');
}

// ---- Utilities -------------------------------------------------------------

/**
 * Extract all TABLE.FIELD references from a query file (both column patterns
 * and <!-- access: TABLE.FIELD --> annotation comments).
 */
export function extractFieldRefs(file: QueryFile): Array<{ table: string; field: string }> {
  const refs: Array<{ table: string; field: string }> = [];
  const seen = new Set<string>();

  function addRef(raw: string) {
    const m = raw.trim().match(/^([^.]+)\.([^.]+)$/);
    if (!m) return;
    const key = `${m[1]!.toUpperCase()}.${m[2]!.toUpperCase()}`;
    if (!seen.has(key)) {
      seen.add(key);
      refs.push({ table: m[1]!.toUpperCase(), field: m[2]!.toUpperCase() });
    }
  }

  for (const q of file.queries) {
    for (const col of q.columns) {
      if (col.fieldRef) addRef(col.fieldRef);
    }
    for (const arg of q.args) {
      if (arg.column) addRef(arg.column);
    }
  }

  return refs;
}

/**
 * Extract :paramname references from a SQL string.
 */
export function extractSqlParams(sql: string): string[] {
  const params = new Set<string>();
  for (const m of sql.matchAll(/:([a-zA-Z_][a-zA-Z0-9_]*)/g)) {
    params.add(m[1]!.toLowerCase());
  }
  return Array.from(params);
}
