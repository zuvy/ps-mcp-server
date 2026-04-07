import fs from 'fs';
import path from 'path';

export type WorkspaceLayout = 'flat' | 'src-based' | 'env' | 'env-src';

export interface WorkspaceDirs {
  queriesRoot?: string;
  permissionsRoot?: string;
  userSchemaRoot?: string;
  webRoot?: string;
  pagecataloging?: string;
}

export interface WorkspaceContext {
  /** Absolute path to the directory containing plugin.xml */
  artifactsRoot: string;
  layout: WorkspaceLayout;
  dirs: WorkspaceDirs;
  pluginXmlPath: string;
  /** Human-readable description of how this workspace was discovered */
  discoveryMethod: string;
}

/**
 * Detect the plugin workspace layout and resolve artifact directory paths.
 *
 * Detection order:
 * 1. PS_PLUGIN_ROOT env var — tried as direct artifacts root, then as workspace root
 *    with an implicit /src subfolder (handles both flat and src-based layouts when
 *    PS_PLUGIN_ROOT points to the VS Code workspaceFolder rather than the artifacts root)
 * 2. MCP roots capability candidates (if provided by caller)
 * 3. Walk up from cwd looking for plugin.xml or src/plugin.xml
 */
export function detectWorkspace(rootCandidates?: string[]): WorkspaceContext | null {
  const candidates: { dir: string; layout: WorkspaceLayout; discoveryMethod: string }[] = [];

  // 1. Explicit env override — try both as direct artifacts root and as workspace root
  const envRoot = process.env['PS_PLUGIN_ROOT'];
  if (envRoot) {
    const abs = path.resolve(envRoot);
    // Primary: treat PS_PLUGIN_ROOT as the artifacts root directly (flat layout, or already resolved)
    candidates.push({
      dir: abs,
      layout: 'env',
      discoveryMethod: `PS_PLUGIN_ROOT="${envRoot}"`,
    });
    // Fallback: treat PS_PLUGIN_ROOT as the workspace root with a src-based layout
    candidates.push({
      dir: path.join(abs, 'src'),
      layout: 'env-src',
      discoveryMethod: `PS_PLUGIN_ROOT="${envRoot}" (src subfolder)`,
    });
  }

  // 2. MCP roots capability candidates
  if (rootCandidates) {
    for (const r of rootCandidates) {
      const abs = path.resolve(r);
      candidates.push({ dir: path.join(abs, 'src'), layout: 'src-based', discoveryMethod: `MCP root "${r}" (src subfolder)` });
      candidates.push({ dir: abs, layout: 'flat', discoveryMethod: `MCP root "${r}"` });
    }
  }

  // 3. Walk up from cwd
  let dir = process.cwd();
  for (let i = 0; i < 10; i++) {
    candidates.push({ dir: path.join(dir, 'src'), layout: 'src-based', discoveryMethod: `cwd walk-up (${dir}/src)` });
    candidates.push({ dir, layout: 'flat', discoveryMethod: `cwd walk-up (${dir})` });
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  // Track whether PS_PLUGIN_ROOT was set but yielded no match (for warning)
  let envCandidatesExhausted = false;
  let envCandidateCount = 0;
  if (envRoot) envCandidateCount = 2;

  for (let i = 0; i < candidates.length; i++) {
    const { dir: candidate, layout, discoveryMethod } = candidates[i]!;

    // After exhausting env candidates, emit a warning if PS_PLUGIN_ROOT was set
    if (envRoot && !envCandidatesExhausted && i >= envCandidateCount) {
      envCandidatesExhausted = true;
      process.stderr.write(
        `[ps-mcp] Warning: PS_PLUGIN_ROOT="${envRoot}" set but no plugin.xml found at ` +
        `"${path.resolve(envRoot)}" or "${path.join(path.resolve(envRoot), 'src')}". ` +
        `Falling back to cwd walk-up.\n`,
      );
    }

    const pluginXml = path.join(candidate, 'plugin.xml');
    if (fs.existsSync(pluginXml)) {
      return {
        artifactsRoot: candidate,
        layout,
        dirs: resolveArtifactDirs(candidate),
        pluginXmlPath: pluginXml,
        discoveryMethod,
      };
    }
  }

  return null;
}

function resolveArtifactDirs(root: string): WorkspaceDirs {
  const dirs: WorkspaceDirs = {};

  if (existsDir(root, 'queries_root')) {
    dirs.queriesRoot = path.join(root, 'queries_root');
  }
  if (existsDir(root, 'permissions_root')) {
    dirs.permissionsRoot = path.join(root, 'permissions_root');
  }
  if (existsDir(root, 'user_schema_root')) {
    dirs.userSchemaRoot = path.join(root, 'user_schema_root');
  }
  // web_root is case-insensitive in the wild (web_root or WEB_ROOT)
  if (existsDir(root, 'web_root')) {
    dirs.webRoot = path.join(root, 'web_root');
  } else if (existsDir(root, 'WEB_ROOT')) {
    dirs.webRoot = path.join(root, 'WEB_ROOT');
  }
  // pagecataloging is conventionally inside web_root/ in real PS plugins.
  // Fall back to the plugin root for non-standard layouts.
  if (dirs.webRoot && existsDir(dirs.webRoot, 'pagecataloging')) {
    dirs.pagecataloging = path.join(dirs.webRoot, 'pagecataloging');
  } else if (existsDir(root, 'pagecataloging')) {
    dirs.pagecataloging = path.join(root, 'pagecataloging');
  }

  return dirs;
}

function existsDir(root: string, name: string): boolean {
  try {
    return fs.statSync(path.join(root, name)).isDirectory();
  } catch {
    return false;
  }
}
