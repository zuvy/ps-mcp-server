import archiver from 'archiver';
import fs from 'fs';
import path from 'path';
import { readPluginXml, PluginXmlData } from './plugin-xml.js';
import { readQueryDir } from './query-xml.js';

// ---- Pre-flight validation -------------------------------------------------

export interface PackageValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export function validateForPackage(
  pluginXmlPath: string,
  queriesDir: string | undefined,
): PackageValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. plugin.xml must exist and parse
  if (!fs.existsSync(pluginXmlPath)) {
    errors.push(`plugin.xml not found at ${pluginXmlPath}`);
    return { valid: false, errors, warnings };
  }

  let data: PluginXmlData;
  try {
    data = readPluginXml(pluginXmlPath);
  } catch (err) {
    errors.push(`plugin.xml parse error: ${err}`);
    return { valid: false, errors, warnings };
  }

  // Required elements
  const rawXml = fs.readFileSync(pluginXmlPath, 'utf-8');
  if (!rawXml.includes('http://plugin.powerschool.pearson.com')) {
    errors.push('plugin.xml namespace must be "http://plugin.powerschool.pearson.com"');
  }
  if (!data.publisher.name) errors.push('<publisher name> is missing');
  if (!data.publisher.contact.email) errors.push('<contact email> is missing');
  if (!data.name) errors.push('<plugin name> attribute is missing');
  else if (data.name.length > 40) errors.push(`Plugin name is ${data.name.length} chars (max 40)`);
  if (!data.version) errors.push('<plugin version> attribute is missing');

  // 2. Named query files must parse
  if (queriesDir && fs.existsSync(queriesDir)) {
    const xmlFiles = fs
      .readdirSync(queriesDir)
      .filter((f) => f.endsWith('.named_queries.xml'));
    for (const f of xmlFiles) {
      try {
        readQueryDir(queriesDir);
      } catch (err) {
        errors.push(`${f}: parse error — ${err}`);
      }
    }

    // Duplicate query names
    try {
      const allFiles = readQueryDir(queriesDir);
      const nameCounts = new Map<string, number>();
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
      // Already caught above
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ---- ZIP builder -----------------------------------------------------------

export interface PackageResult {
  outputPath: string;
  /** Size in bytes */
  sizeBytes: number;
  /** Files added */
  fileCount: number;
}

/**
 * Build a distributable plugin ZIP from the artifacts root directory.
 * The ZIP root contains plugin.xml and all artifact subdirectories.
 */
export async function buildPluginZip(
  artifactsRoot: string,
  outputPath: string,
): Promise<PackageResult> {
  // Ensure output directory exists
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outputPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    let fileCount = 0;
    const archiverWarnings: string[] = [];

    archive.on('entry', () => fileCount++);
    archive.on('error', reject);
    archive.on('warning', (err) => {
      // ENOENT warnings are non-fatal; surface others as errors
      if (err.code === 'ENOENT') {
        archiverWarnings.push(err.message);
      } else {
        reject(err);
      }
    });
    output.on('error', reject);
    output.on('close', () => {
      const stats = fs.statSync(outputPath);
      resolve({
        outputPath,
        sizeBytes: stats.size,
        fileCount,
      });
    });

    archive.pipe(output);

    // Build an allowlist of glob patterns covering only the known PS plugin
    // artifact dirs that actually exist, plus plugin.xml at the root.
    // Using glob (same as original) preserves the zip entry format that the
    // PS installer expects — archive.directory() produces different metadata.
    const knownArtifactDirs = [
      'queries_root',
      'permissions_root',
      'user_schema_root',
      'web_root',
      'WEB_ROOT',
    ];

    const includePatterns: string[] = ['plugin.xml'];
    for (const dir of knownArtifactDirs) {
      if (fs.existsSync(path.join(artifactsRoot, dir))) {
        includePatterns.push(`${dir}/**/*`);
      }
    }

    for (const pattern of includePatterns) {
      archive.glob(pattern, { cwd: artifactsRoot });
    }

    archive.finalize();
  });
}
