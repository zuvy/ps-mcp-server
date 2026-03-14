#!/usr/bin/env node

// src/server.ts
import { McpServer as McpServer4 } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { fileURLToPath } from "url";
import path14 from "path";
import fs19 from "fs";

// src/lib/tag-index.ts
import fs from "fs";
import path from "path";
function sanitizeTagJson(raw) {
  return fixUnescapedQuotesInValues(fixControlCharsInStrings(raw));
}
function fixControlCharsInStrings(raw) {
  let out = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    const code = raw.charCodeAt(i);
    if (escaped) {
      out += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\" && inString) {
      out += ch;
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      out += ch;
      continue;
    }
    if (inString && code < 32) {
      switch (ch) {
        case "	":
          out += "\\t";
          break;
        case "\n":
          out += "\\n";
          break;
        case "\r":
          out += "\\r";
          break;
        default:
          out += `\\u${code.toString(16).padStart(4, "0")}`;
          break;
      }
      continue;
    }
    out += ch;
  }
  return out;
}
var VALUE_LINE_RE = /^(\s*"[^"]+"\s*:\s*")(.*)/;
function fixUnescapedQuotesInValues(raw) {
  return raw.split("\n").map((line) => {
    const m = line.match(VALUE_LINE_RE);
    if (!m) return line;
    const prefix = m[1];
    const rest = m[2];
    const trimmed = rest.trimEnd();
    const trailingWS = rest.slice(trimmed.length);
    let suffix;
    let content;
    if (trimmed.endsWith('",')) {
      suffix = '",';
      content = trimmed.slice(0, -2);
    } else if (trimmed.endsWith('"')) {
      suffix = '"';
      content = trimmed.slice(0, -1);
    } else {
      return line;
    }
    const fixedContent = content.replace(/(?<!\\)"/g, '\\"');
    return prefix + fixedContent + suffix + trailingWS;
  }).join("\n");
}
var TagIndex = class _TagIndex {
  _index = /* @__PURE__ */ new Map();
  constructor() {
  }
  /** Load all *.json files from the given tags directory */
  static async load(tagsDir) {
    const idx = new _TagIndex();
    const files = fs.readdirSync(tagsDir).filter((f) => f.endsWith(".json"));
    for (const file of files) {
      const category = path.basename(file, ".json");
      const raw = fs.readFileSync(path.join(tagsDir, file), "utf8");
      const sanitized = sanitizeTagJson(raw);
      try {
        const data = JSON.parse(sanitized);
        idx._index.set(category, data);
      } catch (err) {
        process.stderr.write(`[ps-mcp] Warning: failed to parse tags/${file}: ${err}
`);
      }
    }
    return idx;
  }
  get categories() {
    return Array.from(this._index.keys()).sort();
  }
  getCategory(category) {
    return this._index.get(category);
  }
  getAll() {
    return this.categories.map((cat) => ({
      category: cat,
      sections: this._index.get(cat)
    }));
  }
  /** Search tags by keyword across all categories. Returns matching tags with their category. */
  search(query) {
    const q = query.toLowerCase();
    const results = [];
    for (const [category, sections] of this._index) {
      for (const sec of sections) {
        for (const tag of sec.tags) {
          if (tag.name.toLowerCase().includes(q) || tag.desc.toLowerCase().includes(q) || tag.ex && tag.ex.toLowerCase().includes(q)) {
            results.push({ category, section: sec.section, tag });
          }
        }
      }
    }
    return results;
  }
  get totalTagCount() {
    let count = 0;
    for (const sections of this._index.values()) {
      for (const sec of sections) count += sec.tags.length;
    }
    return count;
  }
};

// src/lib/data-dictionary.ts
import fs2 from "fs";
import { parse } from "csv-parse/sync";
var DataDictionary = class _DataDictionary {
  /** Keyed by uppercase TABLE_NAME */
  _tables = /* @__PURE__ */ new Map();
  constructor() {
  }
  static load(csvPath) {
    const dict = new _DataDictionary();
    const content = fs2.readFileSync(csvPath, "utf8");
    const rows = parse(content, {
      columns: true,
      skip_empty_lines: true,
      relax_quotes: true
    });
    for (const row of rows) {
      const tableName = row.TABLE_NAME.toUpperCase();
      let table = dict._tables.get(tableName);
      if (!table) {
        table = {
          name: tableName,
          coreTable: row.CORE_TABLE.toUpperCase(),
          title: row.TABLE_TITLE,
          description: row.TABLE_DESC,
          isCore: row.IS_CORE === "1",
          fields: /* @__PURE__ */ new Map()
        };
        dict._tables.set(tableName, table);
      }
      if (row.FIELD_NAME) {
        table.fields.set(row.FIELD_NAME.toUpperCase(), {
          name: row.FIELD_NAME.toUpperCase(),
          dataType: row.FIELD_DATA_TYPE,
          description: row.FIELD_DESC,
          version: row.FIELD_VERSION
        });
      }
    }
    return dict;
  }
  /** Look up a table by name (case-insensitive). */
  getTable(name) {
    return this._tables.get(name.toUpperCase());
  }
  /** Look up a specific field within a table. */
  getField(table, field) {
    return this._tables.get(table.toUpperCase())?.fields.get(field.toUpperCase());
  }
  /** Returns true if the table/field pair exists in the dictionary. */
  hasField(table, field) {
    return this.getField(table, field) !== void 0;
  }
  /** Returns true if the table exists in the dictionary. */
  hasTable(name) {
    return this._tables.has(name.toUpperCase());
  }
  /** All U_-prefixed tables (custom tables installed across PS). */
  getCustomTables() {
    const results = [];
    for (const table of this._tables.values()) {
      if (table.name.startsWith("U_")) results.push(table);
    }
    return results.sort((a, b) => a.name.localeCompare(b.name));
  }
  /** Search tables by keyword (matches name, title, or description). */
  searchTables(query) {
    const q = query.toLowerCase();
    const results = [];
    for (const table of this._tables.values()) {
      if (table.name.toLowerCase().includes(q) || table.title.toLowerCase().includes(q) || table.description.toLowerCase().includes(q)) {
        results.push(table);
      }
    }
    return results.sort((a, b) => a.name.localeCompare(b.name));
  }
  /** Search fields by keyword across all tables. */
  searchFields(query) {
    const q = query.toLowerCase();
    const results = [];
    for (const table of this._tables.values()) {
      for (const field of table.fields.values()) {
        if (field.name.toLowerCase().includes(q) || field.description.toLowerCase().includes(q)) {
          results.push({ table, field });
        }
      }
    }
    return results;
  }
  get tableCount() {
    return this._tables.size;
  }
  /** All table names, sorted. */
  get tableNames() {
    return Array.from(this._tables.keys()).sort();
  }
  /** Serialise a table for JSON output (converts Map fields to array). */
  tableToJson(table) {
    return {
      name: table.name,
      coreTable: table.coreTable,
      title: table.title,
      description: table.description,
      isCore: table.isCore,
      fieldCount: table.fields.size,
      fields: Array.from(table.fields.values())
    };
  }
};

// src/lib/workspace.ts
import fs3 from "fs";
import path2 from "path";
function detectWorkspace(rootCandidates) {
  const candidates = [];
  const envRoot = process.env["PS_PLUGIN_ROOT"];
  if (envRoot) {
    candidates.push({ dir: path2.resolve(envRoot), layout: "env" });
  }
  if (rootCandidates) {
    for (const r of rootCandidates) {
      const abs = path2.resolve(r);
      candidates.push({ dir: path2.join(abs, "src"), layout: "src-based" });
      candidates.push({ dir: abs, layout: "flat" });
    }
  }
  let dir = process.cwd();
  for (let i = 0; i < 10; i++) {
    candidates.push({ dir: path2.join(dir, "src"), layout: "src-based" });
    candidates.push({ dir, layout: "flat" });
    const parent = path2.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  for (const { dir: candidate, layout } of candidates) {
    const pluginXml = path2.join(candidate, "plugin.xml");
    if (fs3.existsSync(pluginXml)) {
      return {
        artifactsRoot: candidate,
        layout,
        dirs: resolveArtifactDirs(candidate),
        pluginXmlPath: pluginXml
      };
    }
  }
  return null;
}
function resolveArtifactDirs(root) {
  const dirs = {};
  if (existsDir(root, "queries_root")) {
    dirs.queriesRoot = path2.join(root, "queries_root");
  }
  if (existsDir(root, "permissions_root")) {
    dirs.permissionsRoot = path2.join(root, "permissions_root");
  }
  if (existsDir(root, "user_schema_root")) {
    dirs.userSchemaRoot = path2.join(root, "user_schema_root");
  }
  if (existsDir(root, "web_root")) {
    dirs.webRoot = path2.join(root, "web_root");
  } else if (existsDir(root, "WEB_ROOT")) {
    dirs.webRoot = path2.join(root, "WEB_ROOT");
  }
  if (existsDir(root, "pagecataloging")) {
    dirs.pagecataloging = path2.join(root, "pagecataloging");
  }
  return dirs;
}
function existsDir(root, name) {
  try {
    return fs3.statSync(path2.join(root, name)).isDirectory();
  } catch {
    return false;
  }
}

// src/resources/tags.ts
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
function registerTagResources(server, tags) {
  server.resource(
    "tags-list",
    "ps://tags",
    { description: "List of all PS HTML tag categories", mimeType: "application/json" },
    async (_uri) => ({
      contents: [{
        uri: "ps://tags",
        mimeType: "application/json",
        text: JSON.stringify({ categories: tags.categories, totalTags: tags.totalTagCount })
      }]
    })
  );
  server.resource(
    "tags-all",
    "ps://tags/all",
    { description: "Complete PS HTML tag reference (all categories)", mimeType: "application/json" },
    async (_uri) => ({
      contents: [{
        uri: "ps://tags/all",
        mimeType: "application/json",
        text: JSON.stringify(tags.getAll())
      }]
    })
  );
  server.resource(
    "tags-by-category",
    new ResourceTemplate("ps://tags/{category}", {
      list: async () => ({
        resources: tags.categories.map((cat) => ({
          uri: `ps://tags/${cat}`,
          name: `PS HTML tags: ${cat}`,
          mimeType: "application/json"
        }))
      })
    }),
    { description: "PS HTML tags for a specific category", mimeType: "application/json" },
    async (uri, { category }) => {
      const sections = tags.getCategory(category);
      if (!sections) {
        throw new Error(
          `Tag category '${category}' not found. Available: ${tags.categories.join(", ")}`
        );
      }
      return {
        contents: [{
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify({ category, sections })
        }]
      };
    }
  );
}

// src/resources/dictionary.ts
import { ResourceTemplate as ResourceTemplate2 } from "@modelcontextprotocol/sdk/server/mcp.js";
function registerDictionaryResources(server, dict) {
  server.resource(
    "schema-tables",
    "ps://schema/tables",
    { description: "All PowerSchool tables with names and descriptions", mimeType: "application/json" },
    async (_uri) => {
      const tables = dict.tableNames.map((name) => {
        const t = dict.getTable(name);
        return {
          name: t.name,
          title: t.title,
          description: t.description,
          coreTable: t.coreTable,
          isCore: t.isCore,
          fieldCount: t.fields.size
        };
      });
      return {
        contents: [{
          uri: "ps://schema/tables",
          mimeType: "application/json",
          text: JSON.stringify({ tableCount: dict.tableCount, tables })
        }]
      };
    }
  );
  server.resource(
    "schema-table",
    new ResourceTemplate2("ps://schema/table/{table}", {
      list: async () => ({
        resources: dict.tableNames.map((name) => ({
          uri: `ps://schema/table/${name}`,
          name: `Schema: ${name}`,
          mimeType: "application/json"
        }))
      })
    }),
    { description: "All fields for a PowerSchool table", mimeType: "application/json" },
    async (uri, { table }) => {
      const tableName = table.toUpperCase();
      const t = dict.getTable(tableName);
      if (!t) {
        throw new Error(`Table '${tableName}' not found in data dictionary.`);
      }
      return {
        contents: [{
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(dict.tableToJson(t))
        }]
      };
    }
  );
  server.resource(
    "schema-search",
    new ResourceTemplate2("ps://schema/search/{query}", { list: void 0 }),
    { description: "Search PowerSchool tables and fields by keyword", mimeType: "application/json" },
    async (uri, { query }) => {
      const q = query;
      const tables = dict.searchTables(q).map((t) => ({
        type: "table",
        name: t.name,
        title: t.title,
        description: t.description,
        fieldCount: t.fields.size
      }));
      const fields = dict.searchFields(q).slice(0, 100).map(({ table, field }) => ({
        type: "field",
        table: table.name,
        field: field.name,
        dataType: field.dataType,
        description: field.description
      }));
      return {
        contents: [{
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify({ query: q, tableMatches: tables, fieldMatches: fields })
        }]
      };
    }
  );
  server.resource(
    "schema-custom-tables",
    "ps://schema/custom-tables",
    { description: "All U_-prefixed custom tables known to PowerSchool", mimeType: "application/json" },
    async (_uri) => {
      const tables = dict.getCustomTables().map((t) => dict.tableToJson(t));
      return {
        contents: [{
          uri: "ps://schema/custom-tables",
          mimeType: "application/json",
          text: JSON.stringify({ count: tables.length, tables })
        }]
      };
    }
  );
}

// src/resources/docs.ts
import { ResourceTemplate as ResourceTemplate3 } from "@modelcontextprotocol/sdk/server/mcp.js";
import fs4 from "fs";
import path3 from "path";
function registerDocsResources(server, docsDir) {
  server.resource(
    "ps://docs/list",
    "ps://docs/list",
    { mimeType: "application/json" },
    async () => {
      const entries = fs4.readdirSync(docsDir).filter((f) => f.endsWith(".md"));
      const docs = entries.map((file) => ({
        docName: file.replace(/\.md$/, ""),
        uri: `ps://docs/${file.replace(/\.md$/, "")}`,
        file
      }));
      return {
        contents: [
          {
            uri: "ps://docs/list",
            mimeType: "application/json",
            text: JSON.stringify(docs, null, 2)
          }
        ]
      };
    }
  );
  const docTemplate = new ResourceTemplate3("ps://docs/{docName}", {
    list: async () => {
      const entries = fs4.readdirSync(docsDir).filter((f) => f.endsWith(".md"));
      return {
        resources: entries.map((file) => ({
          uri: `ps://docs/${file.replace(/\.md$/, "")}`,
          name: file.replace(/\.md$/, ""),
          mimeType: "text/markdown"
        }))
      };
    }
  });
  server.resource(
    "ps://docs/{docName}",
    docTemplate,
    { mimeType: "text/markdown" },
    async (uri, variables) => {
      const docName = variables["docName"];
      const filePath = path3.join(docsDir, `${docName}.md`);
      if (!fs4.existsSync(filePath)) {
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "text/plain",
              text: `Documentation file not found: ${docName}.md
Available docs: see ps://docs/list`
            }
          ]
        };
      }
      const text = fs4.readFileSync(filePath, "utf-8");
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "text/markdown",
            text
          }
        ]
      };
    }
  );
}

