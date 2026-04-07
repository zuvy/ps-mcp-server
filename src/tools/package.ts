import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import path from 'path';
import { loggedTool } from '../lib/logger.js';
import { WorkspaceContext } from '../lib/workspace.js';
import { readPluginXml, writePluginXml } from '../lib/plugin-xml.js';
import { validateForPackage, buildPluginZip } from '../lib/packager.js';
import { readQueryXml, writeQueryXml } from '../lib/query-xml.js';
import fs from 'fs';

function requireWorkspace(getWorkspace: () => WorkspaceContext | null): WorkspaceContext {
  const ws = getWorkspace();
  if (!ws) {
    throw new Error(
      'No plugin workspace detected. Set PS_PLUGIN_ROOT to the plugin src directory, or open a folder containing plugin.xml.',
    );
  }
  return ws;
}

function bumpSemver(version: string, part: 'major' | 'minor' | 'patch'): string {
  const m = version.match(/^(\d+)\.(\d+)\.(\d+)(.*)/);
  if (!m) throw new Error(`Cannot parse version "${version}" as semver X.Y.Z`);
  const maj = parseInt(m[1]!, 10);
  const min = parseInt(m[2]!, 10);
  const pat = parseInt(m[3]!, 10);
  const rest = m[4] ?? '';
  if (part === 'major') return `${maj + 1}.0.0${rest}`;
  if (part === 'minor') return `${maj}.${min + 1}.0${rest}`;
  return `${maj}.${min}.${pat + 1}${rest}`;
}

