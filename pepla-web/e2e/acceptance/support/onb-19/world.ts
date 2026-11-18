import { A, AGENT_SECRET, B, EMP, MAIL, SUB, bodyOf, handlerOf, pool, settings, tables } from '../ten-02/world';
import { httpEvent, jwtAuthorizer, runHandler, type Row, type Run, type Tables } from '../ten-02/lambda-harness';

/**
 * ONB-19: TEN-02's two companies (A and B), so the real getMyStart, getEmployees and getEmployeeDocumentVerifications can be
 * asked as the new employee of either company, as HR, and as a token that has no business there. Names and addresses are
 * TEN-02's made-up ones. Each run is a fresh process against a fake AWS: nothing reaches AWS or any paid AI.
 */
export { A, B, EMP, MAIL, SUB, bodyOf, tables };
export type { Run, Tables };

type Patch = Record<string, string | undefined>;
const idOf = (r: Row): string => String((r['employee_id'] as { S?: string })?.S ?? '');

/** TEN-02's tables with `patch` written on one person's row (`undefined` removes the field). */
export function withRow(id: string, patch: Patch, base: Tables = tables()): Tables {
  const out: Tables = { ...base };
  out['employees'] = (base['employees'] ?? []).map((r) => {
    if (idOf(r) !== id) return r;
    const next: Row = { ...r };
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) delete next[k];
      else next[k] = { S: v };
    }
    return next;
  });
  return out;
}

/** The stored fields of the stages and steps the tests set. `step` or `stage` left out means the row has none. */
export const stored = (step: string | undefined, stage: string | undefined): Patch => ({ step, stage });

type Ask = { query?: Record<string, string>; body?: unknown; path?: Record<string, string>; method?: string };

/** Runs one route with any authorizer (the caller's claims, exactly as given) against `tables`. */
export function askAs(handler: string, authorizer: unknown, a: Ask = {}, t: Tables = tables()): Run {
  const event = httpEvent({ authorizer, query: a.query, body: a.body, path: a.path });
  if (a.method) event.requestContext.http.method = a.method;
  return runHandler(handlerOf(handler), event, {
    tables: t,
    cognito: pool(),
    secrets: { [AGENT_SECRET]: { AWSCURRENT: 'ten02-agent-key' } },
    env: settings(),
  });
}

/** An employee's ID-token claims, as API Gateway hands them over: a verified email, the group `employee` and the company. */
export function employeeClaims(over: Record<string, unknown> = {}): unknown {
  return jwtAuthorizer({ sub: SUB.a1, email: MAIL.a1, email_verified: 'true', 'cognito:groups': '[employee]', 'custom:employee_id': EMP.a1, tenant_id: A, ...over });
}

export const dynamoOps = (r: Run): string[] => r.calls.filter((c) => c.service === 'dynamodb').map((c) => (c as { op: string }).op);
export const dynamoCalls = (r: Run) => r.calls.filter((c): c is { service: 'dynamodb'; op: string; table?: string; input: any } => c.service === 'dynamodb');
export const describeRun = (r: Run): string =>
  `${r.response?.statusCode} ${String(r.response?.body ?? '').slice(0, 300)}${r.error ? ` (threw ${r.error.name}: ${r.error.message.slice(0, 200)})` : ''}`;

/** What the HR routes answer for one person's step: getEmployees' item and getEmployeeDocumentVerifications' employee. */
export function hrSees(id: string, t: Tables): { list: unknown; detail: unknown; listRun: Run; detailRun: Run } {
  const listRun = askAs('getEmployees', jwtAuthorizer({ sub: SUB.hrA, email: MAIL.hrA, email_verified: 'true', 'cognito:groups': '[hr_staff e2e-robots]', 'custom:staff_id': 'HRA001', tenant_id: A }), {}, t);
  const detailRun = askAs(
    'getEmployeeDocumentVerifications',
    jwtAuthorizer({ sub: SUB.hrA, email: MAIL.hrA, email_verified: 'true', 'cognito:groups': '[hr_staff e2e-robots]', 'custom:staff_id': 'HRA001', tenant_id: A }),
    { path: { id } },
    t,
  );
  const items = ((bodyOf(listRun) as { items?: Array<Record<string, unknown>> } | null)?.items ?? []).filter((i) => i['employee_id'] === id);
  const body = bodyOf(detailRun) as { employee?: Record<string, unknown> } | null;
  return { list: items[0]?.['step'], detail: body?.employee?.['step'], listRun, detailRun };
}
