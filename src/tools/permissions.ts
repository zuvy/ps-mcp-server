import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import { WorkspaceContext } from '../lib/workspace.js';
import { HttpOperation, PermissionMapping, writePermissionXml } from '../lib/permission-xml.js';

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

// ---- scaffold_permission_mapping -------------------------------------------

export function registerPermissionTools(
  server: McpServer,
  getWorkspace: () => WorkspaceContext | null,
): void {
  server.tool(
    'scaffold_permission_mapping',
    'Generate a permissions_root XML file that grants PS pages access to named query or table endpoints. Each sourcePage + operation + endpoint triple becomes one <implies> element.',
    {
      fileName: z
        .string()
        .describe(
          'Output filename, must end in ".permission_mappings.xml" (e.g. "org.tulsaschools.data.students.permission_mappings.xml")',
        ),
      mappings: z
        .array(
          z.object({
            sourcePage: z
              .string()
              .describe(
                'PS page path that needs access, e.g. "/admin/students/student_ids.html"',
              ),
            allowedOperations: z
              .array(z.enum(['get', 'post', 'put', 'delete']))
              .min(1)
              .describe('HTTP operations to allow on the target endpoint'),
            targetEndpoint: z
              .string()
              .describe(
                'Target endpoint: /ws/schema/query/{queryName} for named queries (always post), /ws/schema/table/{TableName} for table CRUD, /ws/schema/table/{TableName}/# for specific records (PUT/DELETE)',
              ),
          }),
        )
        .min(1)
        .describe('Permission mappings to generate'),
      force: z
        .boolean()
        .default(false)
        .describe('Overwrite existing file without prompting (default: false)'),
    },
    async ({ fileName, mappings, force }) => {
      const ws = requireWorkspace(getWorkspace);
      const permsDir = ws.dirs.permissionsRoot;

      if (!permsDir) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                error: 'No permissions_root directory found in workspace.',
                expectedPath: path.join(ws.artifactsRoot, 'permissions_root'),
              }),
            },
          ],
          isError: true,
        };
      }

      if (!fileName.endsWith('.permission_mappings.xml')) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                error: 'fileName must end in ".permission_mappings.xml"',
              }),
            },
          ],
          isError: true,
        };
      }

      const filePath = path.join(permsDir, fileName);

      if (fs.existsSync(filePath) && !force) {
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

      // Flatten: each operation gets its own PermissionMapping entry
      const flat: PermissionMapping[] = [];
      for (const m of mappings) {
        for (const op of m.allowedOperations) {
          flat.push({
            sourcePage: m.sourcePage,
            allowedOperation: op as HttpOperation,
            targetEndpoint: m.targetEndpoint,
          });
        }
      }

      fs.mkdirSync(permsDir, { recursive: true });
      writePermissionXml(filePath, flat);

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                success: true,
                file: fileName,
                path: filePath,
                mappingCount: flat.length,
                sourcePageCount: new Set(flat.map((m) => m.sourcePage)).size,
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
