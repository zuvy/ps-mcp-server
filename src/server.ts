import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

import { TagIndex } from './lib/tag-index.js';
import { DataDictionary } from './lib/data-dictionary.js';
import { detectWorkspace } from './lib/workspace.js';
import { registerTagResources } from './resources/tags.js';
import { registerDictionaryResources } from './resources/dictionary.js';
import { registerDocsResources } from './resources/docs.js';
import { registerPluginResources } from './resources/plugin.js';
import { registerLessonResources } from './resources/lessons.js';
import { registerPluginTools } from './tools/plugin.js';
import { registerPackageTools } from './tools/package.js';
import { registerSchemaTools } from './tools/schema.js';
import { registerQueryTools } from './tools/queries.js';
import { registerAccessTools } from './tools/access.js';
import { registerPermissionTools } from './tools/permissions.js';
import { registerLessonTools } from './tools/lessons.js';
import { registerPrompts } from './prompts/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Both src/ and dist/ are one level below the project root where .docs/ lives
const PROJECT_ROOT = path.join(__dirname, '..');
const DOCS_DIR = path.join(PROJECT_ROOT, '.docs');
const LESSONS_DIR = path.join(PROJECT_ROOT, '.docs', 'lessons');

export async function createServer(): Promise<McpServer> {
  // --- Load data assets ---
  const tagsDir = path.join(DOCS_DIR, 'tags');
  if (!fs.existsSync(tagsDir)) {
    throw new Error(`Tags directory not found: ${tagsDir}`);
  }
  const csvPath = path.join(DOCS_DIR, 'data_dictionary.csv');
  if (!fs.existsSync(csvPath)) {
    throw new Error(`Data dictionary not found: ${csvPath}`);
  }

  process.stderr.write('[ps-mcp] Loading tag index...\n');
  const tagIndex = await TagIndex.load(tagsDir);
  process.stderr.write(`[ps-mcp] Loaded ${tagIndex.categories.length} tag categories (${tagIndex.totalTagCount} tags)\n`);

  process.stderr.write('[ps-mcp] Loading data dictionary...\n');
  const dict = DataDictionary.load(csvPath);
  process.stderr.write(`[ps-mcp] Loaded ${dict.tableCount} tables from data dictionary\n`);

  // --- Detect plugin workspace (best-effort at startup; tools re-check on demand) ---
  const workspace = detectWorkspace();
  if (workspace) {
    process.stderr.write(`[ps-mcp] Workspace detected: ${workspace.artifactsRoot} (${workspace.layout})\n`);
  } else {
    process.stderr.write('[ps-mcp] No plugin workspace detected — set PS_PLUGIN_ROOT or open a plugin directory\n');
  }

  // --- Create MCP server ---
  const server = new McpServer({
    name: 'ps-mcp',
    version: '0.1.0',
  });

  // getWorkspace is a function so tools re-detect on each call
  const getWorkspace = () => detectWorkspace();

  // --- Register resources ---
  registerTagResources(server, tagIndex);
  registerDictionaryResources(server, dict);
  registerDocsResources(server, DOCS_DIR);
  registerPluginResources(server, getWorkspace);
  registerLessonResources(server, LESSONS_DIR);

  // --- Register tools ---
  registerPluginTools(server, dict, getWorkspace);
  registerPackageTools(server, getWorkspace);
  registerSchemaTools(server, dict, getWorkspace);
  registerQueryTools(server, dict, getWorkspace);
  registerAccessTools(server, dict, getWorkspace);
  registerPermissionTools(server, getWorkspace);
  registerLessonTools(server, LESSONS_DIR);

  // --- Register prompts ---
  registerPrompts(server);

  return server;
}

export async function startServer(): Promise<void> {
  const server = await createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write('[ps-mcp] Server running on stdio\n');
}