// src/lib/plugin-xml.ts
import { XMLParser } from "fast-xml-parser";
import { create } from "xmlbuilder2";
import fs5 from "fs";
var PARSER = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  allowBooleanAttributes: true,
  isArray: (name) => ["field", "link", "ui_context", "cdn", "event_subscription"].includes(name)
});
function asStr(v) {
  return typeof v === "string" ? v : void 0;
}
function parseLinks(linksBlock) {
  if (!linksBlock || typeof linksBlock !== "object") return [];
  const lb = linksBlock;
  const raw = Array.isArray(lb["link"]) ? lb["link"] : lb["link"] ? [lb["link"]] : [];
  return raw.map((l) => {
    const link = l;
    const uiContextIds = [];
    const uiCtxs = link["ui_contexts"];
    if (uiCtxs && typeof uiCtxs === "object") {
      const ctxBlock = uiCtxs;
      const ctxArr = Array.isArray(ctxBlock["ui_context"]) ? ctxBlock["ui_context"] : ctxBlock["ui_context"] ? [ctxBlock["ui_context"]] : [];
      for (const c of ctxArr) {
        const id = asStr(c["@_id"]);
        if (id) uiContextIds.push(id);
      }
    }
    return {
      title: asStr(link["@_title"]) ?? "",
      displayText: asStr(link["@_display-text"]) ?? "",
      path: asStr(link["@_path"]) ?? "",
      uiContextIds
    };
  });
}
function parsePluginXml(xmlString) {
  const parsed = PARSER.parse(xmlString);
  const p = parsed["plugin"] ?? {};
  const hasOauth = "oauth" in p;
  let accessLevelV1Api;
  if (hasOauth) {
    const oa = p["oauth"];
    if (oa && typeof oa === "object") {
      const level = asStr(oa["@_accessLevelV1Api"]);
      if (level) accessLevelV1Api = level;
    }
  }
  let autoinstall;
  if ("autoinstall" in p) {
    const ai = p["autoinstall"] ?? {};
    autoinstall = {
      required: ai["@_required"] === "true" || ai["@_required"] === true,
      autoredeploy: "autoredeploy" in ai
    };
    if ("autoenable" in ai) {
      const ae = ai["autoenable"] ?? {};
      autoinstall.autoenable = {
        required: ae["@_required"] === "true" || ae["@_required"] === true
      };
    }
  }
  const accessRequest = [];
  const cdnRequest = [];
  if ("access_request" in p) {
    const arRaw = p["access_request"];
    const ar = arRaw && typeof arRaw === "object" ? arRaw : {};
    const fields = Array.isArray(ar["field"]) ? ar["field"] : ar["field"] ? [ar["field"]] : [];
    for (const f of fields) {
      const fobj = f;
      accessRequest.push({
        table: asStr(fobj["@_table"]) ?? "",
        field: asStr(fobj["@_field"]) ?? "",
        access: asStr(fobj["@_access"]) ?? "ViewOnly"
      });
    }
    if (ar["cdn_request"] && typeof ar["cdn_request"] === "object") {
      const cr = ar["cdn_request"];
      const cdns = Array.isArray(cr["cdn"]) ? cr["cdn"] : cr["cdn"] ? [cr["cdn"]] : [];
      for (const c of cdns) {
        const name = asStr(c["@_name"]);
        if (name) cdnRequest.push(name);
      }
    }
  }
  const pub = p["publisher"] ?? {};
  const contact = pub["contact"] ?? {};
  const publisher = {
    name: asStr(pub["@_name"]) ?? "",
    contact: {
      email: asStr(contact["@_email"]) ?? "",
      phone: asStr(contact["@_phone"])
    }
  };
  const links = parseLinks(p["links"]);
  let registration;
  if ("registration" in p) {
    const reg = p["registration"] ?? {};
    registration = { url: asStr(reg["@_url"]) ?? "" };
  }
  let openid;
  if ("openid" in p) {
    const oid = p["openid"] ?? {};
    openid = {
      host: asStr(oid["@_host"]) ?? "",
      port: asStr(oid["@_port"]) ?? "",
      links: parseLinks(oid["links"])
    };
  }
  return {
    name: asStr(p["@_name"]) ?? "",
    version: asStr(p["@_version"]) ?? "",
    description: asStr(p["@_description"]) ?? "",
    oauth: hasOauth,
    accessLevelV1Api,
    autoinstall,
    accessRequest,
    cdnRequest,
    publisher,
    links: links.length > 0 ? links : void 0,
    registration,
    openid
  };
}
function readPluginXml(filePath) {
  const xml = fs5.readFileSync(filePath, "utf-8");
  return parsePluginXml(xml);
}
function buildLinksElement(parent, links) {
  const linksEl = parent.ele("links");
  for (const link of links) {
    const linkEl = linksEl.ele("link", {
      title: link.title,
      "display-text": link.displayText,
      path: link.path
    });
    if (link.uiContextIds.length > 0) {
      const ctxs = linkEl.ele("ui_contexts");
      for (const id of link.uiContextIds) {
        ctxs.ele("ui_context", { id });
      }
    }
  }
}
function buildPluginXml(data) {
  const doc = create({ version: "1.0", encoding: "UTF-8" });
  const plugin = doc.ele("plugin", {
    xmlns: "http://plugin.powerschool.pearson.com",
    "xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance",
    "xsi:schemaLocation": "http://plugin.powerschool.pearson.com plugin.xsd",
    name: data.name,
    version: data.version,
    description: data.description
  });
  if (data.oauth) {
    const oauthAttrs = {};
    if (data.accessLevelV1Api && data.accessLevelV1Api !== "NONE") {
      oauthAttrs["accessLevelV1Api"] = data.accessLevelV1Api;
    }
    plugin.ele("oauth", oauthAttrs);
  }
  if (data.autoinstall) {
    const ai = plugin.ele("autoinstall");
    if (data.autoinstall.required) ai.att("required", "true");
    if (data.autoinstall.autoenable) {
      const ae = ai.ele("autoenable");
      if (data.autoinstall.autoenable.required) ae.att("required", "true");
    }
    if (data.autoinstall.autoredeploy) ai.ele("autoredeploy");
  }
  const hasAccessRequest = data.accessRequest.length > 0 || data.cdnRequest.length > 0 || data.oauth;
  if (hasAccessRequest) {
    const ar = plugin.ele("access_request");
    if (data.cdnRequest.length > 0) {
      const cr = ar.ele("cdn_request");
      for (const cdn of data.cdnRequest) {
        cr.ele("cdn", { name: cdn });
      }
    }
    for (const f of data.accessRequest) {
      ar.ele("field", { table: f.table, field: f.field, access: f.access });
    }
  }
  const pub = plugin.ele("publisher", { name: data.publisher.name });
  const contactAttrs = {
    email: data.publisher.contact.email
  };
  if (data.publisher.contact.phone) {
    contactAttrs["phone"] = data.publisher.contact.phone;
  }
  pub.ele("contact", contactAttrs);
  if (data.registration !== void 0) {
    plugin.ele("registration", { url: data.registration.url });
  }
  if (data.openid) {
    const oid = plugin.ele("openid", {
      host: data.openid.host,
      port: data.openid.port
    });
    if (data.openid.links && data.openid.links.length > 0) {
      buildLinksElement(oid, data.openid.links);
    }
  }
  if (data.links && data.links.length > 0) {
    buildLinksElement(plugin, data.links);
  }
  return doc.end({ prettyPrint: true });
}
function writePluginXml(filePath, data) {
  fs5.writeFileSync(filePath, buildPluginXml(data), "utf-8");
}

// src/lib/query-xml.ts
import { XMLParser as XMLParser2 } from "fast-xml-parser";
import { create as create2 } from "xmlbuilder2";
import fs6 from "fs";
import path4 from "path";
function asStr2(v) {
  if (typeof v === "string" && v.trim() !== "") return v.trim();
  return void 0;
}
function asBool(v, fallback) {
  if (v === "true" || v === true) return true;
  if (v === "false" || v === false) return false;
  return fallback;
}
var QUERY_PARSER = new XMLParser2({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  allowBooleanAttributes: true,
  isArray: (name) => ["query", "column", "arg"].includes(name),
  textNodeName: "#text",
  // CDATA is automatically merged with text content by default
  cdataPropName: false,
  processEntities: false
});
function parseColumn(c) {
  const colAttr = asStr2(c["@_column"]);
  const descAttr = asStr2(c["@_description"]);
  const textContent = asStr2(c["#text"]);
  if (colAttr) {
    return { fieldRef: colAttr, alias: textContent };
  }
  return { fieldRef: textContent ?? "", description: descAttr, alias: descAttr };
}
function parseArg(a) {
  const required = asBool(a["@_required"]);
  return {
    name: asStr2(a["@_name"]) ?? "",
    ...asStr2(a["@_type"]) ? { type: a["@_type"] } : {},
    ...asStr2(a["@_column"]) ? { column: a["@_column"] } : {},
    ...required !== void 0 ? { required } : {},
    ...asStr2(a["@_description"]) ? { description: a["@_description"] } : {},
    ...asStr2(a["@_default"]) ? { default: a["@_default"] } : {}
  };
}
function parseQueryXml(xmlString) {
  const parsed = QUERY_PARSER.parse(xmlString);
  const queriesBlock = parsed["queries"] ?? {};
  const rawQueries = Array.isArray(queriesBlock["query"]) ? queriesBlock["query"] : queriesBlock["query"] ? [queriesBlock["query"]] : [];
  const queries = rawQueries.map((q) => {
    const qobj = q;
    const argsBlock = qobj["args"];
    const rawArgs = argsBlock && typeof argsBlock === "object" && argsBlock["arg"] ? Array.isArray(argsBlock["arg"]) ? argsBlock["arg"] : [argsBlock["arg"]] : [];
    const colsBlock = qobj["columns"];
    const rawCols = colsBlock && typeof colsBlock === "object" && colsBlock["column"] ? Array.isArray(colsBlock["column"]) ? colsBlock["column"] : [colsBlock["column"]] : [];
    let sql = "";
    const sqlRaw = qobj["sql"];
    if (typeof sqlRaw === "string") {
      sql = sqlRaw.trim();
    } else if (sqlRaw && typeof sqlRaw === "object") {
      const sqlText = asStr2(sqlRaw["#text"]) ?? asStr2(sqlRaw["__cdata"]) ?? "";
      sql = sqlText;
    }
    return {
      name: asStr2(qobj["@_name"]) ?? "",
      // Preserve empty string coreTable="" — valid per PS spec for multi-table queries
      ..."@_coreTable" in qobj ? { coreTable: typeof qobj["@_coreTable"] === "string" ? qobj["@_coreTable"] : "" } : {},
      flattened: asBool(qobj["@_flattened"], true),
      ...qobj["@_dat"] === "true" || qobj["@_dat"] === true ? { dat: true } : {},
      ...asStr2(qobj["summary"]) ? { summary: asStr2(qobj["summary"]) } : {},
      ...asStr2(qobj["description"]) ? { description: asStr2(qobj["description"]) } : {},
      args: rawArgs.map((a) => parseArg(a)),
      columns: rawCols.map((c) => parseColumn(c)),
      sql
    };
  });
  return { queries };
}
function readQueryXml(filePath) {
  const xml = fs6.readFileSync(filePath, "utf-8");
  const result = parseQueryXml(xml);
  result.sourceFile = filePath;
  return result;
}
function readQueryDir(dirPath) {
  if (!fs6.existsSync(dirPath)) return [];
  const files = fs6.readdirSync(dirPath).filter((f) => f.endsWith(".named_queries.xml"));
  return files.map((f) => readQueryXml(path4.join(dirPath, f)));
}
function buildQueryXml(file) {
  const doc = create2({ version: "1.0", encoding: "UTF-8" });
  const queries = doc.ele("queries");
  for (const q of file.queries) {
    const attrs = { name: q.name };
    if (q.coreTable !== void 0) attrs["coreTable"] = q.coreTable;
    if (q.flattened !== void 0) attrs["flattened"] = String(q.flattened);
    if (q.dat) attrs["dat"] = "true";
    const qEl = queries.ele("query", attrs);
    if (q.summary) qEl.ele("summary").txt(q.summary);
    if (q.description) qEl.ele("description").txt(q.description);
    const argsEl = qEl.ele("args");
    for (const arg of q.args) {
      const argAttrs = { name: arg.name };
      if (arg.type) argAttrs["type"] = arg.type;
      if (arg.column) argAttrs["column"] = arg.column;
      if (arg.required !== void 0) argAttrs["required"] = String(arg.required);
      if (arg.description) argAttrs["description"] = arg.description;
      if (arg.default !== void 0) argAttrs["default"] = arg.default;
      argsEl.ele("arg", argAttrs);
    }
    const colsEl = qEl.ele("columns");
    for (const col of q.columns) {
      if (col.alias && col.fieldRef && !col.description) {
        colsEl.ele("column", { column: col.fieldRef }).txt(col.alias);
      } else {
        const colAttrs = {};
        if (col.description) colAttrs["description"] = col.description;
        colsEl.ele("column", colAttrs).txt(col.fieldRef);
      }
    }
    qEl.ele("sql").dat(q.sql.trim() ? `
      ${q.sql.trim()}
    ` : "");
  }
  return doc.end({ prettyPrint: true });
}
function writeQueryXml(filePath, file) {
  fs6.writeFileSync(filePath, buildQueryXml(file), "utf-8");
}
function extractFieldRefs(file) {
  const refs = [];
  const seen = /* @__PURE__ */ new Set();
  function addRef(raw) {
    const m = raw.trim().match(/^([^.]+)\.([^.]+)$/);
    if (!m) return;
    const key = `${m[1].toUpperCase()}.${m[2].toUpperCase()}`;
    if (!seen.has(key)) {
      seen.add(key);
      refs.push({ table: m[1].toUpperCase(), field: m[2].toUpperCase() });
    }
  }
  for (const q of file.queries) {
    for (const col of q.columns) {
      if (col.fieldRef) addRef(col.fieldRef);
    }
    for (const arg of q.args) {
      if (arg.column) addRef(arg.column);
    }
  }
  return refs;
}
function extractSqlParams(sql) {
  const params = /* @__PURE__ */ new Set();
  for (const m of sql.matchAll(/:([a-zA-Z_][a-zA-Z0-9_]*)/g)) {
    params.add(m[1].toLowerCase());
  }
  return Array.from(params);
}

