/**
 * REC-05: offers. Drafted by HR, approved or sent back by a different person with the Approve offers tick, sent only once approved,
 * answered (accepted with a signed copy, declined, withdrawn) and expired by the hourly job. Every change is recorded on the offer.
 *
 * The handler (lambda/manageOffers) has already run the role check, requireTenant and requireModule. ctx = { tenantId, personId,
 * personName, event }. The company and the person come from the sign-in only. Another company's offer answers 404, the same as one
 * that does not exist. Answers carry codes only, never sentences. Nothing here calls a model or starts the state machine.
 *
 * Row (state table): PK OFFER#<offer_id>, SK OFFER; GSI2PK TENANT#<id>#OFFER, GSI2SK <created_at>#<offer_id> (the company's list).
 * One live offer per candidate: a lock row (PK TENANT#<id>#OFFER_LIVE#<candidate>, SK LOCK) holds the live offer's id.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { DynamoDBClient, GetItemCommand, PutItemCommand, QueryCommand, TransactWriteItemsCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { S3Client, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { CognitoIdentityProviderClient, ListUsersInGroupCommand } from '@aws-sdk/client-cognito-identity-provider';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { json, hrOnly } from '../hr-group.mjs';
import { ownsRow, stampTenant, tenantKey, tenantFilter, bracket, notFound } from '../tenant.mjs';
import { buildEmployeeRow } from '../employee-row.mjs';
import { isApprover, isManager, isRecruiter, hiringManagerOf, forbidden } from '../recruitment-access.mjs';
import { normaliseStage } from '../recruitment-stages.mjs';
import { departmentsOf } from '../departments.mjs';
import { companiesOf } from '../membership.mjs';
import { modulesOf } from '../modules.mjs';
import { OLD_GROUPS, PERMS } from '../roles.mjs';
import { recordView } from '../recruitment-audit.mjs';

const db = new DynamoDBClient({});
const bus = new EventBridgeClient({});
const s3 = new S3Client({});
const STATE = () => process.env.STATE_TABLE_NAME ?? 'talent-flow-state';
const ROLES = () => process.env.ROLES_TABLE_NAME ?? 'talent-flow-roles';
const EMPLOYEES = 'employees'; // the literal createEmployee uses
const BUS = () => process.env.EVENTBRIDGE_BUS_NAME;
const BUCKET = () => process.env.UPLOAD_BUCKET;

import { STATES, mapState } from '../offer-states.mjs';
export { STATES, mapState };
const LIVE = ['DRAFT', 'WAITING_APPROVAL', 'APPROVED', 'SENT'];

const APPROVE_TICK = PERMS[2];
const ALLOWED_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];
const MAX_FILE = 10 * 1024 * 1024;
const LINK_SECONDS = 900;
const CANDIDATE_ID = /^CAND-[0-9A-Z]{26}$/;
const OFFER_ID = /^offer-[0-9a-z-]{8,80}$/;
const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;

const bad = (code, field) => json(400, { error: 'Bad request', code, ...(field ? { field } : {}) });
const badField = (field) => bad('INVALID_FIELD', field);
const conflict = (code) => json(409, { error: 'Conflict', code });

const offerKey = (offerId) => ({ PK: `OFFER#${offerId}`, SK: 'OFFER' });
const lockKey = (tenantId, candidateId) => ({ PK: tenantKey(tenantId, 'OFFER_LIVE', candidateId), SK: 'LOCK' });

// ---------------------------------------------------------------- checks

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function ulid(now = Date.now()) {
  let time = '';
  let t = now;
  for (let i = 0; i < 10; i++) { time = CROCKFORD[t % 32] + time; t = Math.floor(t / 32); }
  const bytes = randomBytes(16);
  let rand = '';
  for (let i = 0; i < 16; i++) rand += CROCKFORD[bytes[i] % 32];
  return time + rand;
}

/** Today in Johannesburg, YYYY-MM-DD. */
const today = () => new Date(Date.now() + 2 * 3600_000).toISOString().slice(0, 10);
function isDay(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
const futureDay = (v) => isDay(v) && v > today();
const goodSalary = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0 && /^\d{1,12}(\.\d{1,2})?$/.test(String(v));
const goodCurrency = (v) => typeof v === 'string' && /^[A-Z]{3}$/.test(v);
const goodBenefits = (v) => typeof v === 'string' && v.length <= 2000;

/** The person's name from the sign-in: given and family name, else email, else null. */
export function nameOf(event) {
  const c = event?.requestContext?.authorizer?.jwt?.claims ?? {};
  const n = [c.given_name, c.family_name].filter((x) => typeof x === 'string' && x.trim() !== '').join(' ');
  return n || (typeof c.email === 'string' ? c.email : null);
}

// ---------------------------------------------------------------- the answer

const canReveal = (event) => isRecruiter(event) || isApprover(event);

/** The one-offer answer (rule 14) for this caller. salary only when `reveal`. */
export function shape(row, ctx, { reveal = false } = {}) {
  const state = mapState(row.state);
  return {
    offer_id: row.offer_id, candidate_id: row.candidate_id, candidate_name: row.candidate_name ?? null, role_title: row.role_title ?? null,
    department: row.department ?? null, state, version: row.version ?? 1, start_date: row.start_date ?? null, expiry_date: row.expiry_date ?? null,
    benefits: row.benefits ?? null, currency: row.currency ?? null, salary: reveal ? row.salary ?? null : null, salary_hidden: !reveal,
    created_at: row.created_at ?? null, drafted_by_name: row.drafted_by_name ?? null,
    submitted_at: row.submitted_at ?? null, sent_at: row.sent_at ?? null, answered_at: row.answered_at ?? null,
    approval: row.approval ? { approver_name: row.approval.approver_name ?? null, at: row.approval.at, mode: row.approval.mode } : null,
    history: (row.history ?? []).map((h) => ({
      from: h.from ?? null, to: h.to, by_kind: h.by_kind, by_name: h.by_kind === 'system' ? null : h.by_name ?? null, at: h.at,
      ...(h.note !== undefined ? { note: h.note } : {}), ...(h.kind ? { kind: h.kind, fields: h.fields ?? [] } : {}),
    })),
    ...(state === 'ACCEPTED' && typeof row.employee_id === 'string' ? { employee_id: row.employee_id } : {}),
    drafted_by_me: typeof ctx.personId === 'string' && ctx.personId !== '' && row.drafted_by === ctx.personId,
    can_reveal_salary: canReveal(ctx.event),
  };
}

const listRow = (row) => {
  const out = { offer_id: row.offer_id, candidate_id: row.candidate_id, candidate_name: row.candidate_name ?? null, role_title: row.role_title ?? null, state: mapState(row.state), expires_at: row.expiry_date ?? null };
  const sentBack = (row.approval_history ?? []).filter((a) => a.kind === 'SENT_BACK').at(-1);
  const name = row.approval?.approver_name ?? (mapState(row.state) === 'DRAFT' ? sentBack?.by_name : undefined);
  if (name) out.approver_name = name;
  return out;
};

// ---------------------------------------------------------------- reads

async function loadOffer(ctx, offerId) {
  if (typeof offerId !== 'string' || !OFFER_ID.test(offerId)) return null;
  const got = await db.send(new GetItemCommand({ TableName: STATE(), Key: marshall(offerKey(offerId)), ConsistentRead: true }));
  const row = got.Item ? unmarshall(got.Item) : null;
  if (!row || row.offer_id !== offerId || !ownsRow(row, ctx.tenantId)) return null;
  return row;
}

/** May this caller see this offer (rule 14)? Recruiter; approver once submitted; the candidate's hiring manager. */
async function visible(ctx, row) {
  if (isRecruiter(ctx.event)) return true;
  if (isApprover(ctx.event) && row.submitted_at) return true;
  if (isManager(ctx.event)) {
    const got = await db.send(new GetItemCommand({ TableName: STATE(), Key: marshall({ PK: `CANDIDATE#${row.candidate_id}`, SK: 'SAGA' }) }));
    const saga = got.Item ? unmarshall(got.Item) : null;
    return !!saga && ownsRow(saga, ctx.tenantId) && hiringManagerOf(saga, ctx.personId);
  }
  return false;
}

/** GET /v1/offers/{id} */
export async function getOffer(ctx, offerId, query = {}) {
  const row = await loadOffer(ctx, offerId);
  if (!row || !(await visible(ctx, row))) return notFound();
  if (query.reveal === 'salary') {
    if (!canReveal(ctx.event)) return forbidden();
    const at = new Date().toISOString();
    await recordView({ tenantId: ctx.tenantId, personId: ctx.personId, kind: 'OFFER_SALARY_VIEWED', subject: { offer_id: row.offer_id }, at });
    return json(200, shape(row, ctx, { reveal: true }));
  }
  return json(200, shape(row, ctx));
}

const tokenOf = (row) => Buffer.from(JSON.stringify({ c: row.created_at, o: row.offer_id })).toString('base64url');
function cursorOf(token) {
  try {
    const v = JSON.parse(Buffer.from(token, 'base64url').toString('utf8'));
    if (v && typeof v.c === 'string' && typeof v.o === 'string' && OFFER_ID.test(v.o) && !Number.isNaN(Date.parse(v.c))) return v;
  } catch { /* not a token */ }
  return null;
}
const newestFirst = (a, b) => String(b.created_at).localeCompare(String(a.created_at)) || String(b.offer_id).localeCompare(String(a.offer_id));

/** GET /v1/offers */
export async function listOffers(ctx, query = {}) {
  const { state, candidate_id: candidate, limit, nextToken } = query;
  if (state !== undefined && !STATES.includes(state)) return badField('state');
  if (candidate !== undefined && !CANDIDATE_ID.test(candidate)) return badField('candidate_id');
  let size = 100;
  if (limit !== undefined) {
    if (!/^\d+$/.test(String(limit)) || Number(limit) < 1 || Number(limit) > 100) return badField('limit');
    size = Number(limit);
  }
  let after = null;
  if (nextToken !== undefined) {
    after = cursorOf(String(nextToken));
    if (!after) return badField('nextToken');
  }
  const rows = [];
  let start;
  do {
    const page = await db.send(new QueryCommand({
      TableName: STATE(), IndexName: 'GSI2', KeyConditionExpression: 'GSI2PK = :pk', ScanIndexForward: false,
      FilterExpression: '#t = :t', ExpressionAttributeNames: { '#t': 'tenant_id' },
      ExpressionAttributeValues: marshall({ ':pk': tenantKey(ctx.tenantId, 'OFFER'), ':t': ctx.tenantId }), ExclusiveStartKey: start,
    }));
    for (const item of page.Items ?? []) {
      const row = unmarshall(item);
      if (ownsRow(row, ctx.tenantId) && row.offer_id) rows.push(row);
    }
    start = page.LastEvaluatedKey;
  } while (start);
  const all = isRecruiter(ctx.event);
  let shown = rows.filter((r) => (all || r.submitted_at) && (!state || mapState(r.state) === state) && (!candidate || r.candidate_id === candidate)).sort(newestFirst);
  if (after) shown = shown.filter((r) => newestFirst(r, { created_at: after.c, offer_id: after.o }) > 0);
  const page = shown.slice(0, size);
  return json(200, { offers: page.map(listRow), ...(shown.length > size ? { nextToken: tokenOf(page.at(-1)) } : {}) });
}

// ---------------------------------------------------------------- writes

const entry = (ctx, from, to, at, extra = {}) => ({ from, to, by: ctx.personId, by_kind: 'person', by_name: ctx.personName, at, ...extra });

/** One conditional write of the whole row (on the state and version read), with the lock released when `release`. */
async function save(ctx, before, after, { release = false } = {}) {
  const put = {
    TableName: STATE(), Item: marshall(after, { removeUndefinedValues: true }),
    ConditionExpression: '#v = :v AND #s = :s AND tenant_id = :t',
    ExpressionAttributeNames: { '#v': 'version', '#s': 'state' },
    ExpressionAttributeValues: marshall({ ':v': before.version, ':s': before.state, ':t': ctx.tenantId }),
  };
  try {
    if (!release) await db.send(new PutItemCommand(put));
    else {
      await db.send(new TransactWriteItemsCommand({
        TransactItems: [
          { Put: put },
          {
            Update: {
              TableName: STATE(), Key: marshall(lockKey(before.tenant_id, before.candidate_id)), UpdateExpression: 'REMOVE live_offer_id',
              ConditionExpression: 'live_offer_id = :id', ExpressionAttributeValues: marshall({ ':id': before.offer_id }),
            },
          },
        ],
      }));
    }
  } catch (e) {
    if (e.name === 'ConditionalCheckFailedException' || e.name === 'TransactionCanceledException') return false;
    throw e;
  }
  return true;
}

async function publish(type, detail) {
  try {
    await bus.send(new PutEventsCommand({ Entries: [{ EventBusName: BUS(), Source: 'talent-flow.workflow', DetailType: type, Detail: JSON.stringify(detail) }] }));
  } catch (e) {
    console.error('offers: event not sent', { type, error: e?.name ?? 'Error' });
  }
}

/** Several events in one request. True only when every entry was taken; the log carries the offer id and an error name only. */
async function publishAll(events, offerId) {
  try {
    const out = await bus.send(new PutEventsCommand({
      Entries: events.map(([type, detail]) => ({ EventBusName: BUS(), Source: 'talent-flow.workflow', DetailType: type, Detail: JSON.stringify(detail) })),
    }));
    if (out?.FailedEntryCount) {
      console.error('offers: events not sent', { offer_id: offerId, error: 'FailedEntry' });
      return false;
    }
    return true;
  } catch (e) {
    console.error('offers: events not sent', { offer_id: offerId, error: e?.name ?? 'Error' });
    return false;
  }
}

const next = (row, changes) => ({ ...row, ...changes, version: row.version + 1, updated_at: changes.updated_at });

/** POST /v1/offers (rule 2) */
export async function createOffer(ctx, body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return bad('INVALID_BODY');
  const { candidate_id: candidateId, salary, currency, start_date: start, expiry_date: expiry, benefits } = body;
  if (typeof candidateId !== 'string' || !CANDIDATE_ID.test(candidateId)) return badField('candidate_id');
  if (!goodSalary(salary)) return badField('salary');
  if (currency !== undefined && !goodCurrency(currency)) return badField('currency');
  if (!futureDay(start)) return badField('start_date');
  if (!futureDay(expiry) || expiry > start) return badField('expiry_date');
  if (benefits !== undefined && !goodBenefits(benefits)) return badField('benefits');

  const got = await db.send(new GetItemCommand({ TableName: STATE(), Key: marshall({ PK: `CANDIDATE#${candidateId}`, SK: 'SAGA' }), ConsistentRead: true }));
  const saga = got.Item ? unmarshall(got.Item) : null;
  if (!saga || !ownsRow(saga, ctx.tenantId)) return notFound();
  if (normaliseStage(saga) !== 'OFFER') return conflict('NOT_IN_OFFER');

  // One live offer: the lock, and an old-shape row that has not been moved yet.
  const [lock, old] = await Promise.all([
    db.send(new GetItemCommand({ TableName: STATE(), Key: marshall(lockKey(ctx.tenantId, candidateId)), ConsistentRead: true })),
    db.send(new GetItemCommand({ TableName: STATE(), Key: marshall({ PK: `CANDIDATE#${candidateId}`, SK: 'OFFER' }), ConsistentRead: true })),
  ]);
  if (lock.Item && unmarshall(lock.Item).live_offer_id) return conflict('OFFER_EXISTS');
  const oldRow = old.Item ? unmarshall(old.Item) : null;
  if (oldRow && ownsRow(oldRow, ctx.tenantId) && !oldRow.moved_to && LIVE.includes(mapState(oldRow.state))) return conflict('OFFER_EXISTS');

  let role = null;
  if (saga.role_id) {
    const r = await db.send(new GetItemCommand({ TableName: ROLES(), Key: marshall({ pk: `TENANT#${ctx.tenantId}`, sk: `ROLE#${saga.role_id}` }) }));
    role = r.Item ? unmarshall(r.Item) : null;
    if (role && !ownsRow(role, ctx.tenantId)) role = null;
  }
  let department = role?.department ?? null;
  if (role?.department_id) {
    const { departments } = await departmentsOf(ctx.tenantId);
    department = departments.find((d) => d.id === role.department_id)?.name ?? department;
  }
  const at = new Date().toISOString();
  const offerId = `offer-${randomUUID()}`;
  const row = stampTenant({
    ...offerKey(offerId), offer_id: offerId, candidate_id: candidateId, ...(saga.role_id ? { role_id: saga.role_id } : {}), // role_id is a table index key: a null there is refused
    candidate_name: [saga.firstName, saga.lastName].filter(Boolean).join(' ') || null, role_title: role?.job_title ?? null, department,
    state: 'DRAFT', version: 1, salary, currency: currency ?? 'ZAR', start_date: start, expiry_date: expiry, ...(benefits !== undefined ? { benefits } : {}),
    drafted_by: ctx.personId, drafted_by_name: ctx.personName, created_at: at, updated_at: at, approval_history: [],
    history: [entry(ctx, null, 'DRAFT', at)], GSI2PK: tenantKey(ctx.tenantId, 'OFFER'), GSI2SK: `${at}#${offerId}`,
  }, ctx.tenantId);
  try {
    await db.send(new TransactWriteItemsCommand({
      TransactItems: [
        { Put: { TableName: STATE(), Item: marshall(row, { removeUndefinedValues: true }), ConditionExpression: 'attribute_not_exists(PK)' } },
        {
          Update: {
            TableName: STATE(), Key: marshall(lockKey(ctx.tenantId, candidateId)), UpdateExpression: 'SET live_offer_id = :id, tenant_id = :t',
            ConditionExpression: 'attribute_not_exists(live_offer_id)', ExpressionAttributeValues: marshall({ ':id': offerId, ':t': ctx.tenantId }),
          },
        },
      ],
    }));
  } catch (e) {
    if (e.name === 'TransactionCanceledException') {
      // Only a failed condition means another live offer. Any other cancel reason (a clash with another write, a bad request) is not that.
      const reasons = e.CancellationReasons?.map((r) => r?.Code ?? 'None')
        ?? String(e.message ?? '').match(/\[([^\]]*)\]/)?.[1]?.split(/,\s*/).map((c) => c.trim()) ?? [];
      if (reasons.length === 0 || reasons.includes('ConditionalCheckFailed')) return conflict('OFFER_EXISTS');
      console.error('offers: create cancelled', { reasons });
      return json(409, { error: 'Conflict', code: 'OFFER_BUSY', reasons });
    }
    throw e;
  }
  return json(201, shape(row, ctx));
}

