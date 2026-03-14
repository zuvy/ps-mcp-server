import fs from 'fs';
import path from 'path';

/**
 * Two-pass sanitizer for the tag JSON source files, which contain two classes
 * of defects:
 *
 * Pass 1 — Literal control characters (0x00–0x1F) inside string values.
 *   Walks the text character-by-character tracking string context so that
 *   structural whitespace (newlines between fields) is untouched.
 *
 * Pass 2 — Unescaped double-quote characters inside single-line string values.
 *   Some "ex" / "desc" / "disp" fields contain PS HTML tag syntax with
 *   embedded quotes (e.g. `method="Weighted"`). Applied line-by-line only on
 *   lines that look like a complete `"key": "value"[,]` pattern.
 */
function sanitizeTagJson(raw: string): string {
  return fixUnescapedQuotesInValues(fixControlCharsInStrings(raw));
}

function fixControlCharsInStrings(raw: string): string {
  let out = '';
  let inString = false;
  let escaped = false;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]!;
    const code = raw.charCodeAt(i);

    if (escaped) {
      out += ch;
      escaped = false;
      continue;
    }

    if (ch === '\\' && inString) {
      out += ch;
      escaped = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      out += ch;
      continue;
    }

    if (inString && code < 0x20) {
      switch (ch) {
        case '\t': out += '\\t'; break;
        case '\n': out += '\\n'; break;
        case '\r': out += '\\r'; break;
        default:   out += `\\u${code.toString(16).padStart(4, '0')}`; break;
      }
      continue;
    }

    out += ch;
  }

  return out;
}

// Matches lines of the form:   optional-spaces "key": "value" optional-comma
// Capture groups: (prefix-through-opening-quote)(rest-of-line)
const VALUE_LINE_RE = /^(\s*"[^"]+"\s*:\s*")(.*)/;

function fixUnescapedQuotesInValues(raw: string): string {
  return raw
    .split('\n')
    .map(line => {
      const m = line.match(VALUE_LINE_RE);
      if (!m) return line;

      const prefix = m[1]!;          // e.g.  '    "ex": "'
      const rest   = m[2]!;          // everything after the opening "

      // The trailing whitespace is cosmetic; work on the trimmed version
      const trimmed    = rest.trimEnd();
      const trailingWS = rest.slice(trimmed.length);

      let suffix: string;
      let content: string;

      if (trimmed.endsWith('",')) {
        suffix  = '",';
        content = trimmed.slice(0, -2);
      } else if (trimmed.endsWith('"')) {
        suffix  = '"';
        content = trimmed.slice(0, -1);
      } else {
        // Not a complete single-line value — leave the line unchanged
        return line;
      }

      // Escape any " that is NOT already preceded by a backslash
      const fixedContent = content.replace(/(?<!\\)"/g, '\\"');

      return prefix + fixedContent + suffix + trailingWS;
    })
    .join('\n');
}

export interface Tag {
  name: string;
  /** HTML-encoded tag syntax (e.g. "&#126;(*DM)") */
  disp: string;
  desc: string;
  /** HTML-encoded example — may be absent */
  code?: string;
  /** Plain-text example — may be absent */
  ex?: string;
}

export interface TagSection {
  section: string;
  description?: string;
  tags: Tag[];
}

export class TagIndex {
  private readonly _index = new Map<string, TagSection[]>();

  private constructor() {}

  /** Load all *.json files from the given tags directory */
  static async load(tagsDir: string): Promise<TagIndex> {
    const idx = new TagIndex();

    const files = fs.readdirSync(tagsDir).filter(f => f.endsWith('.json'));
    for (const file of files) {
      const category = path.basename(file, '.json');
      const raw = fs.readFileSync(path.join(tagsDir, file), 'utf8');
      // Some source files contain literal unescaped control characters inside
      // JSON string values. Sanitize them before parsing.
      const sanitized = sanitizeTagJson(raw);
      try {
        const data: TagSection[] = JSON.parse(sanitized);
        idx._index.set(category, data);
      } catch (err) {
        // Log the bad file and continue rather than crashing the whole server
        process.stderr.write(`[ps-mcp] Warning: failed to parse tags/${file}: ${err}\n`);
      }
    }

    return idx;
  }

  get categories(): string[] {
    return Array.from(this._index.keys()).sort();
  }

  getCategory(category: string): TagSection[] | undefined {
    return this._index.get(category);
  }

  getAll(): Array<{ category: string; sections: TagSection[] }> {
    return this.categories.map(cat => ({
      category: cat,
      sections: this._index.get(cat)!,
    }));
  }

  /** Search tags by keyword across all categories. Returns matching tags with their category. */
  search(query: string): Array<{ category: string; section: string; tag: Tag }> {
    const q = query.toLowerCase();
    const results: Array<{ category: string; section: string; tag: Tag }> = [];

    for (const [category, sections] of this._index) {
      for (const sec of sections) {
        for (const tag of sec.tags) {
          if (
            tag.name.toLowerCase().includes(q) ||
            tag.desc.toLowerCase().includes(q) ||
            (tag.ex && tag.ex.toLowerCase().includes(q))
          ) {
            results.push({ category, section: sec.section, tag });
          }
        }
      }
    }

    return results;
  }

  get totalTagCount(): number {
    let count = 0;
    for (const sections of this._index.values()) {
      for (const sec of sections) count += sec.tags.length;
    }
    return count;
  }
}