// src/lib/schema-xml.ts
import { XMLParser as XMLParser3 } from "fast-xml-parser";
import { create as create3 } from "xmlbuilder2";
import fs7 from "fs";
import path5 from "path";
function asStr3(v) {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : void 0;
}
function inferExtensionType(extensionGroupName, dbTableName, coreTable) {
  if (!coreTable) return "independent";
  if (extensionGroupName.toUpperCase() === dbTableName.toUpperCase()) return "one-to-one";
  return "one-to-many";
}
var SCHEMA_PARSER = new XMLParser3({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  allowBooleanAttributes: true,
  isArray: (name) => name === "field",
  textNodeName: "#text"
});
function parseSchemaXml(xmlString) {
  const parsed = SCHEMA_PARSER.parse(xmlString);
  const root = parsed["psExtension"] ?? // Some older files may use different roots — fall back gracefully
  Object.values(parsed).find((v) => v && typeof v === "object") ?? {};
  const extensionGroupName = asStr3(root["extensionname"]) ?? asStr3(root["extensionName"]) ?? "";
  const et = root["extendedTable"] ?? root["ExtendedTable"] ?? {};
  const coreTable = asStr3(et["@_coreTable"]) ?? asStr3(et["@_CoreTable"]);
  const dbTableName = asStr3(et["@_dbTableName"]) ?? asStr3(et["@_DBTableName"]) ?? extensionGroupName;
  const comment = asStr3(et["@_comment"]) ?? asStr3(et["@_Comment"]);
  const rawFields = Array.isArray(et["field"]) ? et["field"] : et["field"] ? [et["field"]] : [];
  const fields = rawFields.map((f) => {
    const fobj = f;
    const type = asStr3(fobj["@_type"]) ?? "String";
    const lengthRaw = fobj["@_length"];
    const length = type === "String" && lengthRaw !== void 0 ? parseInt(String(lengthRaw), 10) || void 0 : void 0;
    return {
      name: asStr3(fobj["@_name"]) ?? "",
      type,
      ...length !== void 0 ? { length } : {},
      ...asStr3(fobj["@_comment"]) ? { comment: fobj["@_comment"] } : {}
    };
  });
  const extensionType = inferExtensionType(extensionGroupName, dbTableName, coreTable);
  return {
    extensionGroupName,
    coreTable,
    dbTableName,
    comment,
    fields,
    extensionType
  };
}
function readSchemaXml(filePath) {
  const xml = fs7.readFileSync(filePath, "utf-8");
  const ext = parseSchemaXml(xml);
  ext.sourceFile = filePath;
  return ext;
}
function readSchemaDir(dirPath) {
  if (!fs7.existsSync(dirPath)) return [];
  const files = fs7.readdirSync(dirPath).filter((f) => f.endsWith(".xml"));
  return files.map((f) => readSchemaXml(path5.join(dirPath, f)));
}
function buildHtmlReference(ext) {
  const group = ext.extensionGroupName.toUpperCase();
  const table = ext.dbTableName.toUpperCase();
  const core = (ext.coreTable ?? "").toUpperCase();
  const fieldNames = ext.fields.map((f) => f.name).join(",");
  const fieldLabels = ext.fields.map((f) => f.name).join(",");
  if (ext.extensionType === "one-to-one") {
    return {
      fieldPattern: `name="[${ext.coreTable}.${ext.extensionGroupName}]FieldName" (form input) / ~([${ext.coreTable}.${ext.extensionGroupName}]FieldName) (display)`,
      notes: [
        `One-to-one: access individual fields via ~([${ext.coreTable}.${ext.extensionGroupName}]FieldName)`
      ]
    };
  }
  if (ext.extensionType === "one-to-many") {
    return {
      tlistTag: `~[tlist_child:${core}.${group}.${table};displaycols:${fieldNames};fieldNames:${fieldLabels};type:html]`,
      directTableSelect: `~[DirectTable.Select:${table};ID:~(gpv.id)]`,
      notes: [
        `Special displaycols: ID (record PK), ${core}DCID (parent FK)`,
        `tlist type:json outputs a JSON array \u2014 useful for custom JavaScript UIs`,
        `DirectTable.Select must be placed inside <form> and before any <input> tags`
      ]
    };
  }
  return {
    tlistTag: `~[tlist_standalone:${group}.${table};displaycols:${fieldNames};fieldNames:${fieldLabels};type:html]`,
    directTableSelect: `~[DirectTable.Select:${table};ID:~(gpv.id)]`,
    notes: [
      `Special displaycols: ID (auto-created, always available)`,
      `tlist type:json outputs a JSON array \u2014 useful for custom JavaScript UIs`,
      `DirectTable.Select must be placed inside <form> and before any <input> tags`
    ]
  };
}
function buildSchemaXml(ext) {
  const doc = create3({ version: "1.0" });
  const root = doc.ele("psExtension", {
    xmlns: "http://www.powerschool.com",
    "xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance",
    "xsi:schemaLocation": "http://www.powerschool.com psextension.xsd"
  });
  root.ele("extensionname").txt(ext.extensionGroupName);
  const tableAttrs = {
    dbTableName: ext.dbTableName
  };
  if (ext.coreTable) tableAttrs["coreTable"] = ext.coreTable;
  if (ext.comment) tableAttrs["comment"] = ext.comment;
  const etEl = root.ele("extendedTable", tableAttrs);
  for (const field of ext.fields) {
    const fieldAttrs = {
      name: field.name,
      type: field.type
    };
    if (field.type === "String" && field.length !== void 0) {
      fieldAttrs["length"] = String(field.length);
    }
    if (field.comment) fieldAttrs["comment"] = field.comment;
    etEl.ele("field", fieldAttrs);
  }
  return doc.end({ prettyPrint: true });
}
function writeSchemaXml(filePath, ext) {
  fs7.writeFileSync(filePath, buildSchemaXml(ext), "utf-8");
}

// src/resources/plugin.ts
import fs8 from "fs";
function registerCurrentResource(server, getWorkspace) {
  server.resource(
    "plugin-current",
    "ps://plugin/current",
    { mimeType: "application/json" },
    async () => {
      const ws = getWorkspace();
      if (!ws) {
        return {
          contents: [
            {
              uri: "ps://plugin/current",
              mimeType: "application/json",
              text: JSON.stringify({ error: "No plugin workspace detected" })
            }
          ]
        };
      }
      let pluginData = { error: "plugin.xml not found", path: ws.pluginXmlPath };
      if (fs8.existsSync(ws.pluginXmlPath)) {
        try {
          pluginData = readPluginXml(ws.pluginXmlPath);
        } catch (err) {
          pluginData = { error: `plugin.xml parse error: ${err}`, path: ws.pluginXmlPath };
        }
      }
      return {
        contents: [
          {
            uri: "ps://plugin/current",
            mimeType: "application/json",
            text: JSON.stringify(
              {
                workspace: {
                  artifactsRoot: ws.artifactsRoot,
                  layout: ws.layout,
                  dirs: ws.dirs
                },
                plugin: pluginData
              },
              null,
              2
            )
          }
        ]
      };
    }
  );
}
function registerQueriesResource(server, getWorkspace) {
  server.resource(
    "plugin-queries",
    "ps://plugin/queries",
    { mimeType: "application/json" },
    async () => {
      const ws = getWorkspace();
      if (!ws) {
        return {
          contents: [
            {
              uri: "ps://plugin/queries",
              mimeType: "application/json",
              text: JSON.stringify({ error: "No plugin workspace detected" })
            }
          ]
        };
      }
      const queriesDir = ws.dirs.queriesRoot;
      if (!queriesDir || !fs8.existsSync(queriesDir)) {
        return {
          contents: [
            {
              uri: "ps://plugin/queries",
              mimeType: "application/json",
              text: JSON.stringify({ queries: [], queriesDir: queriesDir ?? null })
            }
          ]
        };
      }
      let queryFiles = [];
      try {
        queryFiles = readQueryDir(queriesDir);
      } catch (err) {
        return {
          contents: [
            {
              uri: "ps://plugin/queries",
              mimeType: "application/json",
              text: JSON.stringify({ error: `Failed to read queries: ${err}` })
            }
          ]
        };
      }
      return {
        contents: [
          {
            uri: "ps://plugin/queries",
            mimeType: "application/json",
            text: JSON.stringify({ queriesDir, queryFiles }, null, 2)
          }
        ]
      };
    }
  );
}
function registerExtensionsResource(server, getWorkspace) {
  server.resource(
    "plugin-extensions",
    "ps://plugin/extensions",
    { mimeType: "application/json" },
    async () => {
      const ws = getWorkspace();
      if (!ws) {
        return {
          contents: [
            {
              uri: "ps://plugin/extensions",
              mimeType: "application/json",
              text: JSON.stringify({ error: "No plugin workspace detected" })
            }
          ]
        };
      }
      const schemaDir = ws.dirs.userSchemaRoot;
      if (!schemaDir || !fs8.existsSync(schemaDir)) {
        return {
          contents: [
            {
              uri: "ps://plugin/extensions",
              mimeType: "application/json",
              text: JSON.stringify({ extensions: [], schemaDir: schemaDir ?? null })
            }
          ]
        };
      }
      let extensions = [];
      try {
        extensions = readSchemaDir(schemaDir);
      } catch (err) {
        return {
          contents: [
            {
              uri: "ps://plugin/extensions",
              mimeType: "application/json",
              text: JSON.stringify({ error: `Failed to read extensions: ${err}` })
            }
          ]
        };
      }
      return {
        contents: [
          {
            uri: "ps://plugin/extensions",
            mimeType: "application/json",
            text: JSON.stringify({ schemaDir, extensions }, null, 2)
          }
        ]
      };
    }
  );
}
function registerPluginResources(server, getWorkspace) {
  registerCurrentResource(server, getWorkspace);
  registerQueriesResource(server, getWorkspace);
  registerExtensionsResource(server, getWorkspace);
}

// src/resources/lessons.ts
import { ResourceTemplate as ResourceTemplate4 } from "@modelcontextprotocol/sdk/server/mcp.js";

// src/lib/lessons.ts
import fs9 from "fs";
import path6 from "path";
function lessonPath(lessonsDir, id) {
  return path6.join(lessonsDir, `${id}.json`);
}
function safeId(raw) {
  return raw.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
}
function listLessons(lessonsDir) {
  if (!fs9.existsSync(lessonsDir)) return [];
  return fs9.readdirSync(lessonsDir).filter((f) => f.endsWith(".json")).map((f) => {
    try {
      return JSON.parse(fs9.readFileSync(path6.join(lessonsDir, f), "utf-8"));
    } catch {
      return null;
    }
  }).filter((l) => l !== null).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
function getLesson(lessonsDir, id) {
  const fp = lessonPath(lessonsDir, id);
  if (!fs9.existsSync(fp)) return null;
  try {
    return JSON.parse(fs9.readFileSync(fp, "utf-8"));
  } catch {
    return null;
  }
}
function searchLessons(lessonsDir, query) {
  const q = query.toLowerCase();
  return listLessons(lessonsDir).filter(
    (l) => l.title.toLowerCase().includes(q) || l.content.toLowerCase().includes(q) || l.topic.toLowerCase().includes(q) || l.tags.some((t) => t.toLowerCase().includes(q))
  );
}
function upsertLesson(lessonsDir, input) {
  fs9.mkdirSync(lessonsDir, { recursive: true });
  const id = input.id ?? safeId(input.title);
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const existing = getLesson(lessonsDir, id);
  const lesson = {
    id,
    title: input.title,
    topic: input.topic,
    content: input.content,
    tags: input.tags,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };
  fs9.writeFileSync(lessonPath(lessonsDir, id), JSON.stringify(lesson, null, 2), "utf-8");
  return { lesson, created: !existing };
}
function deleteLesson(lessonsDir, id) {
  const fp = lessonPath(lessonsDir, id);
  if (!fs9.existsSync(fp)) return false;
  fs9.unlinkSync(fp);
  return true;
}

// src/resources/lessons.ts
function registerLessonResources(server, lessonsDir) {
  server.resource(
    "lessons-list",
    "ps://lessons/list",
    { mimeType: "application/json" },
    async () => {
      const lessons = listLessons(lessonsDir);
      const index = lessons.map((l) => ({
        id: l.id,
        title: l.title,
        topic: l.topic,
        tags: l.tags,
        updatedAt: l.updatedAt,
        uri: `ps://lessons/${l.id}`
      }));
      return {
        contents: [
          {
            uri: "ps://lessons/list",
            mimeType: "application/json",
            text: JSON.stringify({ total: index.length, lessons: index }, null, 2)
          }
        ]
      };
    }
  );
  server.resource(
    "lesson-by-id",
    new ResourceTemplate4("ps://lessons/{id}", {
      list: async () => {
        const lessons = listLessons(lessonsDir);
        return {
          resources: lessons.map((l) => ({
            uri: `ps://lessons/${l.id}`,
            name: l.title,
            description: `[${l.topic}] ${l.tags.join(", ")}`,
            mimeType: "application/json"
          }))
        };
      }
    }),
    { mimeType: "application/json" },
    async (uri, { id }) => {
      const lesson = getLesson(lessonsDir, String(id));
      if (!lesson) {
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "application/json",
              text: JSON.stringify({ error: `No lesson found with id "${id}"` })
            }
          ]
        };
      }
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(lesson, null, 2)
          }
        ]
      };
    }
  );
}

