import oracledb from 'oracledb';
import { log } from './logger.js';
import { PS_SERVERS, PsServerName, DEFAULT_PS_SERVER } from './ps-servers.js';

// ---- Config ----------------------------------------------------------------

export interface OracleConfig {
  server: PsServerName;
  host: string;
  port: number;
  sid: string;
  user: string;
}

/** Returns config without password, or null if required env vars are missing. */
export function getOracleConfig(server: PsServerName = DEFAULT_PS_SERVER): OracleConfig | null {
  const user = process.env['DB_USER'];
  const password = process.env['DB_PASS'];
  const host = process.env[PS_SERVERS[server].hostVar];
  const sid = process.env['DB_SID'];
  if (!user || !password || !host || !sid) return null;

  const port = parseInt(process.env['DB_PORT'] ?? '1521', 10);
  return { server, host, port, sid, user };
}

export function getOracleStatus(server: PsServerName = DEFAULT_PS_SERVER): { configured: boolean; config?: OracleConfig } {
  const config = getOracleConfig(server);
  return config ? { configured: true, config } : { configured: false };
}

// ---- Pool ------------------------------------------------------------------

const pools = new Map<PsServerName, oracledb.Pool>();

async function getPool(server: PsServerName): Promise<oracledb.Pool> {
  const existing = pools.get(server);
  if (existing) return existing;

  const config = getOracleConfig(server);
  if (!config) {
    throw new Error(
      `Oracle DB not configured for ${server}. Set ${PS_SERVERS[server].hostVar}, DB_SID, DB_USER, and DB_PASS.`,
    );
  }

  const password = process.env['DB_PASS']!;
  const connectString = `${config.host}:${config.port}/${config.sid}`;

  log('INFO', `oracle: creating pool server=${server} connectString=${connectString} user=${config.user}`);

  const pool = await oracledb.createPool({
    user: config.user,
    password,
    connectString,
    poolMin: 1,
    poolMax: 5,
    poolIncrement: 1,
  });

  pools.set(server, pool);
  return pool;
}

export async function closeOraclePool(): Promise<void> {
  for (const pool of pools.values()) await pool.close(0);
  pools.clear();
}

// ---- Query -----------------------------------------------------------------

/** Translate PS-style ~[args.name] placeholders to Oracle :name binds. */
export function translateOraclePlaceholders(
  sql: string,
  args: Record<string, unknown>,
): { sql: string; binds: Record<string, unknown> } {
  const binds: Record<string, unknown> = {};
  const translated = sql.replace(/~\[args\.(\w+)\]/g, (_, name: string) => {
    binds[name] = args[name] ?? null;
    return `:${name}`;
  });
  return { sql: translated, binds };
}

/**
 * Run a SELECT against Oracle. Enforces SELECT-only and caps rows at 1000.
 * binds uses Oracle named-bind syntax: { name: value }.
 */
export async function runOracleQuery(
  sql: string,
  binds: Record<string, unknown> = {},
  limit = 100,
  server: PsServerName = DEFAULT_PS_SERVER,
): Promise<{ columns: string[]; rows: unknown[][] }> {
  if (!/^\s*SELECT\b/i.test(sql)) {
    throw new Error('Only SELECT statements are allowed.');
  }

  const effectiveLimit = Math.min(Math.max(1, limit), 1000);
  const p = await getPool(server);
  const connection = await p.getConnection();

  try {
    const result = await connection.execute<unknown[]>(sql, binds as Record<string, oracledb.BindParameter>, {
      maxRows: effectiveLimit,
      outFormat: oracledb.OUT_FORMAT_ARRAY,
    });

    const columns = (result.metaData ?? []).map((m) => m.name);
    const rows = (result.rows ?? []) as unknown[][];
    return { columns, rows };
  } finally {
    await connection.close();
  }
}
