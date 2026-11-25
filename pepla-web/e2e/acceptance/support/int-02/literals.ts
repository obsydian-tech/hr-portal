import * as ts from 'typescript';

/**
 * INT-02 AC-8: the function writes no words of its own. Reads interview-invite.mjs with TypeScript's parser and judges every string
 * literal, every piece of template text outside `${}` (cooked, so `'\r\n'` is CR LF) and every regular expression.
 * Pinned choices (cards/int-02.md D-T-02.4 to D-T-02.6).
 */

/** AC-8's list. Values as the code holds them at run time (the card's `\\n` is a backslash then n). */
const PROPERTIES = ['BEGIN', 'END', 'VCALENDAR', 'VEVENT', 'VERSION', 'PRODID', 'METHOD', 'CALSCALE', 'UID', 'DTSTAMP', 'DTSTART', 'DTEND',
  'SEQUENCE', 'STATUS', 'SUMMARY', 'DESCRIPTION', 'LOCATION', 'URL', 'ORGANIZER', 'ATTENDEE', 'CN', 'ROLE', 'PARTSTAT', 'RSVP', 'CUTYPE'];
const VALUES = ['2.0', 'GREGORIAN', 'REQUEST', 'CANCEL', 'CONFIRMED', 'CANCELLED', 'REQ-PARTICIPANT', 'NEEDS-ACTION', 'TRUE', 'INDIVIDUAL',
  'mailto:', 'Z', 'T'];
const INPUT_VALUES = ['PANEL', 'GUEST', 'CANDIDATE', 'IN_PERSON', 'ONLINE', 'https://'];
export const CODES = ['BAD_AUDIENCE', 'BAD_METHOD', 'MISSING_FIELD', 'BAD_ID', 'BAD_EMAIL', 'BAD_LINK', 'NO_LINK', 'NO_PLACE', 'BAD_TIME',
  'COMPANY_MISMATCH'];
export const PRODID = '-//Naleko People//Interviews//EN';
export const CONTENT_TYPE = 'text/calendar; charset=utf-8; method=';
const FIXED = [PRODID, 'naleko-people', '@naleko-people', 'interview.ics', CONTENT_TYPE];
const BLOCKS = ['node:crypto', 'sha256', 'hex', 'utf8', '\r\n', '\n', '\\', '\\n', '\\,', '\\;', '"', ',', ';', ':', '=', '-', '0', '00', ' '];
/** The input's field names (the card's Input block). */
export const FIELDS = ['audience', 'method', 'now', 'company', 'tenant_id', 'interview', 'interview_id', 'at', 'length_minutes', 'sequence',
  'where', 'place', 'video_link', 'organiser', 'first_name', 'last_name', 'email', 'candidate', 'panel', 'person_id', 'guest', 'name', 'text',
  'summary', 'description'];
/** Rule 1's two patterns, also allowed as strings (for `new RegExp(...)`). */
export const RULE1 = ['^[A-Za-z0-9_-]{1,64}$', '^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,253}\\.[A-Za-z]{2,63}$'];

const PIECES = [...new Set([...PROPERTIES, ...VALUES, ...INPUT_VALUES, ...CODES, 'InviteError', ...FIXED, ...BLOCKS, ...FIELDS,
  '.', '[', ']'])].sort((x, y) => y.length - x.length);
/** Words that may appear in a regular expression: the letter runs of the allowed pieces. */
const WORDS = new Set(PIECES.flatMap((p) => p.match(/[A-Za-z]+/g) ?? []));
/** Calls that make words or read text from elsewhere (D-T-02.6). */
const REFUSED_NAMES = ['fromCharCode', 'fromCodePoint', 'atob', 'btoa', 'eval', 'Function', 'require', 'process', 'fetch', 'readFileSync',
  'readFile', 'Intl', 'toLocaleString', 'toLocaleDateString', 'toLocaleTimeString', 'toDateString', 'toTimeString', 'toUTCString',
  'toGMTString'];

/** Is `s` made only of allowed pieces, one after another, with no two words side by side outside the two fixed strings? */
export function allowedString(s: string): boolean {
  if (s === '' || RULE1.includes(s)) return true;
  const rest = FIXED.reduce((t, f) => (f.includes(' ') ? t.split(f).join('\u0001') : t), s);
  if (/[A-Za-z0-9][ \t]+[A-Za-z]/.test(rest)) return false; // "interview at", "Your interview"
  const ok: boolean[] = new Array(s.length + 1).fill(false);
  ok[0] = true;
  for (let k = 0; k < s.length; k++) {
    if (!ok[k]) continue;
    for (const p of PIECES) if (s.startsWith(p, k)) ok[k + p.length] = true;
  }
  return ok[s.length]!;
}

