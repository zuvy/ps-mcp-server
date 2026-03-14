import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

export function registerPrompts(server: McpServer): void {
  // ---- design_powerquery -----------------------------------------------------

  server.prompt(
    'design_powerquery',
    'Design a PowerSchool named query (PowerQuery) for a described data need. Guides you through naming conventions, column references, parameter binding, and produces a ready-to-use scaffold_powerquery tool call.',
    {
      description: z
        .string()
        .describe('What data is needed — e.g. "list active students with their homeroom teacher name"'),
      targetTable: z
        .string()
        .describe('Primary PS table to query — e.g. "STUDENTS"'),
      psVersion: z
        .string()
        .optional()
        .describe('PowerSchool version (optional) — affects available columns and syntax'),
    },
    ({ description, targetTable, psVersion }) => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: `You are helping design a PowerSchool named query (PowerQuery) using the ps-mcp tools.

## Request
**Data needed:** ${description}
**Primary table:** ${targetTable}${psVersion ? `\n**PS version:** ${psVersion}` : ''}

## PowerQuery Design Guidelines

### Naming convention (enforced by PS)
Query names must be 5-part dot-separated: \`{org}.{product}.{module}.{entity}.{action}\`
- Example: \`com.example.data.students.active_with_teacher\`
- All lowercase, no spaces, underscores allowed
- Max 50 characters total

### Column reference patterns
**Pattern A** (preferred for simple column output):
\`\`\`xml
<column column="TABLE.FIELD">alias</column>
\`\`\`

**Pattern B** (used when field reference is in text):
\`\`\`xml
<column description="Label">TABLE.FIELD</column>
\`\`\`

### Parameter binding
- Use \`:paramname\` in SQL WHERE clauses
- Each parameter must have a matching \`<arg name="paramname" ...>\` element
- Types: \`String\`, \`Integer\`, \`Long\`, \`Date\`

### SQL in CDATA
Always wrap SQL in \`<![CDATA[ ... ]]>\`

### Access request
Every \`TABLE.FIELD\` column reference automatically becomes an \`<access_request>\` entry. Use \`sync_access_request\` after scaffolding.

## Steps
1. Use \`ps://schema/table/${targetTable}\` (or the \`list_custom_tables\` tool) to identify the correct field names for the primary table
2. Identify any JOIN tables needed
3. Design the query name, columns, args, and SQL
4. Call \`scaffold_powerquery\` with all parameters
5. Then call \`sync_access_request\` to update plugin.xml

Please proceed with designing the query for: **${description}**`,
          },
        },
      ],
    }),
  );

  // ---- design_db_extension ---------------------------------------------------

  server.prompt(
    'design_db_extension',
    'Design a PowerSchool database extension (user_schema_root XML). Determines whether to extend an existing table or create a new one, then guides you to the right scaffold or add-field tool call.',
    {
      description: z
        .string()
        .describe('What data to capture — e.g. "track student laptop assignments"'),
      coreTable: z
        .string()
        .optional()
        .describe('PS core table to extend, if known — e.g. "Students". Omit for independent tables.'),
    },
    ({ description, coreTable }) => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: `You are helping design a PowerSchool database extension using the ps-mcp tools.

## Request
**Data to capture:** ${description}${coreTable ? `\n**Core table:** ${coreTable}` : ''}

## DB Extension Design Guidelines

### Extension types
| Type | When to use | Relationship |
|------|-------------|-------------|
| One-to-one | One extra record per core record | Shares DCID with parent |
| One-to-many | Multiple records per core record | FK \`{CoreTable}DCID\` |
| Independent | Standalone lookup/reference table | No parent FK |

### PS HTML reference patterns (for custom pages)
**One-to-one** (group=\`U_Laptop\`, coreTable=\`Students\`):
- Field input: \`name="[Students.U_Laptop]FieldName"\`
- Field display: \`~([Students.U_Laptop]FieldName)\`

**One-to-many** (group=\`U_CollegeApp\`, table=\`U_Applications\`, coreTable=\`Students\`):
- \`~[tlist_child:STUDENTS.U_COLLEGEAPP.U_APPLICATIONS;displaycols:Field1,Field2;fieldNames:Label1,Label2;type:html]\`

**Independent** (group=\`U_CollegeApp\`, table=\`U_Institutions\`):
- \`~[tlist_standalone:U_COLLEGEAPP.U_INSTITUTIONS;displaycols:Field1,Field2;fieldNames:Label1,Label2;type:html]\`

### Staff/FRN gotcha
If coreTable is \`Teachers\` or \`Users\`, page links must use:
\`204~([teachers]USERS_DCID)\` (not \`~(frn)\`) because the Unified Teacher Record splits TEACHERS into USERS (204) and SCHOOLSTAFF (203).

### System fields
- PS auto-creates the \`ID\` primary key — do NOT declare it in the XML
- For one-to-one and one-to-many, declare the \`{CoreTable}DCID\` FK
- Tracking fields (WHOMODIFIEDID, WHENMODIFIED) are optional but recommended

## Steps
1. Call \`analyze_schema\` with a description of what you need to capture${coreTable ? ` and coreTable="${coreTable}"` : ''}
2. Review the existing extension suggestions
3. If extending existing: call \`add_field_to_extension\`
4. If creating new: call \`scaffold_db_extension\`

Please proceed by calling \`analyze_schema\` for: **${description}**${coreTable ? ` on table ${coreTable}` : ''}`,
          },
        },
      ],
    }),
  );

  // ---- explain_pshtml_tag ----------------------------------------------------

  server.prompt(
    'explain_pshtml_tag',
    'Explain a PowerSchool HTML tag pattern, its syntax, and usage. Looks up the tag in the ps-mcp tag reference and provides a plain-language explanation with examples.',
    {
      tagPattern: z
        .string()
        .describe('The tag or pattern to explain — e.g. "~[tlist_sql", "~(*powerquery", "~[DirectTable.Select"'),
    },
    ({ tagPattern }) => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: `You are explaining a PowerSchool HTML (PS HTML) tag using the ps-mcp tag reference.

## Tag to explain
\`${tagPattern}\`

## Instructions
1. Look up this tag pattern using the \`ps://tags/list\` resource to find its category
2. Read the relevant tag category resource (e.g. \`ps://tags/tlist\`) to get the full documentation
3. Provide:
   - **What it does** — plain-language description
   - **Syntax** — all required and optional parameters
   - **Common use cases** — when you'd use this tag
   - **Example** — a realistic usage example in context
   - **Gotchas / caveats** — anything that commonly causes bugs or confusion

Please look up and explain: \`${tagPattern}\``,
          },
        },
      ],
    }),
  );

  // ---- design_permission_mapping ---------------------------------------------

  server.prompt(
    'design_permission_mapping',
    'Design a PowerSchool permission mapping file that grants PS pages access to named query or table endpoints. Produces a ready-to-use scaffold_permission_mapping tool call.',
    {
      tableName: z
        .string()
        .describe('The endpoint table or query to grant access to — e.g. "U_Laptops" or "com.example.data.students.active"'),
      operations: z
        .string()
        .describe('Comma-separated HTTP operations to allow — e.g. "get,post" or "get,post,put,delete"'),
      sourcePages: z
        .string()
        .describe('Comma-separated PS page paths that need access — e.g. "/admin/students/student_ids.html,/guardian/portal.html"'),
    },
    ({ tableName, operations, sourcePages }) => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: `You are designing a PowerSchool permission mapping file using the ps-mcp tools.

## Request
**Endpoint:** \`${tableName}\`
**Operations:** \`${operations}\`
**Source pages:** \`${sourcePages}\`

## Permission Mapping Guidelines

### Endpoint patterns
| Endpoint type | Pattern |
|---------------|---------|
| Named query | \`/ws/schema/query/{queryName}\` (always POST) |
| Table read/create | \`/ws/schema/table/{TableName}\` (GET/POST) |
| Specific record update/delete | \`/ws/schema/table/{TableName}/#\` (PUT/DELETE) |

### File naming convention
\`{namespace}.permission_mappings.xml\`
Example: \`com.example.data.students.permission_mappings.xml\`

### One <implies> per operation
Each sourcePage + operation + endpoint triple becomes one \`<implies>\` element. Multiple operations for the same page are grouped under one \`<permission>\` element.

### Named queries always use POST
Even though named queries are read-only SELECT statements, they are accessed via HTTP POST in PS. Always use \`post\` for named query endpoints.

## Steps
1. Determine the correct endpoint paths for: \`${tableName}\`
   - If it looks like a query name (contains dots): use \`/ws/schema/query/${tableName}\`
   - If it looks like a table name (no dots): use \`/ws/schema/table/${tableName}\`
2. Parse the operations: \`${operations}\`
3. Parse the source pages: \`${sourcePages}\`
4. Choose a \`fileName\` following the naming convention
5. Call \`scaffold_permission_mapping\` with all parameters

Please design the permission mapping for endpoint: **${tableName}**`,
          },
        },
      ],
    }),
  );
}