// src/tools/plugin.ts
import { z } from "zod";
import fs10 from "fs";
import path7 from "path";
function requireWorkspace(getWorkspace) {
  const ws = getWorkspace();
  if (!ws) {
    throw new Error(
      "No plugin workspace detected. Set PS_PLUGIN_ROOT to the plugin src directory, or open a folder containing plugin.xml."
    );
  }
  return ws;
}
function isValidHostname(host) {
  if (host.endsWith("/")) return false;
  try {
    new URL(host);
    return true;
  } catch {
    return /^[a-zA-Z0-9]([a-zA-Z0-9\-.]*[a-zA-Z0-9])?$/.test(host);
  }
}
function registerGetPluginInfo(server, getWorkspace) {
  server.tool(
    "get_plugin_info",
    "Read and return structured information about the current workspace plugin (name, version, publisher, OAuth level, access_request fields, links, artifact directory counts).",
    {},
    async () => {
      const ws = requireWorkspace(getWorkspace);
      const pluginXmlPath = ws.pluginXmlPath;
      if (!fs10.existsSync(pluginXmlPath)) {
        return {
          content: [{ type: "text", text: JSON.stringify({ error: "plugin.xml not found", path: pluginXmlPath }) }],
          isError: true
        };
      }
      const data = readPluginXml(pluginXmlPath);
      const dirs = ws.dirs;
      const result = {
        name: data.name,
        version: data.version,
        description: data.description,
        pluginXmlPath,
        workspaceLayout: ws.layout,
        artifactsRoot: ws.artifactsRoot,
        oauth: {
          enabled: data.oauth,
          accessLevelV1Api: data.accessLevelV1Api ?? null
        },
        autoinstall: data.autoinstall ? {
          required: data.autoinstall.required,
          autoenable: data.autoinstall.autoenable ?? null,
          autoredeploy: data.autoinstall.autoredeploy ?? false
        } : null,
        accessRequest: {
          fieldCount: data.accessRequest.length,
          cdnCount: data.cdnRequest.length,
          fields: data.accessRequest,
          cdns: data.cdnRequest
        },
        publisher: data.publisher,
        links: data.links ?? [],
        registration: data.registration ?? null,
        openid: data.openid ?? null,
        directories: {
          queriesRoot: dirs.queriesRoot ?? null,
          permissionsRoot: dirs.permissionsRoot ?? null,
          userSchemaRoot: dirs.userSchemaRoot ?? null,
          webRoot: dirs.webRoot ?? null,
          pagecataloging: dirs.pagecataloging ?? null
        }
      };
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    }
  );
}
function registerScaffoldPlugin(server, getWorkspace) {
  server.tool(
    "scaffold_plugin",
    "Generate a new plugin.xml with correct namespace, required elements, and optionally OAuth, autoinstall, registration, and OpenID stubs. Writes to the workspace plugin.xml path.",
    {
      name: z.string().max(40, "Plugin name must be 40 characters or fewer").describe("Plugin name (max 40 chars, must be unique on the PS installation)"),
      version: z.string().max(20).default("1.0.0").describe("Plugin version (default: 1.0.0)"),
      description: z.string().max(256).describe("Short description of the plugin"),
      publisherName: z.string().max(100).describe("Publisher / organization name"),
      publisherEmail: z.string().max(40).describe("Publisher contact email"),
      publisherPhone: z.string().optional().describe("Publisher contact phone (optional)"),
      accessLevelV1Api: z.enum(["NONE", "READ", "FULL"]).default("NONE").describe("OAuth API access level (default: NONE)"),
      includeOAuth: z.boolean().default(false).describe(
        "Add <oauth/> element. Required for PowerQuery plugins and service plugins. Always generates an empty <access_request> when true."
      ),
      autoInstall: z.boolean().default(false).describe(
        'Add <autoinstall required="true"><autoenable required="true"/></autoinstall> block. Use with caution \u2014 forces PS to auto-enable the plugin on install.'
      ),
      registrationUrl: z.string().optional().describe(
        'If provided, adds <registration url="..."/> element. Used by service/event-listener plugins to receive OAuth credentials via callback at install time.'
      ),
      openIdHost: z.string().optional().describe("OpenID relying party host (requires openIdPort to also be set)"),
      openIdPort: z.string().optional().describe("OpenID relying party port (requires openIdHost to also be set)"),
      force: z.boolean().default(false).describe("Overwrite existing plugin.xml without prompting (default: false)")
    },
    async (params) => {
      const ws = requireWorkspace(getWorkspace);
      const pluginXmlPath = ws.pluginXmlPath;
      if (fs10.existsSync(pluginXmlPath) && !params.force) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                error: "plugin.xml already exists",
                path: pluginXmlPath,
                hint: "Pass force: true to overwrite."
              })
            }
          ],
          isError: true
        };
      }
      const hasOpenId = Boolean(params.openIdHost) && Boolean(params.openIdPort);
      if (params.openIdHost && !params.openIdPort || !params.openIdHost && params.openIdPort) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                error: "Both openIdHost and openIdPort must be provided together, or neither."
              })
            }
          ],
          isError: true
        };
      }
      const data = {
        name: params.name,
        version: params.version,
        description: params.description,
        oauth: params.includeOAuth || params.accessLevelV1Api !== "NONE",
        accessLevelV1Api: params.accessLevelV1Api !== "NONE" ? params.accessLevelV1Api : void 0,
        autoinstall: params.autoInstall ? { required: true, autoenable: { required: true } } : void 0,
        accessRequest: [],
        cdnRequest: [],
        publisher: {
          name: params.publisherName,
          contact: {
            email: params.publisherEmail,
            phone: params.publisherPhone
          }
        },
        registration: params.registrationUrl !== void 0 ? { url: params.registrationUrl } : void 0,
        openid: hasOpenId ? { host: params.openIdHost, port: params.openIdPort, links: [] } : void 0
      };
      const dir = path7.dirname(pluginXmlPath);
      fs10.mkdirSync(dir, { recursive: true });
      writePluginXml(pluginXmlPath, data);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: true,
              path: pluginXmlPath,
              name: data.name,
              version: data.version,
              nextSteps: [
                "Run validate_plugin_xml to confirm the file is valid.",
                params.includeOAuth ? "Add access_request fields via the access_request tools, or edit plugin.xml directly." : null
              ].filter(Boolean)
            })
          }
        ]
      };
    }
  );
}
function registerValidatePluginXml(server, getWorkspace, dict) {
  server.tool(
    "validate_plugin_xml",
    "Validate plugin.xml against known PowerSchool rules. Returns structured errors, warnings, and info notices.",
    {},
    async () => {
      const ws = requireWorkspace(getWorkspace);
      const pluginXmlPath = ws.pluginXmlPath;
      if (!fs10.existsSync(pluginXmlPath)) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ error: "plugin.xml not found", path: pluginXmlPath })
            }
          ],
          isError: true
        };
      }
      let data;
      try {
        data = readPluginXml(pluginXmlPath);
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ error: `Failed to parse plugin.xml: ${err}`, path: pluginXmlPath })
            }
          ],
          isError: true
        };
      }
      const issues = [];
      const rawXml = fs10.readFileSync(pluginXmlPath, "utf-8");
      if (!rawXml.includes("http://plugin.powerschool.pearson.com")) {
        issues.push({
          severity: "error",
          message: 'plugin.xml namespace must be "http://plugin.powerschool.pearson.com"'
        });
      }
      if (!data.name) {
        issues.push({ severity: "error", message: "<plugin name> attribute is missing or empty" });
      } else if (data.name.length > 40) {
        issues.push({
          severity: "error",
          message: `Plugin name "${data.name}" is ${data.name.length} chars \u2014 max is 40`
        });
      }
      if (!data.version) {
        issues.push({ severity: "error", message: "<plugin version> attribute is missing or empty" });
      } else if (data.version.length > 20) {
        issues.push({
          severity: "error",
          message: `Plugin version "${data.version}" is ${data.version.length} chars \u2014 max is 20`
        });
      }
      if (!data.publisher.name) {
        issues.push({ severity: "error", message: "<publisher name> attribute is missing" });
      }
      if (!data.publisher.contact.email) {
        issues.push({ severity: "error", message: "<contact email> attribute is missing" });
      }
      for (const f of data.accessRequest) {
        if (f.access !== "ViewOnly" && f.access !== "FullAccess") {
          issues.push({
            severity: "error",
            message: `Field ${f.table}.${f.field} has invalid access value "${f.access}" \u2014 must be "ViewOnly" or "FullAccess"`
          });
        }
        if (!f.table.startsWith("U_") && !dict.hasTable(f.table)) {
          issues.push({
            severity: "warning",
            message: `Table "${f.table}" in access_request not found in data dictionary`
          });
        } else if (!f.table.startsWith("U_") && !dict.hasField(f.table, f.field)) {
          issues.push({
            severity: "warning",
            message: `Field "${f.table}.${f.field}" in access_request not found in data dictionary`
          });
        }
      }
      for (const cdn of data.cdnRequest) {
        if (!isValidHostname(cdn)) {
          issues.push({
            severity: "error",
            message: `CDN name "${cdn}" is not a valid hostname/URL (no trailing slashes)`
          });
        }
      }
      if (data.accessLevelV1Api) {
        const validLevels = ["NONE", "READ", "FULL"];
        if (!validLevels.includes(data.accessLevelV1Api)) {
          issues.push({
            severity: "error",
            message: `accessLevelV1Api="${data.accessLevelV1Api}" is invalid \u2014 must be NONE, READ, or FULL`
          });
        } else {
          issues.push({
            severity: "info",
            message: `accessLevelV1Api="${data.accessLevelV1Api}" requires PowerSchool 25.2+`
          });
        }
      }
      if (data.autoinstall) {
        issues.push({
          severity: "info",
          message: "<autoinstall> is present \u2014 this will auto-install and enable the plugin on every PS server that receives this package. Confirm this is intended."
        });
      }
      if (data.registration !== void 0 && data.registration.url === "") {
        issues.push({
          severity: "warning",
          message: '<registration url=""> has an empty url \u2014 plugin will not receive OAuth credentials at install time unless the URL is set'
        });
      }
      if (data.openid !== void 0) {
        if (!data.openid.host || !data.openid.port) {
          issues.push({
            severity: "error",
            message: "<openid> element must have both host and port attributes set"
          });
        }
      }
      const allLinks = [
        ...data.links ?? [],
        ...data.openid?.links ?? []
      ];
      const uiContextCounts = /* @__PURE__ */ new Map();
      for (const link of allLinks) {
        for (const id of link.uiContextIds) {
          uiContextCounts.set(id, (uiContextCounts.get(id) ?? 0) + 1);
        }
      }
      for (const [id, count] of uiContextCounts) {
        if (count > 1) {
          issues.push({
            severity: "warning",
            message: `ui_context id="${id}" appears ${count} times \u2014 duplicate ui_context ids may cause unexpected behaviour`
          });
        }
      }
      issues.push({
        severity: "info",
        message: "Plugin name uniqueness cannot be verified offline \u2014 ensure the name is unique across the target PS installation."
      });
      const errors = issues.filter((i) => i.severity === "error");
      const warnings = issues.filter((i) => i.severity === "warning");
      const infos = issues.filter((i) => i.severity === "info");
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                valid: errors.length === 0,
                path: pluginXmlPath,
                summary: `${errors.length} error(s), ${warnings.length} warning(s), ${infos.length} info(s)`,
                errors: errors.map((i) => i.message),
                warnings: warnings.map((i) => i.message),
                info: infos.map((i) => i.message)
              },
              null,
              2
            )
          }
        ]
      };
    }
  );
}
function registerPluginTools(server, dict, getWorkspace) {
  registerGetPluginInfo(server, getWorkspace);
  registerScaffoldPlugin(server, getWorkspace);
  registerValidatePluginXml(server, getWorkspace, dict);
}

// src/tools/package.ts
import { z as z2 } from "zod";
import path9 from "path";

// src/lib/packager.ts
import archiver from "archiver";
import fs11 from "fs";
import path8 from "path";
function validateForPackage(pluginXmlPath, queriesDir) {
  const errors = [];
  const warnings = [];
  if (!fs11.existsSync(pluginXmlPath)) {
    errors.push(`plugin.xml not found at ${pluginXmlPath}`);
    return { valid: false, errors, warnings };
  }
  let data;
  try {
    data = readPluginXml(pluginXmlPath);
  } catch (err) {
    errors.push(`plugin.xml parse error: ${err}`);
    return { valid: false, errors, warnings };
  }
  const rawXml = fs11.readFileSync(pluginXmlPath, "utf-8");
  if (!rawXml.includes("http://plugin.powerschool.pearson.com")) {
    errors.push('plugin.xml namespace must be "http://plugin.powerschool.pearson.com"');
  }
  if (!data.publisher.name) errors.push("<publisher name> is missing");
  if (!data.publisher.contact.email) errors.push("<contact email> is missing");
  if (!data.name) errors.push("<plugin name> attribute is missing");
  else if (data.name.length > 40) errors.push(`Plugin name is ${data.name.length} chars (max 40)`);
  if (!data.version) errors.push("<plugin version> attribute is missing");
  if (queriesDir && fs11.existsSync(queriesDir)) {
    const xmlFiles = fs11.readdirSync(queriesDir).filter((f) => f.endsWith(".named_queries.xml"));
    for (const f of xmlFiles) {
      try {
        readQueryDir(queriesDir);
      } catch (err) {
        errors.push(`${f}: parse error \u2014 ${err}`);
      }
    }
    try {
      const allFiles = readQueryDir(queriesDir);
      const nameCounts = /* @__PURE__ */ new Map();
      for (const qf of allFiles) {
        for (const q of qf.queries) {
          nameCounts.set(q.name, (nameCounts.get(q.name) ?? 0) + 1);
        }
      }
      for (const [name, count] of nameCounts) {
        if (count > 1) {
          errors.push(`Duplicate query name "${name}" across ${count} files`);
        }
      }
    } catch {
    }
  }
  return { valid: errors.length === 0, errors, warnings };
}
async function buildPluginZip(artifactsRoot, outputPath) {
  fs11.mkdirSync(path8.dirname(outputPath), { recursive: true });
  return new Promise((resolve, reject) => {
    const output = fs11.createWriteStream(outputPath);
    const archive = archiver("zip", { zlib: { level: 9 } });
    let fileCount = 0;
    archive.on("entry", () => fileCount++);
    archive.on("error", reject);
    output.on("error", reject);
    output.on("close", () => {
      const stats = fs11.statSync(outputPath);
      resolve({
        outputPath,
        sizeBytes: stats.size,
        fileCount
      });
    });
    archive.pipe(output);
    archive.glob("**/*", {
      cwd: artifactsRoot,
      ignore: [".git/**", ".gitignore", "node_modules/**", "*.DS_Store", "Thumbs.db"]
    });
    archive.finalize();
  });
}

