import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import { WorkspaceContext } from '../lib/workspace.js';
import { DataDictionary } from '../lib/data-dictionary.js';
import {
  SchemaExtension,
  SchemaField,
  FieldType,
  ExtensionType,
  readSchemaDir,
  readSchemaXml,
  writeSchemaXml,
  buildHtmlReference,
} from '../lib/schema-xml.js';

// ---- Helpers ---------------------------------------------------------------

function requireWorkspace(getWorkspace: () => WorkspaceContext | null): WorkspaceContext {
  const ws = getWorkspace();
  if (!ws) {
    throw new Error(
      'No plugin workspace detected. Set PS_PLUGIN_ROOT to the plugin src directory, or open a folder containing plugin.xml.',
    );
  }
  return ws;
}

function normalizeGroupName(name: string): string {
  const upper = name.toUpperCase();
  return upper.startsWith('U_') ? upper : `U_${upper}`;
}

const FIELD_SCHEMA = z.object({
  name: z.string().describe('Field name (will be stored as-is in XML)'),
  type: z
    .enum(['String', 'Integer', 'Double', 'Boolean', 'Date', 'Clob'])
    .describe('PS field type'),
  length: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Required for String type — max character length'),
  description: z.string().optional().describe('Developer comment for this field'),
});

// ---- list_custom_tables ----------------------------------------------------

function registerListCustomTables(server: McpServer, dict: DataDictionary): void {
  server.tool(
    'list_custom_tables',
    'Query the data dictionary for all U_-prefixed custom tables known to PowerSchool. Results are informational — they reflect what is in the data dictionary, not necessarily what is installed on a specific PS instance.',
    {
      filter: z
        .string()
        .optional()
        .describe('Optional keyword to narrow results (case-insensitive match on table name or description)'),
    },
    async ({ filter }) => {
      const tables = dict.getCustomTables();
      const filtered = filter
        ? tables.filter(
            (t) =>
              t.name.toLowerCase().includes(filter.toLowerCase()) ||
              (t.description ?? '').toLowerCase().includes(filter.toLowerCase()),
          )
        : tables;

      const result = filtered.map((t) => ({
        tableName: t.name,
        tableTitle: t.title ?? null,
        tableDescription: t.description ?? null,
        fieldCount: t.fields.size,
        coreTable: t.coreTable ?? null,
      }));

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ count: result.length, tables: result }, null, 2),
          },
        ],
      };
    },
  );
}

// ---- list_db_extensions ----------------------------------------------------

function registerListDbExtensions(server: McpServer, getWorkspace: () => WorkspaceContext | null): void {
  server.tool(
    'list_db_extensions',
    'List all user schema extension definitions in the current workspace (user_schema_root/*.xml). Includes the PS HTML reference syntax for each extension.',
    {},
    async () => {
      const ws = requireWorkspace(getWorkspace);
      const schemaDir = ws.dirs.userSchemaRoot;

      if (!schemaDir || !fs.existsSync(schemaDir)) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                count: 0,
                extensions: [],
                note: 'No user_schema_root directory found in workspace.',
              }),
            },
          ],
        };
      }

      const extensions = readSchemaDir(schemaDir);
      const result = extensions.map((ext) => ({
        file: path.basename(ext.sourceFile ?? ''),
        extensionGroupName: ext.extensionGroupName,
        tableName: ext.dbTableName,
        coreTable: ext.coreTable ?? null,
        extensionType: ext.extensionType,
        fieldCount: ext.fields.length,
        fields: ext.fields.map((f) => ({
          name: f.name,
          type: f.type,
          ...(f.length !== undefined ? { length: f.length } : {}),
        })),
        htmlReferenceExample: buildHtmlReference(ext),
      }));

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ count: result.length, extensions: result }, null, 2),
          },
        ],
      };
    },
  );
}

// ---- analyze_schema --------------------------------------------------------

