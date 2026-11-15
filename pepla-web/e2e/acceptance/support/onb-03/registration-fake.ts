import { randomUUID } from 'node:crypto';
import type { Route } from '@playwright/test';
import { EmployeesFake, JWT, apiPerson, json, type ApiPerson } from '../employees-fake';

/**
 * ONB-03: the employees API as the new screens use it, in the browser, for the no-backend run.
 * On top of EmployeesFake's GET /v1/employees it answers
 *
 *   GET  /v1/hr-partners                 { items: [{ id, name, staffId, email }] }
 *   GET  /v1/employees/email-check?email { inUse: boolean }   (the address trimmed and lower-cased, as the Lambda does)
 *   POST /v1/employees                   201 as lambda/createEmployee answers, 409 DUPLICATE_EMAIL, or 500
 *
 * Every call needs `Authorization: Bearer <JWT>` (401 without). Every call is recorded, with the body of
 * a POST and its headers. A person who is registered joins the list GET /v1/employees answers, in stage
 * INVITED, with the HR partner's name and email taken from the partners list by `hr_staff_id`, never from
 * the body (as the Lambda does). The same Idempotency-Key gets the first answer again and no second person.
 * Nothing here calls AWS or any AI service.
 */

export type Partner = { id: string; name: string; staffId: string; email: string };
export type Posted = { body: Record<string, unknown>; raw: string; headers: Record<string, string>; authorization: string | null };
export type Seen = { method: string; path: string; search: string; postData: string | null };

export class RegistrationFake extends EmployeesFake {
  partners: Partner[] = [];
  /** Addresses (lower case) that email-check says are in use, and that POST refuses with 409. */
  takenEmails: string[] = [];
  /** 'ok' answers; 'error' answers 500; 'hold' waits for release(). */
  partnersMode: 'ok' | 'error' | 'hold' = 'ok';
  emailMode: 'ok' | 'error' | 'hold' = 'ok';
  /** 'created' answers 201; 'duplicate' answers 409 whatever the address; 'error' answers 500; 'hold' waits for release(). */
  createMode: 'created' | 'duplicate' | 'error' | 'hold' = 'created';
  /** The `email.sent` of the 201. */
  welcomeSent = true;

  readonly partnerCalls: Seen[] = [];
  readonly emailChecks: string[] = [];
  readonly posts: Posted[] = [];
  /** Every request that reached the employees API, in order. */
  readonly seen: Seen[] = [];
  /** The people POST created, in order. */
  readonly created: Array<{ id: string; body: Record<string, unknown> }> = [];
  private readonly answers = new Map<string, { status: number; body: unknown }>();
  private readonly gate: Record<'partners' | 'email' | 'create', Array<() => void>> = { partners: [], email: [], create: [] };

  protected override matches(url: URL): boolean {
    return url.origin !== this.appOrigin && /\/v1\/(employees|employees\/email-check|hr-partners)$/.test(url.pathname);
  }

  /** Lets every held call answer, and ends hold mode (it answers as 'ok' / 'created' from then on). */
  override release(): void {
    if (this.partnersMode === 'hold') this.partnersMode = 'ok';
    if (this.emailMode === 'hold') this.emailMode = 'ok';
    if (this.createMode === 'hold') this.createMode = 'created';
    for (const list of Object.values(this.gate)) for (const go of list.splice(0)) go();
    super.release();
  }

  private async wait(which: 'partners' | 'email' | 'create'): Promise<void> {
    await new Promise<void>((go) => this.gate[which].push(go));
  }

  protected override async handle(route: Route): Promise<void> {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'OPTIONS') return super.handle(route);
    const path = url.pathname;
    const isCheck = path.endsWith('/v1/employees/email-check');
    const isPartners = path.endsWith('/v1/hr-partners');
    const isPost = request.method() === 'POST' && path.endsWith('/v1/employees');
    if (!isCheck && !isPartners && !isPost) return super.handle(route);

    const seen: Seen = { method: request.method(), path, search: url.search, postData: request.postData() };
    this.seen.push(seen);
    const authorization = request.headers()['authorization'] ?? null;