/** People of this company holding the approver tick (D-T-5.7), not counting `except`. */
async function approversOf(tenantId, except) {
  const pool = process.env.COGNITO_POOL_ID ?? process.env.HM_COGNITO_POOL_ID;
  const cognito = new CognitoIdentityProviderClient({});
  const groups = [APPROVE_TICK, ...Object.entries(OLD_GROUPS).filter(([, g]) => g.perms.includes(APPROVE_TICK)).map(([n]) => n)];
  const seen = new Map();
  for (const group of groups) {
    let token;
    try {
      do {
        const page = await cognito.send(new ListUsersInGroupCommand({ UserPoolId: pool, GroupName: group, NextToken: token }));
        for (const u of page.Users ?? []) {
          const sub = (u.Attributes ?? []).find((a) => a.Name === 'sub')?.Value;
          if (sub) seen.set(sub, u);
        }
        token = page.NextToken;
      } while (token);
    } catch (e) {
      if (e?.name !== 'ResourceNotFoundException') throw e;
    }
  }
  const out = [];
  for (const [sub, u] of seen) {
    if (sub === except || u.UserStatus !== 'CONFIRMED' || u.Enabled === false) continue;
    const mine = await companiesOf(sub);
    if (mine.length === 1 && mine[0] === tenantId) out.push(sub);
  }
  return out;
}

