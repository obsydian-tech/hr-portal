import { policyOf, type TfResource } from '../onb-15/tf-policy';

/**
 * TEN-02 re-locks: what TEN-02 may add to an onboarding role, and nothing more (spec section E).
 *  - dynamodb:Query on the tenants table or its tenant-index (the Member rows);
 *  - dynamodb:PutItem on the tenants table itself, only for the two roles that write Member rows (`writesMembers`:
 *    createEmployee and resendInvite);
 *  - dynamodb:Query on the tenant-index of a table the role could already read (`reaches`: its company's list).
 *    Only the tables that have a tenant-index count: employees, documents, document-verification.
 * Resources are as policyOf reads them from Terraform text ("aws_dynamodb_table.<name>.arn[/index/<index>]").
 */
const INDEXED = ['employees', 'documents', 'document_verification', 'document-verification'];
export function tenancyGrant(action: string, resource: string, reaches: readonly string[] = [], writesMembers = false): boolean {
  const tenants = /^(\$\{)?aws_dynamodb_table\.tenants\.arn\}?$/.test(resource);
  const tenantsIndex = /^(\$\{)?aws_dynamodb_table\.tenants\.arn\}?\/index\/tenant-index$/.test(resource);
  const t = /^(?:\$\{)?aws_dynamodb_table\.([\w-]+)\.arn\}?\/index\/tenant-index$/.exec(resource)?.[1] ?? /:table\/([\w.-]+)\/index\/tenant-index$/.exec(resource)?.[1];
  const ownIndex = !!t && INDEXED.includes(t) && reaches.map(same).includes(same(t));
  if (action === 'dynamodb:Query') return tenants || tenantsIndex || ownIndex;
  if (action === 'dynamodb:PutItem') return tenants && writesMembers;
  return false;
}

/** TEN-06: what cognitoPostAuth gains to move a person: PutItem and DeleteItem on the tenants table, AdminAddUserToGroup on the Naleko pool. */
export function ten06Grant(action: string, resource: string): boolean {
  if (action === 'dynamodb:PutItem' || action === 'dynamodb:DeleteItem') return /^(\$\{)?aws_dynamodb_table\.tenants\.arn\}?$/.test(resource);
  if (action === 'cognito-idp:AdminAddUserToGroup') return /^(\$\{)?aws_cognito_user_pool\.naleko_dev\.arn\}?$/.test(resource);
  return false;
}

/** The DynamoDB tables (Terraform labels or names) a list of resources names. */
/** Terraform labels use _ where table names use - (document_verification is table/document-verification). */
export function tablesIn(resources: readonly string[]): string[] {
  return [...new Set(resources.flatMap((r) => [/aws_dynamodb_table\.([\w-]+)\.arn/.exec(r)?.[1], /:table\/([\w.-]+)/.exec(r)?.[1]]).filter((x): x is string => !!x).map(same))];
}
const same = (t: string) => t.replace(/_/g, '-');

type Stmt = { Effect?: string; Action?: string | string[]; Resource?: string | string[]; Condition?: unknown };
const list = (v: unknown): string[] => (v === undefined ? [] : Array.isArray(v) ? (v as string[]) : [v as string]);
const pairs = (r: TfResource) => {
  const doc = policyOf(r) as unknown as { Statement: Stmt | Stmt[] };
  const st = Array.isArray(doc.Statement) ? doc.Statement : [doc.Statement];
  return st.flatMap((s) => list(s.Action).flatMap((a) => list(s.Resource).map((res) => ({ effect: s.Effect ?? '', action: a, resource: res, condition: JSON.stringify(s.Condition ?? null) }))));
};
const key = (p: { effect: string; action: string; resource: string; condition: string }) => `${p.effect} ${p.action} ${p.resource} ${p.condition}`;

/**
 * Compares a role policy with its locked baseline: every (effect, action, resource, condition) the baseline has is
 * still there, and anything new is a TEN-02 grant (Allow, no condition). Returns what is wrong (empty when fine).
 */
export function onlyTenancyAdded(before: TfResource, after: TfResource): string[] {
  const was = pairs(before);
  const old = new Set(was.map(key));
  const reaches = tablesIn(was.filter((p) => p.effect === 'Allow' && p.action.startsWith('dynamodb:')).map((p) => p.resource));
  const writesMembers = /^(create_employee|resend_invite)$/.test(after.name ?? '');
  const now = pairs(after);
  const nowKeys = new Set(now.map(key));
  // Section E: a role may lose a Scan on a table only where it gained a Query on that table's tenant-index.
  const indexed = new Set(tablesIn(now.filter((p) => p.effect === 'Allow' && p.action === 'dynamodb:Query' && /\/index\/tenant-index$/.test(p.resource)).map((p) => p.resource)));
  const wrong: string[] = [];
  for (const k of old) {
    if (nowKeys.has(k)) continue;
    const scan = /^Allow dynamodb:Scan (\S+)/.exec(k)?.[1];
    if (scan && tablesIn([scan]).every((t) => indexed.has(t))) continue;
    wrong.push(`lost: ${k}`);
  }
  for (const p of now) {
    if (old.has(key(p))) continue;
    if (p.effect === 'Allow' && p.condition === 'null' && tenancyGrant(p.action, p.resource, reaches, writesMembers)) continue;
    // TEN-06 re-lock: the sign-in trigger moves a TalentFlow person in (their pending row becomes a Member row and goes; their groups are added).
    if (p.effect === 'Allow' && p.condition === 'null' && after.name === 'cognito_post_auth' && ten06Grant(p.action, p.resource)) continue;
    wrong.push(`added beyond TEN-02: ${key(p)}`);
  }
  return wrong;
}
