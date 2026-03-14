import { XMLParser } from 'fast-xml-parser';
import { create } from 'xmlbuilder2';
import fs from 'fs';
import path from 'path';

// ---- Types -----------------------------------------------------------------

export type FieldType = 'String' | 'Integer' | 'Double' | 'Boolean' | 'Date' | 'Clob';
export type ExtensionType = 'one-to-one' | 'one-to-many' | 'independent';

export interface SchemaField {
  name: string;
  type: FieldType;
  /** Required for String type */
  length?: number;
  comment?: string;
}

export interface SchemaExtension {
  /** Value of <extensionname> element */
  extensionGroupName: string;
  /** coreTable attribute — CamelCase PS entity name (e.g. "Students", "Person") */
  coreTable?: string;
  /** dbTableName attribute — actual Oracle table (uppercase, U_-prefixed) */
  dbTableName: string;
  comment?: string;
  fields: SchemaField[];
  extensionType: ExtensionType;
  /** Path to the source XML file (populated by readSchemaDir) */
  sourceFile?: string;
}

// ---- Helpers ---------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Obj = Record<string, any>;

function asStr(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
}

function inferExtensionType(
  extensionGroupName: string,
  dbTableName: string,
  coreTable?: string,
): ExtensionType {
  if (!coreTable) return 'independent';
  // one-to-one: group name and table name are the same (or very close)
  if (extensionGroupName.toUpperCase() === dbTableName.toUpperCase()) return 'one-to-one';
  return 'one-to-many';
}

// ---- Parser ----------------------------------------------------------------

const SCHEMA_PARSER = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  allowBooleanAttributes: true,
  isArray: (name) => name === 'field',
  textNodeName: '#text',
});

export function parseSchemaXml(xmlString: string): SchemaExtension {
  const parsed = SCHEMA_PARSER.parse(xmlString) as Obj;
  const root: Obj =
    parsed['psExtension'] ??
    // Some older files may use different roots — fall back gracefully
    Object.values(parsed).find((v) => v && typeof v === 'object') ??
    {};

  const extensionGroupName =
    asStr(root['extensionname']) ?? asStr(root['extensionName']) ?? '';

  const et: Obj =
    root['extendedTable'] ??
    root['ExtendedTable'] ??
    {};

  const coreTable = asStr(et['@_coreTable']) ?? asStr(et['@_CoreTable']);
  const dbTableName = asStr(et['@_dbTableName']) ?? asStr(et['@_DBTableName']) ?? extensionGroupName;
  const comment = asStr(et['@_comment']) ?? asStr(et['@_Comment']);

  const rawFields: unknown[] = Array.isArray(et['field'])
    ? et['field']
    : et['field']
    ? [et['field']]
    : [];

  const fields: SchemaField[] = rawFields.map((f) => {
    const fobj = f as Obj;
    const type = (asStr(fobj['@_type']) ?? 'String') as FieldType;
    const lengthRaw = fobj['@_length'];
    const length =
      type === 'String' && lengthRaw !== undefined
        ? parseInt(String(lengthRaw), 10) || undefined
        : undefined;
    return {
      name: asStr(fobj['@_name']) ?? '',
      type,
      ...(length !== undefined ? { length } : {}),
      ...(asStr(fobj['@_comment']) ? { comment: fobj['@_comment'] } : {}),
    };
  });

  const extensionType = inferExtensionType(extensionGroupName, dbTableName, coreTable);

  return {
    extensionGroupName,
    coreTable,
    dbTableName,
    comment,
    fields,
    extensionType,
  };
}

export function readSchemaXml(filePath: string): SchemaExtension {
  const xml = fs.readFileSync(filePath, 'utf-8');
  const ext = parseSchemaXml(xml);
  ext.sourceFile = filePath;
  return ext;
}

/** Read all *.xml files from a user_schema_root directory */
export function readSchemaDir(dirPath: string): SchemaExtension[] {
  if (!fs.existsSync(dirPath)) return [];
  const files = fs.readdirSync(dirPath).filter((f) => f.endsWith('.xml'));
  return files.map((f) => readSchemaXml(path.join(dirPath, f)));
}

// ---- Builder ---------------------------------------------------------------

/**
 * Build the PS HTML reference syntax for an extension so the developer can
 * immediately use the correct tags in custom pages.
 */
export function buildHtmlReference(ext: SchemaExtension): {
  fieldPattern?: string;
  tlistTag?: string;
  directTableSelect?: string;
  notes: string[];
} {
  const group = ext.extensionGroupName.toUpperCase();
  const table = ext.dbTableName.toUpperCase();
  const core = (ext.coreTable ?? '').toUpperCase();
  const fieldNames = ext.fields.map((f) => f.name).join(',');
  const fieldLabels = ext.fields.map((f) => f.name).join(',');

  if (ext.extensionType === 'one-to-one') {
    return {
      fieldPattern: `name="[${ext.coreTable}.${ext.extensionGroupName}]FieldName" (form input) / ~([${ext.coreTable}.${ext.extensionGroupName}]FieldName) (display)`,
      notes: [
        `One-to-one: access individual fields via ~([${ext.coreTable}.${ext.extensionGroupName}]FieldName)`,
      ],
    };
  }

  if (ext.extensionType === 'one-to-many') {
    return {
      tlistTag: `~[tlist_child:${core}.${group}.${table};displaycols:${fieldNames};fieldNames:${fieldLabels};type:html]`,
      directTableSelect: `~[DirectTable.Select:${table};ID:~(gpv.id)]`,
      notes: [
        `Special displaycols: ID (record PK), ${core}DCID (parent FK)`,
        `tlist type:json outputs a JSON array — useful for custom JavaScript UIs`,
        `DirectTable.Select must be placed inside <form> and before any <input> tags`,
      ],
    };
  }

  // independent
  return {
    tlistTag: `~[tlist_standalone:${group}.${table};displaycols:${fieldNames};fieldNames:${fieldLabels};type:html]`,
    directTableSelect: `~[DirectTable.Select:${table};ID:~(gpv.id)]`,
    notes: [
      `Special displaycols: ID (auto-created, always available)`,
      `tlist type:json outputs a JSON array — useful for custom JavaScript UIs`,
      `DirectTable.Select must be placed inside <form> and before any <input> tags`,
    ],
  };
}

export function buildSchemaXml(ext: SchemaExtension): string {
  const doc = create({ version: '1.0' });
  const root = doc.ele('psExtension', {
    xmlns: 'http://www.powerschool.com',
    'xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
    'xsi:schemaLocation': 'http://www.powerschool.com psextension.xsd',
  });

  root.ele('extensionname').txt(ext.extensionGroupName);

  const tableAttrs: Record<string, string> = {
    dbTableName: ext.dbTableName,
  };
  if (ext.coreTable) tableAttrs['coreTable'] = ext.coreTable;
  if (ext.comment) tableAttrs['comment'] = ext.comment;

  const etEl = root.ele('extendedTable', tableAttrs);

  for (const field of ext.fields) {
    const fieldAttrs: Record<string, string> = {
      name: field.name,
      type: field.type,
    };
    if (field.type === 'String' && field.length !== undefined) {
      fieldAttrs['length'] = String(field.length);
    }
    if (field.comment) fieldAttrs['comment'] = field.comment;
    etEl.ele('field', fieldAttrs);
  }

  return doc.end({ prettyPrint: true });
}

export function writeSchemaXml(filePath: string, ext: SchemaExtension): void {
  fs.writeFileSync(filePath, buildSchemaXml(ext), 'utf-8');
}