const versionOk = (body, row) => Number.isInteger(body?.version) && body.version === row.version;
const objectBody = (b) => (b && typeof b === 'object' && !Array.isArray(b) ? b : null);

/** The routes that change one offer. Each loads the offer first, so another company's offer is 404 before anything else. */
export async function actOnOffer(ctx, action, offerId, rawBody) {
  const row = await loadOffer(ctx, offerId);
  if (!row) return notFound();
  const body = objectBody(rawBody) ?? {};
  const state = mapState(row.state);
  const at = new Date().toISOString();
  switch (action) {
    case 'submit': {
      // Any Recruiter of the company may submit (decision 25 Nov, Q2); the approver must still be someone other than the drafter.
      if (state !== 'DRAFT') return conflict('NOT_DRAFT');
      if ((await approversOf(ctx.tenantId, row.drafted_by)).length === 0) return conflict('NO_APPROVER');
      const after = next(row, { state: 'WAITING_APPROVAL', submitted_at: at, updated_at: at, history: [...row.history, entry(ctx, 'DRAFT', 'WAITING_APPROVAL', at)] });
      return (await save(ctx, row, after)) ? json(200, shape(after, ctx)) : conflict('STALE');
    }
    case 'approve':
    case 'send-back': {
      if (row.drafted_by === ctx.personId) return forbidden();
      if (state !== 'WAITING_APPROVAL') return conflict('NOT_WAITING');
      if (!versionOk(body, row)) return conflict('STALE');
      let after;
      if (action === 'approve') {
        after = next(row, { state: 'APPROVED', approval: { approver_id: ctx.personId, approver_name: ctx.personName, at, mode: 'ONE_APPROVER' }, updated_at: at, history: [...row.history, entry(ctx, 'WAITING_APPROVAL', 'APPROVED', at)] });
      } else {
        const note = body.note;
        if (typeof note !== 'string' || note.trim() === '' || note.length > 1000) return bad('NOTE_REQUIRED');
        after = next(row, {
          state: 'DRAFT', approval: undefined, updated_at: at,
          approval_history: [...(row.approval_history ?? []), { kind: 'SENT_BACK', by: ctx.personId, by_name: ctx.personName, note, at }],
          history: [...row.history, entry(ctx, 'WAITING_APPROVAL', 'DRAFT', at, { note })],
        });
        delete after.approval;
      }
      return (await save(ctx, row, after)) ? json(200, shape(after, ctx)) : conflict('STALE');
    }
    case 'send': {
      if (state !== 'APPROVED') return conflict('NOT_APPROVED');
      const after = next(row, { state: 'SENT', sent_at: at, updated_at: at, history: [...row.history, entry(ctx, 'APPROVED', 'SENT', at)] });
      if (!(await save(ctx, row, after))) return conflict('STALE');
      await publish('OfferSent', { tenant_id: ctx.tenantId, offer_id: row.offer_id, candidate_id: row.candidate_id, role_id: row.role_id ?? null, at });
      return json(200, shape(after, ctx));
    }
    case 'answer': {
      const answer = body.answer;
      // REC-06 rule 2.2: the same accept again finishes what is missing and answers the stored offer; any other answer stays NOT_SENT.
      if (answer === 'ACCEPTED' && state === 'ACCEPTED' && typeof row.employee_id === 'string' && row.employee_id !== '') return repeatAccepted(ctx, row);
      if (state !== 'SENT') return conflict('NOT_SENT');
      if (!['ACCEPTED', 'DECLINED', 'WITHDRAWN'].includes(answer)) return badField('answer');
      const extra = {};
      if (answer === 'ACCEPTED') {
        if (typeof body.signed_key !== 'string') return badField('signed_key');
        if (!isDay(body.confirmed_start_date)) return badField('confirmed_start_date');
        const prefix = `recruitment/${ctx.tenantId}/offers/${row.offer_id}/`;
        const key = body.signed_key;
        if (!key.startsWith(prefix) || !ULID.test(key.slice(prefix.length))) return bad('INVALID_SIGNED_KEY');
        try {
          const head = await s3.send(new HeadObjectCommand({ Bucket: BUCKET(), Key: key }));
          if (!(head.ContentLength > 0 && head.ContentLength <= MAX_FILE)) return bad('INVALID_SIGNED_KEY');
        } catch (e) {
          if (e?.name === 'NotFound' || e?.$metadata?.httpStatusCode === 404) return bad('INVALID_SIGNED_KEY');
          throw e;
        }
        Object.assign(extra, { signed_key: key, confirmed_start_date: body.confirmed_start_date });
        const after = next(row, { state: answer, answered_at: at, answered_by: ctx.personId, answered_by_name: ctx.personName, updated_at: at, ...extra, history: [...row.history, entry(ctx, 'SENT', answer, at)] });
        return convertOffer(ctx, row, after, at);
      }
      const after = next(row, { state: answer, answered_at: at, answered_by: ctx.personId, answered_by_name: ctx.personName, updated_at: at, ...extra, history: [...row.history, entry(ctx, 'SENT', answer, at)] });
      if (!(await save(ctx, row, after, { release: answer !== 'ACCEPTED' }))) return conflict('STALE');
      await publish('OfferAnswered', { tenant_id: ctx.tenantId, offer_id: row.offer_id, candidate_id: row.candidate_id, answer });
      return json(200, shape(after, ctx));
    }
    case 'withdraw': {
      // Withdraw from SENT too (decision 25 Nov, F9: the offer screen withdraws a sent offer here); that one tells the candidate's side with OfferAnswered.
      if (!['DRAFT', 'WAITING_APPROVAL', 'APPROVED', 'SENT'].includes(state)) return conflict('NOT_OPEN');
      const note = body.note;
      if (note !== undefined && (typeof note !== 'string' || note.length > 1000)) return badField('note');
      const after = next(row, { state: 'WITHDRAWN', updated_at: at, ...(state === 'SENT' ? { answered_at: at, answered_by: ctx.personId, answered_by_name: ctx.personName } : {}), history: [...row.history, entry(ctx, state, 'WITHDRAWN', at, note !== undefined ? { note } : {})] });
      if (!(await save(ctx, row, after, { release: true }))) return conflict('STALE');
      if (state === 'SENT') await publish('OfferAnswered', { tenant_id: ctx.tenantId, offer_id: row.offer_id, candidate_id: row.candidate_id, answer: 'WITHDRAWN' });
      return json(200, shape(after, ctx));
    }
    case 'signed-upload': {
      if (state !== 'SENT') return conflict('NOT_SENT');
      const { file_name: fileName, content_type: type, file_size: size } = body;
      if (typeof fileName !== 'string' || fileName === '' || fileName.length > 255) return badField('file_name');
      if (typeof type !== 'string' || !ALLOWED_TYPES.includes(type)) return badField('content_type');
      if (!Number.isInteger(size) || size < 1 || size > MAX_FILE) return badField('file_size');
      const key = `recruitment/${ctx.tenantId}/offers/${row.offer_id}/${ulid()}`;
      const uploadUrl = await getSignedUrl(s3, new PutObjectCommand({ Bucket: BUCKET(), Key: key, ContentType: type, ContentLength: size }), { expiresIn: LINK_SECONDS });
      return json(200, { upload_url: uploadUrl, signed_key: key });
    }
    case 'patch':
      return editOffer(ctx, row, body, at);
    default:
      return notFound();
  }
}

