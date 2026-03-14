import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import fs from 'fs';
import path from 'path';

export function registerDocsResources(server: McpServer, docsDir: string): void {
  // ps://docs/list — enumerate all available documentation files
  server.resource(
    'ps://docs/list',
    'ps://docs/list',
    { mimeType: 'application/json' },
    async () => {
      const entries = fs.readdirSync(docsDir).filter((f) => f.endsWith('.md'));
      const docs = entries.map((file) => ({
        docName: file.replace(/\.md$/, ''),
        uri: `ps://docs/${file.replace(/\.md$/, '')}`,
        file,
      }));
      return {
        contents: [
          {
            uri: 'ps://docs/list',
            mimeType: 'application/json',
            text: JSON.stringify(docs, null, 2),
          },
        ],
      };
    },
  );

  // ps://docs/{docName} — contents of .docs/{docName}.md
  const docTemplate = new ResourceTemplate('ps://docs/{docName}', {
    list: async () => {
      const entries = fs.readdirSync(docsDir).filter((f) => f.endsWith('.md'));
      return {
        resources: entries.map((file) => ({
          uri: `ps://docs/${file.replace(/\.md$/, '')}`,
          name: file.replace(/\.md$/, ''),
          mimeType: 'text/markdown',
        })),
      };
    },
  });

  server.resource(
    'ps://docs/{docName}',
    docTemplate,
    { mimeType: 'text/markdown' },
    async (uri, variables) => {
      const docName = variables['docName'] as string;
      const filePath = path.join(docsDir, `${docName}.md`);

      if (!fs.existsSync(filePath)) {
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: 'text/plain',
              text: `Documentation file not found: ${docName}.md\nAvailable docs: see ps://docs/list`,
            },
          ],
        };
      }

      const text = fs.readFileSync(filePath, 'utf-8');
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'text/markdown',
            text,
          },
        ],
      };
    },
  );
}
