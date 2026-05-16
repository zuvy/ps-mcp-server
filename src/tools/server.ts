import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { loggedTool } from '../lib/logger.js';
import { getPsServerStatus, fetchPsServerContext } from '../lib/ps-server.js';

// ---- Helpers ---------------------------------------------------------------

function ok(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

function err(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }], isError: true };
}

// ---- Registration ----------------------------------------------------------

export function registerServerTools(server: McpServer): void {
  loggedTool(
    server,
    'ps_server_context',
    'Fetch live context from the running PowerSchool server via the companion plugin endpoints. Returns PS version, installed plugins, custom schema tables (U_ prefix), and named query namespaces. Requires PSTEST_URI, PS_USER, and PS_PASS env vars.',
    {},
    async () => {
      const status = getPsServerStatus();
      if (!status.configured) {
        return err({
          configured: false,
          message: 'PowerSchool server not configured.',
          missingVars: 'Set PSTEST_URI, PS_USER, and PS_PASS in the workspace .mcp.json env block.',
        });
      }

      const url = process.env['PSTEST_URI']!;
      const user = process.env['PS_USER']!;
      const password = process.env['PS_PASS']!;

      try {
        const context = await fetchPsServerContext(url, user, password);
        return ok(context);
      } catch (e) {
        return err({ error: String(e) });
      }
    },
  );
}
