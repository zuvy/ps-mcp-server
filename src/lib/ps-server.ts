import https from 'https';
import { URL } from 'url';

export interface PsServerConfig {
  url: string;
  user: string;
}

export interface PsServerContext {
  psVersion: string;
  timestamp: string;
  installedPlugins: Array<{ name: string; enabled: number }>;
  schemaExtensions: string[];
  queryRoots: Array<{ plugin: string; namespace: string }>;
}

export function getPsServerConfig(): PsServerConfig | null {
  const url = process.env['PSTEST_URI'];
  const user = process.env['PS_USER'];
  const password = process.env['PS_PASS'];
  if (!url || !user || !password) return null;
  return { url: url.replace(/\/$/, ''), user };
}

export function getPsServerStatus(): { configured: boolean; config?: PsServerConfig } {
  const config = getPsServerConfig();
  return config ? { configured: true, config } : { configured: false };
}

// ---- HTTP helpers -----------------------------------------------------------

function parseCookies(jar: Map<string, string>, headers: string | string[] | undefined): void {
  if (!headers) return;
  const list = Array.isArray(headers) ? headers : [headers];
  for (const cookie of list) {
    const [nameValue] = cookie.split(';');
    const eqIdx = nameValue.indexOf('=');
    if (eqIdx > 0) {
      jar.set(nameValue.slice(0, eqIdx).trim(), nameValue.slice(eqIdx + 1).trim());
    }
  }
}

function cookieHeader(jar: Map<string, string>): string {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

function get(
  url: URL,
  jar: Map<string, string>,
): Promise<{ status: number; setCookies: string[]; body: string }> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: url.hostname,
        port: 443,
        path: url.pathname + url.search,
        method: 'GET',
        rejectUnauthorized: false,
        headers: {
          'User-Agent': 'ps-mcp-server/0.1.0',
          Accept: 'application/json',
          Cookie: cookieHeader(jar),
        },
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            setCookies: (res.headers['set-cookie'] as string[] | undefined) ?? [],
            body,
          }),
        );
      },
    );
    req.on('error', reject);
    req.end();
  });
}

function post(
  url: URL,
  jar: Map<string, string>,
  body: string,
): Promise<{ status: number; setCookies: string[] }> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: url.hostname,
        port: 443,
        path: url.pathname + url.search,
        method: 'POST',
        rejectUnauthorized: false,
        headers: {
          'User-Agent': 'ps-mcp-server/0.1.0',
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body),
          Cookie: cookieHeader(jar),
          Referer: `${url.origin}/admin/pw.html`,
        },
      },
      (res) => {
        // Drain the body so the socket is released.
        res.resume();
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            setCookies: (res.headers['set-cookie'] as string[] | undefined) ?? [],
          }),
        );
      },
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ---- Auth ------------------------------------------------------------------

async function authenticate(
  baseUrl: string,
  user: string,
  password: string,
): Promise<Map<string, string>> {
  const jar = new Map<string, string>();
  const base = new URL(baseUrl);

  // Step 1: GET login page — collects initial session cookies.
  const loginPage = await get(new URL('/admin/pw.html', base), jar);
  parseCookies(jar, loginPage.setCookies);

  // Step 2: POST credentials.
  const postData = new URLSearchParams({
    username: user,
    password,
    ldappassword: password,
    request_locale: 'en_US',
  }).toString();

  const loginResp = await post(new URL('/admin/home.html', base), jar, postData);
  parseCookies(jar, loginResp.setCookies);

  if (loginResp.status !== 200 && loginResp.status !== 302) {
    throw new Error(
      `PowerSchool authentication failed (HTTP ${loginResp.status}). Check PS_SERVER_USER and PS_SERVER_PASSWORD.`,
    );
  }

  return jar;
}

// ---- Fetching context ------------------------------------------------------

async function fetchJson<T>(baseUrl: string, path: string, jar: Map<string, string>): Promise<T> {
  const resp = await get(new URL(path, baseUrl), jar);
  if (resp.status !== 200) {
    throw new Error(`GET ${path} returned HTTP ${resp.status}`);
  }
  try {
    return JSON.parse(resp.body) as T;
  } catch {
    throw new Error(`GET ${path} returned non-JSON: ${resp.body.slice(0, 200)}`);
  }
}

export async function fetchPsServerContext(
  baseUrl: string,
  user: string,
  password: string,
): Promise<PsServerContext> {
  const jar = await authenticate(baseUrl, user, password);

  const [serverInfo, installedPlugins, schemaExtensions, queryRoots] = await Promise.all([
    fetchJson<{ psVersion: string; timestamp: string }>(
      baseUrl,
      '/vscode_cpm/ps_server_info.json',
      jar,
    ),
    fetchJson<Array<{ name: string; enabled: number }>>(
      baseUrl,
      '/vscode_cpm/ps_installed_plugins.json',
      jar,
    ),
    fetchJson<string[]>(baseUrl, '/vscode_cpm/ps_custom_tables.json', jar),
    fetchJson<Array<{ plugin: string; namespace: string }>>(
      baseUrl,
      '/vscode_cpm/ps_named_queries.json',
      jar,
    ),
  ]);

  return {
    psVersion: serverInfo.psVersion,
    timestamp: serverInfo.timestamp,
    installedPlugins,
    schemaExtensions,
    queryRoots,
  };
}
