// INT-01: booking (POST) and the four actions (PATCH) of scheduleInterview.
import { randomBytes, createHash } from 'node:crypto';
import { DynamoDBClient, GetItemCommand, QueryCommand, TransactWriteItemsCommand } from '@aws-sdk/client-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import * as T from '../shared/tenant.mjs';
import * as RA from '../shared/recruitment-access.mjs';
import { requireModule } from '../shared/modules.mjs';
import { activeSettings, DEFAULTS } from '../shared/recruitment-settings.mjs';
import { normaliseStage } from '../shared/recruitment-stages.mjs';
import { companyOfSignIn } from '../shared/membership.mjs';
import * as L from '../shared/interview-lifecycle.mjs';
import * as K from './request-key.mjs';
import * as FD from '../shared/feedback-due-rows.mjs';
import { settingsForRead } from '../shared/recruitment-settings.mjs';
import * as E from '../shared/interview-emails.mjs';
import { contactOf, limited } from '../shared/people-contacts.mjs';
import { buildInvite } from '../shared/interview-invite.mjs';

const db = new DynamoDBClient({});
const eb = new EventBridgeClient({});
const sqs = new SQSClient({});
const STATE = () => process.env.STATE_TABLE_NAME;
const TTL_DAYS = 7;
const json = (statusCode, body) => ({ statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const bad = (field) => json(400, { error: 'Bad request', code: 'INVALID_FIELD', field });
const conflict = (code) => json(409, { error: 'Conflict', code });
// INT-01.F rule 5: an extra key's name goes back as written only when it looks like a plain field name.
const fieldOf = (k) => (/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(k) ? k : 'body');
const fail = () => json(500, { error: 'Internal error' });

class Answer extends Error { constructor(a) { super('answer'); this.answer = a; } }
const stop = (a) => { throw new Answer(a); };

async function publish(type, detail) {
  const entry = { EventBusName: process.env.EVENTBRIDGE_BUS_NAME, Source: 'talent-flow.interviews', DetailType: type, Detail: JSON.stringify(detail) };
  for (let i = 0; i < 2; i++) {
    try { await eb.send(new PutEventsCommand({ Entries: [entry] })); return; } catch { /* tried again once */ }
  }
  console.error('scheduleInterview: event not sent', { error: 'INTERVIEW_EVENT_NOT_SENT', eventType: type });
}
const detailOf = (iv, tenantId, actor, reason) => ({
  candidateId: iv.candidateId, tenant_id: tenantId, interviewId: iv.interviewId, interviewType: iv.interviewType, sequence: iv.sequence, actor, ...(reason ? { reason_code: reason } : {}),
});

async function getRow(PK, SK) {
  const r = await db.send(new GetItemCommand({ TableName: STATE(), Key: marshall({ PK, SK }), ConsistentRead: true }));
  return r.Item ? unmarshall(r.Item) : null;
}
async function rowsOf(candidateId, prefix) {
  const out = [];
  let ExclusiveStartKey;
  do {
    const r = await db.send(new QueryCommand({ TableName: STATE(), KeyConditionExpression: 'PK = :pk AND begins_with(SK, :p)', ExpressionAttributeValues: marshall({ ':pk': `CANDIDATE#${candidateId}`, ':p': prefix }), ConsistentRead: true, ExclusiveStartKey }));
    out.push(...(r.Items ?? []).map((i) => unmarshall(i)));
    ExclusiveStartKey = r.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return out;
}

/** The checks every write route makes first (R-8, R-22). Answers { tenantId, header, body } or throws an answer. */
async function front(event) {
  const notRecruiter = RA.requireRecruiter(event);
  if (notRecruiter) stop(notRecruiter);
  const t = T.requireTenant(event);
  if (t.refusal) stop(t.refusal);
  const off = await requireModule(event, 'recruitment');
  if (off) stop(off);
  if (!process.env.IDEMPOTENCY_TABLE) { console.error('scheduleInterview: refused', { error: 'NO_REQUEST_KEY_TABLE' }); stop(fail()); }
  const header = K.headerOf(event);
  if (!header) stop(bad('Idempotency-Key'));
  let body;
  try { body = typeof event.body === 'string' ? JSON.parse(event.body || '{}') : (event.body ?? {}); } catch { stop(bad('body')); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) stop(bad('body'));
  return { tenantId: t.tenantId, header, body, caller: RA.callerId(event) };
}

async function withKey(event, interviewId, run) {
  let f;
  try { f = await front(event); } catch (e) { if (e instanceof Answer) return e.answer; throw e; }
  const candidateId = event.pathParameters?.id;
  if (!candidateId) return T.notFound();
  // Another company's candidate is 404 before the key is written (TEN-03 AC-3: a 404 on another company's record writes nothing).
  try { await candidateOf(candidateId, f.tenantId); } catch (e) { if (e instanceof Answer) return e.answer; throw e; }
  const routeKey = event.routeKey || event.requestContext?.routeKey || `${event.requestContext?.http?.method}`;
  const r = await K.reserve({ tenantId: f.tenantId, routeKey, caller: f.caller, candidateId, interviewId, header: f.header, body: f.body });
  if (r.answer) return r.answer;
  let answer;
  try { answer = await run({ ...f, candidateId, newInterviewId: r.pendingInterviewId }); } catch (e) {
    if (e instanceof Answer) answer = e.answer;
    else { console.error('scheduleInterview: failed', { error: e?.name ?? 'Error' }); answer = fail(); }
  }
  return K.finish(r, answer);
}

async function candidateOf(candidateId, tenantId) {
  const saga = await getRow(`CANDIDATE#${candidateId}`, 'SAGA');
  if (!saga || !T.ownsRow(saga, tenantId)) stop(T.notFound());
  return saga;
}
async function panelOk(panel, tenantId, size) {
  if (!Array.isArray(panel) || panel.length < 1 || panel.length > size || new Set(panel).size !== panel.length || !panel.every((p) => typeof p === 'string' && p)) return false;
  for (const p of panel) if ((await companyOfSignIn(p)) !== tenantId) return false;
  return true;
}
const panelSizeOf = (settings, saga) => {
  const pc = settings.PANEL_CONFIG ?? DEFAULTS.PANEL_CONFIG;
  return pc?.rules?.votesRequired?.[saga.positionLevel] ?? pc?.panelSize?.[saga.positionLevel] ?? DEFAULTS.PANEL_CONFIG.panelSize[saga.positionLevel] ?? 3;
};
const switchOn = (settings) => (settings.PANEL_CONFIG ?? {}).interview_emails === 'ON';
const guestAllowed = (settings) => (settings.PANEL_CONFIG ?? DEFAULTS.PANEL_CONFIG).guestAllowed !== false;

function newLink(tenantId, iv, email, caller, atMs, nowMs) {
  const raw = randomBytes(32).toString('base64url');
  const hash = createHash('sha256').update(raw).digest('hex');
  const exp = new Date(atMs + TTL_DAYS * 86400000).toISOString();
  return {
    hash, raw,
    item: T.stampTenant({
      PK: `SCORING_LINK#${hash}`, SK: 'META', token_hash: hash, interview_id: iv.interviewId, candidate_id: iv.candidateId, guest_email: email, expires_at: exp,
      used_at: null, created_by: caller, created_at: new Date(nowMs).toISOString(), ttl: Math.floor(Date.parse(exp) / 1000) + 30 * 86400,
    }, tenantId),
  };
}
const linkSet = (hash, expiresIso) => ({ Update: { TableName: STATE(), Key: marshall({ PK: `SCORING_LINK#${hash}`, SK: 'META' }), UpdateExpression: 'SET expires_at = :e', ConditionExpression: 'attribute_exists(PK)', ExpressionAttributeValues: marshall({ ':e': expiresIso }) } });

const BOOK_KEYS = ['type', 'at', 'length_minutes', 'where', 'place', 'video_link', 'panel', 'guest_email', 'candidate_note'];

// ---------------------------------------------------------------- POST

export function book(event) {
  const late = emailClock();
  return withKey(event, undefined, async ({ tenantId, body, caller, candidateId, newInterviewId }) => {
    const extra = Object.keys(body).find((k) => !BOOK_KEYS.includes(k));
    if (extra !== undefined) return bad(fieldOf(extra));
    if (typeof body.type !== 'string' || !body.type) return bad('type');
    const atMs = L.timeOf(body.at);
    if (atMs === null) return bad('at');
    if (!L.isLength(body.length_minutes)) return bad('length_minutes');
    if (!['IN_PERSON', 'ONLINE'].includes(body.where)) return bad('where');
    if (body.where === 'IN_PERSON') {
      if (!L.isPlace(body.place)) return bad('place');
      if (body.video_link !== undefined) return bad('video_link');
    } else {
      if (!L.isVideoLink(body.video_link)) return bad('video_link');
      if (body.place !== undefined) return bad('place');
    }
    if (!Array.isArray(body.panel) || body.panel.length < 1) return bad('panel');
    if (body.guest_email !== undefined && !L.isEmail(body.guest_email)) return bad('guest_email');
    if (body.candidate_note !== undefined && !(typeof body.candidate_note === 'string' && body.candidate_note.length <= 1000)) return bad('candidate_note');
    const saga = await candidateOf(candidateId, tenantId);
    if (normaliseStage(saga) !== 'INTERVIEW') return conflict('NOT_ALLOWED_NOW');
    const settings = await activeSettings(tenantId);
    const types = (settings.INTERVIEW_TYPES ?? DEFAULTS.INTERVIEW_TYPES).types.map((x) => x.key);
    if (!types.includes(body.type)) return bad('type');
    if (!(await panelOk(body.panel, tenantId, panelSizeOf(settings, saga)))) return bad('panel');
    if (body.guest_email !== undefined && !guestAllowed(settings)) return bad('guest_email');
    const nowMs = Date.now();
    if (atMs <= nowMs) return json(400, { error: 'Bad request', code: 'AT_IN_PAST', field: 'at' });
    if (body.guest_email !== undefined && !switchOn(settings)) return conflict('GUEST_EMAIL_OFF');
    const existing = await rowsOf(candidateId, 'INTERVIEW#');
    if (existing.some((x) => T.ownsRow(x, tenantId) && x.interviewType === body.type && ['SCHEDULED', 'COMPLETED'].includes(x.status))) return conflict('TYPE_ALREADY_BOOKED');
    const guard = await getRow(`CANDIDATE#${candidateId}`, `IVTYPE#${body.type}`);
    const now = new Date(nowMs).toISOString();
    // The id was made when the request key was reserved (INT-01.F rule 3.6), so a take-over books the same id.
    const interviewId = newInterviewId;
    // REC-07: the role's criteria, else the company's default criteria.
    let criteria;
    if (saga.role_id && process.env.ROLES_TABLE_NAME) {
      const rr = await db.send(new GetItemCommand({ TableName: process.env.ROLES_TABLE_NAME, Key: marshall({ pk: `TENANT#${tenantId}`, sk: `ROLE#${saga.role_id}` }) }));
      const role = rr.Item ? unmarshall(rr.Item) : null;
      if (role && T.ownsRow(role, tenantId) && Array.isArray(role.criteria)) criteria = role.criteria.map((c) => ({ key: c.key, label: c.label }));
    }
    criteria ??= (settings.SCORING_WEIGHTS?.defaultCriteria ?? DEFAULTS.SCORING_WEIGHTS.defaultCriteria).map((c) => ({ key: c.key, label: c.label }));
    const iv = T.stampTenant({
      PK: `CANDIDATE#${candidateId}`, SK: `INTERVIEW#${interviewId}`, interviewId, candidateId, tenantId, interviewType: body.type, scheduledAt: new Date(atMs).toISOString(),
      panelMemberIds: body.panel, votesRequired: body.panel.length, votesSubmitted: 0, status: 'SCHEDULED', createdAt: now, criteria_snapshot: criteria,
      PANEL_FEEDBACK_PENDING_COUNT: body.panel.length, length_minutes: body.length_minutes, where: body.where,
      ...(body.where === 'IN_PERSON' ? { place: body.place } : { video_link: body.video_link }), ...(body.candidate_note !== undefined ? { candidate_note: body.candidate_note } : {}),
      sequence: 1, booked_by: caller, booked_at: now,
    }, tenantId);
    const items = [
      { Put: { TableName: STATE(), Item: marshall(T.stampTenant({ PK: iv.PK, SK: `IVTYPE#${body.type}`, interviewId, v: (guard?.v ?? 0) + 1 }, tenantId)), ConditionExpression: guard ? '#v = :v' : 'attribute_not_exists(PK)', ...(guard ? { ExpressionAttributeNames: { '#v': 'v' }, ExpressionAttributeValues: marshall({ ':v': guard.v }) } : {}) } },
    ];
    let guestLink = null;
    if (body.guest_email !== undefined) {
      const l = newLink(tenantId, iv, body.guest_email, caller, atMs, nowMs);
      guestLink = l;
      iv.guest_link_hash = l.hash;
      items.push({ Put: { TableName: STATE(), Item: marshall(l.item), ConditionExpression: 'attribute_not_exists(PK)' } });
    }
    items.push({ Put: { TableName: STATE(), Item: marshall(iv, { removeUndefinedValues: true }), ConditionExpression: 'attribute_not_exists(PK)' } });
    for (const p of body.panel) items.push(FD.openItem(STATE(), tenantId, p, candidateId, interviewId, now));
    try {
      await db.send(new TransactWriteItemsCommand({ TransactItems: items }));
    } catch (err) {
      if (err.name === 'TransactionCanceledException') return conflict('TYPE_ALREADY_BOOKED');
      throw err;
    }
    await mailAfter({ late, action: 'book', tenantId, saga, settings, before: null, after: iv, changes: [], guest: guestLink ? { raw: guestLink.raw, email: body.guest_email, expires: guestLink.item.expires_at } : null });
    await publish('INTERVIEW_BOOKED', detailOf(iv, tenantId, caller));
    return json(201, { interview_id: interviewId, status: 'SCHEDULED', sequence: 1 });
  });
}

// ---------------------------------------------------------------- PATCH

const ACTION_KEYS = {
  reschedule: ['action', 'at', 'length_minutes', 'where', 'place', 'video_link', 'panel', 'guest_email', 'reason_note'],
  cancel: ['action', 'reason', 'reason_note'], did_not_happen: ['action', 'reason', 'reason_note'], complete: ['action', 'reason', 'reason_note'],
};
const REASONS = { cancel: L.CANCEL_REASONS, did_not_happen: L.DNH_REASONS, complete: L.DONE_REASONS };
const CLOSED = { cancel: 'CANCELLED', did_not_happen: 'DID_NOT_HAPPEN', complete: 'COMPLETED' };
const EVENT = { reschedule: 'INTERVIEW_RESCHEDULED', cancel: 'INTERVIEW_CANCELLED', did_not_happen: 'INTERVIEW_DID_NOT_HAPPEN', complete: 'INTERVIEW_MARKED_DONE' };

export function act(event) {
  const late = emailClock();
  const interviewId = event.pathParameters?.interviewId;
  return withKey(event, interviewId, async ({ tenantId, body, caller, candidateId }) => {
    const action = body.action;
    if (typeof action !== 'string' || !ACTION_KEYS[action]) return bad('action');
    if (action === 'reschedule' && body.type !== undefined) return bad('type');
    const extra = Object.keys(body).find((k) => !ACTION_KEYS[action].includes(k));
    if (extra !== undefined) return bad(fieldOf(extra));
    if (action !== 'reschedule') {
      if (!REASONS[action].includes(body.reason)) return bad('reason');
      if (body.reason === 'OTHER' ? !L.isNote(body.reason_note, 500) : body.reason_note !== undefined && !L.isNote(body.reason_note, 500)) return bad('reason_note');
    } else {
      if (body.at !== undefined && L.timeOf(body.at) === null) return bad('at');
      if (body.length_minutes !== undefined && !L.isLength(body.length_minutes)) return bad('length_minutes');
      if (body.where !== undefined && !['IN_PERSON', 'ONLINE'].includes(body.where)) return bad('where');
      if (body.place !== undefined && !L.isPlace(body.place)) return bad('place');
      if (body.video_link !== undefined && !L.isVideoLink(body.video_link)) return bad('video_link');
      if (body.panel !== undefined && (!Array.isArray(body.panel) || body.panel.length < 1)) return bad('panel');
      if (body.guest_email !== undefined && body.guest_email !== null && !L.isEmail(body.guest_email)) return bad('guest_email');
      if (body.reason_note !== undefined && !L.isNote(body.reason_note, 500)) return bad('reason_note');
    }
    if (!interviewId) return T.notFound();
    const iv = await getRow(`CANDIDATE#${candidateId}`, `INTERVIEW#${interviewId}`);
    if (!iv || !T.ownsRow(iv, tenantId)) return T.notFound();
    const saga = await candidateOf(candidateId, tenantId);
    const nowMs = Date.now();
    const now = new Date(nowMs).toISOString();
    const settings = await activeSettings(tenantId);
    const votes = await rowsOf(candidateId, 'VOTE#');
    const ctx = { now: nowMs, stage: normaliseStage(saga), votes };

    const names = { '#s': 'status', '#q': 'sequence' };
    const values = { ':t': tenantId, ':sch': 'SCHEDULED' };
    let cond = 'tenant_id = :t AND #s = :sch';
    if (L.isNewWay(iv)) { cond += ' AND #q = :q'; values[':q'] = iv.sequence; } else cond += ' AND attribute_not_exists(#q)';
    if (iv.votesSubmitted !== undefined) { cond += ' AND votesSubmitted = :vs'; values[':vs'] = iv.votesSubmitted; } else cond += ' AND attribute_not_exists(votesSubmitted)';
    const sets = [];
    const removes = [];
    const set = (k, v) => { const n = `#f${sets.length}`; names[n] = k; values[`:f${sets.length}`] = v; sets.push(`${n} = :f${sets.length}`); };
    const items = [];
    const after = { ...iv };
    let seq = L.isNewWay(iv) ? iv.sequence : 1;
    let mailCtx = null;
    let moveItem = null;
    let newGuestRaw;

    if (action === 'reschedule') {
      const where = body.where ?? iv.where;
      if (body.where === 'IN_PERSON') { if (body.place === undefined) return bad('place'); if (body.video_link !== undefined) return bad('video_link'); }
      if (body.where === 'ONLINE') { if (body.video_link === undefined) return bad('video_link'); if (body.place !== undefined) return bad('place'); }
      if (body.where === undefined) { if (body.place !== undefined && where !== 'IN_PERSON') return bad('place'); if (body.video_link !== undefined && where !== 'ONLINE') return bad('video_link'); }
      if (body.panel !== undefined && !(await panelOk(body.panel, tenantId, panelSizeOf(settings, saga)))) return bad('panel');
      if (typeof body.guest_email === 'string' && !guestAllowed(settings)) return bad('guest_email');
      const atMs = body.at !== undefined ? L.timeOf(body.at) : Date.parse(iv.scheduledAt);
      const atIso = new Date(atMs).toISOString();
      const link = iv.guest_link_hash ? await getRow(`SCORING_LINK#${iv.guest_link_hash}`, 'META') : null;
      const changes = [];
      if (body.at !== undefined && atIso !== iv.scheduledAt) changes.push('at');
      if (body.length_minutes !== undefined && body.length_minutes !== iv.length_minutes) changes.push('length');
      if (body.where !== undefined && body.where !== iv.where) changes.push('where');
      if (body.place !== undefined && body.place !== iv.place) changes.push('place');
      if (body.video_link !== undefined && body.video_link !== iv.video_link) changes.push('link');
      if (body.panel !== undefined && JSON.stringify(body.panel) !== JSON.stringify(iv.panelMemberIds)) changes.push('panel');
      const guestNow = link?.guest_email ?? null;
      if (body.guest_email !== undefined && (body.guest_email ?? null) !== (iv.guest_link_hash ? guestNow : null)) changes.push('guest');
      if (!changes.length) return bad('action');
      if (body.at !== undefined && atMs <= nowMs) return json(400, { error: 'Bad request', code: 'AT_IN_PAST', field: 'at' });
      if (typeof body.guest_email === 'string' && changes.includes('guest') && !switchOn(settings)) return conflict('GUEST_EMAIL_OFF');
      const no = L.refusalOf('reschedule', iv, ctx);
      if (no) return conflict(no);
      seq = L.isNewWay(iv) ? iv.sequence + 1 : 1;
      if (changes.includes('at')) { set('scheduledAt', atIso); after.scheduledAt = atIso; }
      if (body.length_minutes !== undefined) set('length_minutes', body.length_minutes);
      if (body.where !== undefined) set('where', body.where);
      if (body.place !== undefined) set('place', body.place);
      if (body.video_link !== undefined) set('video_link', body.video_link);
      if (where === 'ONLINE' && iv.place !== undefined && body.place === undefined) removes.push('place');
      if (where === 'IN_PERSON' && iv.video_link !== undefined && body.video_link === undefined) removes.push('video_link');
      // INT-01.F rule 1: the latest reschedule's removed people, server-only (never in an answer, the read, the event or a log line).
      const removedPanel = body.panel !== undefined ? (iv.panelMemberIds ?? []).filter((p) => !body.panel.includes(p)) : [];
      if (removedPanel.length) set('removed_panel_ids', removedPanel); else removes.push('removed_panel_ids');
      let removedGuest = false;
      if (body.panel !== undefined) { set('panelMemberIds', body.panel); set('votesRequired', body.panel.length); set('PANEL_FEEDBACK_PENDING_COUNT', body.panel.length); }
      if (changes.includes('panel')) {
        for (const p of body.panel) items.push(FD.openItem(STATE(), tenantId, p, candidateId, iv.interviewId, now));
        for (const p of removedPanel) items.push(FD.doneItem(STATE(), tenantId, p, candidateId, iv.interviewId, 'REMOVED', now));
      }
      if (body.reason_note !== undefined) set('reschedule_note', body.reason_note);
      if (changes.includes('guest')) {
        if (iv.guest_link_hash) { items.push(linkSet(iv.guest_link_hash, now)); set('removed_guest_link_hash', iv.guest_link_hash); removedGuest = true; }
        if (typeof body.guest_email === 'string') {
          const l = newLink(tenantId, after, body.guest_email, caller, atMs, nowMs);
          newGuestRaw = l.raw;
          items.push({ Put: { TableName: STATE(), Item: marshall(l.item), ConditionExpression: 'attribute_not_exists(PK)' } });
          set('guest_link_hash', l.hash);
        } else removes.push('guest_link_hash');
      } else if (iv.guest_link_hash && changes.includes('at')) moveItem = linkSet(iv.guest_link_hash, new Date(atMs + TTL_DAYS * 86400000).toISOString());
      if (!removedGuest) removes.push('removed_guest_link_hash');
      if (removedPanel.length || removedGuest) set('removed_at_sequence', seq); else removes.push('removed_at_sequence');
      Object.assign(after, { scheduledAt: atIso, sequence: seq, where });
      if (body.length_minutes !== undefined) after.length_minutes = body.length_minutes;
      if (body.place !== undefined) after.place = body.place;
      if (body.video_link !== undefined) after.video_link = body.video_link;
      if (where === 'ONLINE' && body.place === undefined) delete after.place;
      if (where === 'IN_PERSON' && body.video_link === undefined) delete after.video_link;
      if (body.panel !== undefined) after.panelMemberIds = body.panel;
      const ownLink = link && T.ownsRow(link, tenantId) ? link : null;
      mailCtx = { changes, removedPanel, oldGuest: changes.includes('guest') ? ownLink : null, reasonNote: body.reason_note };
      if (changes.includes('guest') && typeof body.guest_email === 'string') mailCtx.newGuest = { raw: newGuestRaw, email: body.guest_email, expires: new Date(atMs + TTL_DAYS * 86400000).toISOString() };
      // INT-04 rule 2a / D-INT-04.2: a kept guest gets a fresh link only when their E4G is sure to build.
      if (iv.guest_link_hash && !changes.includes('guest') && switchOn(settings) && ownLink) {
        const pre = await keptGuestMail({ late, tenantId, saga, settings, iv, after, changes, link: ownLink, caller, atMs, nowMs, reasonNote: body.reason_note });
        if (pre.message) {
          moveItem = null;
          items.push(linkSet(iv.guest_link_hash, now));
          items.push({ Put: { TableName: STATE(), Item: marshall(pre.link.item), ConditionExpression: 'attribute_not_exists(PK)' } });
          set('guest_link_hash', pre.link.hash);
          mailCtx.keptGuestMessage = pre.message;
        } else mailCtx.keptGuestSkip = pre.skip;
      }
      if (moveItem) items.push(moveItem);
    } else {
      const no = L.refusalOf(action, iv, ctx);
      if (no) return conflict(no);
      if (action === 'cancel') { cond += ' AND scheduledAt > :now'; seq = L.isNewWay(iv) ? iv.sequence + 1 : 1; } else cond += ' AND scheduledAt <= :now';
      values[':now'] = now;
      set('status', CLOSED[action]);
      set('closed_reason', body.reason);
      if (body.reason_note !== undefined) set('closed_note', body.reason_note);
      set('closed_by', caller);
      set('closed_at', now);
      if (action === 'complete') set('completedAt', now);
      const guest = L.guestVoterOf(iv);
      const guestScored = guest && votes.some((v) => v.voterId === guest && v.interviewId === iv.interviewId);
      if (iv.guest_link_hash && !(action === 'complete' && guestScored)) items.push(linkSet(iv.guest_link_hash, now));
      for (const p of iv.panelMemberIds ?? []) items.push(FD.doneItem(STATE(), tenantId, p, candidateId, iv.interviewId, CLOSED[action], now));
      if (action === 'cancel') {
        const link = iv.guest_link_hash ? await getRow(`SCORING_LINK#${iv.guest_link_hash}`, 'META') : null;
        mailCtx = { cancelGuest: link && T.ownsRow(link, tenantId) ? link : null, reason: body.reason, reasonNote: body.reason_note };
      }
    }
    set('sequence', seq);
    after.sequence = seq;
    const update = {
      Update: {
        TableName: STATE(), Key: marshall({ PK: iv.PK, SK: iv.SK }), UpdateExpression: `SET ${sets.join(', ')}${removes.length ? ` REMOVE ${removes.join(', ')}` : ''}`,
        ConditionExpression: cond, ExpressionAttributeNames: names, ExpressionAttributeValues: marshall(values, { removeUndefinedValues: true }),
      },
    };
    try {
      await db.send(new TransactWriteItemsCommand({ TransactItems: [update, ...items] }));
    } catch (err) {
      if (err.name !== 'TransactionCanceledException') throw err;
      const again = await getRow(iv.PK, iv.SK);
      const votes2 = await rowsOf(candidateId, 'VOTE#');
      return conflict(L.refusalOf(action, again, { ...ctx, votes: votes2 }) ?? 'NOT_ALLOWED_NOW');
    }
    if (mailCtx) await mailAfter({ late, action, tenantId, saga, settings, before: iv, after, ...mailCtx });
    await publish(EVENT[action], detailOf(after, tenantId, caller, action === 'reschedule' ? undefined : body.reason));
    return json(200, { interview_id: iv.interviewId, status: action === 'reschedule' ? 'SCHEDULED' : CLOSED[action], sequence: seq });
  });
}

// ---------------------------------------------------------------- INT-04 emails

// Rule 2c: the whole email step stops starting new work 12 seconds after the handler started. performance.now() moves in tests that freeze Date.
const BUDGET_MS = 12000;
const emailClock = () => { const t0 = performance.now(); return () => performance.now() - t0 >= BUDGET_MS; };
const TENANTS = () => process.env.TENANTS_TABLE;

async function companyName(tenantId) {
  try {
    // A Query, not a GetItem: the role may Query the company table (the Member rows) and has no GetItem on it.
    const r = await db.send(new QueryCommand({ TableName: TENANTS(), KeyConditionExpression: 'pk = :pk AND sk = :sk', ExpressionAttributeValues: marshall({ ':pk': `TENANT#${tenantId}`, ':sk': 'PROFILE' }), Limit: 1 }));
    const row = r.Items?.[0] ? unmarshall(r.Items[0]) : null;
    return row && row.tenant_id === tenantId ? E.oneLine(row.name) : '';
  } catch (err) { console.warn(JSON.stringify({ event: 'interview_emails_company_read_failed', error: err?.name ?? 'Error' })); return ''; }
}

/** What every email of one action needs. Answers { ctx } or { skip: <code> } (a code that stops every email of the action). */
async function mailBase(tenantId, saga, settings, row, late) {
  if (!switchOn(settings)) return { skip: 'EMAILS_OFF' };
  if (!L.isNewWay(row) || row.length_minutes === undefined || !row.where) return { skip: 'OLD_INTERVIEW' };
  const front = process.env.FRONTEND_URL;
  const organiser = process.env.INTERVIEW_ORGANISER_EMAIL;
  if (!front || !organiser || !E.EMAIL_PATTERN.test(organiser)) return { skip: 'SETTING_MISSING' };
  const first = E.oneLine(saga.firstName);
  const last = E.oneLine(saga.lastName);
  if (!first || !last) return { skip: 'NO_CANDIDATE_NAME' };
  const role = E.oneLine(saga.positionTitle);
  if (!role) return { skip: 'NO_ROLE' };
  if (late()) return { skip: 'NOT_QUEUED' };
  const booker = await contactOf(tenantId, row.booked_by);
  if (!booker) return { skip: 'NO_BOOKER' };
  const company = await companyName(tenantId);
  let typeLists = [settings.INTERVIEW_TYPES];
  try { const r = await settingsForRead(tenantId, saga); typeLists = [r.settings.INTERVIEW_TYPES, r.active.INTERVIEW_TYPES]; } catch { /* the active list */ }
  const type = E.typeLabelOf(row.interviewType, [...typeLists, DEFAULTS.INTERVIEW_TYPES]);
  const candEmail = typeof saga.email === 'string' ? saga.email.trim() : '';
  return { ctx: { tenantId, front: front.replace(/\/+$/, ''), organiser, booker, company, type, role, cand: { first_name: first, last_name: last, email: candEmail }, candidateSwitch: (settings.PANEL_CONFIG ?? {}).candidate_interview_emails === 'ON' } };
}

const told = (row) => ({ at: row.scheduledAt, length_minutes: row.length_minutes, where: row.where, place: row.place, video_link: row.video_link });
function valuesOf(ctx, t, extra = {}) {
  return {
    candidate: `${ctx.cand.first_name} ${ctx.cand.last_name}`, first_name: ctx.cand.first_name, role: ctx.role, company: ctx.company, type: ctx.type,
    date: E.dateOf(t.at), time: E.timeOf(t.at), zone: E.ZONE, length: E.lengthOf(t.length_minutes), where: t.where, place: t.place, video_link: t.video_link, ...extra,
  };
}

/** One message, or { skip }. */
function build(ctx, job) {
  const rendered = E.render(job.template, job.values);
  let invite;
  try {
    invite = buildInvite({
      audience: job.audience, method: job.method, now: new Date(), company: { tenant_id: ctx.tenantId },
      interview: { tenant_id: ctx.tenantId, interview_id: job.interviewId, at: job.file.at, length_minutes: job.file.length_minutes, sequence: job.sequence, where: job.file.where, place: job.file.place, video_link: job.file.video_link },
      organiser: { first_name: ctx.booker.first_name, last_name: ctx.booker.last_name, email: ctx.organiser },
      candidate: { tenant_id: ctx.tenantId, ...ctx.cand },
      panel: (job.panel ?? []).map((p) => ({ tenant_id: ctx.tenantId, person_id: p.id, first_name: p.first_name, last_name: p.last_name, email: p.email })),
      ...(job.guestEmail ? { guest: { tenant_id: ctx.tenantId, email: job.guestEmail } } : {}),
      text: { summary: rendered.subject, description: job.method === 'CANCEL' ? '' : E.detailsText(job.values) },
    });
  } catch (err) {
    return { skip: err?.name === 'InviteError' ? `INVITE_${err.code}` : 'INVITE_ERROR' };
  }
  return { message: E.messageOf({ tenantId: ctx.tenantId, interviewId: job.interviewId, candidateId: job.candidateId, sequence: job.sequence, template: job.template, who: job.who, recipientEmail: job.email, replyTo: E.CANDIDATE_TEMPLATES.includes(job.template) ? ctx.booker.email : undefined, rendered, invite }) };
}

async function queue(message, candidateId, late) {
  for (let i = 0; i < 2; i++) {
    if (late()) return false;
    try {
      await sqs.send(new SendMessageCommand({ QueueUrl: process.env.NOTIFICATION_QUEUE_URL, MessageGroupId: candidateId, MessageDeduplicationId: message.email_id, MessageBody: JSON.stringify(message) }));
      return true;
    } catch { /* tried again once */ }
  }
  return false;
}

/** Rule 2a: the kept guest's E4G, built before the transaction. Answers { message, link } or { skip }. */
async function keptGuestMail({ late, tenantId, saga, settings, iv, after, changes, link, caller, atMs, nowMs, reasonNote }) {
  const b = await mailBase(tenantId, saga, settings, after, late);
  if (b.skip) return { skip: b.skip };
  const ctx = b.ctx;
  if (!ctx.company) return { skip: 'NO_COMPANY_NAME' };
  const email = typeof link.guest_email === 'string' ? link.guest_email.trim() : '';
  if (!E.EMAIL_PATTERN.test(email)) return { skip: 'PERSON_NOT_FOUND' };
  const l = newLink(tenantId, after, email, caller, atMs, nowMs);
  const values = valuesOf(ctx, told(after), { link: `${ctx.front}/score#token=${l.raw}`, expires: E.whenOf(l.item.expires_at), what_changed: E.whatChanged(changes, after.where, false), reason: reasonNote });
  const m = build(ctx, { template: 'E4G', audience: 'GUEST', method: 'REQUEST', interviewId: iv.interviewId, candidateId: iv.candidateId, sequence: after.sequence, who: 'GUEST', email, guestEmail: email, file: told(after), values });
  if (m.skip) return { skip: m.skip };
  return { message: m.message, link: l };
}

/** Rule 2b: every other email of the action, after the write. Never changes the answer. */
async function mailAfter(a) {
  const late = a.late;
  const skipped = {};
  const skip = (code, n = 1) => { skipped[code] = (skipped[code] ?? 0) + n; };
  let queued = 0;
  const row = a.after;
  const log = () => console.info(JSON.stringify({ event: 'interview_emails', queued, skipped }));
  try {
    if (a.action !== 'book' && a.action !== 'reschedule' && a.action !== 'cancel') return;
    const b = await mailBase(a.tenantId, a.saga, a.settings, a.action === 'cancel' ? a.before : row, late);
    if (b.skip) {
      skip(b.skip);
      if (a.keptGuestSkip && a.keptGuestSkip !== b.skip) skip(a.keptGuestSkip);
      // M-1: the old guest link is already stopped, so the new one must still go out.
      if (a.keptGuestMessage) { if (await queue(a.keptGuestMessage, row.candidateId, late)) queued++; else skip('NOT_QUEUED'); }
      return;
    }
    const ctx = b.ctx;
    const ids = [...new Set([...(row.panelMemberIds ?? []), ...(a.removedPanel ?? [])])];
    const looked = await limited(ids, 5, late, (id) => contactOf(a.tenantId, id));
    const person = new Map();
    ids.forEach((id, i) => person.set(id, looked[i]));
    const panelNow = (row.panelMemberIds ?? []).map((id) => person.get(id)?.value).filter(Boolean);
    const names = E.joinNames(panelNow.map((p) => p.first_name));
    const jobs = [];
    const base = { interviewId: row.interviewId, candidateId: row.candidateId, sequence: row.sequence };
    const forPerson = (id, job) => {
      const p = person.get(id);
      if (!p || p.late) { skip('NOT_QUEUED'); return; }
      if (!p.value) { skip('PERSON_NOT_FOUND'); return; }
      jobs.push({ ...base, ...job, who: id, email: p.value.email, values: { ...job.values, recipient_first_name: p.value.first_name } });
    };
    const noCompany = () => { if (!ctx.company) { skip('NO_COMPANY_NAME'); return true; } return false; };
    const candidate = (template, values, file, method) => {
      if (!ctx.candidateSwitch) { skip('CANDIDATE_EMAILS_OFF'); return; }
      if (noCompany()) return;
      if (!E.EMAIL_PATTERN.test(ctx.cand.email)) { skip('PERSON_NOT_FOUND'); return; }
      jobs.push({ ...base, template, audience: 'CANDIDATE', method, who: 'CANDIDATE', email: ctx.cand.email, file, values });
    };
    const guest = (template, g, values, file, method) => {
      if (noCompany()) return;
      const email = typeof g.email === 'string' ? g.email.trim() : '';
      if (!E.EMAIL_PATTERN.test(email)) { skip('PERSON_NOT_FOUND'); return; }
      jobs.push({ ...base, template, audience: 'GUEST', method, who: 'GUEST', email, guestEmail: email, file, values });
    };
    const now = told(row);
    if (a.action === 'book') {
      const v = valuesOf(ctx, now);
      for (const id of row.panelMemberIds) forPerson(id, { template: 'E1', audience: 'PANEL', method: 'REQUEST', file: now, panel: panelNow, values: { ...v, link: `${ctx.front}/hire/feedback/${row.interviewId}` } });
      if (a.guest) guest('E2', a.guest, { ...v, link: `${ctx.front}/score#token=${a.guest.raw}`, expires: E.whenOf(a.guest.expires) }, now, 'REQUEST');
      candidate('E3', { ...v, panel_first_names: names, note: row.candidate_note }, now, 'REQUEST');
    } else if (a.action === 'reschedule') {
      const before = told(a.before);
      const v = valuesOf(ctx, now);
      const panelWhat = E.whatChanged(a.changes, row.where, false);
      const oldPanel = a.before.panelMemberIds ?? [];
      for (const id of row.panelMemberIds) {
        if (oldPanel.includes(id)) forPerson(id, { template: 'E4P', audience: 'PANEL', method: 'REQUEST', file: now, panel: panelNow, values: { ...v, what_changed: panelWhat, reason: a.reasonNote } });
        else forPerson(id, { template: 'E1', audience: 'PANEL', method: 'REQUEST', file: now, panel: panelNow, values: { ...v, link: `${ctx.front}/hire/feedback/${row.interviewId}` } });
      }
      const vOld = valuesOf(ctx, before);
      for (const id of a.removedPanel ?? []) {
        const p = person.get(id)?.value;
        forPerson(id, { template: 'E6P', audience: 'PANEL', method: 'CANCEL', file: before, panel: p ? [p] : [], values: vOld });
      }
      if (a.keptGuestMessage) jobs.push({ ...base, prebuilt: a.keptGuestMessage });
      else if (a.keptGuestSkip) skip(a.keptGuestSkip);
      if (a.oldGuest) guest('E6G', { email: a.oldGuest.guest_email }, vOld, before, 'CANCEL');
      if (a.newGuest) guest('E2', a.newGuest, { ...v, link: `${ctx.front}/score#token=${a.newGuest.raw}`, expires: E.whenOf(a.newGuest.expires) }, now, 'REQUEST');
      const candWhat = E.whatChanged(a.changes, row.where, true);
      if (candWhat || a.changes.includes('panel')) candidate('E4C', { ...v, what_changed: candWhat, panel_first_names: a.changes.includes('panel') ? names : '' }, now, 'REQUEST');
    } else {
      const before = told(a.before);
      const v = valuesOf(ctx, before);
      const reason = a.reason === 'OTHER' ? a.reasonNote : E.CANCEL_LABELS[a.reason];
      for (const id of row.panelMemberIds) forPerson(id, { template: 'E5P', audience: 'PANEL', method: 'CANCEL', file: before, panel: panelNow, values: { ...v, reason } });
      if (a.cancelGuest) guest('E5G', { email: a.cancelGuest.guest_email }, { ...v, reason }, before, 'CANCEL');
      candidate('E5C', v, before, 'CANCEL');
    }
    for (const job of jobs) {
      const m = job.prebuilt ? { message: job.prebuilt } : build(ctx, job);
      if (m.skip) { skip(m.skip); continue; }
      if (await queue(m.message, row.candidateId, late)) queued++; else skip('NOT_QUEUED');
    }
  } catch (err) {
    skip('NOT_QUEUED');
    console.error(JSON.stringify({ event: 'interview_emails_failed', error: err?.name ?? 'Error' }));
  } finally {
    log();
  }
}