function registerAnalyzeSchema(
  server: McpServer,
  dict: DataDictionary,
  getWorkspace: () => WorkspaceContext | null,
): void {
  server.tool(
    'analyze_schema',
    'Query the data dictionary and workspace user_schema_root to surface existing custom tables and extensions, then recommend whether to extend an existing table or create a new one. Call this before scaffold_db_extension.',
    {
      purpose: z
        .string()
        .describe(
          'Plain-language description of what data you want to store (e.g. "track student library checkouts")',
        ),
      coreTable: z
        .string()
        .optional()
        .describe(
          'The PS entity name the data relates to, if known (e.g. "Students", "Teachers", "Person"). CamelCase PS entity name.',
        ),
    },
    async ({ purpose, coreTable }) => {
      const ws = getWorkspace();
      const schemaDir = ws?.dirs.userSchemaRoot;
      const purposeLower = purpose.toLowerCase();
      const keywords = purposeLower.split(/\s+/).filter((w) => w.length > 2);

      // 1. Match U_-prefixed tables from data dictionary
      const customTables = dict.getCustomTables();
      const dictMatches = customTables.filter((t) => {
        const haystack = `${t.name} ${t.title ?? ''} ${t.description ?? ''}`.toLowerCase();
        return keywords.some((k) => haystack.includes(k));
      });

      // 2. Read workspace schema files
      const workspaceExtensions: SchemaExtension[] =
        schemaDir && fs.existsSync(schemaDir) ? readSchemaDir(schemaDir) : [];

      const workspaceMatches = workspaceExtensions.filter((ext) => {
        const haystack = `${ext.extensionGroupName} ${ext.dbTableName} ${ext.comment ?? ''} ${ext.fields.map((f) => f.name).join(' ')}`.toLowerCase();
        return keywords.some((k) => haystack.includes(k));
      });

      // 3. Core table filter if specified
      const coreMatchFromDict = coreTable
        ? customTables.filter(
            (t) =>
              (t.coreTable ?? '').toLowerCase() === coreTable.toLowerCase() ||
              t.name.toUpperCase().includes(coreTable.toUpperCase()),
          )
        : [];
      const coreMatchFromWorkspace = coreTable
        ? workspaceExtensions.filter(
            (ext) =>
              (ext.coreTable ?? '').toLowerCase() === coreTable.toLowerCase(),
          )
        : [];

      // 4. Build recommendation
      const hasWorkspaceMatch = workspaceMatches.length > 0 || coreMatchFromWorkspace.length > 0;
      const hasDictMatch = dictMatches.length > 0 || coreMatchFromDict.length > 0;

      let recommendation: string;
      let suggestedAction: string;
      let suggestedExtensionType: ExtensionType | null = null;
      let nextStep: string;

      if (hasWorkspaceMatch) {
        recommendation = 'An existing extension in this workspace may already fit your needs. Consider adding fields to it rather than creating a new table.';
        suggestedAction = 'extend-existing';
        nextStep = 'Call add_field_to_extension with the extensionGroupName of the matching extension.';
      } else if (hasDictMatch) {
        recommendation = 'Custom tables matching your purpose exist in the PS data dictionary (installed on PS). These may be from another plugin — review before creating a duplicate.';
        suggestedAction = 'review-dict-then-decide';
        nextStep = 'If none of these tables belong to your plugin, call scaffold_db_extension to create a new one.';
      } else {
        recommendation = 'No matching custom schema found. Creating a new extension is the right approach.';
        suggestedAction = 'create-new';

        // Infer extension type
        if (!coreTable) {
          suggestedExtensionType = 'independent';
          nextStep = 'Call scaffold_db_extension with extensionType: "independent" (no parent table link needed).';
        } else {
          suggestedExtensionType = 'one-to-one';
          nextStep = `Call scaffold_db_extension with extensionType: "one-to-one" and coreTable: "${coreTable}" for a single-record-per-parent extension. Use "one-to-many" if multiple records per parent are needed.`;
        }
      }

      // 5. Staff/FRN warning
      const staffWarning =
        coreTable && ['teachers', 'users'].includes(coreTable.toLowerCase())
          ? `⚠️ Staff table warning: Staff page links must use explicit FRN syntax 204~([teachers]USERS_DCID) instead of ~(frn). The Unified Teacher Record splits TEACHERS into USERS (table 204) and SCHOOLSTAFF (table 203). Using ~(frn) will not correctly link tlist_child records for extensions on the Users table.`
          : null;

      // 6. Student contacts warning
      const contactsWarning =
        coreTable &&
        ['person', 'studentcontactdetail', 'studentcontactassoc', 'personaddressassoc'].includes(
          coreTable.toLowerCase(),
        )
          ? `ℹ️ Student contacts note: Extensions on ${coreTable} are accessed via the /ws/contacts/ API (not /ws/schema/table/). Loading extension data in the browser requires calling psCustomizationUtils.addExtensions([{url: '/ws/contacts/contact/{id}', extensions:'u_table_name'}]) in injected JavaScript. The tlist_child pattern does NOT apply to these tables.`
          : null;

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                purpose,
                coreTable: coreTable ?? null,
                recommendation,
                suggestedAction,
                suggestedExtensionType,
                nextStep,
                warnings: [staffWarning, contactsWarning].filter(Boolean),
                workspaceMatches: workspaceMatches.map((ext) => ({
                  file: path.basename(ext.sourceFile ?? ''),
                  extensionGroupName: ext.extensionGroupName,
                  dbTableName: ext.dbTableName,
                  extensionType: ext.extensionType,
                  fieldCount: ext.fields.length,
                  fields: ext.fields.map((f) => f.name),
                })),
                dictionaryMatches: [...dictMatches, ...coreMatchFromDict]
                  .filter((t, i, arr) => arr.findIndex((x) => x.name === t.name) === i)
                  .slice(0, 20)
                  .map((t) => ({
                    tableName: t.name,
                    coreTable: t.coreTable ?? null,
                    fieldCount: t.fields.size,
                    description: t.description ?? null,
                  })),
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );
}

// ---- scaffold_db_extension -------------------------------------------------

function registerScaffoldDbExtension(
  server: McpServer,
  getWorkspace: () => WorkspaceContext | null,
): void {
  server.tool(
    'scaffold_db_extension',
    'Generate a user_schema_root XML file defining a new custom table extension. Returns the PS HTML reference syntax so the developer can immediately use the correct tags in custom pages.',
    {
      extensionType: z
        .enum(['one-to-one', 'one-to-many', 'independent'])
        .describe('How this table relates to the core table'),
      coreTable: z
        .string()
        .optional()
        .describe(
          'CamelCase PS entity name for the core table (e.g. "Students", "Person"). Required for one-to-one and one-to-many. Omit for independent.',
        ),
      extensionGroupName: z
        .string()
        .describe(
          'Extension group name — maps to <extensionname> in XML. Will be uppercased and U_-prefixed if missing (e.g. "Laptop" → "U_LAPTOP").',
        ),
      tableName: z
        .string()
        .optional()
        .describe(
          'Actual DB table name (dbTableName in XML). Defaults to extensionGroupName for one-to-one. Required for one-to-many and independent when table name differs from group name.',
        ),
      comment: z.string().optional().describe('Optional comment for the extendedTable element'),
      fields: z.array(FIELD_SCHEMA).describe('Fields to include in this extension'),
      includeTrackingFields: z
        .boolean()
        .default(true)
        .describe(
          'Add conventional WhoModifiedId (Integer) and WhenModified (Date) tracking fields. Default: true.',
        ),
      force: z
        .boolean()
        .default(false)
        .describe('Overwrite existing file without prompting (default: false)'),
    },
    async (params) => {
      const ws = requireWorkspace(getWorkspace);
      const schemaDir = ws.dirs.userSchemaRoot;

      if (!schemaDir) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                error: 'No user_schema_root directory found in workspace. Create the directory first.',
                expectedPath: path.join(ws.artifactsRoot, 'user_schema_root'),
              }),
            },
          ],
          isError: true,
        };
      }

      // Validate: coreTable required for non-independent
      if (params.extensionType !== 'independent' && !params.coreTable) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                error: `coreTable is required for extensionType "${params.extensionType}"`,
              }),
            },
          ],
          isError: true,
        };
      }

      const extensionGroupName = normalizeGroupName(params.extensionGroupName);
      const dbTableName = params.tableName
        ? normalizeGroupName(params.tableName)
        : extensionGroupName;

      // Build fields — add DCID FK for 1:1 and 1:many if not already present
      const allFields: SchemaField[] = [];

      if (
        params.extensionType !== 'independent' &&
        params.coreTable
      ) {
        const fkName = `${params.coreTable.toUpperCase()}DCID`;
        if (!params.fields.some((f) => f.name.toUpperCase() === fkName)) {
          allFields.push({ name: fkName, type: 'Integer' as FieldType });
        }
      }

      for (const f of params.fields) {
        if (f.type === 'String' && !f.length) {
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({
                  error: `Field "${f.name}" has type String but no length specified. String fields require a length.`,
                }),
              },
            ],
            isError: true,
          };
        }
        allFields.push({
          name: f.name,
          type: f.type as FieldType,
          ...(f.length !== undefined ? { length: f.length } : {}),
          ...(f.description ? { comment: f.description } : {}),
        });
      }

      if (params.includeTrackingFields) {
        if (!allFields.some((f) => f.name.toUpperCase() === 'WHOMODIFIEDID')) {
          allFields.push({ name: 'WhoModifiedId', type: 'Integer' });
        }
        if (!allFields.some((f) => f.name.toUpperCase() === 'WHENMODIFIED')) {
          allFields.push({ name: 'WhenModified', type: 'Date' });
        }
      }

      const ext: SchemaExtension = {
        extensionGroupName,
        coreTable: params.coreTable,
        dbTableName,
        comment: params.comment,
        fields: allFields,
        extensionType: params.extensionType,
      };

      // Determine output filename: default to {tableName}.xml (lowercase)
      const fileName = `${dbTableName.toLowerCase()}.xml`;
      const filePath = path.join(schemaDir, fileName);

      if (fs.existsSync(filePath) && !params.force) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                error: `File already exists: ${filePath}`,
                hint: 'Pass force: true to overwrite.',
              }),
            },
          ],
          isError: true,
        };
      }

      fs.mkdirSync(schemaDir, { recursive: true });
      writeSchemaXml(filePath, ext);

      const htmlRef = buildHtmlReference(ext);

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                success: true,
                file: fileName,
                path: filePath,
                extensionGroupName,
                dbTableName,
                coreTable: params.coreTable ?? null,
                extensionType: params.extensionType,
                fieldCount: allFields.length,
                fields: allFields.map((f) => ({ name: f.name, type: f.type })),
                htmlReference: htmlRef,
                notes: [
                  'PS auto-creates an internal ID (auto-sequence primary key) — do not declare it in the XML.',
                  params.extensionType !== 'independent'
                    ? `The ${params.coreTable?.toUpperCase()}DCID foreign key links this extension to the parent record.`
                    : null,
                ].filter(Boolean),
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );
}

