import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { loggedTool } from '../lib/logger.js';
import { getPgStatus, runPgQuery } from '../lib/pg.js';

// ---- Helpers ---------------------------------------------------------------

function ok(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

function err(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }], isError: true };
}

// ---- Registration ----------------------------------------------------------

export function registerPostgresTools(server: McpServer): void {

  // --------------------------------------------------------------------------
  loggedTool(server, 'pg_connection_status',
    'Test the local PostgreSQL (tpsdata_development) connection and return configuration. Does not expose the password.',
    {},
    async () => {
      const status = getPgStatus();
      const start = Date.now();
      try {
        await runPgQuery('SELECT 1');
        return ok({ ...status.config, configured: true, connected: true, latencyMs: Date.now() - start });
      } catch (e) {
        return err({ ...status.config, configured: true, connected: false, error: String(e) });
      }
    },
  );

  // --------------------------------------------------------------------------
  loggedTool(server, 'pg_run_query',
    'Run a SELECT statement against the local tpsdata_development PostgreSQL database. Only SELECT is allowed. Use $1, $2, … for positional parameters. Table names containing "/" (e.g. "mastery_connect/scores") must be double-quoted in SQL.',
    {
      sql:    z.string().describe('SELECT statement to execute. Use $1, $2, … for positional parameters.'),
      params: z.array(z.unknown()).optional().describe('Positional parameter values matching $1, $2, … in the SQL'),
      limit:  z.number().int().min(1).max(1000).default(100).describe('Max rows to return (default 100, max 1000)'),
    },
    async ({ sql, params = [], limit }) => {
      try {
        const result = await runPgQuery(sql, params, limit);
        return ok({ ...result, rowCount: result.rows.length });
      } catch (e) {
        return err({ error: String(e) });
      }
    },
  );

  // --------------------------------------------------------------------------
  loggedTool(server, 'pg_describe_table',
    'Get column metadata for a tpsdata_development table from information_schema.columns.',
    {
      tableName: z.string().describe('Table name (e.g. "students", "daily_attendances_2025"). Use the exact name — case-sensitive.'),
      schema:    z.string().default('public').describe('Schema name (default: public)'),
    },
    async ({ tableName, schema }) => {
      try {
        const sql = `
          SELECT column_name, data_type, character_maximum_length, is_nullable, column_default
          FROM information_schema.columns
          WHERE table_name = $1 AND table_schema = $2
          ORDER BY ordinal_position`;
        const { columns, rows } = await runPgQuery(sql, [tableName, schema], 500);

        if (rows.length === 0) {
          return err({ error: `Table '${tableName}' not found in schema '${schema}'.` });
        }

        const colIdx = Object.fromEntries(columns.map((c, i) => [c, i]));
        const fields = rows.map((r) => ({
          name: r[colIdx['column_name']],
          type: r[colIdx['data_type']],
          maxLength: r[colIdx['character_maximum_length']],
          nullable: r[colIdx['is_nullable']] === 'YES',
          default: r[colIdx['column_default']],
        }));

        return ok({ table: tableName, schema, columns: fields });
      } catch (e) {
        return err({ error: String(e) });
      }
    },
  );

  // --------------------------------------------------------------------------
  loggedTool(server, 'pg_list_tables',
    'List tables in the tpsdata_development PostgreSQL database. Some table names contain "/" (e.g. "mastery_connect/scores") and require double-quoting in SQL.',
    {
      search: z.string().optional().describe('Case-insensitive substring filter on table name (e.g. "attendance" or "mastery")'),
      schema: z.string().default('public').describe('Schema name (default: public)'),
    },
    async ({ search, schema }) => {
      try {
        const sql = search
          ? `SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_type = 'BASE TABLE' AND table_name ILIKE $2 ORDER BY table_name`
          : `SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_type = 'BASE TABLE' ORDER BY table_name`;
        const params = search ? [schema, `%${search}%`] : [schema];

        const { rows } = await runPgQuery(sql, params, 500);
        const tables = rows.map((r) => r[0] as string);
        return ok({ schema, tables, count: tables.length });
      } catch (e) {
        return err({ error: String(e) });
      }
    },
  );
}
