import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { loggedTool } from '../lib/logger.js';
import { getPsServerStatus, fetchPsServerContext } from '../lib/ps-server.js';
import { PS_SERVERS, PsServerName, psServerParam } from '../lib/ps-servers.js';

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
    'Fetch live context from the running PowerSchool server via the companion plugin endpoints. Returns PS version, installed plugins, custom schema tables (U_ prefix), and named query namespaces. Requires PS_USER, PS_PASS, and the server URI (PSTEST_URI, PSDEV_URI, or PSPROD_URI).',
    { server: psServerParam },
    async ({ server }: { server: PsServerName }) => {
      const status = getPsServerStatus(server);
      if (!status.configured) {
        return err({
          configured: false,
          message: `PowerSchool server ${server} not configured.`,
          missingVars: `Set ${PS_SERVERS[server].uriVar}, PS_USER, and PS_PASS in .env.local.`,
        });
      }

      const url = status.config!.url;
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
