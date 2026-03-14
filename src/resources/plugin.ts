import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WorkspaceContext } from '../lib/workspace.js';
import { readPluginXml } from '../lib/plugin-xml.js';
import { readQueryDir } from '../lib/query-xml.js';
import { readSchemaDir } from '../lib/schema-xml.js';
import fs from 'fs';

// ---- ps://plugin/current ----------------------------------------------------

function registerCurrentResource(
  server: McpServer,
  getWorkspace: () => WorkspaceContext | null,
): void {
  server.resource(
    'plugin-current',
    'ps://plugin/current',
    { mimeType: 'application/json' },
    async () => {
      const ws = getWorkspace();
      if (!ws) {
        return {
          contents: [
            {
              uri: 'ps://plugin/current',
              mimeType: 'application/json',
              text: JSON.stringify({ error: 'No plugin workspace detected' }),
            },
          ],
        };
      }

      let pluginData: object = { error: 'plugin.xml not found', path: ws.pluginXmlPath };
      if (fs.existsSync(ws.pluginXmlPath)) {
        try {
          pluginData = readPluginXml(ws.pluginXmlPath);
        } catch (err) {
          pluginData = { error: `plugin.xml parse error: ${err}`, path: ws.pluginXmlPath };
        }
      }

      return {
        contents: [
          {
            uri: 'ps://plugin/current',
            mimeType: 'application/json',
            text: JSON.stringify(
              {
                workspace: {
                  artifactsRoot: ws.artifactsRoot,
                  layout: ws.layout,
                  dirs: ws.dirs,
                },
                plugin: pluginData,
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

// ---- ps://plugin/queries ----------------------------------------------------

function registerQueriesResource(
  server: McpServer,
  getWorkspace: () => WorkspaceContext | null,
): void {
  server.resource(
    'plugin-queries',
    'ps://plugin/queries',
    { mimeType: 'application/json' },
    async () => {
      const ws = getWorkspace();
      if (!ws) {
        return {
          contents: [
            {
              uri: 'ps://plugin/queries',
              mimeType: 'application/json',
              text: JSON.stringify({ error: 'No plugin workspace detected' }),
            },
          ],
        };
      }

      const queriesDir = ws.dirs.queriesRoot;
      if (!queriesDir || !fs.existsSync(queriesDir)) {
        return {
          contents: [
            {
              uri: 'ps://plugin/queries',
              mimeType: 'application/json',
              text: JSON.stringify({ queries: [], queriesDir: queriesDir ?? null }),
            },
          ],
        };
      }

      let queryFiles: object[] = [];
      try {
        queryFiles = readQueryDir(queriesDir);
      } catch (err) {
        return {
          contents: [
            {
              uri: 'ps://plugin/queries',
              mimeType: 'application/json',
              text: JSON.stringify({ error: `Failed to read queries: ${err}` }),
            },
          ],
        };
      }

      return {
        contents: [
          {
            uri: 'ps://plugin/queries',
            mimeType: 'application/json',
            text: JSON.stringify({ queriesDir, queryFiles }, null, 2),
          },
        ],
      };
    },
  );
}

// ---- ps://plugin/extensions -------------------------------------------------

function registerExtensionsResource(
  server: McpServer,
  getWorkspace: () => WorkspaceContext | null,
): void {
  server.resource(
    'plugin-extensions',
    'ps://plugin/extensions',
    { mimeType: 'application/json' },
    async () => {
      const ws = getWorkspace();
      if (!ws) {
        return {
          contents: [
            {
              uri: 'ps://plugin/extensions',
              mimeType: 'application/json',
              text: JSON.stringify({ error: 'No plugin workspace detected' }),
            },
          ],
        };
      }

      const schemaDir = ws.dirs.userSchemaRoot;
      if (!schemaDir || !fs.existsSync(schemaDir)) {
        return {
          contents: [
            {
              uri: 'ps://plugin/extensions',
              mimeType: 'application/json',
              text: JSON.stringify({ extensions: [], schemaDir: schemaDir ?? null }),
            },
          ],
        };
      }

      let extensions: object[] = [];
      try {
        extensions = readSchemaDir(schemaDir);
      } catch (err) {
        return {
          contents: [
            {
              uri: 'ps://plugin/extensions',
              mimeType: 'application/json',
              text: JSON.stringify({ error: `Failed to read extensions: ${err}` }),
            },
          ],
        };
      }

      return {
        contents: [
          {
            uri: 'ps://plugin/extensions',
            mimeType: 'application/json',
            text: JSON.stringify({ schemaDir, extensions }, null, 2),
          },
        ],
      };
    },
  );
}

// ---- Registration -----------------------------------------------------------

export function registerPluginResources(
  server: McpServer,
  getWorkspace: () => WorkspaceContext | null,
): void {
  registerCurrentResource(server, getWorkspace);
  registerQueriesResource(server, getWorkspace);
  registerExtensionsResource(server, getWorkspace);
}