    if (isPartners) {
      this.partnerCalls.push(seen);
      if (request.method() !== 'GET') return json(route, 404, { message: 'Not Found' });
      if (this.partnersMode === 'hold') await this.wait('partners');
      if (!JWT.test(authorization ?? '')) return json(route, 401, { message: 'Unauthorized' });
      if (this.partnersMode === 'error') return json(route, 500, { error: 'Internal server error' });
      return json(route, 200, { items: this.partners });
    }

    if (isCheck) {
      if (request.method() !== 'GET') return json(route, 404, { message: 'Not Found' });
      const asked = url.searchParams.get('email') ?? '';
      this.emailChecks.push(asked);
      if (this.emailMode === 'hold') await this.wait('email');
      if (!JWT.test(authorization ?? '')) return json(route, 401, { message: 'Unauthorized' });
      if (this.emailMode === 'error') return json(route, 500, { error: 'Internal server error' });
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(asked.trim())) return json(route, 400, { error: 'Check the email address' });
      return json(route, 200, { inUse: this.takenEmails.includes(asked.trim().toLowerCase()) });
    }

    // POST /v1/employees
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(seen.postData ?? '');
    } catch {
      /* the Lambda answers 400 below */
    }
    this.posts.push({ body: parsed, raw: seen.postData ?? '', headers: request.headers(), authorization });
    if (this.createMode === 'hold') await this.wait('create');
    if (!JWT.test(authorization ?? '')) return json(route, 401, { message: 'Unauthorized' });
    const key = request.headers()['idempotency-key'];
    if (key && this.answers.has(key)) {
      const again = this.answers.get(key)!;
      return json(route, again.status, again.body);
    }
    if (this.createMode === 'error') return json(route, 500, { error: 'Failed to create employee', details: 'Failed to create employee' });
    const email = String(parsed['email'] ?? '').trim().toLowerCase();
    if (this.createMode === 'duplicate' || this.takenEmails.includes(email)) {
      return json(route, 409, { error: 'An employee with this email address already exists.', code: 'DUPLICATE_EMAIL', existingEmployeeId: randomUUID() });
    }
    const partner = this.partners.find((p) => p.id === parsed['hr_staff_id']);
    const id = randomUUID();
    const person: ApiPerson = apiPerson({
      first_name: String(parsed['first_name'] ?? ''),
      last_name: String(parsed['last_name'] ?? ''),
      middle_name: String(parsed['middle_name'] ?? ''),
      email,
      phone: String(parsed['phone'] ?? ''),
      department: String(parsed['department'] ?? ''),
      job_title: String(parsed['job_title'] ?? ''),
      planned_start_date: String(parsed['planned_start_date'] ?? ''),
      offer_accept_date: String(parsed['offer_accept_date'] ?? ''),
      stage: 'INVITED',
      hr_staff_id: partner?.id ?? '',
      hr_staff_name: partner?.name ?? '',
      hr_staff_email: partner?.email ?? '',
      id_number_last4: String(parsed['id_number'] ?? '').slice(-4),
    });
    person.employee_id = id;
    this.people = [...this.people, person];
    this.created.push({ id, body: parsed });
    this.takenEmails.push(email);
    const { id_number_last4: _last4, ...shown } = person;
    const answer = {
      status: 201,
      body: {
        message: 'Employee created successfully',
        employee: { ...shown, id_number_last4: person.id_number_last4 || undefined },
        cognito: { userCreated: true },
        email: { sent: this.welcomeSent },
      },
    };
    if (key) this.answers.set(key, answer);
    return json(route, answer.status, answer.body);
  }
}

/** Three HR people, the first of whom is the signed-in one in the no-backend run (FAKE.hr). */
export function threePartners(signedInEmail: string): Partner[] {
  return [
    { id: 'AS00002', name: 'Lerato Mokoena', staffId: 'AS00002', email: 'lerato.mokoena@mokoena-logistics.co.za' },
    { id: 'E2EHR01', name: 'Jane Smith', staffId: 'E2EHR01', email: signedInEmail },
    { id: 'pool-user-17', name: 'Sipho Ndlovu', staffId: 'AS00017', email: 'sipho.ndlovu@mokoena-logistics.co.za' },
  ];
}
