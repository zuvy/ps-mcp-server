import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import { WorkspaceContext } from '../lib/workspace.js';
import { DataDictionary } from '../lib/data-dictionary.js';
import {
  NamedQuery,
  QueryFile,
  readQueryDir,
  readQueryXml,
  writeQueryXml,
  extractFieldRefs,
  extractSqlParams,
} from '../lib/query-xml.js';

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

function inferFileNameFromQueryName(queryName: string): string {
  // e.g. "org.tulsaschools.data.students.sections_export" → "org.tulsaschools.data.students.named_queries.xml"
  const parts = queryName.split('.');
  if (parts.length >= 4) {
    // Use first 4 segments (tld.org.product.area) as base
    return `${parts.slice(0, 4).join('.')}.named_queries.xml`;
  }
  // Fallback: use query name directly
  return `${queryName}.named_queries.xml`;
}

function validateQueryName(name: string): Array<{ severity: 'warning' | 'info'; message: string }> {
  const issues: Array<{ severity: 'warning' | 'info'; message: string }> = [];
  const parts = name.split('.');
  if (parts.length < 5) {
    issues.push({
      severity: 'info',
      message: `Query name "${name}" has ${parts.length} part(s); PS documentation recommends 5 parts: {tld}.{org}.{product}.{area}.{description}`,
    });
  }
  if (parts[0] === 'com' && parts[1] === 'powerschool') {
    issues.push({
      severity: 'warning',
      message: `Query name starts with "com.powerschool" — this collides with PS core queries. Use your own org namespace.`,
    });
  }
  return issues;
}

// ---- scaffold_powerquery ---------------------------------------------------

