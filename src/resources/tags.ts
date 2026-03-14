import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { TagIndex } from '../lib/tag-index.js';

export function registerTagResources(server: McpServer, tags: TagIndex): void {
  // ps://tags — list of all tag categories
  server.resource(
    'tags-list',
    'ps://tags',
    { description: 'List of all PS HTML tag categories', mimeType: 'application/json' },
    async (_uri) => ({
      contents: [{
        uri: 'ps://tags',
        mimeType: 'application/json',
        text: JSON.stringify({ categories: tags.categories, totalTags: tags.totalTagCount }),
      }],
    }),
  );

  // ps://tags/all — full tag reference merged across all categories
  server.resource(
    'tags-all',
    'ps://tags/all',
    { description: 'Complete PS HTML tag reference (all categories)', mimeType: 'application/json' },
    async (_uri) => ({
      contents: [{
        uri: 'ps://tags/all',
        mimeType: 'application/json',
        text: JSON.stringify(tags.getAll()),
      }],
    }),
  );

  // ps://tags/{category} — tags in a specific category
  server.resource(
    'tags-by-category',
    new ResourceTemplate('ps://tags/{category}', {
      list: async () => ({
        resources: tags.categories.map(cat => ({
          uri: `ps://tags/${cat}`,
          name: `PS HTML tags: ${cat}`,
          mimeType: 'application/json',
        })),
      }),
    }),
    { description: 'PS HTML tags for a specific category', mimeType: 'application/json' },
    async (uri, { category }) => {
      const sections = tags.getCategory(category as string);
      if (!sections) {
        throw new Error(
          `Tag category '${category}' not found. Available: ${tags.categories.join(', ')}`,
        );
      }
      return {
        contents: [{
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify({ category, sections }),
        }],
      };
    },
  );
}