// ---- add_field_to_extension ------------------------------------------------

function registerAddFieldToExtension(
  server: McpServer,
  getWorkspace: () => WorkspaceContext | null,
): void {
  server.tool(
    'add_field_to_extension',
    'Add one or more fields to an existing user_schema_root XML file in the workspace. Use when analyze_schema recommends extending an existing table.',
    {
      extensionGroupName: z
        .string()
        .describe(
          'Group name matching an existing file in user_schema_root/ (e.g. "U_LAPTOP" matches u_laptop.xml)',
        ),
      fields: z.array(FIELD_SCHEMA).describe('Fields to add'),
    },
    async ({ extensionGroupName, fields }) => {
      const ws = requireWorkspace(getWorkspace);
      const schemaDir = ws.dirs.userSchemaRoot;

      if (!schemaDir || !fs.existsSync(schemaDir)) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ error: 'No user_schema_root directory found in workspace.' }),
            },
          ],
          isError: true,
        };
      }

      // Find the matching file
      const allFiles = fs.readdirSync(schemaDir).filter((f) => f.endsWith('.xml'));
      const targetFile = allFiles.find((f) => {
        const base = f.replace(/\.xml$/, '').toUpperCase();
        return (
          base === extensionGroupName.toUpperCase() ||
          base === normalizeGroupName(extensionGroupName).toUpperCase()
        );
      });

      if (!targetFile) {
        // Try by reading each file and matching extensionGroupName inside XML
        const byContent = allFiles.find((f) => {
          try {
            const ext = readSchemaXml(path.join(schemaDir, f));
            return ext.extensionGroupName.toUpperCase() === normalizeGroupName(extensionGroupName).toUpperCase();
          } catch {
            return false;
          }
        });
        if (!byContent) {
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({
                  error: `No schema file found matching extensionGroupName "${extensionGroupName}"`,
                  availableFiles: allFiles,
                }),
              },
            ],
            isError: true,
          };
        }
      }

      const filePath = path.join(schemaDir, targetFile ?? allFiles.find((f) => {
        try {
          return readSchemaXml(path.join(schemaDir, f)).extensionGroupName.toUpperCase() === normalizeGroupName(extensionGroupName).toUpperCase();
        } catch { return false; }
      })!);

      const ext = readSchemaXml(filePath);

      // Check for conflicts
      const existingNames = new Set(ext.fields.map((f) => f.name.toUpperCase()));
      const conflicts = fields.filter((f) => existingNames.has(f.name.toUpperCase()));
      if (conflicts.length > 0) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                error: 'Field name conflict — these fields already exist in the extension',
                conflicts: conflicts.map((f) => f.name),
              }),
            },
          ],
          isError: true,
        };
      }

      // Validate String fields have length
      for (const f of fields) {
        if (f.type === 'String' && !f.length) {
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({
                  error: `Field "${f.name}" has type String but no length specified.`,
                }),
              },
            ],
            isError: true,
          };
        }
      }

      // Add new fields
      const newFields: SchemaField[] = fields.map((f) => ({
        name: f.name,
        type: f.type as FieldType,
        ...(f.length !== undefined ? { length: f.length } : {}),
        ...(f.description ? { comment: f.description } : {}),
      }));

      ext.fields = [...ext.fields, ...newFields];
      writeSchemaXml(filePath, ext);

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              success: true,
              file: path.basename(filePath),
              extensionGroupName: ext.extensionGroupName,
              addedFields: newFields.map((f) => ({ name: f.name, type: f.type })),
              totalFieldCount: ext.fields.length,
            }),
          },
        ],
      };
    },
  );
}

// ---- Registration ----------------------------------------------------------

export function registerSchemaTools(
  server: McpServer,
  dict: DataDictionary,
  getWorkspace: () => WorkspaceContext | null,
): void {
  registerListCustomTables(server, dict);
  registerListDbExtensions(server, getWorkspace);
  registerAnalyzeSchema(server, dict, getWorkspace);
  registerScaffoldDbExtension(server, getWorkspace);
  registerAddFieldToExtension(server, getWorkspace);
}
