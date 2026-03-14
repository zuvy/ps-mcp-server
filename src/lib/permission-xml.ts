import { create } from 'xmlbuilder2';
import fs from 'fs';

// ---- Types -----------------------------------------------------------------

export type HttpOperation = 'get' | 'post' | 'put' | 'delete';

export interface PermissionMapping {
  /** PS page path that needs access, e.g. "/admin/students/student_ids.html" */
  sourcePage: string;
  /** HTTP operation to allow */
  allowedOperation: HttpOperation;
  /**
   * Target endpoint:
   *   - Named query: /ws/schema/query/{queryName}
   *   - Table CRUD:  /ws/schema/table/{TableName}
   *   - Specific record: /ws/schema/table/{TableName}/# (for PUT/DELETE)
   */
  targetEndpoint: string;
}

// ---- Builder ---------------------------------------------------------------

/**
 * Build a permission_mappings XML file from a set of mappings.
 *
 * Each {sourcePage, allowedOperation, targetEndpoint} triple becomes one
 * <permission name="sourcePage"><implies allow="op">endpoint</implies></permission>
 * block. Multiple implies for the same sourcePage are grouped automatically.
 */
export function buildPermissionXml(mappings: PermissionMapping[]): string {
  const doc = create({ version: '1.0', encoding: 'UTF-8' });
  const root = doc.ele('permission_mappings');

  // Group by sourcePage for clean XML
  const byPage = new Map<string, PermissionMapping[]>();
  for (const m of mappings) {
    const group = byPage.get(m.sourcePage) ?? [];
    group.push(m);
    byPage.set(m.sourcePage, group);
  }

  for (const [sourcePage, perms] of byPage) {
    const permEl = root.ele('permission', { name: sourcePage });
    for (const perm of perms) {
      permEl.ele('implies', { allow: perm.allowedOperation }).txt(perm.targetEndpoint);
    }
  }

  return doc.end({ prettyPrint: true });
}

export function writePermissionXml(filePath: string, mappings: PermissionMapping[]): void {
  fs.writeFileSync(filePath, buildPermissionXml(mappings), 'utf-8');
}
