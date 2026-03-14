import fs from 'fs';
import path from 'path';
import { readQueryXml, extractFieldRefs } from './query-xml.js';
import { AccessField } from './plugin-xml.js';

// ---- Types -----------------------------------------------------------------

export interface FieldRef {
  table: string;
  field: string;
}

export interface AccessSyncDiff {
  added: FieldRef[];
  removed: FieldRef[];
  unchanged: FieldRef[];
}

// ---- Access comment extraction ---------------------------------------------

/**
 * Extract TABLE.FIELD references from <!-- access: TABLE.FIELD --> comments
 * anywhere in the raw XML string (Ruby uses `//columns/comment()` but scanning
 * the whole file captures the same references with lower complexity).
 */
export function extractAccessCommentFields(rawXml: string): FieldRef[] {
  const refs: FieldRef[] = [];
  // Match <!-- access: TABLE.FIELD --> (case-insensitive keyword, any whitespace)
  const pattern = /<!--\s*access:\s*([^\s.>]+)\.([^\s.>]+)\s*-->/gi;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(rawXml)) !== null) {
    refs.push({
      table: m[1]!.toUpperCase(),
      field: m[2]!.toUpperCase(),
    });
  }
  return refs;
}

// ---- Collect all field refs from queries_root ------------------------------

/**
 * Read every *.named_queries.xml in queriesDir and return a deduplicated,
 * uppercased, sorted set of TABLE.FIELD pairs — excluding U_* tables.
 * Mirrors sync_plugin_access_request.rb behavior.
 */
export function collectQueryFieldRefs(queriesDir: string): FieldRef[] {
  if (!fs.existsSync(queriesDir)) return [];

  const files = fs
    .readdirSync(queriesDir)
    .filter((f) => f.endsWith('.named_queries.xml'));

  const seen = new Set<string>();
  const refs: FieldRef[] = [];

  for (const file of files) {
    const fp = path.join(queriesDir, file);

    // Extract from parsed column elements (both Pattern A and B)
    try {
      const qf = readQueryXml(fp);
      for (const ref of extractFieldRefs(qf)) {
        const key = `${ref.table}.${ref.field}`;
        if (!seen.has(key)) {
          seen.add(key);
          refs.push(ref);
        }
      }
    } catch {
      // Ignore parse errors here — validate_named_queries handles those
    }

    // Extract from <!-- access: TABLE.FIELD --> comments in raw XML
    try {
      const rawXml = fs.readFileSync(fp, 'utf-8');
      for (const ref of extractAccessCommentFields(rawXml)) {
        const key = `${ref.table}.${ref.field}`;
        if (!seen.has(key)) {
          seen.add(key);
          refs.push(ref);
        }
      }
    } catch {
      // Ignore read errors
    }
  }

  // Filter out custom (U_*) tables — they don't need access_request declarations
  const coreOnly = refs.filter((r) => !r.table.startsWith('U_'));

  // Sort by table then field (mirrors Ruby .sort)
  return coreOnly.sort((a, b) => {
    if (a.table !== b.table) return a.table.localeCompare(b.table);
    return a.field.localeCompare(b.field);
  });
}

// ---- Diff ------------------------------------------------------------------

/**
 * Compare the freshly collected field refs against the existing access_request
 * fields in plugin.xml and return what would be added, removed, or unchanged.
 */
export function diffAccessRequest(
  incoming: FieldRef[],
  existing: AccessField[],
): AccessSyncDiff {
  const incomingKeys = new Set(incoming.map((r) => `${r.table}.${r.field}`));
  const existingKeys = new Set(
    existing.map((f) => `${f.table.toUpperCase()}.${f.field.toUpperCase()}`),
  );

  const added = incoming.filter((r) => !existingKeys.has(`${r.table}.${r.field}`));
  const removed = existing
    .filter((f) => !incomingKeys.has(`${f.table.toUpperCase()}.${f.field.toUpperCase()}`))
    .map((f) => ({ table: f.table.toUpperCase(), field: f.field.toUpperCase() }));
  const unchanged = incoming.filter((r) => existingKeys.has(`${r.table}.${r.field}`));

  return { added, removed, unchanged };
}
