import type { BrowserContext, Route } from '@playwright/test';
import { answerFor, isPersonApi, type FakePerson } from '../documents-fake';

/**
 * ONB-08: answers GET <document upload API>/v1/employees/<id>/verifications in the browser the way
 * lambda/getEmployeeDocumentVerifications will once ONB-08 is built: ONB-12's answer (support/documents-fake.ts)
 * plus `required_documents` at the top level. Each person is added with the list the answer carries, or with
 * no `required_documents` field at all (`'left out'`). Refuses a call without a sign-in token; records every call.
 */
export type Required = string[] | 'left out';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-allow-methods': 'GET, OPTIONS',
};
const JWT = /^Bearer eyJ[\w-]+\.eyJ[\w-]+\.[\w-]*$/;
const ROUTE = /^\/v1\/employees\/([^/]+)\/verifications$/;

export class EmployeeAnswerFake {
  readonly calls: Array<{ method: string; url: URL }> = [];
  private readonly people = new Map<string, { person: FakePerson; required: Required }>();

  constructor(private readonly appOrigin: string) {}

  add(person: FakePerson, required: Required): void {
    this.people.set(person.employee.employee_id, { person, required });
  }

  async install(context: BrowserContext): Promise<void> {
    await context.route((url) => isPersonApi(url, this.appOrigin), (route) => this.handle(route));
  }

  private async handle(route: Route): Promise<void> {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    this.calls.push({ method: request.method(), url });
    if (request.method() !== 'GET') return json(route, 404, { message: 'Not Found' });
    if (!JWT.test(request.headers()['authorization'] ?? '')) return json(route, 401, { message: 'Unauthorized' });
    const id = decodeURIComponent(ROUTE.exec(url.pathname)![1]!);
    const found = this.people.get(id);
    if (!found) return json(route, 404, { error: 'Employee not found' });
    const body = answerFor(found.person) as Record<string, unknown>;
    if (found.required !== 'left out') body['required_documents'] = [...found.required];
    return json(route, 200, body);
  }
}

function json(route: Route, status: number, body: unknown): Promise<void> {
  return route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) });
}