// src/tools/package.ts
import fs12 from "fs";
function requireWorkspace2(getWorkspace) {
  const ws = getWorkspace();
  if (!ws) {
    throw new Error(
      "No plugin workspace detected. Set PS_PLUGIN_ROOT to the plugin src directory, or open a folder containing plugin.xml."
    );
  }
  return ws;
}
function bumpSemver(version, part) {
  const m = version.match(/^(\d+)\.(\d+)\.(\d+)(.*)/);
  if (!m) throw new Error(`Cannot parse version "${version}" as semver X.Y.Z`);
  const maj = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const pat = parseInt(m[3], 10);
  const rest = m[4] ?? "";
  if (part === "major") return `${maj + 1}.0.0${rest}`;
  if (part === "minor") return `${maj}.${min + 1}.0${rest}`;
  return `${maj}.${min}.${pat + 1}${rest}`;
}
function registerPackageTools(server, getWorkspace) {
  server.tool(
    "bump_plugin_version",
    "Update the version attribute in plugin.xml. Port of the release.rb script. Provide either an explicit version string or a bump direction (major/minor/patch).",
    {
      version: z2.string().optional().describe('Explicit version string to set, e.g. "2.0.0". Mutually exclusive with bump.'),
      bump: z2.enum(["major", "minor", "patch"]).optional().describe("Increment major, minor, or patch component of the current semver version. Mutually exclusive with version.")
    },
    async (params) => {
      if (!params.version && !params.bump) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ error: "Provide either version or bump parameter." })
            }
          ],
          isError: true
        };
      }
      if (params.version && params.bump) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ error: "Provide version OR bump, not both." })
            }
          ],
          isError: true
        };
      }
      const ws = requireWorkspace2(getWorkspace);
      const pluginXmlPath = ws.pluginXmlPath;
      if (!fs12.existsSync(pluginXmlPath)) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ error: "plugin.xml not found", path: pluginXmlPath })
            }
          ],
          isError: true
        };
      }
      const data = readPluginXml(pluginXmlPath);
      const oldVersion = data.version;
      let newVersion;
      if (params.version) {
        newVersion = params.version;
        if (newVersion.length > 20) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({ error: `Version "${newVersion}" exceeds 20 character limit` })
              }
            ],
            isError: true
          };
        }
      } else {
        try {
          newVersion = bumpSemver(oldVersion, params.bump);
        } catch (err) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  error: `${err}`,
                  currentVersion: oldVersion,
                  hint: "Current version must be in X.Y.Z format to use bump."
                })
              }
            ],
            isError: true
          };
        }
      }
      data.version = newVersion;
      writePluginXml(pluginXmlPath, data);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: true,
              path: pluginXmlPath,
              oldVersion,
              newVersion
            })
          }
        ]
      };
    }
  );
  server.tool(
    "package_plugin",
    "Build a distributable ZIP from the plugin artifacts root. Runs pre-flight validation (plugin.xml required fields, named query parse errors, duplicate query names) before packaging. Returns the output path and file size.",
    {
      outputPath: z2.string().optional().describe(
        "Where to write the ZIP. Defaults to ./dist/{pluginName}-v{version}.zip relative to the workspace artifacts root."
      ),
      force: z2.boolean().default(false).describe("Skip pre-flight validation and overwrite existing output file (default: false)")
    },
    async ({ outputPath, force }) => {
      const ws = requireWorkspace2(getWorkspace);
      if (!force) {
        const validation = validateForPackage(ws.pluginXmlPath, ws.dirs.queriesRoot);
        if (!validation.valid) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    error: "Pre-flight validation failed",
                    errors: validation.errors,
                    warnings: validation.warnings,
                    hint: "Fix the errors above, or pass force: true to skip validation."
                  },
                  null,
                  2
                )
              }
            ],
            isError: true
          };
        }
      }
      let resolvedOutputPath = outputPath;
      if (!resolvedOutputPath) {
        const pluginData = readPluginXml(ws.pluginXmlPath);
        const safeName = (pluginData.name || "plugin").replace(/[^a-zA-Z0-9._-]/g, "_");
        const safeVersion = (pluginData.version || "0.0.0").replace(/[^a-zA-Z0-9._-]/g, "_");
        resolvedOutputPath = path9.join(ws.artifactsRoot, "..", "dist", `${safeName}-v${safeVersion}.zip`);
      }
      try {
        const result = await buildPluginZip(ws.artifactsRoot, resolvedOutputPath);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: true,
                  outputPath: result.outputPath,
                  sizeBytes: result.sizeBytes,
                  sizeKb: Math.round(result.sizeBytes / 1024),
                  fileCount: result.fileCount
                },
                null,
                2
              )
            }
          ]
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ error: `ZIP build failed: ${err}` })
            }
          ],
          isError: true
        };
      }
    }
  );
  server.tool(
    "rename_plugin",
    "Refactor plugin name and all query/permission namespaces (ports rename.rb). Updates the plugin.xml name attribute, replaces oldNamespace prefix in every <query name> value, renames .named_queries.xml and .permission_mappings.xml files that use the old namespace as a filename prefix.",
    {
      oldNamespace: z2.string().describe('Current namespace prefix used in query names and file names, e.g. "org.tulsaschools.data"'),
      newNamespace: z2.string().describe('Replacement namespace prefix, e.g. "com.acme.schools.data"'),
      newPluginName: z2.string().optional().describe(
        "New value for the plugin name attribute in plugin.xml. If omitted, the plugin name is not changed."
      )
    },
    async ({ oldNamespace, newNamespace, newPluginName }) => {
      const ws = requireWorkspace2(getWorkspace);
      const renamedFiles = [];
      const updatedQueryNames = [];
      if (newPluginName) {
        if (!fs12.existsSync(ws.pluginXmlPath)) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({ error: "plugin.xml not found", path: ws.pluginXmlPath })
              }
            ],
            isError: true
          };
        }
        const pluginData = readPluginXml(ws.pluginXmlPath);
        pluginData.name = newPluginName;
        writePluginXml(ws.pluginXmlPath, pluginData);
      }
      const queriesDir = ws.dirs.queriesRoot;
      if (queriesDir && fs12.existsSync(queriesDir)) {
        const queryFiles = fs12.readdirSync(queriesDir).filter((f) => f.endsWith(".named_queries.xml"));
        for (const fileName of queryFiles) {
          const filePath = path9.join(queriesDir, fileName);
          try {
            const qf = readQueryXml(filePath);
            let changed = false;
            for (const q of qf.queries) {
              if (q.name.startsWith(`${oldNamespace}.`)) {
                const oldName = q.name;
                q.name = newNamespace + q.name.slice(oldNamespace.length);
                updatedQueryNames.push({ file: fileName, old: oldName, new: q.name });
                changed = true;
              }
            }
            if (changed) {
              writeQueryXml(filePath, qf);
            }
          } catch {
          }
          if (fileName.startsWith(`${oldNamespace}.`)) {
            const newFileName = newNamespace + fileName.slice(oldNamespace.length);
            const newFilePath = path9.join(queriesDir, newFileName);
            fs12.renameSync(filePath, newFilePath);
            renamedFiles.push(`${fileName} \u2192 ${newFileName}`);
          }
        }
      }
      const permsDir = ws.dirs.permissionsRoot;
      if (permsDir && fs12.existsSync(permsDir)) {
        const permFiles = fs12.readdirSync(permsDir).filter((f) => f.endsWith(".permission_mappings.xml"));
        for (const fileName of permFiles) {
          if (fileName.startsWith(`${oldNamespace}.`)) {
            const filePath = path9.join(permsDir, fileName);
            const newFileName = newNamespace + fileName.slice(oldNamespace.length);
            const newFilePath = path9.join(permsDir, newFileName);
            fs12.renameSync(filePath, newFilePath);
            renamedFiles.push(`${fileName} \u2192 ${newFileName}`);
          }
        }
      }
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                success: true,
                oldNamespace,
                newNamespace,
                pluginNameUpdated: newPluginName ?? null,
                renamedFiles,
                updatedQueryNames
              },
              null,
              2
            )
          }
        ]
      };
    }
  );
}

