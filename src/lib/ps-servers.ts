import { z } from 'zod';

// Env var names per PowerSchool server, matching the shared .env.local layout.
export const PS_SERVERS = {
  pstest: { hostVar: 'PSTEST_HOST', uriVar: 'PSTEST_URI' },
  psdev:  { hostVar: 'PSDEV_HOST',  uriVar: 'PSDEV_URI' },
  psprod: { hostVar: 'PROD_HOST',   uriVar: 'PSPROD_URI' },
} as const;

export type PsServerName = keyof typeof PS_SERVERS;

export const DEFAULT_PS_SERVER: PsServerName = 'pstest';

export const psServerParam = z
  .enum(['pstest', 'psdev', 'psprod'])
  .default(DEFAULT_PS_SERVER)
  .describe('Target PowerSchool server. Always use pstest unless the user asks for psdev/psprod or the task clearly requires it (e.g. verifying production data).');
