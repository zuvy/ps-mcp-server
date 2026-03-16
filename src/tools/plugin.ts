import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import { WorkspaceContext } from '../lib/workspace.js';
import { DataDictionary } from '../lib/data-dictionary.js';
import {
  readPluginXml,
  buildPluginXml,
  writePluginXml,
  PluginXmlData,
} from '../lib/plugin-xml.js';

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

function isValidHostname(host: string): boolean {
  // Must not have trailing slash, must be a valid-ish URL/hostname
  if (host.endsWith('/')) return false;
  try {
    // Try as URL first (handles https://... CDN entries)
    new URL(host);
    return true;
  } catch {
    // Fall back to hostname pattern
    return /^[a-zA-Z0-9]([a-zA-Z0-9\-.]*[a-zA-Z0-9])?$/.test(host);
  }
}

function bumpSemver(version: string, part: 'major' | 'minor' | 'patch'): string {
  const m = version.match(/^(\d+)\.(\d+)\.(\d+)(.*)/);
  if (!m) throw new Error(`Cannot parse version: ${version}`);
  let [, major, minor, patch, rest] = m;
  let maj = parseInt(major, 10);
  let min = parseInt(minor, 10);
  let pat = parseInt(patch, 10);
  if (part === 'major') { maj++; min = 0; pat = 0; }
  else if (part === 'minor') { min++; pat = 0; }
  else { pat++; }
  return `${maj}.${min}.${pat}${rest}`;
}

// ---- get_plugin_info -------------------------------------------------------

function registerGetPluginInfo(
  server: McpServer,
  getWorkspace: () => WorkspaceContext | null,
): void {
  server.tool(
    'get_plugin_info',
    'Read and return structured information about the current workspace plugin (name, version, publisher, OAuth level, access_request fields, links, artifact directory counts).',
    {},
    async () => {
      const ws = requireWorkspace(getWorkspace);
      const pluginXmlPath = ws.pluginXmlPath;

      if (!fs.existsSync(pluginXmlPath)) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: 'plugin.xml not found', path: pluginXmlPath }) }],
          isError: true,
        };
      }

      const data = readPluginXml(pluginXmlPath);
      const dirs = ws.dirs;

      const result = {
        name: data.name,
        version: data.version,
        description: data.description,
        pluginXmlPath,
        workspaceLayout: ws.layout,
        discoveryMethod: ws.discoveryMethod,
        artifactsRoot: ws.artifactsRoot,
        oauth: {
          enabled: data.oauth,
          accessLevelV1Api: data.accessLevelV1Api ?? null,
        },
        autoinstall: data.autoinstall
          ? {
              required: data.autoinstall.required,
              autoenable: data.autoinstall.autoenable ?? null,
              autoredeploy: data.autoinstall.autoredeploy ?? false,
            }
          : null,
        accessRequest: {
          fieldCount: data.accessRequest.length,
          cdnCount: data.cdnRequest.length,
          fields: data.accessRequest,
          cdns: data.cdnRequest,
        },
        publisher: data.publisher,
        links: data.links ?? [],
        registration: data.registration ?? null,
        openid: data.openid ?? null,
        directories: {
          queriesRoot: dirs.queriesRoot ?? null,
          permissionsRoot: dirs.permissionsRoot ?? null,
          userSchemaRoot: dirs.userSchemaRoot ?? null,
          webRoot: dirs.webRoot ?? null,
          pagecataloging: dirs.pagecataloging ?? null,
        },
      };

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    },
  );
}

// ---- scaffold_plugin -------------------------------------------------------

