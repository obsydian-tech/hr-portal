import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ICAL from 'ical.js';
import { REPO } from '../rec-14/lambda-harness';

/**
 * INT-02 test world: one booking of Sunbird Bakery (company A), a look-alike company B, and helpers that read an invite file
 * as raw lines, as unfolded lines and through ical.js. Test data only; nothing here is a word a person will read.
 */

export const FILE = join(REPO, 'lambda', 'shared', 'interview-invite.mjs');
export const A = 'tenant-a-sunbird-0001';
export const B = 'tenant-b-other-0002';
export const ID = 'INT_01JD7Q2V9K-a';
export const NOW = new Date('2026-11-25T10:00:00Z');

export type Audience = 'PANEL' | 'GUEST' | 'CANDIDATE';
export type Method = 'REQUEST' | 'CANCEL';
export const AUDIENCES: Audience[] = ['PANEL', 'GUEST', 'CANDIDATE'];
export const METHODS: Method[] = ['REQUEST', 'CANCEL'];

/** The company's sending address (D-INT-8). Never a person's own address. */
export const SENDER = 'hiring@sunbird.test';
export const ORGANISER = { first_name: 'Pieter', last_name: 'van Wyk', email: SENDER };
/** Panel: P-1 is the organiser's own person (AC-2), with a personal address that must never reach the candidate. */
export const PANEL = [
  { tenant_id: A, person_id: 'P-1', first_name: 'Pieter', last_name: 'van Wyk', email: 'pieter.vanwyk@sunbird.test' },
  { tenant_id: A, person_id: 'P-2', first_name: 'Thandiwe', last_name: 'Nkosi', email: 'thandiwe.nkosi@sunbird.test' },
  { tenant_id: A, person_id: 'P-3', first_name: 'Zoë', last_name: 'Botha', email: 'zoe.botha@sunbird.test' },
];
export const PANEL_EMAILS = [...PANEL.map((p) => p.email)];
export const CANDIDATE = { tenant_id: A, first_name: 'Lerato', last_name: 'Mokoena', email: 'lerato.mokoena@example.test' };
export const SCORING_URL = 'https://x.test/score#token=abc';
export const GUEST = { tenant_id: A, email: 'sam.reviewer@partner.test', name: 'Sam Reviewer', scoring_url: SCORING_URL, token: 'abc' };
export const TEXT = { summary: 'S-MARK-7731', description: 'D-MARK-4402' };
export const PLACE = 'Sunbird Bakery, 12 Long Street; Room 2';
export const VIDEO = 'https://meet.example.test/int-02-room?pwd=Q7x';

export type Input = Record<string, any>;

/** A whole, valid input. `over` replaces top-level fields; use `del`/`set` for nested ones. */
export function input(audience: Audience = 'PANEL', method: Method = 'REQUEST', over: Input = {}): Input {
  return {
    audience,
    method,
    now: new Date(NOW.getTime()),
    company: { tenant_id: A },
    interview: {
      tenant_id: A, interview_id: ID, at: '2026-12-03T09:00:00+02:00', length_minutes: 45, sequence: 1,
      where: 'IN_PERSON', place: PLACE,
    },
    organiser: { ...ORGANISER },
    candidate: { ...CANDIDATE },
    panel: PANEL.map((p) => ({ ...p })),
    guest: { ...GUEST },
    text: { ...TEXT },
    ...over,
  };
}

/** The same booking, every row and the company switched to `tenant`. */
export function inputFor(tenant: string, audience: Audience = 'PANEL', method: Method = 'REQUEST'): Input {
  const i = input(audience, method);
  i['company'].tenant_id = tenant;
  i['interview'].tenant_id = tenant;
  i['candidate'].tenant_id = tenant;
  for (const p of i['panel']) p.tenant_id = tenant;
  i['guest'].tenant_id = tenant;
  return i;
}

/** Set a nested field by path, `undefined` deletes it ('interview.length_minutes', 'panel.1.email'). */
export function set(i: Input, path: string, value: unknown): Input {
  const keys = path.split('.');
  let o: any = i;
  for (const k of keys.slice(0, -1)) o = o[k];
  const last = keys[keys.length - 1]!;
  if (value === undefined) delete o[last];
  else o[last] = value;
  return i;
}

// ---------------------------------------------------------------- loading the function

export type Built = { filename: string; contentType: string; body: string };
type Mod = { buildInvite: (input: Input) => Built };
let mod: Promise<Mod> | undefined;
/** The module under test. On develop before the build it does not exist, so every test fails here. */
export async function load(): Promise<Mod> {
  if (!existsSync(FILE)) throw new Error(`lambda/shared/interview-invite.mjs does not exist yet (INT-02 not built)`);
  mod ??= import(pathToFileURL(FILE).href) as Promise<Mod>;
  const m = await mod;
  if (typeof m.buildInvite !== 'function') throw new Error('interview-invite.mjs has no export buildInvite');
  return m;
}

