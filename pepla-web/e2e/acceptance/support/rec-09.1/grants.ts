/**
 * Child lock rec-09.1 (REC-09, NH-243): what REC-09 adds that older locked tests pinned.
 *
 * REC-09 adds four policies, all add-only, each written out in full in Terraform (no locals, no concat) so the IAM readers can read them:
 *  - `manage_drafts`: a new role and policy for the drafts Lambda;
 *  - `evaluate_intelligence_rules_rec09`, `monitor_slas_rec09` and `get_intelligence_tiles_rec09`: one more policy on each of three existing roles.
 * Their exact lines are in support/rec-09/policy-lines.json (the reader's "Allow <action> <resource> <condition>" form). rec-09.spec.ts AC-10
 * pins the same lines from the Terraform. The IAM checks of int-01 AC-16, int-01f AC-8, mod-01 AC-8, rec-01 AC-8, rec-02 AC-11,
 * rec-04 AC-8, rec-07 AC-9, rec-15, rec-15b, rec-15c and rec-15d AC-17 and ten-03 AC-10 each refuse any new grant, so each leaves out
 * exactly these lines on exactly these roles, by their exact text, and nothing else: a policy of these labels whose lines differ from the
 * list in any way is not left out.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isRec062Grant as isRec062Only } from '../rec-06.2.1/grants';

const LINES = JSON.parse(readFileSync(join(__dirname, '..', 'rec-09', 'policy-lines.json'), 'utf8')) as Record<string, string[]>;
/** The role a rec09 label belongs to, or undefined: "<stack>/manage_drafts", ".../<role>_rec09" and the role's own key for gained lines. */
const roleOf = (key: string): string | undefined => {
  const m = /(?:^|\/)(manage_drafts|evaluate_intelligence_rules|monitor_slas|get_intelligence_tiles)(_rec09)?$/.exec(key);
  return m ? m[1] : undefined;
};
/** True for the label of one of the four REC-09 policies. */
export const isRec09Label = (key: string) => /(^|\/)(manage_drafts|(evaluate_intelligence_rules|monitor_slas|get_intelligence_tiles)_rec09)$/.test(key);
/** True only for a REC-09 policy label whose readable lines are exactly the pinned ones (nothing more, nothing less, none unreadable). */
export const isRec09Policy = (key: string, pairs?: string[]) => {
  if (!isRec09Label(key) || !pairs || pairs.length === 0) return false;
  const want = LINES[roleOf(key)!]!;
  return pairs.length === want.length && [...pairs].sort().join('\n') === [...want].sort().join('\n');
};
/** True only for one of REC-09's lines, by its exact text, on the role it was pinned for (the policy label or the role's own key). */
export const isRec09Grant = (line: string, key: string) => {
  const role = roleOf(key);
  return role !== undefined && LINES[role]!.includes(line);
};
/** The two together, so a spec that already asks isRec062Grant asks this instead. */
export const isRec062Grant = (line: string, key: string) => isRec062Only(line, key) || isRec09Grant(line, key);
export const REC09_POLICY_LINES = LINES;
