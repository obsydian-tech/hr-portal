/**
 * Child lock rec-15b.1 (REC-15 step B, NH-266): REC-15 rule 19 and 20 change the body of POST /v1/candidates. A candidate is added to an
 * OPEN role of the caller's company, and the body may hold only first_name, last_name, email, role_id, phone, source and (for older callers)
 * idempotencyKey. The older suites whose fixtures add a candidate (rec-01, ten-03, mod-01, rec-12) send this body, and their worlds hold
 * one open role for each company. Test data only; no application code.
 */
export const ROLES_TABLE = 'talent-flow-roles';
/** One open role per company, by company id. */
export const ADD_ROLE: Record<string, string> = {
  ten_aaaaaaaaaaaaaaaaaaaaaaaaaa: 'role-15BADDROLEAAAAAAAAAAAAA1',
  ten_bbbbbbbbbbbbbbbbbbbbbbbbbb: 'role-15BADDROLEBBBBBBBBBBBBB1',
  ten_cccccccccccccccccccccccccc: 'role-15BADDROLECCCCCCCCCCCCC1',
  ten_dddddddddddddddddddddddddd: 'role-15BADDROLEDDDDDDDDDDDDD1',
};
type Row = Record<string, Record<string, unknown>>;
const s = (v: string) => ({ S: v });
/** The role rows (as DynamoDB stores them, REC-04 shape) for these companies. `hm` is each company's hiring manager. */
export function addRoleRows(companies: { id: string; hm: string; level?: string }[]): Row[] {
  return companies.map(({ id, hm, level }) => ({
    pk: s(`TENANT#${id}`), sk: s(`ROLE#${ADD_ROLE[id]}`), tenant_id: s(id), role_id: s(ADD_ROLE[id]!), job_title: s('Baker'), department: s('Operations'),
    level: s(level ?? 'JUNIOR'), hiring_manager_id: s(hm), status: s('OPEN'), panel_size: { N: '3' }, opened_at: s('2026-11-01T08:00:00.000Z'), legacy: { BOOL: false },
    criteria: { L: [{ M: { key: s('technical'), label: s('Technical') } }, { M: { key: s('communication'), label: s('Communication') } }] },
  }));
}
/** The new body for company `c`'s open role (rule 19), with the older suites' person and their body key. */
export const addBody = (c: string, key = 'idem-a-0001', extra: Record<string, unknown> = {}) => ({
  idempotencyKey: key, first_name: 'Lerato', last_name: 'Mokoena', email: 'lerato@example.test', role_id: ADD_ROLE[c], ...extra,
});
/** The same tables with these companies' open roles added (when not there yet). */
export function withAddRoles<T extends Record<string, Row[]>>(t: T, companies: { id: string; hm: string; level?: string }[]): T {
  const out = structuredClone(t) as Record<string, Row[]>;
  const have = new Set((out[ROLES_TABLE] ?? []).map((r) => (r['sk'] as any)?.S));
  out[ROLES_TABLE] = [...(out[ROLES_TABLE] ?? []), ...addRoleRows(companies).filter((r) => !have.has((r['sk'] as any).S))];
  return out as T;
}