// ---------------------------------------------------------------- REC-06: an accepted offer makes the hire and the employee record

/** The stored offer, with the follow-ups an earlier call could not finish done now (rule 5). */
async function repeatAccepted(ctx, row) {
  await finishFollowUps(ctx, row);
  return json(200, shape(row, ctx));
}

/** CandidateHired and OfferAnswered once, then the marker. A failure leaves the marker off, so the next repeat tries again. */
async function finishFollowUps(ctx, row) {
  if (row.followups_done?.hired_event) return;
  const sent = await publishAll([
    ['CandidateHired', { tenant_id: ctx.tenantId, candidate_id: row.candidate_id, role_id: row.role_id ?? null, employee_id: row.employee_id, offer_id: row.offer_id, at: row.answered_at }],
    ['OfferAnswered', { tenant_id: ctx.tenantId, offer_id: row.offer_id, candidate_id: row.candidate_id, answer: 'ACCEPTED' }],
  ], row.offer_id);
  if (!sent) return;
  try {
    await db.send(new UpdateItemCommand({
      TableName: STATE(), Key: marshall(offerKey(row.offer_id)), UpdateExpression: 'SET #f.#h = :at',
      ConditionExpression: 'tenant_id = :t', ExpressionAttributeNames: { '#f': 'followups_done', '#h': 'hired_event' },
      ExpressionAttributeValues: marshall({ ':at': new Date().toISOString(), ':t': ctx.tenantId }),
    }));
  } catch (e) {
    console.error('offers: marker not saved', { offer_id: row.offer_id, error: e?.name ?? 'Error' });
  }
}

