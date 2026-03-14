import fs from 'fs';
import path from 'path';

export type WorkspaceLayout = 'flat' | 'src-based' | 'env';

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
}

/**
 * Detect the plugin workspace layout and resolve artifact directory paths.
 *
 * Detection order:
 * 1. PS_PLUGIN_ROOT env var (explicit override)
 * 2. Walk up from cwd looking for plugin.xml or src/plugin.xml
 * 3. Check ./src/plugin.xml then ./plugin.xml in cwd
 *
 * When MCP roots are provided at init time, callers may pass them as candidates.
 */
export function detectWorkspace(rootCandidates?: string[]): WorkspaceContext | null {
  const candidates: { dir: string; layout: WorkspaceLayout }[] = [];

  // 1. Explicit env override
  const envRoot = process.env['PS_PLUGIN_ROOT'];
  if (envRoot) {
    candidates.push({ dir: path.resolve(envRoot), layout: 'env' });
  }

  // 2. MCP roots capability candidates
  if (rootCandidates) {
    for (const r of rootCandidates) {
      const abs = path.resolve(r);
      candidates.push({ dir: path.join(abs, 'src'), layout: 'src-based' });
      candidates.push({ dir: abs, layout: 'flat' });
    }
  }

  // 3. Walk up from cwd
  let dir = process.cwd();
  for (let i = 0; i < 10; i++) {
    candidates.push({ dir: path.join(dir, 'src'), layout: 'src-based' });
    candidates.push({ dir, layout: 'flat' });
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  for (const { dir: candidate, layout } of candidates) {
    const pluginXml = path.join(candidate, 'plugin.xml');
    if (fs.existsSync(pluginXml)) {
      return {
        artifactsRoot: candidate,
        layout,
        dirs: resolveArtifactDirs(candidate),
        pluginXmlPath: pluginXml,
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
  // pagecataloging lives at the plugin root (same level as plugin.xml), not inside web_root
  if (existsDir(root, 'pagecataloging')) {
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
