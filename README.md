# ps-mcp

A [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server for PowerSchool plugin developers. It gives an AI assistant (Claude, Cursor, etc.) structured, read/write access to your plugin workspace — so it can scaffold artifacts, validate XML, sync access request fields, package ZIPs, and answer questions about the PS data model, all with knowledge of your actual files.

---

## What it does

ps-mcp exposes three categories of capability to an MCP client:

### Tools (actions the AI can take)

| Tool | What it does |
|------|-------------|
| `get_plugin_info` | Read current plugin.xml and workspace layout |
| `scaffold_plugin` | Generate a new plugin.xml with all optional blocks |
| `validate_plugin_xml` | Validate plugin.xml against PS requirements |
| `bump_plugin_version` | Increment major/minor/patch or set an explicit version |
| `package_plugin` | Pre-flight validate and build a distributable ZIP |
| `rename_plugin` | Refactor plugin name and all query/permission namespaces (ports `rename.rb`) |
| `scaffold_powerquery` | Generate a named query XML file with correct column refs |
| `list_powerqueries` | List all named queries in the workspace |
| `validate_named_queries` | Check for duplicate names, bad column refs, arg/param mismatches |
| `scaffold_db_extension` | Generate a `user_schema_root` XML for a new DB extension |
| `list_db_extensions` | List all DB extensions in the workspace |
| `list_custom_tables` | Browse U_* custom tables in the PS data dictionary |
| `analyze_schema` | Find existing extensions and tables relevant to a description |
| `add_field_to_extension` | Add a field to an existing extension XML |
| `sync_access_request` | Scan all named queries and rebuild the `access_request` block in plugin.xml (ports `sync_plugin_access_request.rb`) |
| `add_access_field` | Add a single TABLE.FIELD entry to `access_request` |
| `scaffold_permission_mapping` | Generate a `permissions_root` XML file |
| `record_lesson` | Save a lesson learned, pattern, or gotcha about PS plugin development |
| `list_lessons` | Search saved lessons |
| `get_lesson` | Read a saved lesson in full |
| `delete_lesson` | Remove a saved lesson |

### Resources (read-only data the AI can load)

| URI | Contents |
|-----|---------|
| `ps://tags/list` | All PS HTML tag categories |
| `ps://tags/{category}` | Tag reference for a category (e.g. `tlist_sql`, `powerquery`) |
| `ps://schema/tables` | All table names in the PS data dictionary |
| `ps://schema/table/{TABLE}` | All fields for a table with types and descriptions |
| `ps://schema/search/{query}` | Keyword search across tables and fields |
| `ps://plugin/current` | Parsed plugin.xml + workspace layout |
| `ps://plugin/queries` | All named query definitions in the workspace |
| `ps://plugin/extensions` | All DB extension definitions in the workspace |
| `ps://docs/list` | Index of bundled PS documentation |
| `ps://docs/{docName}` | A specific documentation file |
| `ps://lessons/list` | Index of saved lessons |
| `ps://lessons/{id}` | A specific saved lesson |

### Prompts (guided templates)

| Prompt | What it guides |
|--------|---------------|
| `design_powerquery` | Design a named query end-to-end; produces a `scaffold_powerquery` call |
| `design_db_extension` | Choose extend-existing vs. create-new; produces the right scaffold call |
| `explain_pshtml_tag` | Look up and explain a PS HTML tag pattern |
| `design_permission_mapping` | Design a permission mapping file; produces a `scaffold_permission_mapping` call |

---

## Bundled reference data

The server loads these assets at startup from `.docs/`:

- **Data dictionary** (`data_dictionary.csv`) — Complete PS database schema: every core table and field with types and descriptions. Used for column validation in named queries, access request sync, and schema analysis.
- **Tag reference** (`.docs/tags/*.json`) — PS HTML tag documentation covering ~37 categories (tlist_sql, powerquery, frn, if/logic, dates, grades, gpa, contacts, etc.).
- **Documentation** (`.docs/*.md`) — 62+ markdown files covering PS customization, the Data Access API, OAuth, SSO, DB extensions, named queries, permissions, and more.

> **Note: `.docs/` is not in this repository.** The reference material in `.docs/` contains proprietary PowerSchool content. It is licensed for use by PowerSchool Support Technical Users but may not be shared, so it is deliberately git-ignored and must never be committed or redistributed. To run the server with full reference data, get these files through your own PowerSchool support channels and place them in `.docs/` at the project root.

---

## Installation

### Prerequisites

- Node.js 20+
- An MCP-compatible client (Claude Code, Claude Desktop, VS Code with MCP extension, Cursor, etc.)

### Build

```bash
cd /path/to/ps-mcp
npm install
npm run build
```

This produces `dist/index.js` — a single self-contained ESM bundle with a `#!/usr/bin/env node` shebang.

---

## Configuration

### Option A — VS Code (recommended)

Add to your plugin project's `.vscode/mcp.json`:

```json
{
  "servers": {
    "ps-mcp": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/ps-mcp/dist/index.js"],
      "env": {
        "PS_PLUGIN_ROOT": "${workspaceFolder}"
      }
    }
  }
}
```

Set `PS_PLUGIN_ROOT` to `${workspaceFolder}` — the server resolves both flat and src-based layouts automatically. See [Workspace detection](#workspace-detection) for details.

### Option B — Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or the equivalent on your platform:

```json
{
  "mcpServers": {
    "ps-mcp": {
      "command": "node",
      "args": ["/path/to/ps-mcp/dist/index.js"],
      "env": {
        "PS_PLUGIN_ROOT": "/path/to/your/plugin"
      }
    }
  }
}
```

Set `PS_PLUGIN_ROOT` to the project root directory (the VS Code workspace folder equivalent). The server will find `plugin.xml` whether it is at the root or inside a `src/` subdirectory.

### Option C — Claude Code CLI

Add to `~/.claude/settings.json` under `mcpServers`, or use the VS Code `.vscode/mcp.json` approach above.

---

## Workspace detection

The server locates your plugin project automatically on every tool call using this priority order:

### 1. `PS_PLUGIN_ROOT` env var (highest priority)

When `PS_PLUGIN_ROOT` is set, the server tries two candidates derived from it:

1. `{PS_PLUGIN_ROOT}/plugin.xml` — treats the env var as the artifacts root directly (flat layout, or already-resolved path)
2. `{PS_PLUGIN_ROOT}/src/plugin.xml` — treats the env var as the workspace root with a src-based layout

This means **`PS_PLUGIN_ROOT` can point to the VS Code `${workspaceFolder}` for any layout** — you never need to change the `mcp.json` value when switching between flat and src-based projects.

If `PS_PLUGIN_ROOT` is set but neither candidate finds `plugin.xml`, a warning is written to stderr and detection falls through to the walk-up method.

### 2. Walk up from the current working directory

Tries `{dir}/src/plugin.xml` then `{dir}/plugin.xml` at each level, walking up to 10 parent directories. Used when `PS_PLUGIN_ROOT` is not set or yields no match.

### Common configurations

| Layout | `PS_PLUGIN_ROOT` value | How it resolves |
|--------|----------------------|----------------|
| Src-based (`src/plugin.xml`) | `${workspaceFolder}` | Tries `workspaceFolder/src/plugin.xml` ✓ |
| Flat (`plugin.xml` at root) | `${workspaceFolder}` | Tries `workspaceFolder/plugin.xml` ✓ |
| Explicit artifacts root | `${workspaceFolder}/src` | Tries `workspaceFolder/src/plugin.xml` directly ✓ |
| Not set | _(none)_ | Walk-up from cwd finds `plugin.xml` at any depth |

### Verifying detection

Call `get_plugin_info` — the response includes `discoveryMethod` (e.g. `PS_PLUGIN_ROOT="/path" (src subfolder)` or `cwd walk-up (/path/to/dir)`) so you can confirm the right workspace was found.

### Artifact directories

Once `plugin.xml` is found, the server also discovers any artifact subdirectories present alongside it:

| Directory | Purpose |
|-----------|---------|
| `queries_root/` | Named query XML files (`*.named_queries.xml`) |
| `permissions_root/` | Permission mapping XML files (`*.permission_mappings.xml`) |
| `user_schema_root/` | DB extension schema XML files |
| `web_root/` or `WEB_ROOT/` | PS HTML page fragments |
| `pagecataloging/` | Page catalog entries |

If no workspace is detected, tools that require one will return a clear error. Read-only tools (tag reference, data dictionary, docs, lessons) work without a workspace.

---

## Plugin project layout

ps-mcp supports both common layouts:

**src-based** (typical for projects with a build step):
```
my-plugin/
└── src/
    ├── plugin.xml
    ├── queries_root/
    │   └── com.example.data.students.named_queries.xml
    ├── user_schema_root/
    │   └── U_Laptops.xml
    ├── permissions_root/
    │   └── com.example.data.students.permission_mappings.xml
    └── web_root/
```

**flat** (artifacts directly at root):
```
my-plugin/
├── plugin.xml
├── queries_root/
├── user_schema_root/
└── permissions_root/
```

---

## Lessons learned store

The `record_lesson` / `list_lessons` / `get_lesson` tools provide a persistent knowledge base for capturing non-obvious PS behaviors and hard-won workarounds. Lessons are stored as JSON files in `.docs/lessons/` and survive across sessions.

Topics: `named-queries` · `db-extensions` · `permissions` · `ps-html` · `plugin-xml` · `access-request` · `packaging` · `general`

Example — recording a gotcha mid-session:

> "Record a lesson: when extending the Users table, tlist_child links must use `204~([teachers]USERS_DCID)` instead of `~(frn)` because the Unified Teacher Record splits TEACHERS into USERS (204) and SCHOOLSTAFF (203)."

The lesson is saved and automatically available in all future sessions via `ps://lessons/list`.

---

## Development

```bash
npm run dev        # Run via tsx (no build step, for development)
npm run build      # Bundle to dist/index.js
npm run test       # Run unit tests (vitest)
npm run test:watch # Watch mode
```

---

## Architecture

```
src/
├── index.ts            # Entry point — calls startServer()
├── server.ts           # Asset loading, workspace detection, registration
├── lib/
│   ├── workspace.ts    # Workspace detection + artifact dir resolution
│   ├── plugin-xml.ts   # plugin.xml parse/build (fast-xml-parser + xmlbuilder2)
│   ├── query-xml.ts    # named_queries XML parse/build
│   ├── schema-xml.ts   # user_schema_root XML parse/build
│   ├── permission-xml.ts # permission_mappings XML build
│   ├── access-sync.ts  # Port of sync_plugin_access_request.rb
│   ├── packager.ts     # Pre-flight validation + archiver ZIP builder
│   ├── data-dictionary.ts # CSV parser for data_dictionary.csv
│   ├── tag-index.ts    # Tag JSON file loader/indexer
│   └── lessons.ts      # Lessons JSON store (upsert/search/delete)
├── tools/              # One file per tool group
├── resources/          # One file per resource group
└── prompts/            # Prompt templates
```

The server runs over **stdio** transport. Each tool call re-detects the workspace so the server stays correct if files change between calls. Data assets (dictionary, tags) are loaded once at startup.
