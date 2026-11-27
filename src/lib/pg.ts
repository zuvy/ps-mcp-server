import { Pool, PoolConfig, QueryResult } from 'pg';

// ---- Config ----------------------------------------------------------------

export interface PgConfig {
  database: string;
  user?: string;
  host?: string;
  port: number;
}

export function getPgConfig(): PgConfig {
  return {
    database: process.env.PS_PG_DATABASE ?? 'tpsdata_development',
    ...(process.env.PS_PG_USER ? { user: process.env.PS_PG_USER } : {}),
    ...(process.env.PS_PG_HOST ? { host: process.env.PS_PG_HOST } : {}),
    port: parseInt(process.env.PS_PG_PORT ?? '5432', 10),
  };
}

export function getPgStatus(): { configured: boolean; config: PgConfig } {
  return { configured: true, config: getPgConfig() };
}

// ---- Pool ------------------------------------------------------------------

let pool: Pool | null = null;

function getPool(): Pool {
  if (pool) return pool;

  const config = getPgConfig();
  const poolConfig: PoolConfig = {
    database: config.database,
    port: config.port,
    max: parseInt(process.env.PS_PG_POOL_MAX ?? '5', 10),
    ...(config.user ? { user: config.user } : {}),
    ...(config.host ? { host: config.host } : {}),
    ...(process.env.PS_PG_PASSWORD ? { password: process.env.PS_PG_PASSWORD } : {}),
  };

  pool = new Pool(poolConfig);
  return pool;
}

export async function closePgPool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

// ---- Query -----------------------------------------------------------------

/** Append LIMIT to SQL if no LIMIT clause is already present. */
function applyLimit(sql: string, limit: number): string {
  if (/\bLIMIT\s+\d+/i.test(sql)) return sql;
  return `${sql.trimEnd()} LIMIT ${limit}`;
}

/**
 * Run a SELECT against Postgres. Enforces SELECT-only and caps rows at 1000.
 * params are positional ($1, $2, ...).
 *
 * Note: table names containing '/' (e.g. "mastery_connect/scores") must be
 * double-quoted in SQL: SELECT * FROM "mastery_connect/scores"
 */
export async function runPgQuery(
  sql: string,
  params: unknown[] = [],
  limit = 100,
): Promise<{ columns: string[]; rows: unknown[][] }> {
  if (!/^\s*SELECT\b/i.test(sql)) {
    throw new Error('Only SELECT statements are allowed.');
  }

  const effectiveLimit = Math.min(Math.max(1, limit), 1000);
  const limitedSql = applyLimit(sql, effectiveLimit);

  const p = getPool();
  const result: QueryResult = await p.query(limitedSql, params.length > 0 ? params : undefined);

  const columns = result.fields.map((f) => f.name);
  const rows = result.rows.map((row) => columns.map((col) => row[col]));
  return { columns, rows };
}
