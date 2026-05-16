import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { loggedTool } from '../lib/logger.js';
import { WorkspaceContext } from '../lib/workspace.js';
import {
  getOracleStatus,
  runOracleQuery,
  translateOraclePlaceholders,
} from '../lib/oracle.js';
import { readQueryDir } from '../lib/query-xml.js';

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

function ok(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

function err(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }], isError: true };
}

// ---- Registration ----------------------------------------------------------

export function registerOracleTools(
  server: McpServer,
  getWorkspace: () => WorkspaceContext | null,
): void {

  // --------------------------------------------------------------------------
  loggedTool(server, 'oracle_connection_status',
    'Test the Oracle (PowerSchool) database connection and return configuration status. Does not expose the password.',
    {},
    async () => {
      const status = getOracleStatus();
      if (!status.configured) {
        return err({
          configured: false,
          message: 'Oracle DB not configured.',
          missingVars: 'Set PS_DB_USER and PS_DB_PASSWORD, and either PS_DB_CONNECT_STRING or PS_DB_HOST + PS_DB_SERVICE.',
        });
      }
      const start = Date.now();
      try {
        await runOracleQuery('SELECT 1 FROM DUAL');
        return ok({ ...status.config, configured: true, connected: true, latencyMs: Date.now() - start });
      } catch (e) {
        return err({ ...status.config, configured: true, connected: false, error: String(e) });
      }
    },
  );

  // --------------------------------------------------------------------------
  loggedTool(server, 'oracle_run_query',
    'Run a SELECT statement against the live PowerSchool Oracle database. Only SELECT is allowed.',
    {
      sql:   z.string().describe('SELECT statement to execute. Use named binds with :name syntax.'),
      binds: z.record(z.unknown()).optional().describe('Named bind variables, e.g. { "studentId": 12345 }'),
      limit: z.number().int().min(1).max(1000).default(100).describe('Max rows to return (default 100, max 1000)'),
    },
    async ({ sql, binds = {}, limit }) => {
      try {
        const result = await runOracleQuery(sql, binds, limit);
        return ok({ ...result, rowCount: result.rows.length });
      } catch (e) {
        return err({ error: String(e) });
      }
    },
  );

  // --------------------------------------------------------------------------
  loggedTool(server, 'oracle_describe_table',
    'Get live column metadata for a PowerSchool Oracle table from ALL_TAB_COLUMNS.',
    {
      tableName: z.string().describe('Table name (e.g. STUDENTS, U_MY_EXTENSION). Case-insensitive.'),
      owner:     z.string().optional().describe('Schema owner filter (e.g. SISDBA). Omit to search all accessible owners.'),
    },
    async ({ tableName, owner }) => {
      try {
        const ownerClause = owner ? ' AND OWNER = :owner' : '';
        const sql = `SELECT COLUMN_NAME, DATA_TYPE, DATA_LENGTH, DATA_PRECISION, DATA_SCALE, NULLABLE, OWNER FROM ALL_TAB_COLUMNS WHERE TABLE_NAME = :tableName${ownerClause} ORDER BY COLUMN_ID`;
        const binds: Record<string, unknown> = { tableName: tableName.toUpperCase() };
        if (owner) binds.owner = owner.toUpperCase();

        const { columns, rows } = await runOracleQuery(sql, binds, 500);
        if (rows.length === 0) {
          return err({ error: `Table '${tableName}' not found or not accessible.` });
        }

        const colIdx = Object.fromEntries(columns.map((c, i) => [c, i]));
        const tableOwner = rows[0][colIdx['OWNER']];
        const fields = rows.map((r) => ({
          name: r[colIdx['COLUMN_NAME']],
          type: r[colIdx['DATA_TYPE']],
          length: r[colIdx['DATA_LENGTH']],
          precision: r[colIdx['DATA_PRECISION']],
          scale: r[colIdx['DATA_SCALE']],
          nullable: r[colIdx['NULLABLE']] === 'Y',
        }));

        return ok({ table: tableName.toUpperCase(), owner: tableOwner, columns: fields });
      } catch (e) {
        return err({ error: String(e) });
      }
    },
  );

  // --------------------------------------------------------------------------
  loggedTool(server, 'oracle_list_tables',
    'List Oracle tables accessible to the DB user, with optional prefix filter. Useful for finding custom U_ plugin tables.',
    {
      prefix: z.string().optional().describe('Filter by table name prefix (e.g. "U_" for custom plugin tables). Omit for all tables.'),
      owner:  z.string().optional().describe('Filter by schema owner (e.g. "SISDBA"). Omit to search all accessible owners.'),
    },
    async ({ prefix, owner }) => {
      try {
        const ownerClause = owner ? ' AND OWNER = :owner' : '';
        const sql = `SELECT OWNER, TABLE_NAME FROM ALL_TABLES WHERE TABLE_NAME LIKE :prefix || '%'${ownerClause} ORDER BY OWNER, TABLE_NAME`;
        const binds: Record<string, unknown> = { prefix: (prefix ?? '').toUpperCase() };
        if (owner) binds.owner = owner.toUpperCase();

        const { rows } = await runOracleQuery(sql, binds, 500);
        const tables = rows.map((r) => ({ owner: r[0], name: r[1] }));
        return ok({ tables, count: tables.length });
      } catch (e) {
        return err({ error: String(e) });
      }
    },
  );

  // --------------------------------------------------------------------------
  loggedTool(server, 'oracle_run_named_query',
    'Find a named query in the workspace named_queries.xml files and execute it against the live PowerSchool Oracle database. Translates ~[args.x] placeholders to Oracle :x binds.',
    {
      queryName: z.string().describe('The name= attribute of the query in named_queries.xml (e.g. com.example.plugin.myQuery)'),
      args:      z.record(z.unknown()).optional().describe('Argument values matching the <args> definition in the query, e.g. { "studentId": 12345 }'),
      limit:     z.number().int().min(1).max(1000).default(100).describe('Max rows to return (default 100, max 1000)'),
    },
    async ({ queryName, args = {}, limit }) => {
      try {
        const ws = requireWorkspace(getWorkspace);
        if (!ws.dirs.queriesRoot) {
          return err({ error: 'No queries_root directory found in this workspace.' });
        }

        const queryFiles = readQueryDir(ws.dirs.queriesRoot);
        let found = null;
        for (const qf of queryFiles) {
          const match = qf.queries.find((q) => q.name === queryName);
          if (match) { found = match; break; }
        }

        if (!found) {
          return err({ error: `Named query '${queryName}' not found in queries_root.` });
        }
        if (!found.sql) {
          return err({ error: `Named query '${queryName}' has no SQL content.` });
        }

        const { sql: translatedSql, binds } = translateOraclePlaceholders(found.sql, args);
        const result = await runOracleQuery(translatedSql, binds, limit);
        return ok({ queryName, ...result, rowCount: result.rows.length });
      } catch (e) {
        return err({ error: String(e) });
      }
    },
  );
}
