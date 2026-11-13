import type { BrowserContext, Route } from '@playwright/test';

/**
 * A stand-in for the employees API (GET <employeesApiUrl>/v1/employees), for
 * the no-backend acceptance run (ONB-02 and later cards that read the list).
 *
 * It answers in the browser the way lambda/getEmployees answers an hr_staff
 * user: `{ items, count }`, plus `lastKey` when another page follows. The next
 * page is asked for with `?lastKey=<that value>`. A page can hold fewer people
 * than `limit`. Every call needs `Authorization: Bearer <JWT>`, as the API's
 * Cognito authorizer does, or it gets 401.
 *
 * Every call is recorded in `calls`. Nothing here calls AWS or any AI service.
 */

/** One person as getEmployees returns them (lambda/getEmployees/index.mjs). */
export type ApiPerson = {
  employee_id: string;
  first_name: string;
  middle_name: string;
  last_name: string;
  email: string;
  phone: string;
  department: string;
  job_title: string;
  stage: string;
  offer_accept_date: string;
  planned_start_date: string;
  created_at: string;
  created_by: string;
  hr_staff_id: string;
  hr_staff_name: string;
  hr_staff_email: string;
  id_number_last4: string;
};

export type ApiCall = { method: string; url: URL; authorization: string | null };

/** GET <employees API>/v1/employees on any host that is not the app. */
export const isEmployeesApi = (url: URL, appOrigin: string): boolean => /\/v1\/employees$/.test(url.pathname) && url.origin !== appOrigin;

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-allow-methods': 'GET, OPTIONS',
};
const JWT = /^Bearer eyJ[\w-]+\.eyJ[\w-]+\.[\w-]*$/;

let serial = 0;

/** A made-up person with every field getEmployees returns. */
export function apiPerson(p: Partial<ApiPerson> & Pick<ApiPerson, 'first_name' | 'last_name'>): ApiPerson {
  serial++;
  const slug = `${p.first_name}.${p.last_name}`.toLowerCase().replace(/[^a-z.]/g, '');
  return {
    employee_id: `emp-${String(serial).padStart(4, '0')}`,
    middle_name: '',
    email: `${slug}@kestrel-foods.co.za`,
    phone: '',
    department: 'Operations',
    job_title: 'Clerk',
    stage: 'INVITED',
    offer_accept_date: '',
    planned_start_date: '',
    created_at: new Date(Date.UTC(2026, 9, 1) + serial * 3_600_000).toISOString(),
    created_by: 'hr-0001',
    hr_staff_id: 'hr-0001',
    hr_staff_name: 'Jane Smith',
    hr_staff_email: 'jane.smith@mokoena-logistics.co.za',
    id_number_last4: '',
    ...p,
  };
}

export class EmployeesFake {
  readonly calls: ApiCall[] = [];
  people: ApiPerson[] = [];
  /** How many people each page holds, in order; the last size repeats. Default: everyone on one page. */
  pageSizes: number[] = [];
  /** 'ok' answers; 'error' answers 500; 'offline' fails as if the network were down; 'hold' waits for release(). */
  mode: 'ok' | 'error' | 'offline' | 'hold' = 'ok';
  private held: Array<() => void> = [];

  constructor(private readonly appOrigin: string) {}

  /** GET calls the page made, in order. */
  gets(): ApiCall[] {
    return this.calls.filter((c) => c.method === 'GET');
  }

  /** Lets every held call answer, with the mode it is then in ('ok' unless changed). */
  release(): void {
    if (this.mode === 'hold') this.mode = 'ok';
    for (const go of this.held.splice(0)) go();
  }

  async install(context: BrowserContext): Promise<void> {
    await context.route((url) => isEmployeesApi(url, this.appOrigin), (route) => this.handle(route));
  }

  /** The pages the API would answer with: [people of page 1, people of page 2, ...]. */
  pages(): ApiPerson[][] {
    if (!this.pageSizes.length) return [this.people];
    const out: ApiPerson[][] = [];
    let i = 0;
    for (let n = 0; i < this.people.length; n++) {
      const size = this.pageSizes[Math.min(n, this.pageSizes.length - 1)]!;
      out.push(this.people.slice(i, i + size));
      i += size;
    }
    return out.length ? out : [[]];
  }

  private async handle(route: Route): Promise<void> {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    this.calls.push({ method: request.method(), url, authorization: request.headers()['authorization'] ?? null });

    if (this.mode === 'hold') await new Promise<void>((go) => this.held.push(go));
    if (this.mode === 'offline') return route.abort('internetdisconnected');
    if (this.mode === 'error') return json(route, 500, { error: 'Internal server error' });

    if (request.method() !== 'GET') return json(route, 404, { message: 'Not Found' });
    if (!JWT.test(request.headers()['authorization'] ?? '')) return json(route, 401, { message: 'Unauthorized' });

    const pages = this.pages();
    const key = url.searchParams.get('lastKey');
    const index = key === null ? 0 : pageOfKey(key);
    if (index === null || index >= pages.length) return json(route, 400, { error: 'Bad lastKey' });
    const items = pages[index]!;
    const body: Record<string, unknown> = { items, count: items.length };
    if (index + 1 < pages.length) body['lastKey'] = keyOfPage(index + 1);
    return json(route, 200, body);
  }
}

/** Opaque, like the real one (base64url of a DynamoDB key). */
export function keyOfPage(index: number): string {
  return Buffer.from(JSON.stringify({ employee_id: { S: `page-${index}` } })).toString('base64url');
}
function pageOfKey(key: string): number | null {
  try {
    const m = /^page-(\d+)$/.exec(JSON.parse(Buffer.from(key, 'base64url').toString('utf8'))?.employee_id?.S ?? '');
    return m ? Number(m[1]) : null;
  } catch {
    return null;
  }
}

function json(route: Route, status: number, body: unknown): Promise<void> {
  return route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) });
}