function registerScaffoldPlugin(
  server: McpServer,
  getWorkspace: () => WorkspaceContext | null,
): void {
  server.tool(
    'scaffold_plugin',
    'Generate a new plugin.xml with correct namespace, required elements, and optionally OAuth, autoinstall, registration, and OpenID stubs. Writes to the workspace plugin.xml path.',
    {
      name: z
        .string()
        .max(40, 'Plugin name must be 40 characters or fewer')
        .describe('Plugin name (max 40 chars, must be unique on the PS installation)'),
      version: z.string().max(20).default('1.0.0').describe('Plugin version (default: 1.0.0)'),
      description: z
        .string()
        .max(256)
        .describe('Short description of the plugin'),
      publisherName: z.string().max(100).describe('Publisher / organization name'),
      publisherEmail: z.string().max(40).describe('Publisher contact email'),
      publisherPhone: z.string().optional().describe('Publisher contact phone (optional)'),
      accessLevelV1Api: z
        .enum(['NONE', 'READ', 'FULL'])
        .default('NONE')
        .describe('OAuth API access level (default: NONE)'),
      includeOAuth: z
        .boolean()
        .default(false)
        .describe(
          'Add <oauth/> element. Required for PowerQuery plugins and service plugins. Always generates an empty <access_request> when true.',
        ),
      autoInstall: z
        .boolean()
        .default(false)
        .describe(
          'Add <autoinstall required="true"><autoenable required="true"/></autoinstall> block. Use with caution — forces PS to auto-enable the plugin on install.',
        ),
      registrationUrl: z
        .string()
        .optional()
        .describe(
          'If provided, adds <registration url="..."/> element. Used by service/event-listener plugins to receive OAuth credentials via callback at install time.',
        ),
      openIdHost: z
        .string()
        .optional()
        .describe('OpenID relying party host (requires openIdPort to also be set)'),
      openIdPort: z
        .string()
        .optional()
        .describe('OpenID relying party port (requires openIdHost to also be set)'),
      force: z
        .boolean()
        .default(false)
        .describe('Overwrite existing plugin.xml without prompting (default: false)'),
    },
    async (params) => {
      const ws = requireWorkspace(getWorkspace);
      const pluginXmlPath = ws.pluginXmlPath;

      // Guard: file exists and force not set
      if (fs.existsSync(pluginXmlPath) && !params.force) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                error: 'plugin.xml already exists',
                path: pluginXmlPath,
                hint: 'Pass force: true to overwrite.',
              }),
            },
          ],
          isError: true,
        };
      }

      // Validate OpenID: both or neither
      const hasOpenId = Boolean(params.openIdHost) && Boolean(params.openIdPort);
      if ((params.openIdHost && !params.openIdPort) || (!params.openIdHost && params.openIdPort)) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                error: 'Both openIdHost and openIdPort must be provided together, or neither.',
              }),
            },
          ],
          isError: true,
        };
      }

      const data: PluginXmlData = {
        name: params.name,
        version: params.version,
        description: params.description,
        oauth: params.includeOAuth || params.accessLevelV1Api !== 'NONE',
        accessLevelV1Api:
          params.accessLevelV1Api !== 'NONE' ? params.accessLevelV1Api : undefined,
        autoinstall: params.autoInstall
          ? { required: true, autoenable: { required: true } }
          : undefined,
        accessRequest: [],
        cdnRequest: [],
        publisher: {
          name: params.publisherName,
          contact: {
            email: params.publisherEmail,
            phone: params.publisherPhone,
          },
        },
        registration: params.registrationUrl !== undefined ? { url: params.registrationUrl } : undefined,
        openid: hasOpenId
          ? { host: params.openIdHost!, port: params.openIdPort!, links: [] }
          : undefined,
      };

      // Ensure directory exists
      const dir = path.dirname(pluginXmlPath);
      fs.mkdirSync(dir, { recursive: true });
      writePluginXml(pluginXmlPath, data);

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              success: true,
              path: pluginXmlPath,
              name: data.name,
              version: data.version,
              nextSteps: [
                'Run validate_plugin_xml to confirm the file is valid.',
                params.includeOAuth
                  ? 'Add access_request fields via the access_request tools, or edit plugin.xml directly.'
                  : null,
              ].filter(Boolean),
            }),
          },
        ],
      };
    },
  );
}

// ---- validate_plugin_xml ---------------------------------------------------

interface ValidationIssue {
  severity: 'error' | 'warning' | 'info';
  message: string;
}

