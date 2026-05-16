import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock oracledb before any imports that use it
vi.mock('oracledb', () => {
  const mockConnection = {
    execute: vi.fn().mockResolvedValue({
      metaData: [{ name: 'SYSDATE' }],
      rows: [['2026-05-16']],
    }),
    close: vi.fn().mockResolvedValue(undefined),
  };
  const mockPool = {
    getConnection: vi.fn().mockResolvedValue(mockConnection),
    close: vi.fn().mockResolvedValue(undefined),
  };
  return {
    default: {
      createPool: vi.fn().mockResolvedValue(mockPool),
      OUT_FORMAT_ARRAY: 4,
    },
  };
});

// Import after mock so the module sees the mocked oracledb
const { getOracleConfig, getOracleStatus, runOracleQuery, translateOraclePlaceholders } =
  await import('../lib/oracle.js');

// ---- getOracleConfig -------------------------------------------------------

describe('getOracleConfig', () => {
  beforeEach(() => {
    delete process.env['DB_USER'];
    delete process.env['DB_PASS'];
    delete process.env['DB_HOST'];
    delete process.env['DB_SID'];
    delete process.env['DB_PORT'];
  });

  it('returns null when user is missing', () => {
    process.env['DB_PASS'] = 'secret';
    process.env['DB_HOST'] = 'myhost';
    process.env['DB_SID'] = 'PSDB';
    expect(getOracleConfig()).toBeNull();
  });

  it('returns null when password is missing', () => {
    process.env['DB_USER'] = 'dbuser';
    process.env['DB_HOST'] = 'myhost';
    process.env['DB_SID'] = 'PSDB';
    expect(getOracleConfig()).toBeNull();
  });

  it('returns null when host is missing', () => {
    process.env['DB_USER'] = 'dbuser';
    process.env['DB_PASS'] = 'secret';
    process.env['DB_SID'] = 'PSDB';
    expect(getOracleConfig()).toBeNull();
  });

  it('returns null when SID is missing', () => {
    process.env['DB_USER'] = 'dbuser';
    process.env['DB_PASS'] = 'secret';
    process.env['DB_HOST'] = 'myhost';
    expect(getOracleConfig()).toBeNull();
  });

  it('returns config when all required vars are set', () => {
    process.env['DB_USER'] = 'dbuser';
    process.env['DB_PASS'] = 'secret';
    process.env['DB_HOST'] = 'myhost';
    process.env['DB_SID'] = 'PSDB';
    const config = getOracleConfig();
    expect(config).not.toBeNull();
    expect(config!.user).toBe('dbuser');
    expect(config!.host).toBe('myhost');
    expect(config!.sid).toBe('PSDB');
    expect(config!.port).toBe(1521);
  });

  it('uses custom port when DB_PORT is set', () => {
    process.env['DB_USER'] = 'dbuser';
    process.env['DB_PASS'] = 'secret';
    process.env['DB_HOST'] = 'myhost';
    process.env['DB_SID'] = 'PSDB';
    process.env['DB_PORT'] = '1522';
    const config = getOracleConfig();
    expect(config!.port).toBe(1522);
  });
});

// ---- getOracleStatus -------------------------------------------------------

describe('getOracleStatus', () => {
  afterEach(() => {
    delete process.env['DB_USER'];
    delete process.env['DB_PASS'];
    delete process.env['DB_HOST'];
    delete process.env['DB_SID'];
  });

  it('never includes a password field', () => {
    process.env['DB_USER'] = 'dbuser';
    process.env['DB_PASS'] = 'supersecret';
    process.env['DB_HOST'] = 'myhost';
    process.env['DB_SID'] = 'PSDB';
    const status = getOracleStatus();
    expect(JSON.stringify(status)).not.toContain('supersecret');
    expect(JSON.stringify(status)).not.toContain('DB_PASS');
  });

  it('returns configured: false when env vars are missing', () => {
    const status = getOracleStatus();
    expect(status.configured).toBe(false);
    expect(status.config).toBeUndefined();
  });
});

// ---- runOracleQuery SELECT guard -------------------------------------------

describe('runOracleQuery SELECT guard', () => {
  const statements = [
    'INSERT INTO students VALUES (1)',
    'UPDATE students SET name = \'x\'',
    'DELETE FROM students',
    'DROP TABLE students',
    'TRUNCATE TABLE students',
    '  insert into foo values (1)',
    '\nDELETE FROM foo',
  ];

  for (const sql of statements) {
    it(`rejects: ${sql.trim().slice(0, 40)}`, async () => {
      await expect(runOracleQuery(sql)).rejects.toThrow('Only SELECT statements are allowed.');
    });
  }

  it('accepts a SELECT statement', async () => {
    process.env['DB_USER'] = 'dbuser';
    process.env['DB_PASS'] = 'secret';
    process.env['DB_HOST'] = 'myhost';
    process.env['DB_SID'] = 'PSDB';
    const result = await runOracleQuery('SELECT SYSDATE FROM DUAL');
    expect(result.columns).toEqual(['SYSDATE']);
    expect(result.rows).toHaveLength(1);
  });
});

// ---- translateOraclePlaceholders -------------------------------------------

describe('translateOraclePlaceholders', () => {
  it('translates ~[args.x] to :x and maps bind values', () => {
    const { sql, binds } = translateOraclePlaceholders(
      'SELECT * FROM STUDENTS WHERE STUDENT_NUMBER = ~[args.studentId] AND GRADE_LEVEL = ~[args.grade]',
      { studentId: 12345, grade: 9 },
    );
    expect(sql).toBe('SELECT * FROM STUDENTS WHERE STUDENT_NUMBER = :studentId AND GRADE_LEVEL = :grade');
    expect(binds).toEqual({ studentId: 12345, grade: 9 });
  });

  it('uses null for args not provided in the values map', () => {
    const { sql, binds } = translateOraclePlaceholders(
      'SELECT * FROM STUDENTS WHERE ID = ~[args.id]',
      {},
    );
    expect(sql).toContain(':id');
    expect(binds['id']).toBeNull();
  });

  it('leaves non-args placeholders untouched', () => {
    const { sql } = translateOraclePlaceholders(
      'SELECT ~(curyearid) FROM DUAL WHERE x = ~[args.x]',
      { x: 1 },
    );
    expect(sql).toContain('~(curyearid)');
    expect(sql).toContain(':x');
  });

  it('handles SQL with no placeholders', () => {
    const { sql, binds } = translateOraclePlaceholders('SELECT 1 FROM DUAL', {});
    expect(sql).toBe('SELECT 1 FROM DUAL');
    expect(binds).toEqual({});
  });
});