/** Is a regular expression allowed: rule 1's own, or every run of three or more letters is a word of an allowed piece? */
export function allowedRegex(source: string): boolean {
  const body = source.replace(/^\/|\/[a-z]*$/g, '');
  if (RULE1.includes(body)) return true;
  const plain = body.replace(/\\u\{?[0-9A-Fa-f]+\}?|\\x[0-9A-Fa-f]{2}|\\c[A-Za-z]|\\[A-Za-z]/g, ' ');
  return (plain.match(/[A-Za-z]{3,}/g) ?? []).every((w) => WORDS.has(w));
}

/** D-T-02.5: a JavaScript type name compared with `typeof x` is the language's word, not the file's ('string' in typeof v === 'string'). */
const TYPE_NAMES = ['string', 'number', 'object', 'undefined', 'boolean', 'function', 'bigint', 'symbol'];
function typeofName(n: ts.Node, text: string): boolean {
  const p = n.parent;
  if (!TYPE_NAMES.includes(text) || !p || !ts.isBinaryExpression(p)) return false;
  const op = p.operatorToken.kind;
  if (![ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken].includes(op)) return false;
  const other = p.left === n ? p.right : p.left;
  return ts.isTypeOfExpression(other);
}

export type Finding = { line: number; what: string };

/** Every literal, regular expression or name in `source` that AC-8 refuses. */
export function findings(source: string, fileName = 'interview-invite.mjs'): Finding[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const out: Finding[] = [];
  const lineOf = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const visit = (n: ts.Node) => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) {
      const text = (n as ts.LiteralLikeNode).text;
      if (!allowedString(text) && !typeofName(n, text)) out.push({ line: lineOf(n), what: `string ${JSON.stringify(text)}` });
    } else if (ts.isRegularExpressionLiteral(n)) {
      if (!allowedRegex(n.text)) out.push({ line: lineOf(n), what: `regular expression ${n.text}` });
    } else if (ts.isIdentifier(n) || ts.isPrivateIdentifier(n)) {
      if (REFUSED_NAMES.includes(n.text)) out.push({ line: lineOf(n), what: `name ${n.text}` });
    } else if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword) {
      out.push({ line: lineOf(n), what: 'dynamic import()' });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  // A parse error would hide literals from the walk.
  const diags = (sf as unknown as { parseDiagnostics?: ts.Diagnostic[] }).parseDiagnostics ?? [];
  for (const d of diags) out.push({ line: d.start === undefined ? 0 : sf.getLineAndCharacterOfPosition(d.start).line + 1, what: `parse error ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}` });
  return out;
}

/** Examples the checker itself must refuse (AC-8 tests its own checker first). */
export const MUST_REFUSE: string[] = [
  `const s = 'Interview';`,
  "const s = `Your interview at ${place}`;",
  `const s = "X-WR-CALNAME:";`,
  `const s = 'COMMENT:';`,
  `const s = 'Pepla';`,
  `const s = 'BEGIN:VCALENDAR Hello';`,
  `const s = 'interview at place';`,
  `import words from './words.mjs';`,
  `const s = 'Reminder';`,
  `const r = /Interview/;`,
  `const s = String.fromCharCode(72, 105);`,
  `const s = new Date().toLocaleDateString();`,
  `const s = 'DESCRIPTION:Please join';`,
  `const s = "\\u0048i";`,
  `const s = 'X-' + 'MS-OLK-FORCEINSPECTOROPEN';`,
  `const m = await import('./more.mjs');`,
  `const s = 'string';`,
  `const s = kind === 'string' ? 1 : 2;`,
];
/** Examples it must let through (a correct build writes these). */
export const MUST_PASS: string[] = [
  `import { createHash } from 'node:crypto';`,
  `const s = 'BEGIN:VCALENDAR';`,
  `const s = 'PRODID:-//Naleko People//Interviews//EN';`,
  "const s = `ATTENDEE;CN=\"${first} ${last}\":mailto:${email}`;",
  "const s = `${a}\\r\\n`;",
  "const s = `text/calendar; charset=utf-8; method=${method}`;",
  `const s = 'interview.length_minutes';`,
  "const s = `UID:${hex}@naleko-people`;",
  `const r = /^[A-Za-z0-9_-]{1,64}$/;`,
  `const r = /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,253}\\.[A-Za-z]{2,63}$/;`,
  `const r = /^https:\\/\\//;`,
  `const s = v.replace(/\\\\/g, '\\\\\\\\').replace(/;/g, '\\\\;').replace(/\\n/g, '\\\\n');`,
  `class InviteError extends Error { constructor(c) { super(c); this.name = 'InviteError'; this.code = c; } }`,
  `const s = ['ROLE=REQ-PARTICIPANT', 'PARTSTAT=NEEDS-ACTION', 'RSVP=TRUE', 'CUTYPE=INDIVIDUAL'].join(';');`,
  `const s = createHash('sha256').update(x, 'utf8').digest('hex');`,
  `const s = String(n).padStart(2, '0');`,
  `if (typeof v !== 'string' || typeof n === "number") throw new InviteError('MISSING_FIELD');`,
];