function registerScaffoldPowerquery(
  server: McpServer,
  dict: DataDictionary,
  getWorkspace: () => WorkspaceContext | null,
): void {
  server.tool(
    'scaffold_powerquery',
    'Generate a named_queries.xml file with the correct PS structure. File and query naming follow 5-part recommended conventions by default.',
    {
      queryName: z
        .string()
        .describe(
          'Full query name attribute — must be unique across PS installation. Recommended: {tld}.{org}.{product}.{area}.{description} (5 parts)',
        ),
      fileName: z
        .string()
        .optional()
        .describe(
          'Output filename, must end in .named_queries.xml. Defaults to deriving from first 4 queryName segments.',
        ),
      coreTable: z
        .string()
        .optional()
        .describe(
          'PS core table entity name for this query (e.g. "students"). Required for DAT queries. Can be empty string for multi-table queries.',
        ),
      flattened: z
        .boolean()
        .default(true)
        .describe('Add flattened="true" attribute (standard for most queries)'),
      isDat: z
        .boolean()
        .default(false)
        .describe('Add dat="true" for PowerQuery DAT (requires PS 22.9+)'),
      summary: z.string().optional().describe('Short summary text'),
      description: z.string().optional().describe('Longer description text'),
      columns: z
        .array(
          z.object({
            column: z
              .string()
              .describe('TABLE.FIELD reference (e.g. "students.dcid")'),
            alias: z.string().optional().describe('Column alias for Pattern A'),
            description: z.string().optional().describe('Human label for Pattern B'),
          }),
        )
        .default([])
        .describe('Column definitions'),
      args: z
        .array(
          z.object({
            name: z.string().describe(':paramname used in SQL'),
            type: z
              .string()
              .optional()
              .describe('Arg type: "primitive", "array", "date", etc.'),
            column: z.string().optional().describe('TABLE.FIELD for array args'),
            required: z.boolean().optional(),
            description: z.string().optional(),
            default: z.string().optional().describe('Default value (PS expression OK)'),
          }),
        )
        .default([])
        .describe('Query parameters'),
      sqlBody: z
        .string()
        .default('')
        .describe('SQL SELECT body (placed inside CDATA)'),
    },
    async (params) => {
      const ws = requireWorkspace(getWorkspace);
      const queriesDir = ws.dirs.queriesRoot;

      if (!queriesDir) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                error: 'No queries_root directory found in workspace.',
                expectedPath: path.join(ws.artifactsRoot, 'queries_root'),
              }),
            },
          ],
          isError: true,
        };
      }

      // Validate file name
      let fileName = params.fileName;
      if (!fileName) {
        fileName = inferFileNameFromQueryName(params.queryName);
      } else if (!fileName.endsWith('.named_queries.xml')) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ error: 'fileName must end in ".named_queries.xml"' }),
            },
          ],
          isError: true,
        };
      }

      // Check for duplicate query names across existing workspace files
      const existingFiles = readQueryDir(queriesDir);
      const existingNames = new Set(
        existingFiles.flatMap((f) => f.queries.map((q) => q.name)),
      );
      if (existingNames.has(params.queryName)) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                error: `Query name "${params.queryName}" already exists in the workspace.`,
                duplicateIn: existingFiles
                  .filter((f) => f.queries.some((q) => q.name === params.queryName))
                  .map((f) => path.basename(f.sourceFile ?? '')),
              }),
            },
          ],
          isError: true,
        };
      }

      // Collect validation issues
      const issues: Array<{ severity: string; message: string }> = [];
      issues.push(...validateQueryName(params.queryName));

      // Validate coreTable
      if (params.coreTable && params.coreTable !== '' && !dict.hasTable(params.coreTable.toUpperCase())) {
        issues.push({
          severity: 'warning',
          message: `coreTable "${params.coreTable}" not found in data dictionary`,
        });
      }

      if (params.isDat) {
        issues.push({
          severity: 'info',
          message: 'dat="true" requires PowerSchool 22.9+. Ensure target PS version supports DAT queries.',
        });
        if (!params.coreTable) {
          issues.push({
            severity: 'warning',
            message: 'DAT queries typically require coreTable to be set.',
          });
        }
      }

      // Validate column TABLE.FIELD references
      for (const col of params.columns) {
        const m = col.column.match(/^([^.]+)\.([^.]+)$/);
        if (!m) {
          issues.push({
            severity: 'warning',
            message: `Column reference "${col.column}" does not match TABLE.FIELD format`,
          });
          continue;
        }
        const [, table, field] = m;
        if (
          table &&
          !table.startsWith('U_') &&
          !dict.hasTable(table.toUpperCase())
        ) {
          issues.push({
            severity: 'warning',
            message: `Column table "${table}" not found in data dictionary`,
          });
        } else if (
          table &&
          !table.startsWith('U_') &&
          field &&
          !dict.hasField(table.toUpperCase(), field.toUpperCase())
        ) {
          issues.push({
            severity: 'warning',
            message: `Column field "${col.column}" not found in data dictionary`,
          });
        }
      }

      // Check SQL params vs args consistency
      const sqlParams = extractSqlParams(params.sqlBody);
      const declaredArgs = new Set(params.args.map((a) => a.name.toLowerCase()));
      for (const p of sqlParams) {
        if (!declaredArgs.has(p)) {
          issues.push({
            severity: 'warning',
            message: `SQL uses :${p} but no <arg name="${p}"> declared in args`,
          });
        }
      }
      for (const a of params.args) {
        if (!sqlParams.includes(a.name.toLowerCase())) {
          issues.push({
            severity: 'info',
            message: `Arg "${a.name}" is declared but not referenced as :${a.name} in the SQL body`,
          });
        }
      }

      // Build the query
      const query: NamedQuery = {
        name: params.queryName,
        ...(params.coreTable !== undefined ? { coreTable: params.coreTable } : {}),
        flattened: params.flattened,
        ...(params.isDat ? { dat: true } : {}),
        ...(params.summary ? { summary: params.summary } : {}),
        ...(params.description ? { description: params.description } : {}),
        args: params.args.map((a) => ({
          name: a.name,
          ...(a.type ? { type: a.type } : {}),
          ...(a.column ? { column: a.column } : {}),
          ...(a.required !== undefined ? { required: a.required } : {}),
          ...(a.description ? { description: a.description } : {}),
          ...(a.default !== undefined ? { default: a.default } : {}),
        })),
        columns: params.columns.map((col) => {
          if (col.description) {
            // Pattern B
            return { fieldRef: col.column, description: col.description, alias: col.description };
          }
          // Pattern A
          return { fieldRef: col.column, alias: col.alias ?? col.column.split('.').pop() ?? col.column };
        }),
        sql: params.sqlBody,
      };

      // Check if file exists — merge into it or create
      const filePath = path.join(queriesDir, fileName);
      let queryFile: QueryFile;
      if (fs.existsSync(filePath)) {
        queryFile = readQueryXml(filePath);
        queryFile.queries.push(query);
      } else {
        queryFile = { queries: [query] };
      }

      fs.mkdirSync(queriesDir, { recursive: true });
      writeQueryXml(filePath, queryFile);

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                success: true,
                file: fileName,
                path: filePath,
                queryName: params.queryName,
                action: fs.existsSync(filePath) ? 'added-to-existing' : 'created-new',
                validationIssues: issues,
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