/** True when the company already has an employee with this email (the exact lower-case address, filtered to the company). */
async function emailIsEmployee(tenantId, email) {
  if (email === '') return false;
  const f = tenantFilter(tenantId);
  let start;
  do {
    const page = await db.send(new QueryCommand({
      TableName: EMPLOYEES, IndexName: 'email-index', KeyConditionExpression: 'email = :email',
      FilterExpression: f.FilterExpression, ExpressionAttributeNames: f.ExpressionAttributeNames,
      ExpressionAttributeValues: marshall({ ...f.ExpressionAttributeValues, ':email': email }), ProjectionExpression: 'employee_id', ExclusiveStartKey: start,
    }));
    if ((page.Items ?? []).length > 0) return true;
    start = page.LastEvaluatedKey;
  } while (start);
  return false;
}

/**
 * ACCEPTED, once the caller, the signed copy and the date have passed (REC-06 rules 2.6 to 3). One transaction of four items, all or
 * none: the employee, the offer, the candidate and the stage history row. `after` is the accepted offer without employee_id yet.
 */
async function convertOffer(ctx, row, after, at) {
  const got = await db.send(new GetItemCommand({ TableName: STATE(), Key: marshall({ PK: `CANDIDATE#${row.candidate_id}`, SK: 'SAGA' }), ConsistentRead: true }));
  const saga = got.Item ? unmarshall(got.Item) : null;
  if (!saga || !ownsRow(saga, ctx.tenantId) || normaliseStage(saga) !== 'OFFER') return conflict('NOT_OPEN');

  // The role gives the title and the current department name; a missing role does not refuse.
  let role = null;
  if (saga.role_id) {
    const r = await db.send(new GetItemCommand({ TableName: ROLES(), Key: marshall({ pk: `TENANT#${ctx.tenantId}`, sk: `ROLE#${saga.role_id}` }) }));
    role = r.Item ? unmarshall(r.Item) : null;
    if (role && !ownsRow(role, ctx.tenantId)) role = null;
  }
  let department = role?.department ?? null;
  if (role?.department_id) {
    const { departments } = await departmentsOf(ctx.tenantId);
    department = departments.find((d) => d.id === role.department_id)?.name ?? department;
  }

  const email = String(saga.email ?? '').trim().toLowerCase();
  if (await emailIsEmployee(ctx.tenantId, email)) return conflict('EMAIL_IS_EMPLOYEE');

  const claims = ctx.event?.requestContext?.authorizer?.jwt?.claims ?? {};
  const employee = buildEmployeeRow({ tenantId: ctx.tenantId, offer: row, candidate: saga, role, department, claims, at, confirmedStartDate: after.confirmed_start_date });
  const accepted = { ...after, employee_id: employee.employee_id, followups_done: {} };
  const history = stampTenant({
    PK: `CANDIDATE#${row.candidate_id}`, SK: `STAGE#${at}#${randomBytes(4).toString('hex')}`, recordType: 'STAGE_HISTORY', fromStage: 'OFFER', toStage: 'HIRED',
    actor: ctx.personId, timestamp: at, createdAt: at, candidateId: row.candidate_id,
  }, ctx.tenantId);
  const mine = tenantFilter(ctx.tenantId);
  try {
    await db.send(new TransactWriteItemsCommand({
      TransactItems: [
        { Put: { TableName: EMPLOYEES, Item: marshall(employee, { removeUndefinedValues: true }), ConditionExpression: 'attribute_not_exists(employee_id)' } },
        {
          Put: {
            TableName: STATE(), Item: marshall(accepted, { removeUndefinedValues: true }), ConditionExpression: '#v = :v AND #s = :s AND tenant_id = :t',
            ExpressionAttributeNames: { '#v': 'version', '#s': 'state' }, ExpressionAttributeValues: marshall({ ':v': row.version, ':s': row.state, ':t': ctx.tenantId }),
          },
        },
        {
          Update: {
            TableName: STATE(), Key: marshall({ PK: saga.PK, SK: 'SAGA' }),
            UpdateExpression: 'SET currentStage = :hired, stageEnteredAt = :at, hired_at = :at, employee_id = :eid, offer_id = :oid, updatedBy = :person',
            ConditionExpression: `${bracket(mine.FilterExpression)} AND currentStage = :was`, ExpressionAttributeNames: mine.ExpressionAttributeNames,
            ExpressionAttributeValues: marshall({ ...mine.ExpressionAttributeValues, ':was': saga.currentStage, ':hired': 'HIRED', ':at': at, ':eid': employee.employee_id, ':oid': row.offer_id, ':person': ctx.personId }),
          },
        },
        { Put: { TableName: STATE(), Item: marshall(history, { removeUndefinedValues: true }), ConditionExpression: 'attribute_not_exists(PK)' } },
      ],
    }));
  } catch (e) {
    if (e?.name !== 'TransactionCanceledException' && e?.name !== 'ConditionalCheckFailedException') throw e;
    console.error('offers: accept cancelled', { offer_id: row.offer_id, error: e.name });
    // Another call may have finished the same accept just before this one: then answer as a repeat.
    const now = await loadOffer(ctx, row.offer_id);
    if (now && mapState(now.state) === 'ACCEPTED' && typeof now.employee_id === 'string' && now.employee_id !== '') return repeatAccepted(ctx, now);
    return conflict('STALE');
  }
  await finishFollowUps(ctx, accepted);
  return json(200, shape(accepted, ctx));
}

