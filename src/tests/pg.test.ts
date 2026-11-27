import { describe, it, expect, vi, beforeEach } from 'vitest';

// Shared mock pool instance — captured so tests can inspect calls
const mockQuery = vi.fn().mockResolvedValue({
  fields: [{ name: 'now' }],
  rows: [{ now: '2026-05-16' }],
});
const mockPool = { query: mockQuery, end: vi.fn().mockResolvedValue(undefined) };

// Mock the pg Pool before importing the lib
vi.mock('pg', () => ({
  Pool: vi.fn(() => mockPool),
}));

const { getPgConfig, getPgStatus, runPgQuery } = await import('../lib/pg.js');

// ---- getPgConfig -----------------------------------------------------------

describe('getPgConfig', () => {
  beforeEach(() => {
    delete process.env['PS_PG_DATABASE'];
    delete process.env['PS_PG_USER'];
    delete process.env['PS_PG_HOST'];
    delete process.env['PS_PG_PORT'];
    delete process.env['PS_PG_PASSWORD'];
  });

  it('defaults to tpsdata_development when PS_PG_DATABASE is not set', () => {
    const config = getPgConfig();
    expect(config.database).toBe('tpsdata_development');
  });

  it('uses PS_PG_DATABASE when set', () => {
    process.env['PS_PG_DATABASE'] = 'tpsdata_test';
    const config = getPgConfig();
    expect(config.database).toBe('tpsdata_test');
  });

  it('defaults port to 5432', () => {
    const config = getPgConfig();
    expect(config.port).toBe(5432);
  });

  it('uses custom port when PS_PG_PORT is set', () => {
    process.env['PS_PG_PORT'] = '5433';
    const config = getPgConfig();
    expect(config.port).toBe(5433);
  });

  it('omits host when PS_PG_HOST is not set (Unix socket mode)', () => {
    const config = getPgConfig();
    expect(config.host).toBeUndefined();
  });

  it('includes host when PS_PG_HOST is set', () => {
    process.env['PS_PG_HOST'] = 'localhost';
    const config = getPgConfig();
    expect(config.host).toBe('localhost');
  });
});

// ---- getPgStatus -----------------------------------------------------------

describe('getPgStatus', () => {
  it('never includes a password field', () => {
    process.env['PS_PG_PASSWORD'] = 'supersecret';
    const status = getPgStatus();
    expect(JSON.stringify(status)).not.toContain('supersecret');
    expect(JSON.stringify(status)).not.toContain('password');
    delete process.env['PS_PG_PASSWORD'];
  });

  it('always returns configured: true (Postgres has safe defaults)', () => {
    const status = getPgStatus();
    expect(status.configured).toBe(true);
  });
});

// ---- runPgQuery SELECT guard -----------------------------------------------

describe('runPgQuery SELECT guard', () => {
  const statements = [
    'INSERT INTO students VALUES (1)',
    'UPDATE students SET name = \'x\'',
    'DELETE FROM students',
    'DROP TABLE students',
    'TRUNCATE students',
    '  insert into foo values (1)',
    '\nDELETE FROM foo',
  ];

  for (const sql of statements) {
    it(`rejects: ${sql.trim().slice(0, 40)}`, async () => {
      await expect(runPgQuery(sql)).rejects.toThrow('Only SELECT statements are allowed.');
    });
  }

  it('accepts a SELECT statement', async () => {
    const result = await runPgQuery('SELECT now()');
    expect(result.columns).toEqual(['now']);
    expect(result.rows).toHaveLength(1);
  });
});

// ---- LIMIT injection -------------------------------------------------------

describe('runPgQuery LIMIT injection', () => {
  beforeEach(() => mockQuery.mockClear());

  it('appends LIMIT when query has none', async () => {
    await runPgQuery('SELECT * FROM students', [], 50);
    const calledSql: string = mockQuery.mock.calls[0]?.[0] ?? '';
    expect(calledSql).toMatch(/LIMIT 50/i);
  });

  it('does not add a second LIMIT when query already has one', async () => {
    await runPgQuery('SELECT * FROM students LIMIT 10', [], 50);
    const calledSql: string = mockQuery.mock.calls[0]?.[0] ?? '';
    const limitMatches = calledSql.match(/\bLIMIT\b/gi) ?? [];
    expect(limitMatches).toHaveLength(1);
  });
});