// src/tools/schema.ts
import { z as z3 } from "zod";
import fs13 from "fs";
import path10 from "path";
function requireWorkspace3(getWorkspace) {
  const ws = getWorkspace();
  if (!ws) {
    throw new Error(
      "No plugin workspace detected. Set PS_PLUGIN_ROOT to the plugin src directory, or open a folder containing plugin.xml."
    );
  }
  return ws;
}
function normalizeGroupName(name) {
  const upper = name.toUpperCase();
  return upper.startsWith("U_") ? upper : `U_${upper}`;
}
var FIELD_SCHEMA = z3.object({
  name: z3.string().describe("Field name (will be stored as-is in XML)"),
  type: z3.enum(["String", "Integer", "Double", "Boolean", "Date", "Clob"]).describe("PS field type"),
  length: z3.number().int().positive().optional().describe("Required for String type \u2014 max character length"),
  description: z3.string().optional().describe("Developer comment for this field")
});
function registerListCustomTables(server, dict) {
  server.tool(
    "list_custom_tables",
    "Query the data dictionary for all U_-prefixed custom tables known to PowerSchool. Results are informational \u2014 they reflect what is in the data dictionary, not necessarily what is installed on a specific PS instance.",
    {
      filter: z3.string().optional().describe("Optional keyword to narrow results (case-insensitive match on table name or description)")
    },
    async ({ filter }) => {
      const tables = dict.getCustomTables();
      const filtered = filter ? tables.filter(
        (t) => t.name.toLowerCase().includes(filter.toLowerCase()) || (t.description ?? "").toLowerCase().includes(filter.toLowerCase())
      ) : tables;
      const result = filtered.map((t) => ({
        tableName: t.name,
        tableTitle: t.title ?? null,
        tableDescription: t.description ?? null,
        fieldCount: t.fields.size,
        coreTable: t.coreTable ?? null
      }));
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ count: result.length, tables: result }, null, 2)
          }
        ]
      };
    }
  );
}
function registerListDbExtensions(server, getWorkspace) {
  server.tool(
    "list_db_extensions",
    "List all user schema extension definitions in the current workspace (user_schema_root/*.xml). Includes the PS HTML reference syntax for each extension.",
    {},
    async () => {
      const ws = requireWorkspace3(getWorkspace);
      const schemaDir = ws.dirs.userSchemaRoot;
      if (!schemaDir || !fs13.existsSync(schemaDir)) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                count: 0,
                extensions: [],
                note: "No user_schema_root directory found in workspace."
              })
            }
          ]
        };
      }
      const extensions = readSchemaDir(schemaDir);
      const result = extensions.map((ext) => ({
        file: path10.basename(ext.sourceFile ?? ""),
        extensionGroupName: ext.extensionGroupName,
        tableName: ext.dbTableName,
        coreTable: ext.coreTable ?? null,
        extensionType: ext.extensionType,
        fieldCount: ext.fields.length,
        fields: ext.fields.map((f) => ({
          name: f.name,
          type: f.type,
          ...f.length !== void 0 ? { length: f.length } : {}
        })),
        htmlReferenceExample: buildHtmlReference(ext)
      }));
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ count: result.length, extensions: result }, null, 2)
          }
        ]
      };
    }
  );
}
function registerAnalyzeSchema(server, dict, getWorkspace) {
  server.tool(
    "analyze_schema",
    "Query the data dictionary and workspace user_schema_root to surface existing custom tables and extensions, then recommend whether to extend an existing table or create a new one. Call this before scaffold_db_extension.",
    {
      purpose: z3.string().describe(
        'Plain-language description of what data you want to store (e.g. "track student library checkouts")'
      ),
      coreTable: z3.string().optional().describe(
        'The PS entity name the data relates to, if known (e.g. "Students", "Teachers", "Person"). CamelCase PS entity name.'
      )
    },
    async ({ purpose, coreTable }) => {
      const ws = getWorkspace();
      const schemaDir = ws?.dirs.userSchemaRoot;
      const purposeLower = purpose.toLowerCase();
      const keywords = purposeLower.split(/\s+/).filter((w) => w.length > 2);
      const customTables = dict.getCustomTables();
      const dictMatches = customTables.filter((t) => {
        const haystack = `${t.name} ${t.title ?? ""} ${t.description ?? ""}`.toLowerCase();
        return keywords.some((k) => haystack.includes(k));
      });
      const workspaceExtensions = schemaDir && fs13.existsSync(schemaDir) ? readSchemaDir(schemaDir) : [];
      const workspaceMatches = workspaceExtensions.filter((ext) => {
        const haystack = `${ext.extensionGroupName} ${ext.dbTableName} ${ext.comment ?? ""} ${ext.fields.map((f) => f.name).join(" ")}`.toLowerCase();
        return keywords.some((k) => haystack.includes(k));
      });
      const coreMatchFromDict = coreTable ? customTables.filter(
        (t) => (t.coreTable ?? "").toLowerCase() === coreTable.toLowerCase() || t.name.toUpperCase().includes(coreTable.toUpperCase())
      ) : [];
      const coreMatchFromWorkspace = coreTable ? workspaceExtensions.filter(
        (ext) => (ext.coreTable ?? "").toLowerCase() === coreTable.toLowerCase()
      ) : [];
      const hasWorkspaceMatch = workspaceMatches.length > 0 || coreMatchFromWorkspace.length > 0;
      const hasDictMatch = dictMatches.length > 0 || coreMatchFromDict.length > 0;
      let recommendation;
      let suggestedAction;
      let suggestedExtensionType = null;
      let nextStep;
      if (hasWorkspaceMatch) {
        recommendation = "An existing extension in this workspace may already fit your needs. Consider adding fields to it rather than creating a new table.";
        suggestedAction = "extend-existing";
        nextStep = "Call add_field_to_extension with the extensionGroupName of the matching extension.";
      } else if (hasDictMatch) {
        recommendation = "Custom tables matching your purpose exist in the PS data dictionary (installed on PS). These may be from another plugin \u2014 review before creating a duplicate.";
        suggestedAction = "review-dict-then-decide";
        nextStep = "If none of these tables belong to your plugin, call scaffold_db_extension to create a new one.";
      } else {
        recommendation = "No matching custom schema found. Creating a new extension is the right approach.";
        suggestedAction = "create-new";
        if (!coreTable) {
          suggestedExtensionType = "independent";
          nextStep = 'Call scaffold_db_extension with extensionType: "independent" (no parent table link needed).';
        } else {
          suggestedExtensionType = "one-to-one";
          nextStep = `Call scaffold_db_extension with extensionType: "one-to-one" and coreTable: "${coreTable}" for a single-record-per-parent extension. Use "one-to-many" if multiple records per parent are needed.`;
        }
      }
      const staffWarning = coreTable && ["teachers", "users"].includes(coreTable.toLowerCase()) ? `\u26A0\uFE0F Staff table warning: Staff page links must use explicit FRN syntax 204~([teachers]USERS_DCID) instead of ~(frn). The Unified Teacher Record splits TEACHERS into USERS (table 204) and SCHOOLSTAFF (table 203). Using ~(frn) will not correctly link tlist_child records for extensions on the Users table.` : null;
      const contactsWarning = coreTable && ["person", "studentcontactdetail", "studentcontactassoc", "personaddressassoc"].includes(
        coreTable.toLowerCase()
      ) ? `\u2139\uFE0F Student contacts note: Extensions on ${coreTable} are accessed via the /ws/contacts/ API (not /ws/schema/table/). Loading extension data in the browser requires calling psCustomizationUtils.addExtensions([{url: '/ws/contacts/contact/{id}', extensions:'u_table_name'}]) in injected JavaScript. The tlist_child pattern does NOT apply to these tables.` : null;
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                purpose,
                coreTable: coreTable ?? null,
                recommendation,
                suggestedAction,
                suggestedExtensionType,
                nextStep,
                warnings: [staffWarning, contactsWarning].filter(Boolean),
                workspaceMatches: workspaceMatches.map((ext) => ({
                  file: path10.basename(ext.sourceFile ?? ""),
                  extensionGroupName: ext.extensionGroupName,
                  dbTableName: ext.dbTableName,
                  extensionType: ext.extensionType,
                  fieldCount: ext.fields.length,
                  fields: ext.fields.map((f) => f.name)
                })),
                dictionaryMatches: [...dictMatches, ...coreMatchFromDict].filter((t, i, arr) => arr.findIndex((x) => x.name === t.name) === i).slice(0, 20).map((t) => ({
                  tableName: t.name,
                  coreTable: t.coreTable ?? null,
                  fieldCount: t.fields.size,
                  description: t.description ?? null
                }))
              },
              null,
              2
            )
          }
        ]
      };
    }
  );
}
function registerScaffoldDbExtension(server, getWorkspace) {
  server.tool(
    "scaffold_db_extension",
    "Generate a user_schema_root XML file defining a new custom table extension. Returns the PS HTML reference syntax so the developer can immediately use the correct tags in custom pages.",
    {
      extensionType: z3.enum(["one-to-one", "one-to-many", "independent"]).describe("How this table relates to the core table"),
      coreTable: z3.string().optional().describe(
        'CamelCase PS entity name for the core table (e.g. "Students", "Person"). Required for one-to-one and one-to-many. Omit for independent.'
      ),
      extensionGroupName: z3.string().describe(
        'Extension group name \u2014 maps to <extensionname> in XML. Will be uppercased and U_-prefixed if missing (e.g. "Laptop" \u2192 "U_LAPTOP").'
      ),
      tableName: z3.string().optional().describe(
        "Actual DB table name (dbTableName in XML). Defaults to extensionGroupName for one-to-one. Required for one-to-many and independent when table name differs from group name."
      ),
      comment: z3.string().optional().describe("Optional comment for the extendedTable element"),
      fields: z3.array(FIELD_SCHEMA).describe("Fields to include in this extension"),
      includeTrackingFields: z3.boolean().default(true).describe(
        "Add conventional WhoModifiedId (Integer) and WhenModified (Date) tracking fields. Default: true."
      ),
      force: z3.boolean().default(false).describe("Overwrite existing file without prompting (default: false)")
    },
    async (params) => {
      const ws = requireWorkspace3(getWorkspace);
      const schemaDir = ws.dirs.userSchemaRoot;
      if (!schemaDir) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                error: "No user_schema_root directory found in workspace. Create the directory first.",
                expectedPath: path10.join(ws.artifactsRoot, "user_schema_root")
              })
            }
          ],
          isError: true
        };
      }
      if (params.extensionType !== "independent" && !params.coreTable) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                error: `coreTable is required for extensionType "${params.extensionType}"`
              })
            }
          ],
          isError: true
        };
      }
      const extensionGroupName = normalizeGroupName(params.extensionGroupName);
      const dbTableName = params.tableName ? normalizeGroupName(params.tableName) : extensionGroupName;
      const allFields = [];
      if (params.extensionType !== "independent" && params.coreTable) {
        const fkName = `${params.coreTable.toUpperCase()}DCID`;
        if (!params.fields.some((f) => f.name.toUpperCase() === fkName)) {
          allFields.push({ name: fkName, type: "Integer" });
        }
      }
      for (const f of params.fields) {
        if (f.type === "String" && !f.length) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  error: `Field "${f.name}" has type String but no length specified. String fields require a length.`
                })
              }
            ],
            isError: true
          };
        }
        allFields.push({
          name: f.name,
          type: f.type,
          ...f.length !== void 0 ? { length: f.length } : {},
          ...f.description ? { comment: f.description } : {}
        });
      }
      if (params.includeTrackingFields) {
        if (!allFields.some((f) => f.name.toUpperCase() === "WHOMODIFIEDID")) {
          allFields.push({ name: "WhoModifiedId", type: "Integer" });
        }
        if (!allFields.some((f) => f.name.toUpperCase() === "WHENMODIFIED")) {
          allFields.push({ name: "WhenModified", type: "Date" });
        }
      }
      const ext = {
        extensionGroupName,
        coreTable: params.coreTable,
        dbTableName,
        comment: params.comment,
        fields: allFields,
        extensionType: params.extensionType
      };
      const fileName = `${dbTableName.toLowerCase()}.xml`;
      const filePath = path10.join(schemaDir, fileName);
      if (fs13.existsSync(filePath) && !params.force) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                error: `File already exists: ${filePath}`,
                hint: "Pass force: true to overwrite."
              })
            }
          ],
          isError: true
        };
      }
      fs13.mkdirSync(schemaDir, { recursive: true });
      writeSchemaXml(filePath, ext);
      const htmlRef = buildHtmlReference(ext);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                success: true,
                file: fileName,
                path: filePath,
                extensionGroupName,
                dbTableName,
                coreTable: params.coreTable ?? null,
                extensionType: params.extensionType,
                fieldCount: allFields.length,
                fields: allFields.map((f) => ({ name: f.name, type: f.type })),
                htmlReference: htmlRef,
                notes: [
                  "PS auto-creates an internal ID (auto-sequence primary key) \u2014 do not declare it in the XML.",
                  params.extensionType !== "independent" ? `The ${params.coreTable?.toUpperCase()}DCID foreign key links this extension to the parent record.` : null
                ].filter(Boolean)
              },
              null,
              2
            )
          }
        ]
      };
    }
  );
}
function registerAddFieldToExtension(server, getWorkspace) {
  server.tool(
    "add_field_to_extension",
    "Add one or more fields to an existing user_schema_root XML file in the workspace. Use when analyze_schema recommends extending an existing table.",
    {
      extensionGroupName: z3.string().describe(
        'Group name matching an existing file in user_schema_root/ (e.g. "U_LAPTOP" matches u_laptop.xml)'
      ),
      fields: z3.array(FIELD_SCHEMA).describe("Fields to add")
    },
    async ({ extensionGroupName, fields }) => {
      const ws = requireWorkspace3(getWorkspace);
      const schemaDir = ws.dirs.userSchemaRoot;
      if (!schemaDir || !fs13.existsSync(schemaDir)) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ error: "No user_schema_root directory found in workspace." })
            }
          ],
          isError: true
        };
      }
      const allFiles = fs13.readdirSync(schemaDir).filter((f) => f.endsWith(".xml"));
      const targetFile = allFiles.find((f) => {
        const base = f.replace(/\.xml$/, "").toUpperCase();
        return base === extensionGroupName.toUpperCase() || base === normalizeGroupName(extensionGroupName).toUpperCase();
      });
      if (!targetFile) {
        const byContent = allFiles.find((f) => {
          try {
            const ext2 = readSchemaXml(path10.join(schemaDir, f));
            return ext2.extensionGroupName.toUpperCase() === normalizeGroupName(extensionGroupName).toUpperCase();
          } catch {
            return false;
          }
        });
        if (!byContent) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  error: `No schema file found matching extensionGroupName "${extensionGroupName}"`,
                  availableFiles: allFiles
                })
              }
            ],
            isError: true
          };
        }
      }
      const filePath = path10.join(schemaDir, targetFile ?? allFiles.find((f) => {
        try {
          return readSchemaXml(path10.join(schemaDir, f)).extensionGroupName.toUpperCase() === normalizeGroupName(extensionGroupName).toUpperCase();
        } catch {
          return false;
        }
      }));
      const ext = readSchemaXml(filePath);
      const existingNames = new Set(ext.fields.map((f) => f.name.toUpperCase()));
      const conflicts = fields.filter((f) => existingNames.has(f.name.toUpperCase()));
      if (conflicts.length > 0) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                error: "Field name conflict \u2014 these fields already exist in the extension",
                conflicts: conflicts.map((f) => f.name)
              })
            }
          ],
          isError: true
        };
      }
      for (const f of fields) {
        if (f.type === "String" && !f.length) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  error: `Field "${f.name}" has type String but no length specified.`
                })
              }
            ],
            isError: true
          };
        }
      }
      const newFields = fields.map((f) => ({
        name: f.name,
        type: f.type,
        ...f.length !== void 0 ? { length: f.length } : {},
        ...f.description ? { comment: f.description } : {}
      }));
      ext.fields = [...ext.fields, ...newFields];
      writeSchemaXml(filePath, ext);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: true,
              file: path10.basename(filePath),
              extensionGroupName: ext.extensionGroupName,
              addedFields: newFields.map((f) => ({ name: f.name, type: f.type })),
              totalFieldCount: ext.fields.length
            })
          }
        ]
      };
    }
  );
}
function registerSchemaTools(server, dict, getWorkspace) {
  registerListCustomTables(server, dict);
  registerListDbExtensions(server, getWorkspace);
  registerAnalyzeSchema(server, dict, getWorkspace);
  registerScaffoldDbExtension(server, getWorkspace);
  registerAddFieldToExtension(server, getWorkspace);
}