const EDITABLE = ['salary', 'start_date', 'expiry_date', 'benefits'];

/** PATCH /v1/offers/{id} (rule 15) */
async function editOffer(ctx, row, body, at) {
  const state = mapState(row.state);
  if (state !== 'DRAFT' && state !== 'APPROVED') return conflict('NOT_OPEN');
  if (!versionOk(body, row)) return conflict('STALE');
  const fields = EDITABLE.filter((f) => body[f] !== undefined);
  if (fields.length === 0) return bad('NO_FIELDS');
  if (body.salary !== undefined && !goodSalary(body.salary)) return badField('salary');
  if (body.start_date !== undefined && !futureDay(body.start_date)) return badField('start_date');
  if (body.expiry_date !== undefined && !futureDay(body.expiry_date)) return badField('expiry_date');
  if (body.benefits !== undefined && !goodBenefits(body.benefits)) return badField('benefits');
  const start = body.start_date ?? row.start_date;
  const expiry = body.expiry_date ?? row.expiry_date;
  if (expiry > start) return badField('expiry_date');
  const changes = Object.fromEntries(fields.map((f) => [f, body[f]]));
  const after = next(row, {
    ...changes, state: 'DRAFT', updated_at: at,
    approval_history: row.approval ? [...(row.approval_history ?? []), { ...row.approval, kind: 'CLEARED_BY_EDIT', cleared_at: at }] : row.approval_history ?? [],
    history: [...row.history, entry(ctx, state, 'DRAFT', at, { kind: 'EDITED', fields: [...fields].sort() })],
  });
  delete after.approval;
  return (await save(ctx, row, after)) ? json(200, shape(after, ctx)) : conflict('STALE');
}