function registerValidatePluginXml(
  server: McpServer,
  getWorkspace: () => WorkspaceContext | null,
  dict: DataDictionary,
): void {
  server.tool(
    'validate_plugin_xml',
    'Validate plugin.xml against known PowerSchool rules. Returns structured errors, warnings, and info notices.',
    {},
    async () => {
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

      let data: PluginXmlData;
      try {
        data = readPluginXml(pluginXmlPath);
      } catch (err) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ error: `Failed to parse plugin.xml: ${err}`, path: pluginXmlPath }),
            },
          ],
          isError: true,
        };
      }

      const issues: ValidationIssue[] = [];

      // Namespace — fast-xml-parser won't surface it directly; we check the raw file
      const rawXml = fs.readFileSync(pluginXmlPath, 'utf-8');
      if (!rawXml.includes('http://plugin.powerschool.pearson.com')) {
        issues.push({
          severity: 'error',
          message: 'plugin.xml namespace must be "http://plugin.powerschool.pearson.com"',
        });
      }

      // Required: name
      if (!data.name) {
        issues.push({ severity: 'error', message: '<plugin name> attribute is missing or empty' });
      } else if (data.name.length > 40) {
        issues.push({
          severity: 'error',
          message: `Plugin name "${data.name}" is ${data.name.length} chars — max is 40`,
        });
      }

      // Required: version
      if (!data.version) {
        issues.push({ severity: 'error', message: '<plugin version> attribute is missing or empty' });
      } else if (data.version.length > 20) {
        issues.push({
          severity: 'error',
          message: `Plugin version "${data.version}" is ${data.version.length} chars — max is 20`,
        });
      }

      // Required: publisher
      if (!data.publisher.name) {
        issues.push({ severity: 'error', message: '<publisher name> attribute is missing' });
      }

      // Required: contact email
      if (!data.publisher.contact.email) {
        issues.push({ severity: 'error', message: '<contact email> attribute is missing' });
      }

      // access field values
      for (const f of data.accessRequest) {
        if (f.access !== 'ViewOnly' && f.access !== 'FullAccess') {
          issues.push({
            severity: 'error',
            message: `Field ${f.table}.${f.field} has invalid access value "${f.access}" — must be "ViewOnly" or "FullAccess"`,
          });
        }
        // data dictionary check (warn only — U_ tables may not be in dictionary)
        if (!f.table.startsWith('U_') && !dict.hasTable(f.table)) {
          issues.push({
            severity: 'warning',
            message: `Table "${f.table}" in access_request not found in data dictionary`,
          });
        } else if (!f.table.startsWith('U_') && !dict.hasField(f.table, f.field)) {
          issues.push({
            severity: 'warning',
            message: `Field "${f.table}.${f.field}" in access_request not found in data dictionary`,
          });
        }
      }

      // CDN names
      for (const cdn of data.cdnRequest) {
        if (!isValidHostname(cdn)) {
          issues.push({
            severity: 'error',
            message: `CDN name "${cdn}" is not a valid hostname/URL (no trailing slashes)`,
          });
        }
      }

      // accessLevelV1Api
      if (data.accessLevelV1Api) {
        const validLevels = ['NONE', 'READ', 'FULL'];
        if (!validLevels.includes(data.accessLevelV1Api)) {
          issues.push({
            severity: 'error',
            message: `accessLevelV1Api="${data.accessLevelV1Api}" is invalid — must be NONE, READ, or FULL`,
          });
        } else {
          issues.push({
            severity: 'info',
            message: `accessLevelV1Api="${data.accessLevelV1Api}" requires PowerSchool 25.2+`,
          });
        }
      }

      // autoinstall warning
      if (data.autoinstall) {
        issues.push({
          severity: 'info',
          message:
            '<autoinstall> is present — this will auto-install and enable the plugin on every PS server that receives this package. Confirm this is intended.',
        });
      }

      // registration with empty URL
      if (data.registration !== undefined && data.registration.url === '') {
        issues.push({
          severity: 'warning',
          message:
            '<registration url=""> has an empty url — plugin will not receive OAuth credentials at install time unless the URL is set',
        });
      }

      // openid missing host or port
      if (data.openid !== undefined) {
        if (!data.openid.host || !data.openid.port) {
          issues.push({
            severity: 'error',
            message: '<openid> element must have both host and port attributes set',
          });
        }
      }

      // Duplicate ui_context ids across all links
      const allLinks = [
        ...(data.links ?? []),
        ...(data.openid?.links ?? []),
      ];
      const uiContextCounts = new Map<string, number>();
      for (const link of allLinks) {
        for (const id of link.uiContextIds) {
          uiContextCounts.set(id, (uiContextCounts.get(id) ?? 0) + 1);
        }
      }
      for (const [id, count] of uiContextCounts) {
        if (count > 1) {
          issues.push({
            severity: 'warning',
            message: `ui_context id="${id}" appears ${count} times — duplicate ui_context ids may cause unexpected behaviour`,
          });
        }
      }

      // Offline note
      issues.push({
        severity: 'info',
        message:
          'Plugin name uniqueness cannot be verified offline — ensure the name is unique across the target PS installation.',
      });

      const errors = issues.filter((i) => i.severity === 'error');
      const warnings = issues.filter((i) => i.severity === 'warning');
      const infos = issues.filter((i) => i.severity === 'info');

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                valid: errors.length === 0,
                path: pluginXmlPath,
                summary: `${errors.length} error(s), ${warnings.length} warning(s), ${infos.length} info(s)`,
                errors: errors.map((i) => i.message),
                warnings: warnings.map((i) => i.message),
                info: infos.map((i) => i.message),
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

export function registerPluginTools(
  server: McpServer,
  dict: DataDictionary,
  getWorkspace: () => WorkspaceContext | null,
): void {
  registerGetPluginInfo(server, getWorkspace);
  registerScaffoldPlugin(server, getWorkspace);
  registerValidatePluginXml(server, getWorkspace, dict);
}