// src/tools/queries.ts
import { z as z4 } from "zod";
import fs14 from "fs";
import path11 from "path";
function requireWorkspace4(getWorkspace) {
  const ws = getWorkspace();
  if (!ws) {
    throw new Error(
      "No plugin workspace detected. Set PS_PLUGIN_ROOT to the plugin src directory, or open a folder containing plugin.xml."
    );
  }
  return ws;
}
function inferFileNameFromQueryName(queryName) {
  const parts = queryName.split(".");
  if (parts.length >= 4) {
    return `${parts.slice(0, 4).join(".")}.named_queries.xml`;
  }
  return `${queryName}.named_queries.xml`;
}
function validateQueryName(name) {
  const issues = [];
  const parts = name.split(".");
  if (parts.length < 5) {
    issues.push({
      severity: "info",
      message: `Query name "${name}" has ${parts.length} part(s); PS documentation recommends 5 parts: {tld}.{org}.{product}.{area}.{description}`
    });
  }
  if (parts[0] === "com" && parts[1] === "powerschool") {
    issues.push({
      severity: "warning",
      message: `Query name starts with "com.powerschool" \u2014 this collides with PS core queries. Use your own org namespace.`
    });
  }
  return issues;
}
function registerScaffoldPowerquery(server, dict, getWorkspace) {
  server.tool(
    "scaffold_powerquery",
    "Generate a named_queries.xml file with the correct PS structure. File and query naming follow 5-part recommended conventions by default.",
    {
      queryName: z4.string().describe(
        "Full query name attribute \u2014 must be unique across PS installation. Recommended: {tld}.{org}.{product}.{area}.{description} (5 parts)"
      ),
      fileName: z4.string().optional().describe(
        "Output filename, must end in .named_queries.xml. Defaults to deriving from first 4 queryName segments."
      ),
      coreTable: z4.string().optional().describe(
        'PS core table entity name for this query (e.g. "students"). Required for DAT queries. Can be empty string for multi-table queries.'
      ),
      flattened: z4.boolean().default(true).describe('Add flattened="true" attribute (standard for most queries)'),
      isDat: z4.boolean().default(false).describe('Add dat="true" for PowerQuery DAT (requires PS 22.9+)'),
      summary: z4.string().optional().describe("Short summary text"),
      description: z4.string().optional().describe("Longer description text"),
      columns: z4.array(
        z4.object({
          column: z4.string().describe('TABLE.FIELD reference (e.g. "students.dcid")'),
          alias: z4.string().optional().describe("Column alias for Pattern A"),
          description: z4.string().optional().describe("Human label for Pattern B")
        })
      ).default([]).describe("Column definitions"),
      args: z4.array(
        z4.object({
          name: z4.string().describe(":paramname used in SQL"),
          type: z4.string().optional().describe('Arg type: "primitive", "array", "date", etc.'),
          column: z4.string().optional().describe("TABLE.FIELD for array args"),
          required: z4.boolean().optional(),
          description: z4.string().optional(),
          default: z4.string().optional().describe("Default value (PS expression OK)")
        })
      ).default([]).describe("Query parameters"),
      sqlBody: z4.string().default("").describe("SQL SELECT body (placed inside CDATA)")
    },
    async (params) => {
      const ws = requireWorkspace4(getWorkspace);
      const queriesDir = ws.dirs.queriesRoot;
      if (!queriesDir) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                error: "No queries_root directory found in workspace.",
                expectedPath: path11.join(ws.artifactsRoot, "queries_root")
              })
            }
          ],
          isError: true
        };
      }
      let fileName = params.fileName;
      if (!fileName) {
        fileName = inferFileNameFromQueryName(params.queryName);
      } else if (!fileName.endsWith(".named_queries.xml")) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ error: 'fileName must end in ".named_queries.xml"' })
            }
          ],
          isError: true
        };
      }
      const existingFiles = readQueryDir(queriesDir);
      const existingNames = new Set(
        existingFiles.flatMap((f) => f.queries.map((q) => q.name))
      );
      if (existingNames.has(params.queryName)) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                error: `Query name "${params.queryName}" already exists in the workspace.`,
                duplicateIn: existingFiles.filter((f) => f.queries.some((q) => q.name === params.queryName)).map((f) => path11.basename(f.sourceFile ?? ""))
              })
            }
          ],
          isError: true
        };
      }
      const issues = [];
      issues.push(...validateQueryName(params.queryName));
      if (params.coreTable && params.coreTable !== "" && !dict.hasTable(params.coreTable.toUpperCase())) {
        issues.push({
          severity: "warning",
          message: `coreTable "${params.coreTable}" not found in data dictionary`
        });
      }
      if (params.isDat) {
        issues.push({
          severity: "info",
          message: 'dat="true" requires PowerSchool 22.9+. Ensure target PS version supports DAT queries.'
        });
        if (!params.coreTable) {
          issues.push({
            severity: "warning",
            message: "DAT queries typically require coreTable to be set."
          });
        }
      }
      for (const col of params.columns) {
        const m = col.column.match(/^([^.]+)\.([^.]+)$/);
        if (!m) {
          issues.push({
            severity: "warning",
            message: `Column reference "${col.column}" does not match TABLE.FIELD format`
          });
          continue;
        }
        const [, table, field] = m;
        if (table && !table.startsWith("U_") && !dict.hasTable(table.toUpperCase())) {
          issues.push({
            severity: "warning",
            message: `Column table "${table}" not found in data dictionary`
          });
        } else if (table && !table.startsWith("U_") && field && !dict.hasField(table.toUpperCase(), field.toUpperCase())) {
          issues.push({
            severity: "warning",
            message: `Column field "${col.column}" not found in data dictionary`
          });
        }
      }
      const sqlParams = extractSqlParams(params.sqlBody);
      const declaredArgs = new Set(params.args.map((a) => a.name.toLowerCase()));
      for (const p of sqlParams) {
        if (!declaredArgs.has(p)) {
          issues.push({
            severity: "warning",
            message: `SQL uses :${p} but no <arg name="${p}"> declared in args`
          });
        }
      }
      for (const a of params.args) {
        if (!sqlParams.includes(a.name.toLowerCase())) {
          issues.push({
            severity: "info",
            message: `Arg "${a.name}" is declared but not referenced as :${a.name} in the SQL body`
          });
        }
      }
      const query = {
        name: params.queryName,
        ...params.coreTable !== void 0 ? { coreTable: params.coreTable } : {},
        flattened: params.flattened,
        ...params.isDat ? { dat: true } : {},
        ...params.summary ? { summary: params.summary } : {},
        ...params.description ? { description: params.description } : {},
        args: params.args.map((a) => ({
          name: a.name,
          ...a.type ? { type: a.type } : {},
          ...a.column ? { column: a.column } : {},
          ...a.required !== void 0 ? { required: a.required } : {},
          ...a.description ? { description: a.description } : {},
          ...a.default !== void 0 ? { default: a.default } : {}
        })),
        columns: params.columns.map((col) => {
          if (col.description) {
            return { fieldRef: col.column, description: col.description, alias: col.description };
          }
          return { fieldRef: col.column, alias: col.alias ?? col.column.split(".").pop() ?? col.column };
        }),
        sql: params.sqlBody
      };
      const filePath = path11.join(queriesDir, fileName);
      let queryFile;
      if (fs14.existsSync(filePath)) {
        queryFile = readQueryXml(filePath);
        queryFile.queries.push(query);
      } else {
        queryFile = { queries: [query] };
      }
      fs14.mkdirSync(queriesDir, { recursive: true });
      writeQueryXml(filePath, queryFile);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                success: true,
                file: fileName,
                path: filePath,
                queryName: params.queryName,
                action: fs14.existsSync(filePath) ? "added-to-existing" : "created-new",
                validationIssues: issues
              },
              null,
              2
            )
          }
        ]
      };
    }
  );
}
function registerListPowerqueries(server, getWorkspace) {
  server.tool(
    "list_powerqueries",
    "List all named query definitions in the current workspace queries_root directory.",
    {},
    async () => {
      const ws = requireWorkspace4(getWorkspace);
      const queriesDir = ws.dirs.queriesRoot;
      if (!queriesDir || !fs14.existsSync(queriesDir)) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ count: 0, files: [], note: "No queries_root directory found." })
            }
          ]
        };
      }
      const queryFiles = readQueryDir(queriesDir);
      const result = queryFiles.map((f) => ({
        file: path11.basename(f.sourceFile ?? ""),
        queryCount: f.queries.length,
        queries: f.queries.map((q) => ({
          name: q.name,
          coreTable: q.coreTable ?? null,
          flattened: q.flattened ?? true,
          isDat: q.dat ?? false,
          columnCount: q.columns.length,
          argCount: q.args.length
        }))
      }));
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                fileCount: result.length,
                totalQueries: result.reduce((n, f) => n + f.queryCount, 0),
                files: result
              },
              null,
              2
            )
          }
        ]
      };
    }
  );
}
function registerValidateNamedQueries(server, dict, getWorkspace) {
  server.tool(
    "validate_named_queries",
    "Validate named query XML files in the workspace. Checks structure, column references against data dictionary, arg/param consistency, and duplicate query names.",
    {
      file: z4.string().optional().describe("Specific filename to validate. Validates all *.named_queries.xml files if omitted.")
    },
    async ({ file }) => {
      const ws = requireWorkspace4(getWorkspace);
      const queriesDir = ws.dirs.queriesRoot;
      if (!queriesDir || !fs14.existsSync(queriesDir)) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ error: "No queries_root directory found in workspace." })
            }
          ],
          isError: true
        };
      }
      let filesToCheck;
      if (file) {
        const target = path11.isAbsolute(file) ? file : path11.join(queriesDir, file);
        if (!fs14.existsSync(target)) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({ error: `File not found: ${target}` })
              }
            ],
            isError: true
          };
        }
        filesToCheck = [target];
      } else {
        filesToCheck = fs14.readdirSync(queriesDir).filter((f) => f.endsWith(".named_queries.xml")).map((f) => path11.join(queriesDir, f));
      }
      const allQueryFiles = [];
      for (const fp of filesToCheck) {
        try {
          allQueryFiles.push(readQueryXml(fp));
        } catch (err) {
        }
      }
      const queryNameCount = /* @__PURE__ */ new Map();
      for (const qf of allQueryFiles) {
        for (const q of qf.queries) {
          const existing = queryNameCount.get(q.name) ?? [];
          existing.push(path11.basename(qf.sourceFile ?? ""));
          queryNameCount.set(q.name, existing);
        }
      }
      const fileResults = [];
      for (const fp of filesToCheck) {
        const fileName = path11.basename(fp);
        let qf;
        try {
          qf = readQueryXml(fp);
        } catch (err) {
          fileResults.push({
            file: fileName,
            valid: false,
            errors: [`Failed to parse XML: ${err}`],
            warnings: [],
            info: []
          });
          continue;
        }
        const errors = [];
        const warnings = [];
        const info = [];
        for (const q of qf.queries) {
          const prefix = q.name ? `[${q.name}]` : "[unnamed query]";
          const nameFiles = queryNameCount.get(q.name) ?? [];
          if (nameFiles.length > 1) {
            errors.push(`${prefix} Duplicate query name across files: ${nameFiles.join(", ")}`);
          }
          const nameIssues = validateQueryName(q.name);
          for (const ni of nameIssues) {
            if (ni.severity === "warning") warnings.push(`${prefix} ${ni.message}`);
            else info.push(`${prefix} ${ni.message}`);
          }
          for (const col of q.columns) {
            const ref = col.fieldRef;
            if (!ref) continue;
            const m = ref.match(/^([^.]+)\.([^.]+)$/);
            if (!m) {
              warnings.push(`${prefix} Column reference "${ref}" does not match TABLE.FIELD format`);
              continue;
            }
            const [, table, field] = m;
            if (table && table.startsWith("U_")) continue;
            if (table && !dict.hasTable(table.toUpperCase())) {
              warnings.push(`${prefix} Column table "${table}" not found in data dictionary`);
            } else if (table && field && !dict.hasField(table.toUpperCase(), field.toUpperCase())) {
              warnings.push(`${prefix} Column field "${ref}" not found in data dictionary`);
            }
          }
          for (const a of q.args) {
            if (!a.name) {
              warnings.push(`${prefix} An <arg> element is missing required name attribute`);
            }
          }
          const sqlParams = extractSqlParams(q.sql);
          const declaredArgs = new Set(q.args.map((a) => a.name.toLowerCase()));
          for (const p of sqlParams) {
            if (!declaredArgs.has(p)) {
              warnings.push(`${prefix} SQL uses :${p} but no <arg name="${p}"> declared`);
            }
          }
          for (const a of q.args) {
            if (a.name && !sqlParams.includes(a.name.toLowerCase())) {
              info.push(
                `${prefix} Arg "${a.name}" declared but :${a.name} not found in SQL (may be intentional for array types)`
              );
            }
          }
          if (q.dat) {
            if (!q.coreTable) {
              warnings.push(`${prefix} dat="true" but coreTable is not set`);
            }
            info.push(`${prefix} dat="true" requires PowerSchool 22.9+`);
          }
        }
        fileResults.push({
          file: fileName,
          valid: errors.length === 0,
          queryCount: qf.queries.length,
          errors,
          warnings,
          info
        });
      }
      const totalErrors = fileResults.reduce((n, f) => n + f.errors.length, 0);
      const totalWarnings = fileResults.reduce((n, f) => n + f.warnings.length, 0);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                valid: totalErrors === 0,
                summary: `${totalErrors} error(s), ${totalWarnings} warning(s) across ${fileResults.length} file(s)`,
                files: fileResults
              },
              null,
              2
            )
          }
        ]
      };
    }
  );
}
function registerQueryTools(server, dict, getWorkspace) {
  registerScaffoldPowerquery(server, dict, getWorkspace);
  registerListPowerqueries(server, getWorkspace);
  registerValidateNamedQueries(server, dict, getWorkspace);
}

// src/tools/access.ts
import { z as z5 } from "zod";
import fs16 from "fs";

// src/lib/access-sync.ts
import fs15 from "fs";
import path12 from "path";
function extractAccessCommentFields(rawXml) {
  const refs = [];
  const pattern = /<!--\s*access:\s*([^\s.>]+)\.([^\s.>]+)\s*-->/gi;
  let m;
  while ((m = pattern.exec(rawXml)) !== null) {
    refs.push({
      table: m[1].toUpperCase(),
      field: m[2].toUpperCase()
    });
  }
  return refs;
}
function collectQueryFieldRefs(queriesDir) {
  if (!fs15.existsSync(queriesDir)) return [];
  const files = fs15.readdirSync(queriesDir).filter((f) => f.endsWith(".named_queries.xml"));
  const seen = /* @__PURE__ */ new Set();
  const refs = [];
  for (const file of files) {
    const fp = path12.join(queriesDir, file);
    try {
      const qf = readQueryXml(fp);
      for (const ref of extractFieldRefs(qf)) {
        const key = `${ref.table}.${ref.field}`;
        if (!seen.has(key)) {
          seen.add(key);
          refs.push(ref);
        }
      }
    } catch {
    }
    try {
      const rawXml = fs15.readFileSync(fp, "utf-8");
      for (const ref of extractAccessCommentFields(rawXml)) {
        const key = `${ref.table}.${ref.field}`;
        if (!seen.has(key)) {
          seen.add(key);
          refs.push(ref);
        }
      }
    } catch {
    }
  }
  const coreOnly = refs.filter((r) => !r.table.startsWith("U_"));
  return coreOnly.sort((a, b) => {
    if (a.table !== b.table) return a.table.localeCompare(b.table);
    return a.field.localeCompare(b.field);
  });
}
function diffAccessRequest(incoming, existing) {
  const incomingKeys = new Set(incoming.map((r) => `${r.table}.${r.field}`));
  const existingKeys = new Set(
    existing.map((f) => `${f.table.toUpperCase()}.${f.field.toUpperCase()}`)
  );
  const added = incoming.filter((r) => !existingKeys.has(`${r.table}.${r.field}`));
  const removed = existing.filter((f) => !incomingKeys.has(`${f.table.toUpperCase()}.${f.field.toUpperCase()}`)).map((f) => ({ table: f.table.toUpperCase(), field: f.field.toUpperCase() }));
  const unchanged = incoming.filter((r) => existingKeys.has(`${r.table}.${r.field}`));
  return { added, removed, unchanged };
}

// src/tools/access.ts
function requireWorkspace5(getWorkspace) {
  const ws = getWorkspace();
  if (!ws) {
    throw new Error(
      "No plugin workspace detected. Set PS_PLUGIN_ROOT to the plugin src directory, or open a folder containing plugin.xml."
    );
  }
  return ws;
}
function registerSyncAccessRequest(server, dict, getWorkspace) {
  server.tool(
    "sync_access_request",
    "Scan all named query XML files in queries_root for TABLE.FIELD column references (both column patterns and <!-- access: TABLE.FIELD --> comments) and rebuild the access_request block in plugin.xml. Ports sync_plugin_access_request.rb. U_* custom tables are skipped automatically.",
    {
      dryRun: z5.boolean().default(false).describe("If true, return the diff without modifying plugin.xml (default: false)")
    },
    async ({ dryRun }) => {
      const ws = requireWorkspace5(getWorkspace);
      const pluginXmlPath = ws.pluginXmlPath;
      const queriesDir = ws.dirs.queriesRoot;
      if (!fs16.existsSync(pluginXmlPath)) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ error: "plugin.xml not found", path: pluginXmlPath })
            }
          ],
          isError: true
        };
      }
      const incomingRefs = queriesDir ? collectQueryFieldRefs(queriesDir) : [];
      const pluginData = readPluginXml(pluginXmlPath);
      const existingFields = pluginData.accessRequest;
      const diff = diffAccessRequest(incomingRefs, existingFields);
      const dictWarnings = [];
      for (const ref of incomingRefs) {
        if (!dict.hasTable(ref.table)) {
          dictWarnings.push(`Table "${ref.table}" not found in data dictionary (keeping it anyway)`);
        } else if (!dict.hasField(ref.table, ref.field)) {
          dictWarnings.push(
            `Field "${ref.table}.${ref.field}" not found in data dictionary (keeping it anyway)`
          );
        }
      }
      if (!dryRun) {
        pluginData.accessRequest = incomingRefs.map((r) => ({
          table: r.table,
          field: r.field,
          access: "ViewOnly"
        }));
        writePluginXml(pluginXmlPath, pluginData);
      }
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                dryRun,
                applied: !dryRun,
                totalFields: incomingRefs.length,
                diff: {
                  added: diff.added.map((r) => `${r.table}.${r.field}`),
                  removed: diff.removed.map((r) => `${r.table}.${r.field}`),
                  unchanged: diff.unchanged.length
                },
                warnings: dictWarnings,
                queriesScanned: queriesDir ? fs16.readdirSync(queriesDir).filter((f) => f.endsWith(".named_queries.xml")).length : 0
              },
              null,
              2
            )
          }
        ]
      };
    }
  );
}
function registerAddAccessField(server, dict, getWorkspace) {
  server.tool(
    "add_access_field",
    "Add a single TABLE.FIELD entry to the access_request block in plugin.xml. Validates against the data dictionary. Use sync_access_request to rebuild the full block from named queries.",
    {
      table: z5.string().describe('Table name (e.g. "STUDENTS")'),
      field: z5.string().describe('Field name (e.g. "DCID")'),
      access: z5.enum(["ViewOnly", "FullAccess"]).default("ViewOnly").describe("Access level (default: ViewOnly)")
    },
    async ({ table, field, access }) => {
      const ws = requireWorkspace5(getWorkspace);
      const pluginXmlPath = ws.pluginXmlPath;
      if (!fs16.existsSync(pluginXmlPath)) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ error: "plugin.xml not found", path: pluginXmlPath })
            }
          ],
          isError: true
        };
      }
      const tableUpper = table.toUpperCase();
      const fieldUpper = field.toUpperCase();
      const warnings = [];
      if (!tableUpper.startsWith("U_")) {
        if (!dict.hasTable(tableUpper)) {
          warnings.push(`Table "${tableUpper}" not found in data dictionary`);
        } else if (!dict.hasField(tableUpper, fieldUpper)) {
          warnings.push(`Field "${tableUpper}.${fieldUpper}" not found in data dictionary`);
        }
      }
      const pluginData = readPluginXml(pluginXmlPath);
      const alreadyExists = pluginData.accessRequest.some(
        (f) => f.table.toUpperCase() === tableUpper && f.field.toUpperCase() === fieldUpper
      );
      if (alreadyExists) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                error: `${tableUpper}.${fieldUpper} already exists in access_request`
              })
            }
          ],
          isError: true
        };
      }
      const newField = {
        table: tableUpper,
        field: fieldUpper,
        access
      };
      pluginData.accessRequest = [
        ...pluginData.accessRequest,
        newField
      ].sort((a, b) => {
        if (a.table !== b.table) return a.table.localeCompare(b.table);
        return a.field.localeCompare(b.field);
      });
      writePluginXml(pluginXmlPath, pluginData);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: true,
              added: `${tableUpper}.${fieldUpper}`,
              access,
              totalFields: pluginData.accessRequest.length,
              warnings
            })
          }
        ]
      };
    }
  );
}
function registerAccessTools(server, dict, getWorkspace) {
  registerSyncAccessRequest(server, dict, getWorkspace);
  registerAddAccessField(server, dict, getWorkspace);
}

