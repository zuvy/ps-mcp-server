import { startServer } from './server.js';

startServer().catch((err: unknown) => {
  process.stderr.write(`[ps-mcp] Fatal error: ${err}\n`);
  process.exit(1);
});