export function registerPackageTools(
  server: McpServer,
  getWorkspace: () => WorkspaceContext | null,
): void {
  loggedTool(server,
    'bump_plugin_version',
    'Update the version attribute in plugin.xml. Port of the release.rb script. Provide either an explicit version string or a bump direction (major/minor/patch).',
    {
      version: z
        .string()
        .optional()
        .describe('Explicit version string to set, e.g. "2.0.0". Mutually exclusive with bump.'),
      bump: z
        .enum(['major', 'minor', 'patch'])
        .optional()
        .describe('Increment major, minor, or patch component of the current semver version. Mutually exclusive with version.'),
    },
    async (params) => {
      if (!params.version && !params.bump) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ error: 'Provide either version or bump parameter.' }),
            },
          ],
          isError: true,
        };
      }
      if (params.version && params.bump) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ error: 'Provide version OR bump, not both.' }),
            },
          ],
          isError: true,
        };
      }

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

      const data = readPluginXml(pluginXmlPath);
      const oldVersion = data.version;

      let newVersion: string;
      if (params.version) {
        newVersion = params.version;
        if (newVersion.length > 20) {
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({ error: `Version "${newVersion}" exceeds 20 character limit` }),
              },
            ],
            isError: true,
          };
        }
      } else {
        try {
          newVersion = bumpSemver(oldVersion, params.bump!);
        } catch (err) {
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({
                  error: `${err}`,
                  currentVersion: oldVersion,
                  hint: 'Current version must be in X.Y.Z format to use bump.',
                }),
              },
            ],
            isError: true,
          };
        }
      }

      data.version = newVersion;
      writePluginXml(pluginXmlPath, data);

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              success: true,
              path: pluginXmlPath,
              oldVersion,
              newVersion,
            }),
          },
        ],
      };
    },
  );

  // ---- package_plugin -------------------------------------------------------

  loggedTool(server,
    'package_plugin',
    'Build a distributable ZIP from the plugin artifacts root. Runs pre-flight validation (plugin.xml required fields, named query parse errors, duplicate query names) before packaging. Returns the output path and file size.',
    {
      outputPath: z
        .string()
        .optional()
        .describe(
          'Where to write the ZIP. Defaults to ./dist/{pluginName}-v{version}.zip relative to the workspace artifacts root.',
        ),
      force: z
        .boolean()
        .default(false)
        .describe('Overwrite existing output file without prompting (default: false)'),
      skipValidation: z
        .boolean()
        .default(false)
        .describe('Skip pre-flight validation of plugin.xml and named query files (default: false)'),
    },
    async ({ outputPath, force, skipValidation }) => {
      const ws = requireWorkspace(getWorkspace);

      // Pre-flight validation (unless skipValidation)
      if (!skipValidation) {
        const validation = validateForPackage(ws.pluginXmlPath, ws.dirs.queriesRoot);
        if (!validation.valid) {
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify(
                  {
                    error: 'Pre-flight validation failed',
                    errors: validation.errors,
                    warnings: validation.warnings,
                    hint: 'Fix the errors above, or pass force: true to skip validation.',
                  },
                  null,
                  2,
                ),
              },
            ],
            isError: true,
          };
        }
      }

      // Determine output path
      let resolvedOutputPath = outputPath;
      if (!resolvedOutputPath) {
        const pluginData = readPluginXml(ws.pluginXmlPath);
        const safeName = (pluginData.name || 'plugin').replace(/[^a-zA-Z0-9._-]/g, '_');
        const safeVersion = (pluginData.version || '0.0.0').replace(/[^a-zA-Z0-9._-]/g, '_');
        // For flat/env layouts dist/ lives inside artifactsRoot; for src-based/env-src it lives beside src/ at the project root.
        const distDir = (ws.layout === 'flat' || ws.layout === 'env')
          ? path.join(ws.artifactsRoot, 'dist')
          : path.join(ws.artifactsRoot, '..', 'dist');
        resolvedOutputPath = path.join(distDir, `${safeName}-v${safeVersion}.zip`);
      }

      // Block if output already exists and force is not set
      if (fs.existsSync(resolvedOutputPath) && !force) {
        const stat = fs.statSync(resolvedOutputPath);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                error: 'Output file already exists',
                existingFile: resolvedOutputPath,
                existingSizeBytes: stat.size,
                existingModifiedAt: stat.mtime.toISOString(),
                hint: 'Pass force: true to overwrite the existing file.',
              }, null, 2),
            },
          ],
          isError: true,
        };
      }

      try {
        const result = await buildPluginZip(ws.artifactsRoot, resolvedOutputPath);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  success: true,
                  outputPath: result.outputPath,
                  sizeBytes: result.sizeBytes,
                  sizeKb: Math.round(result.sizeBytes / 1024),
                  fileCount: result.fileCount,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ error: `ZIP build failed: ${err}` }),
            },
          ],
          isError: true,
        };
      }
    },
  );

  // ---- rename_plugin --------------------------------------------------------

  loggedTool(server,
    'rename_plugin',
    'Refactor plugin name and all query/permission namespaces (ports rename.rb). Updates the plugin.xml name attribute, replaces oldNamespace prefix in every <query name> value, renames .named_queries.xml and .permission_mappings.xml files that use the old namespace as a filename prefix.',
    {
      oldNamespace: z
        .string()
        .describe('Current namespace prefix used in query names and file names, e.g. "org.tulsaschools.data"'),
      newNamespace: z
        .string()
        .describe('Replacement namespace prefix, e.g. "com.acme.schools.data"'),
      newPluginName: z
        .string()
        .optional()
        .describe(
          'New value for the plugin name attribute in plugin.xml. If omitted, the plugin name is not changed.',
        ),
    },
    async ({ oldNamespace, newNamespace, newPluginName }) => {
      const ws = requireWorkspace(getWorkspace);

      const renamedFiles: string[] = [];
      const updatedQueryNames: Array<{ file: string; old: string; new: string }> = [];

      // 1. Update plugin.xml name attribute
      if (newPluginName) {
        if (!fs.existsSync(ws.pluginXmlPath)) {
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({ error: 'plugin.xml not found', path: ws.pluginXmlPath }),
              },
            ],
            isError: true,
          };
        }
        const pluginData = readPluginXml(ws.pluginXmlPath);
        pluginData.name = newPluginName;
        writePluginXml(ws.pluginXmlPath, pluginData);
      }

      // 2. Rename query names and files in queries_root
      const queriesDir = ws.dirs.queriesRoot;
      if (queriesDir && fs.existsSync(queriesDir)) {
        const queryFiles = fs
          .readdirSync(queriesDir)
          .filter((f) => f.endsWith('.named_queries.xml'));

        for (const fileName of queryFiles) {
          const filePath = path.join(queriesDir, fileName);

          // Update query name attributes
          try {
            const qf = readQueryXml(filePath);
            let changed = false;
            for (const q of qf.queries) {
              if (q.name.startsWith(`${oldNamespace}.`)) {
                const oldName = q.name;
                q.name = newNamespace + q.name.slice(oldNamespace.length);
                updatedQueryNames.push({ file: fileName, old: oldName, new: q.name });
                changed = true;
              }
            }
            if (changed) {
              writeQueryXml(filePath, qf);
            }
          } catch {
            // Skip unreadable files
          }

          // Rename file if it uses old namespace as prefix
          if (fileName.startsWith(`${oldNamespace}.`)) {
            const newFileName = newNamespace + fileName.slice(oldNamespace.length);
            const newFilePath = path.join(queriesDir, newFileName);
            fs.renameSync(filePath, newFilePath);
            renamedFiles.push(`${fileName} → ${newFileName}`);
          }
        }
      }

      // 3. Rename permission_mappings files in permissions_root
      const permsDir = ws.dirs.permissionsRoot;
      if (permsDir && fs.existsSync(permsDir)) {
        const permFiles = fs
          .readdirSync(permsDir)
          .filter((f) => f.endsWith('.permission_mappings.xml'));

        for (const fileName of permFiles) {
          if (fileName.startsWith(`${oldNamespace}.`)) {
            const filePath = path.join(permsDir, fileName);
            const newFileName = newNamespace + fileName.slice(oldNamespace.length);
            const newFilePath = path.join(permsDir, newFileName);
            fs.renameSync(filePath, newFilePath);
            renamedFiles.push(`${fileName} → ${newFileName}`);
          }
        }
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                success: true,
                oldNamespace,
                newNamespace,
                pluginNameUpdated: newPluginName ?? null,
                renamedFiles,
                updatedQueryNames,
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
