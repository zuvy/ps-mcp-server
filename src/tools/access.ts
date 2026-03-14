import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import fs from 'fs';
import { WorkspaceContext } from '../lib/workspace.js';
import { DataDictionary } from '../lib/data-dictionary.js';
import { readPluginXml, writePluginXml, AccessField } from '../lib/plugin-xml.js';
import { collectQueryFieldRefs, diffAccessRequest } from '../lib/access-sync.js';

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

// ---- sync_access_request ---------------------------------------------------

function registerSyncAccessRequest(
  server: McpServer,
  dict: DataDictionary,
  getWorkspace: () => WorkspaceContext | null,
): void {
  server.tool(
    'sync_access_request',
    'Scan all named query XML files in queries_root for TABLE.FIELD column references (both column patterns and <!-- access: TABLE.FIELD --> comments) and rebuild the access_request block in plugin.xml. Ports sync_plugin_access_request.rb. U_* custom tables are skipped automatically.',
    {
      dryRun: z
        .boolean()
        .default(false)
        .describe('If true, return the diff without modifying plugin.xml (default: false)'),
    },
    async ({ dryRun }) => {
      const ws = requireWorkspace(getWorkspace);
      const pluginXmlPath = ws.pluginXmlPath;
      const queriesDir = ws.dirs.queriesRoot;

      if (!fs.existsSync(pluginXmlPath)) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ error: 'plugin.xml not found', path: pluginXmlPath }),
            },
          ],
          isError: true,
        };
      }

      // Collect all field refs from queries
      const incomingRefs = queriesDir ? collectQueryFieldRefs(queriesDir) : [];

      // Load current plugin.xml
      const pluginData = readPluginXml(pluginXmlPath);
      const existingFields = pluginData.accessRequest;

      // Compute diff
      const diff = diffAccessRequest(incomingRefs, existingFields);

      // Data dictionary validation warnings
      const dictWarnings: string[] = [];
      for (const ref of incomingRefs) {
        if (!dict.hasTable(ref.table)) {
          dictWarnings.push(`Table "${ref.table}" not found in data dictionary (keeping it anyway)`);
        } else if (!dict.hasField(ref.table, ref.field)) {
          dictWarnings.push(
            `Field "${ref.table}.${ref.field}" not found in data dictionary (keeping it anyway)`,
          );
        }
      }

      if (!dryRun) {
        // Replace the entire access_request with the freshly collected refs
        pluginData.accessRequest = incomingRefs.map((r) => ({
          table: r.table,
          field: r.field,
          access: 'ViewOnly' as const,
        }));
        writePluginXml(pluginXmlPath, pluginData);
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                dryRun,
                applied: !dryRun,
                totalFields: incomingRefs.length,
                diff: {
                  added: diff.added.map((r) => `${r.table}.${r.field}`),
                  removed: diff.removed.map((r) => `${r.table}.${r.field}`),
                  unchanged: diff.unchanged.length,
                },
                warnings: dictWarnings,
                queriesScanned: queriesDir
                  ? fs
                      .readdirSync(queriesDir)
                      .filter((f) => f.endsWith('.named_queries.xml')).length
                  : 0,
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

// ---- add_access_field -------------------------------------------------------

function registerAddAccessField(
  server: McpServer,
  dict: DataDictionary,
  getWorkspace: () => WorkspaceContext | null,
): void {
  server.tool(
    'add_access_field',
    'Add a single TABLE.FIELD entry to the access_request block in plugin.xml. Validates against the data dictionary. Use sync_access_request to rebuild the full block from named queries.',
    {
      table: z.string().describe('Table name (e.g. "STUDENTS")'),
      field: z.string().describe('Field name (e.g. "DCID")'),
      access: z
        .enum(['ViewOnly', 'FullAccess'])
        .default('ViewOnly')
        .describe('Access level (default: ViewOnly)'),
    },
    async ({ table, field, access }) => {
      const ws = requireWorkspace(getWorkspace);
      const pluginXmlPath = ws.pluginXmlPath;

      if (!fs.existsSync(pluginXmlPath)) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ error: 'plugin.xml not found', path: pluginXmlPath }),
            },
          ],
          isError: true,
        };
      }

      const tableUpper = table.toUpperCase();
      const fieldUpper = field.toUpperCase();

      // Data dictionary validation (warn for U_* tables, error for core tables not found)
      const warnings: string[] = [];
      if (!tableUpper.startsWith('U_')) {
        if (!dict.hasTable(tableUpper)) {
          warnings.push(`Table "${tableUpper}" not found in data dictionary`);
        } else if (!dict.hasField(tableUpper, fieldUpper)) {
          warnings.push(`Field "${tableUpper}.${fieldUpper}" not found in data dictionary`);
        }
      }

      const pluginData = readPluginXml(pluginXmlPath);

      // Check for duplicate
      const alreadyExists = pluginData.accessRequest.some(
        (f) =>
          f.table.toUpperCase() === tableUpper && f.field.toUpperCase() === fieldUpper,
      );

      if (alreadyExists) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                error: `${tableUpper}.${fieldUpper} already exists in access_request`,
              }),
            },
          ],
          isError: true,
        };
      }

      const newField: AccessField = {
        table: tableUpper,
        field: fieldUpper,
        access,
      };

      pluginData.accessRequest = [
        ...pluginData.accessRequest,
        newField,
      ].sort((a, b) => {
        if (a.table !== b.table) return a.table.localeCompare(b.table);
        return a.field.localeCompare(b.field);
      });

      writePluginXml(pluginXmlPath, pluginData);

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              success: true,
              added: `${tableUpper}.${fieldUpper}`,
              access,
              totalFields: pluginData.accessRequest.length,
              warnings,
            }),
          },
        ],
      };
    },
  );
}

// ---- Registration ----------------------------------------------------------

export function registerAccessTools(
  server: McpServer,
  dict: DataDictionary,
  getWorkspace: () => WorkspaceContext | null,
): void {
  registerSyncAccessRequest(server, dict, getWorkspace);
  registerAddAccessField(server, dict, getWorkspace);
}
