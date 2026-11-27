import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ZodRawShape } from 'zod';

/** Write a timestamped line to stderr. Never throws. */
export function log(level: 'INFO' | 'WARN' | 'ERROR', message: string): void {
  try {
    const ts = new Date().toISOString();
    process.stderr.write(`[ps-mcp] ${ts} ${level} ${message}\n`);
  } catch {
    // Logging must never crash the server
  }
}

/**
 * Drop-in replacement for server.tool() that logs every invocation.
 *
 * Logs:
 *   → tool:<name> called  (with serialized params, capped at 300 chars)
 *   ✓ tool:<name> ok      (with elapsed ms)
 *   ✗ tool:<name> error   (with error message and elapsed ms)
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function loggedTool<T extends ZodRawShape>(
  server: McpServer,
  name: string,
  description: string,
  schema: T,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (params: any) => Promise<any>,
): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  server.tool(name, description, schema, (async (params: any) => {
    const start = Date.now();
    const paramStr = JSON.stringify(params);
    const truncated = paramStr.length > 300 ? paramStr.slice(0, 300) + '…' : paramStr;
    log('INFO', `tool:${name} called params=${truncated}`);
    try {
      const result = await handler(params);
      const ms = Date.now() - start;
      const isError = result?.isError === true;
      if (isError) {
        log('WARN', `tool:${name} returned error result (${ms}ms)`);
      } else {
        log('INFO', `tool:${name} ok (${ms}ms)`);
      }
      return result;
    } catch (err) {
      const ms = Date.now() - start;
      log('ERROR', `tool:${name} threw ${err} (${ms}ms)`);
      throw err;
    }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any);
}