// src/tools/permissions.ts
import { z as z6 } from "zod";
import fs18 from "fs";
import path13 from "path";

// src/lib/permission-xml.ts
import { create as create4 } from "xmlbuilder2";
import fs17 from "fs";
function buildPermissionXml(mappings) {
  const doc = create4({ version: "1.0", encoding: "UTF-8" });
  const root = doc.ele("permission_mappings");
  const byPage = /* @__PURE__ */ new Map();
  for (const m of mappings) {
    const group = byPage.get(m.sourcePage) ?? [];
    group.push(m);
    byPage.set(m.sourcePage, group);
  }
  for (const [sourcePage, perms] of byPage) {
    const permEl = root.ele("permission", { name: sourcePage });
    for (const perm of perms) {
      permEl.ele("implies", { allow: perm.allowedOperation }).txt(perm.targetEndpoint);
    }
  }
  return doc.end({ prettyPrint: true });
}
function writePermissionXml(filePath, mappings) {
  fs17.writeFileSync(filePath, buildPermissionXml(mappings), "utf-8");
}

// src/tools/permissions.ts
function requireWorkspace6(getWorkspace) {
  const ws = getWorkspace();
  if (!ws) {
    throw new Error(
      "No plugin workspace detected. Set PS_PLUGIN_ROOT to the plugin src directory, or open a folder containing plugin.xml."
    );
  }
  return ws;
}
function registerPermissionTools(server, getWorkspace) {
  server.tool(
    "scaffold_permission_mapping",
    "Generate a permissions_root XML file that grants PS pages access to named query or table endpoints. Each sourcePage + operation + endpoint triple becomes one <implies> element.",
    {
      fileName: z6.string().describe(
        'Output filename, must end in ".permission_mappings.xml" (e.g. "org.tulsaschools.data.students.permission_mappings.xml")'
      ),
      mappings: z6.array(
        z6.object({
          sourcePage: z6.string().describe(
            'PS page path that needs access, e.g. "/admin/students/student_ids.html"'
          ),
          allowedOperations: z6.array(z6.enum(["get", "post", "put", "delete"])).min(1).describe("HTTP operations to allow on the target endpoint"),
          targetEndpoint: z6.string().describe(
            "Target endpoint: /ws/schema/query/{queryName} for named queries (always post), /ws/schema/table/{TableName} for table CRUD, /ws/schema/table/{TableName}/# for specific records (PUT/DELETE)"
          )
        })
      ).min(1).describe("Permission mappings to generate"),
      force: z6.boolean().default(false).describe("Overwrite existing file without prompting (default: false)")
    },
    async ({ fileName, mappings, force }) => {
      const ws = requireWorkspace6(getWorkspace);
      const permsDir = ws.dirs.permissionsRoot;
      if (!permsDir) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                error: "No permissions_root directory found in workspace.",
                expectedPath: path13.join(ws.artifactsRoot, "permissions_root")
              })
            }
          ],
          isError: true
        };
      }
      if (!fileName.endsWith(".permission_mappings.xml")) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                error: 'fileName must end in ".permission_mappings.xml"'
              })
            }
          ],
          isError: true
        };
      }
      const filePath = path13.join(permsDir, fileName);
      if (fs18.existsSync(filePath) && !force) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                error: `File already exists: ${filePath}`,
                hint: "Pass force: true to overwrite."
              })
            }
          ],
          isError: true
        };
      }
      const flat = [];
      for (const m of mappings) {
        for (const op of m.allowedOperations) {
          flat.push({
            sourcePage: m.sourcePage,
            allowedOperation: op,
            targetEndpoint: m.targetEndpoint
          });
        }
      }
      fs18.mkdirSync(permsDir, { recursive: true });
      writePermissionXml(filePath, flat);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                success: true,
                file: fileName,
                path: filePath,
                mappingCount: flat.length,
                sourcePageCount: new Set(flat.map((m) => m.sourcePage)).size
              },
              null,
              2
            )
          }
        ]
      };
    }
  );
}

// src/tools/lessons.ts
import { z as z7 } from "zod";
var TOPIC_VALUES = [
  "named-queries",
  "db-extensions",
  "permissions",
  "ps-html",
  "plugin-xml",
  "access-request",
  "packaging",
  "general"
];
function registerLessonTools(server, lessonsDir) {
  server.tool(
    "record_lesson",
    "Save a lesson learned, coding pattern, gotcha, or solution to a challenge encountered while building PowerSchool plugins. Lessons persist across sessions and are surfaced via ps://lessons/* resources. Use this to capture non-obvious behavior, workarounds, and hard-won insights.",
    {
      title: z7.string().describe('Short, descriptive title for the lesson \u2014 e.g. "tlist_child requires 3-part table path"'),
      topic: z7.enum(TOPIC_VALUES).describe(
        "Category: named-queries | db-extensions | permissions | ps-html | plugin-xml | access-request | packaging | general"
      ),
      content: z7.string().describe(
        "Full lesson content in Markdown. Include: what the problem/pattern is, why it behaves this way, how to handle it, and a concrete example where helpful."
      ),
      tags: z7.array(z7.string()).default([]).describe('Searchable tags, e.g. ["tlist", "one-to-many", "coreTable"]'),
      id: z7.string().optional().describe(
        'Optional explicit slug ID (e.g. "tlist-child-3-part-path"). If omitted, derived from title. Providing the same ID as an existing lesson updates it in place.'
      )
    },
    async ({ title, topic, content, tags, id }) => {
      const { lesson, created } = upsertLesson(lessonsDir, {
        id,
        title,
        topic,
        content,
        tags
      });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                success: true,
                action: created ? "created" : "updated",
                id: lesson.id,
                title: lesson.title,
                topic: lesson.topic,
                updatedAt: lesson.updatedAt
              },
              null,
              2
            )
          }
        ]
      };
    }
  );
  server.tool(
    "list_lessons",
    "List or search saved lessons learned about PowerSchool plugin development. Returns lesson summaries (no full content). Use get_lesson to read the full content of a specific lesson.",
    {
      query: z7.string().optional().describe("Optional search string \u2014 matches against title, content, topic, and tags"),
      topic: z7.enum(TOPIC_VALUES).optional().describe("Filter to a specific topic category")
    },
    async ({ query, topic }) => {
      let lessons = query ? searchLessons(lessonsDir, query) : listLessons(lessonsDir);
      if (topic) {
        lessons = lessons.filter((l) => l.topic === topic);
      }
      const summaries = lessons.map((l) => ({
        id: l.id,
        title: l.title,
        topic: l.topic,
        tags: l.tags,
        updatedAt: l.updatedAt,
        excerpt: l.content.split("\n").find((line) => line.trim()) ?? ""
      }));
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ total: summaries.length, lessons: summaries }, null, 2)
          }
        ]
      };
    }
  );
  server.tool(
    "get_lesson",
    "Read the full content of a saved lesson by its ID.",
    {
      id: z7.string().describe("Lesson ID (from list_lessons)")
    },
    async ({ id }) => {
      const lesson = getLesson(lessonsDir, id);
      if (!lesson) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ error: `No lesson found with id "${id}"` })
            }
          ],
          isError: true
        };
      }
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(lesson, null, 2)
          }
        ]
      };
    }
  );
  server.tool(
    "delete_lesson",
    "Delete a saved lesson by its ID.",
    {
      id: z7.string().describe("Lesson ID to delete (from list_lessons)")
    },
    async ({ id }) => {
      const deleted = deleteLesson(lessonsDir, id);
      if (!deleted) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ error: `No lesson found with id "${id}"` })
            }
          ],
          isError: true
        };
      }
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ success: true, deleted: id })
          }
        ]
      };
    }
  );
}

// src/prompts/index.ts
import { z as z8 } from "zod";
function registerPrompts(server) {
  server.prompt(
    "design_powerquery",
    "Design a PowerSchool named query (PowerQuery) for a described data need. Guides you through naming conventions, column references, parameter binding, and produces a ready-to-use scaffold_powerquery tool call.",
    {
      description: z8.string().describe('What data is needed \u2014 e.g. "list active students with their homeroom teacher name"'),
      targetTable: z8.string().describe('Primary PS table to query \u2014 e.g. "STUDENTS"'),
      psVersion: z8.string().optional().describe("PowerSchool version (optional) \u2014 affects available columns and syntax")
    },
    ({ description, targetTable, psVersion }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `You are helping design a PowerSchool named query (PowerQuery) using the ps-mcp tools.

## Request
**Data needed:** ${description}
**Primary table:** ${targetTable}${psVersion ? `
**PS version:** ${psVersion}` : ""}

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

Please proceed with designing the query for: **${description}**`
          }
        }
      ]
    })
  );
  server.prompt(
    "design_db_extension",
    "Design a PowerSchool database extension (user_schema_root XML). Determines whether to extend an existing table or create a new one, then guides you to the right scaffold or add-field tool call.",
    {
      description: z8.string().describe('What data to capture \u2014 e.g. "track student laptop assignments"'),
      coreTable: z8.string().optional().describe('PS core table to extend, if known \u2014 e.g. "Students". Omit for independent tables.')
    },
    ({ description, coreTable }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `You are helping design a PowerSchool database extension using the ps-mcp tools.

## Request
**Data to capture:** ${description}${coreTable ? `
**Core table:** ${coreTable}` : ""}

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
- PS auto-creates the \`ID\` primary key \u2014 do NOT declare it in the XML
- For one-to-one and one-to-many, declare the \`{CoreTable}DCID\` FK
- Tracking fields (WHOMODIFIEDID, WHENMODIFIED) are optional but recommended

## Steps
1. Call \`analyze_schema\` with a description of what you need to capture${coreTable ? ` and coreTable="${coreTable}"` : ""}
2. Review the existing extension suggestions
3. If extending existing: call \`add_field_to_extension\`
4. If creating new: call \`scaffold_db_extension\`

Please proceed by calling \`analyze_schema\` for: **${description}**${coreTable ? ` on table ${coreTable}` : ""}`
          }
        }
      ]
    })
  );
  server.prompt(
    "explain_pshtml_tag",
    "Explain a PowerSchool HTML tag pattern, its syntax, and usage. Looks up the tag in the ps-mcp tag reference and provides a plain-language explanation with examples.",
    {
      tagPattern: z8.string().describe('The tag or pattern to explain \u2014 e.g. "~[tlist_sql", "~(*powerquery", "~[DirectTable.Select"')
    },
    ({ tagPattern }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `You are explaining a PowerSchool HTML (PS HTML) tag using the ps-mcp tag reference.

## Tag to explain
\`${tagPattern}\`

## Instructions
1. Look up this tag pattern using the \`ps://tags/list\` resource to find its category
2. Read the relevant tag category resource (e.g. \`ps://tags/tlist\`) to get the full documentation
3. Provide:
   - **What it does** \u2014 plain-language description
   - **Syntax** \u2014 all required and optional parameters
   - **Common use cases** \u2014 when you'd use this tag
   - **Example** \u2014 a realistic usage example in context
   - **Gotchas / caveats** \u2014 anything that commonly causes bugs or confusion

Please look up and explain: \`${tagPattern}\``
          }
        }
      ]
    })
  );
  server.prompt(
    "design_permission_mapping",
    "Design a PowerSchool permission mapping file that grants PS pages access to named query or table endpoints. Produces a ready-to-use scaffold_permission_mapping tool call.",
    {
      tableName: z8.string().describe('The endpoint table or query to grant access to \u2014 e.g. "U_Laptops" or "com.example.data.students.active"'),
      operations: z8.string().describe('Comma-separated HTTP operations to allow \u2014 e.g. "get,post" or "get,post,put,delete"'),
      sourcePages: z8.string().describe('Comma-separated PS page paths that need access \u2014 e.g. "/admin/students/student_ids.html,/guardian/portal.html"')
    },
    ({ tableName, operations, sourcePages }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
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

Please design the permission mapping for endpoint: **${tableName}**`
          }
        }
      ]
    })
  );
}

// src/server.ts
var __filename = fileURLToPath(import.meta.url);
var __dirname = path14.dirname(__filename);
var PROJECT_ROOT = path14.join(__dirname, "..");
var DOCS_DIR = path14.join(PROJECT_ROOT, ".docs");
var LESSONS_DIR = path14.join(PROJECT_ROOT, ".docs", "lessons");
async function createServer() {
  const tagsDir = path14.join(DOCS_DIR, "tags");
  if (!fs19.existsSync(tagsDir)) {
    throw new Error(`Tags directory not found: ${tagsDir}`);
  }
  const csvPath = path14.join(DOCS_DIR, "data_dictionary.csv");
  if (!fs19.existsSync(csvPath)) {
    throw new Error(`Data dictionary not found: ${csvPath}`);
  }
  process.stderr.write("[ps-mcp] Loading tag index...\n");
  const tagIndex = await TagIndex.load(tagsDir);
  process.stderr.write(`[ps-mcp] Loaded ${tagIndex.categories.length} tag categories (${tagIndex.totalTagCount} tags)
`);
  process.stderr.write("[ps-mcp] Loading data dictionary...\n");
  const dict = DataDictionary.load(csvPath);
  process.stderr.write(`[ps-mcp] Loaded ${dict.tableCount} tables from data dictionary
`);
  const workspace = detectWorkspace();
  if (workspace) {
    process.stderr.write(`[ps-mcp] Workspace detected: ${workspace.artifactsRoot} (${workspace.layout})
`);
  } else {
    process.stderr.write("[ps-mcp] No plugin workspace detected \u2014 set PS_PLUGIN_ROOT or open a plugin directory\n");
  }
  const server = new McpServer4({
    name: "ps-mcp",
    version: "0.1.0"
  });
  const getWorkspace = () => detectWorkspace();
  registerTagResources(server, tagIndex);
  registerDictionaryResources(server, dict);
  registerDocsResources(server, DOCS_DIR);
  registerPluginResources(server, getWorkspace);
  registerLessonResources(server, LESSONS_DIR);
  registerPluginTools(server, dict, getWorkspace);
  registerPackageTools(server, getWorkspace);
  registerSchemaTools(server, dict, getWorkspace);
  registerQueryTools(server, dict, getWorkspace);
  registerAccessTools(server, dict, getWorkspace);
  registerPermissionTools(server, getWorkspace);
  registerLessonTools(server, LESSONS_DIR);
  registerPrompts(server);
  return server;
}
async function startServer() {
  const server = await createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write("[ps-mcp] Server running on stdio\n");
}

// src/index.ts
startServer().catch((err) => {
  process.stderr.write(`[ps-mcp] Fatal error: ${err}
`);
  process.exit(1);
});
//# sourceMappingURL=index.js.map