// ---------------------------------------------------------------- expiry (rule 8), called by monitorTalentFlowSLAs

/**
 * SENT offers past their expiry date become EXPIRED by the system, once each. Companies with Recruitment off are skipped. `rows` are the
 * SENT offer rows monitorTalentFlowSLAs found in its hourly Scan. Writes are updates only (the job's role holds UpdateItem).
 */
export async function expireOffers(rows) {
  const day = today();
  let expired = 0;
  for (const row of rows) {
    if (!row.tenant_id || row.state !== 'SENT' || !row.expiry_date || !(day > row.expiry_date)) continue;
    if (!(await modulesOf(row.tenant_id)).includes('recruitment')) continue;
    const at = new Date().toISOString();
    const h = { from: 'SENT', to: 'EXPIRED', by: 'system', by_kind: 'system', by_name: null, at };
    try {
      await db.send(new TransactWriteItemsCommand({
        TransactItems: [
          {
            Update: {
              TableName: STATE(), Key: marshall(offerKey(row.offer_id)),
              UpdateExpression: 'SET #s = :exp, version = version + :one, answered_at = :at, updated_at = :at, history = list_append(history, :h)',
              ConditionExpression: '#s = :sent AND version = :v AND tenant_id = :t', ExpressionAttributeNames: { '#s': 'state' },
              ExpressionAttributeValues: marshall({ ':exp': 'EXPIRED', ':sent': 'SENT', ':one': 1, ':at': at, ':h': [h], ':v': row.version, ':t': row.tenant_id }),
            },
          },
          {
            Update: {
              TableName: STATE(), Key: marshall(lockKey(row.tenant_id, row.candidate_id)), UpdateExpression: 'REMOVE live_offer_id',
              ConditionExpression: 'live_offer_id = :id', ExpressionAttributeValues: marshall({ ':id': row.offer_id }),
            },
          },
        ],
      }));
    } catch (e) {
      if (e.name === 'TransactionCanceledException' || e.name === 'ConditionalCheckFailedException') continue;
      throw e;
    }
    await publish('OfferAnswered', { tenant_id: row.tenant_id, offer_id: row.offer_id, candidate_id: row.candidate_id, answer: 'EXPIRED' });
    expired += 1;
  }
  return expired;
}