export async function build(i: Input): Promise<Built> {
  const { buildInvite } = await load();
  const out = buildInvite(i);
  if (!out || typeof out.body !== 'string') throw new Error(`buildInvite returned no body: ${JSON.stringify(out)?.slice(0, 200)}`);
  return out;
}

/** What a call did: the error's class name and code when it threw, or 'RETURNED' when it gave something back. */
export async function outcome(i: Input): Promise<{ threw: boolean; cls?: string; code?: unknown; returned?: unknown }> {
  const { buildInvite } = await load();
  try {
    const returned = buildInvite(i);
    return { threw: false, returned };
  } catch (e: any) {
    return { threw: true, cls: e?.constructor?.name, code: e?.code };
  }
}

// ---------------------------------------------------------------- reading a file

/** Physical lines as byte buffers, split on CRLF. `endsInCrlf` false when the body does not end in CRLF. */
export function physical(body: string): { lines: Buffer[]; endsInCrlf: boolean; bareCrOrLf: boolean } {
  const bytes = Buffer.from(body, 'utf8');
  const lines: Buffer[] = [];
  let start = 0;
  let bare = false;
  for (let k = 0; k < bytes.length; k++) {
    if (bytes[k] === 0x0d && bytes[k + 1] === 0x0a) { lines.push(bytes.subarray(start, k)); start = k + 2; k++; continue; }
    if (bytes[k] === 0x0d || bytes[k] === 0x0a) bare = true;
  }
  const endsInCrlf = start === bytes.length;
  if (!endsInCrlf) lines.push(bytes.subarray(start));
  return { lines, endsInCrlf, bareCrOrLf: bare };
}

/** Content lines after unfolding (RFC 5545 §3.1: CRLF followed by one space or tab is removed). */
export function unfold(body: string): string[] {
  return body.replace(/\r\n[ \t]/g, '').split('\r\n').filter((l, k, all) => !(k === all.length - 1 && l === ''));
}

/** The property name of a content line (before the first `;` or `:`). */
export const nameOf = (line: string) => line.split(/[;:]/, 1)[0]!;

/** Parsed with ical.js: the calendar and its one event. Throws when ical.js cannot read it. */
export function parse(body: string): { cal: ICAL.Component; ev: ICAL.Component } {
  const cal = new ICAL.Component(ICAL.parse(body) as any);
  const events = cal.getAllSubcomponents('vevent');
  if (events.length !== 1) throw new Error(`expected one VEVENT, found ${events.length}`);
  return { cal, ev: events[0]! };
}

export type Person = { email: string; cn: string | null };
const personOf = (p: ICAL.Property): Person => {
  const v = String(p.getFirstValue());
  const cn = p.getParameter('cn');
  return { email: v.replace(/^mailto:/i, '').toLowerCase(), cn: cn === undefined || cn === null ? null : String(cn) };
};
export const attendeesOf = (body: string): Person[] => parse(body).ev.getAllProperties('attendee').map(personOf);
export const organisersOf = (body: string): Person[] => parse(body).ev.getAllProperties('organizer').map(personOf);
export const valueOf = (body: string, name: string): string | null => {
  const v = parse(body).ev.getFirstPropertyValue(name.toLowerCase());
  return v === null || v === undefined ? null : String(v);
};
export const calValueOf = (body: string, name: string): string | null => {
  const v = parse(body).cal.getFirstPropertyValue(name.toLowerCase());
  return v === null || v === undefined ? null : String(v);
};

/** The unfolded content line(s) starting with `NAME:` or `NAME;`. */
export const linesNamed = (body: string, name: string) => unfold(body).filter((l) => nameOf(l) === name);

/** The text of the whole file, unfolded and lower-cased, for string searches. */
export const flat = (body: string) => unfold(body).join('\n').toLowerCase();

/** Rule 5: the UID one interview of one company must have. */
export const uidFor = (tenant: string, id: string) => `${createHash('sha256').update(`${tenant}:${id}`, 'utf8').digest('hex').slice(0, 32)}@naleko-people`;

/** Every physical line decodes as UTF-8 on its own (no character cut in two). */
export function validUtf8(line: Buffer): boolean {
  try { new TextDecoder('utf-8', { fatal: true }).decode(line); return true; } catch { return false; }
}

/** What a TEXT value reads back as (rule 10): CRLF becomes a newline, a bare CR is removed. */
export const readBack = (s: string) => s.replace(/\r\n/g, '\n').replace(/\r/g, '');