// ---- list_powerqueries -----------------------------------------------------

function registerListPowerqueries(
  server: McpServer,
  getWorkspace: () => WorkspaceContext | null,
): void {
  server.tool(
    'list_powerqueries',
    'List all named query definitions in the current workspace queries_root directory.',
    {},
    async () => {
      const ws = requireWorkspace(getWorkspace);
      const queriesDir = ws.dirs.queriesRoot;

      if (!queriesDir || !fs.existsSync(queriesDir)) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ count: 0, files: [], note: 'No queries_root directory found.' }),
            },
          ],
        };
      }

      const queryFiles = readQueryDir(queriesDir);
      const result = queryFiles.map((f) => ({
        file: path.basename(f.sourceFile ?? ''),
        queryCount: f.queries.length,
        queries: f.queries.map((q) => ({
          name: q.name,
          coreTable: q.coreTable ?? null,
          flattened: q.flattened ?? true,
          isDat: q.dat ?? false,
          columnCount: q.columns.length,
          argCount: q.args.length,
        })),
      }));

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                fileCount: result.length,
                totalQueries: result.reduce((n, f) => n + f.queryCount, 0),
                files: result,
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

// ---- validate_named_queries ------------------------------------------------

function registerValidateNamedQueries(
  server: McpServer,
  dict: DataDictionary,
  getWorkspace: () => WorkspaceContext | null,
): void {
  server.tool(
    'validate_named_queries',
    'Validate named query XML files in the workspace. Checks structure, column references against data dictionary, arg/param consistency, and duplicate query names.',
    {
      file: z
        .string()
        .optional()
        .describe('Specific filename to validate. Validates all *.named_queries.xml files if omitted.'),
    },
    async ({ file }) => {
      const ws = requireWorkspace(getWorkspace);
      const queriesDir = ws.dirs.queriesRoot;

      if (!queriesDir || !fs.existsSync(queriesDir)) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ error: 'No queries_root directory found in workspace.' }),
            },
          ],
          isError: true,
        };
      }

      // Load files
      let filesToCheck: string[];
      if (file) {
        const target = path.isAbsolute(file) ? file : path.join(queriesDir, file);
        if (!fs.existsSync(target)) {
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({ error: `File not found: ${target}` }),
              },
            ],
            isError: true,
          };
        }
        filesToCheck = [target];
      } else {
        filesToCheck = fs
          .readdirSync(queriesDir)
          .filter((f) => f.endsWith('.named_queries.xml'))
          .map((f) => path.join(queriesDir, f));
      }

      // Load all files for cross-file duplicate checking
      const allQueryFiles: QueryFile[] = [];
      for (const fp of filesToCheck) {
        try {
          allQueryFiles.push(readQueryXml(fp));
        } catch (err) {
          // Handled per-file below
        }
      }

      // Build global query name set for duplicate detection
      const queryNameCount = new Map<string, string[]>();
      for (const qf of allQueryFiles) {
        for (const q of qf.queries) {
          const existing = queryNameCount.get(q.name) ?? [];
          existing.push(path.basename(qf.sourceFile ?? ''));
          queryNameCount.set(q.name, existing);
        }
      }

      const fileResults = [];

      for (const fp of filesToCheck) {
        const fileName = path.basename(fp);
        let qf: QueryFile;
        try {
          qf = readQueryXml(fp);
        } catch (err) {
          fileResults.push({
            file: fileName,
            valid: false,
            errors: [`Failed to parse XML: ${err}`],
            warnings: [],
            info: [],
          });
          continue;
        }

        const errors: string[] = [];
        const warnings: string[] = [];
        const info: string[] = [];

        for (const q of qf.queries) {
          const prefix = q.name ? `[${q.name}]` : '[unnamed query]';

          // Duplicate name check
          const nameFiles = queryNameCount.get(q.name) ?? [];
          if (nameFiles.length > 1) {
            errors.push(`${prefix} Duplicate query name across files: ${nameFiles.join(', ')}`);
          }

          // Query name format
          const nameIssues = validateQueryName(q.name);
          for (const ni of nameIssues) {
            if (ni.severity === 'warning') warnings.push(`${prefix} ${ni.message}`);
            else info.push(`${prefix} ${ni.message}`);
          }

          // Column references
          for (const col of q.columns) {
            const ref = col.fieldRef;
            if (!ref) continue;
            const m = ref.match(/^([^.]+)\.([^.]+)$/);
            if (!m) {
              warnings.push(`${prefix} Column reference "${ref}" does not match TABLE.FIELD format`);
              continue;
            }
            const [, table, field] = m;
            if (table && table.startsWith('U_')) continue; // skip custom tables
            if (table && !dict.hasTable(table.toUpperCase())) {
              warnings.push(`${prefix} Column table "${table}" not found in data dictionary`);
            } else if (table && field && !dict.hasField(table.toUpperCase(), field.toUpperCase())) {
              warnings.push(`${prefix} Column field "${ref}" not found in data dictionary`);
            }
          }

          // Arg validation
          for (const a of q.args) {
            if (!a.name) {
              warnings.push(`${prefix} An <arg> element is missing required name attribute`);
            }
          }

          // SQL param vs arg consistency
          const sqlParams = extractSqlParams(q.sql);
          const declaredArgs = new Set(q.args.map((a) => a.name.toLowerCase()));
          for (const p of sqlParams) {
            if (!declaredArgs.has(p)) {
              warnings.push(`${prefix} SQL uses :${p} but no <arg name="${p}"> declared`);
            }
          }
          for (const a of q.args) {
            if (a.name && !sqlParams.includes(a.name.toLowerCase())) {
              info.push(
                `${prefix} Arg "${a.name}" declared but :${a.name} not found in SQL (may be intentional for array types)`,
              );
            }
          }

          // DAT consistency
          if (q.dat) {
            if (!q.coreTable) {
              warnings.push(`${prefix} dat="true" but coreTable is not set`);
            }
            info.push(`${prefix} dat="true" requires PowerSchool 22.9+`);
          }
        }

        fileResults.push({
          file: fileName,
          valid: errors.length === 0,
          queryCount: qf.queries.length,
          errors,
          warnings,
          info,
        });
      }

      const totalErrors = fileResults.reduce((n, f) => n + f.errors.length, 0);
      const totalWarnings = fileResults.reduce((n, f) => n + f.warnings.length, 0);

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                valid: totalErrors === 0,
                summary: `${totalErrors} error(s), ${totalWarnings} warning(s) across ${fileResults.length} file(s)`,
                files: fileResults,
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

// ---- Registration ----------------------------------------------------------

export function registerQueryTools(
  server: McpServer,
  dict: DataDictionary,
  getWorkspace: () => WorkspaceContext | null,
): void {
  registerScaffoldPowerquery(server, dict, getWorkspace);
  registerListPowerqueries(server, getWorkspace);
  registerValidateNamedQueries(server, dict, getWorkspace);
}
