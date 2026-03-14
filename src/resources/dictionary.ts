import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DataDictionary } from '../lib/data-dictionary.js';

export function registerDictionaryResources(server: McpServer, dict: DataDictionary): void {
  // ps://schema/tables — all table names + descriptions
  server.resource(
    'schema-tables',
    'ps://schema/tables',
    { description: 'All PowerSchool tables with names and descriptions', mimeType: 'application/json' },
    async (_uri) => {
      const tables = dict.tableNames.map(name => {
        const t = dict.getTable(name)!;
        return {
          name: t.name,
          title: t.title,
          description: t.description,
          coreTable: t.coreTable,
          isCore: t.isCore,
          fieldCount: t.fields.size,
        };
      });
      return {
        contents: [{
          uri: 'ps://schema/tables',
          mimeType: 'application/json',
          text: JSON.stringify({ tableCount: dict.tableCount, tables }),
        }],
      };
    },
  );

  // ps://schema/table/{TABLE} — all fields for a specific table
  server.resource(
    'schema-table',
    new ResourceTemplate('ps://schema/table/{table}', {
      list: async () => ({
        resources: dict.tableNames.map(name => ({
          uri: `ps://schema/table/${name}`,
          name: `Schema: ${name}`,
          mimeType: 'application/json',
        })),
      }),
    }),
    { description: 'All fields for a PowerSchool table', mimeType: 'application/json' },
    async (uri, { table }) => {
      const tableName = (table as string).toUpperCase();
      const t = dict.getTable(tableName);
      if (!t) {
        throw new Error(`Table '${tableName}' not found in data dictionary.`);
      }
      return {
        contents: [{
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify(dict.tableToJson(t)),
        }],
      };
    },
  );

  // ps://schema/search/{query} — search tables and fields by keyword
  server.resource(
    'schema-search',
    new ResourceTemplate('ps://schema/search/{query}', { list: undefined }),
    { description: 'Search PowerSchool tables and fields by keyword', mimeType: 'application/json' },
    async (uri, { query }) => {
      const q = query as string;
      const tables = dict.searchTables(q).map(t => ({
        type: 'table' as const,
        name: t.name,
        title: t.title,
        description: t.description,
        fieldCount: t.fields.size,
      }));
      const fields = dict.searchFields(q).slice(0, 100).map(({ table, field }) => ({
        type: 'field' as const,
        table: table.name,
        field: field.name,
        dataType: field.dataType,
        description: field.description,
      }));
      return {
        contents: [{
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify({ query: q, tableMatches: tables, fieldMatches: fields }),
        }],
      };
    },
  );

  // ps://schema/custom-tables — U_-prefixed tables only
  server.resource(
    'schema-custom-tables',
    'ps://schema/custom-tables',
    { description: 'All U_-prefixed custom tables known to PowerSchool', mimeType: 'application/json' },
    async (_uri) => {
      const tables = dict.getCustomTables().map(t => dict.tableToJson(t));
      return {
        contents: [{
          uri: 'ps://schema/custom-tables',
          mimeType: 'application/json',
          text: JSON.stringify({ count: tables.length, tables }),
        }],
      };
    },
  );
}
