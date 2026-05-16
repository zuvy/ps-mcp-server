import oracledb from 'oracledb';
import { log } from './logger.js';

// ---- Config ----------------------------------------------------------------

export interface OracleConfig {
  host?: string;
  port: number;
  service?: string;
  connectString?: string;
  user: string;
}

/** Returns config without password, or null if required env vars are missing. */
export function getOracleConfig(): OracleConfig | null {
  const user = process.env.PS_DB_USER;
  const password = process.env.PS_DB_PASSWORD;
  if (!user || !password) return null;

  const connectString = process.env.PS_DB_CONNECT_STRING;
  if (connectString) {
    return { connectString, user, port: 1521 };
  }

  const host = process.env.PS_DB_HOST;
  const service = process.env.PS_DB_SERVICE;
  if (!host || !service) return null;

  const port = parseInt(process.env.PS_DB_PORT ?? '1521', 10);
  return { host, port, service, user };
}

export function getOracleStatus(): { configured: boolean; config?: OracleConfig } {
  const config = getOracleConfig();
  return config ? { configured: true, config } : { configured: false };
}

// ---- Pool ------------------------------------------------------------------

let pool: oracledb.Pool | null = null;

async function getPool(): Promise<oracledb.Pool> {
  if (pool) return pool;

  const config = getOracleConfig();
  if (!config) {
    throw new Error(
      'Oracle DB not configured. Set PS_DB_HOST (or PS_DB_CONNECT_STRING), PS_DB_SERVICE, PS_DB_USER, and PS_DB_PASSWORD.',
    );
  }

  const password = process.env.PS_DB_PASSWORD!;
  const connectString =
    config.connectString ?? `${config.host}:${config.port}/${config.service}`;

  log('INFO', `oracle: creating pool connectString=${connectString} user=${config.user}`);

  pool = await oracledb.createPool({
    user: config.user,
    password,
    connectString,
    poolMin: parseInt(process.env.PS_DB_POOL_MIN ?? '1', 10),
    poolMax: parseInt(process.env.PS_DB_POOL_MAX ?? '5', 10),
    poolIncrement: 1,
  });

  return pool;
}

export async function closeOraclePool(): Promise<void> {
  if (pool) {
    await pool.close(0);
    pool = null;
  }
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
): Promise<{ columns: string[]; rows: unknown[][] }> {
  if (!/^\s*SELECT\b/i.test(sql)) {
    throw new Error('Only SELECT statements are allowed.');
  }

  const effectiveLimit = Math.min(Math.max(1, limit), 1000);
  const p = await getPool();
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
