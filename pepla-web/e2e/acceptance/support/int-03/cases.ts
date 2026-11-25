import {
  C, ERR_MARK, K, OLD_BODY, OLD_VOTE, PM_EXISTING, REC07_BODY, REC07_VOTE, TOK, bodyOf, failOn, forged, hashesWritten, keyOf, linkRead, linkVote,
  oldGenerate, oldVote, tokensWritten, world, type Run, type Tables,
} from './world';

/**
 * INT-03: each path of AC-2, run once. A case knows the run, the world it started from, the tokens that must not reach a log line
 * (`secrets`, each checked with its two hashes and every 12-character run), and, where rule 3 applies, the candidate and interview the
 * log must name instead. `names` gives each token a name so AC-3 can compare a run with random tokens against develop 7048cb9.
 */
export type Case = {
  id: string;
  group: 'old-generate' | 'rec07' | 'old-vote' | 'company-b';
  label: string;
  before: Tables;
  run: Run;
  secrets: string[];
  names: [string, string][];
  /** Rule 3: a line names this candidate and this interview. */
  names3?: { cand: string; iv: string };
  /** The failure was planted on a call the plain run makes (0 = not found: the case cannot judge anything). */
  planted?: number;
  /** The status the card names for this path, where it names one. */
  cardStatus?: number;
};

/** Every token of the world: none of them may reach a log line in any run. */
export const WORLD_TOKENS = [...Object.values(TOK), K.oldToken, K.oldExpiredToken, K.forgedToken];

const isCandLink = (i: any) => /^CANDIDATE#/.test(i?.Item?.PK?.S ?? '') && /^SCORING_LINK#/.test(i?.Item?.SK?.S ?? '');
const isTokenLink = (i: any) => /^SCORING_LINK#/.test(i?.Item?.PK?.S ?? '');
const msg = (token?: string) => `${ERR_MARK} the request failed${token ? ` for SCORING_LINK#${token}` : ''}`;

let cache: Case[] | undefined;
/** Runs every case once per worker (about 40 Lambda runs). */
export function cases(): Case[] {
  if (cache) return cache;
  const out: Case[] = [];
  const add = (c: Omit<Case, 'secrets' | 'names'> & { secrets?: string[]; names?: [string, string][] }) => {
    const secrets = [...new Set([...(c.secrets ?? []), ...WORLD_TOKENS])];
    out.push({ ...c, secrets, names: c.names ?? [] });
  };
  const w = world;

  // ---------------------------------------------------------------- old generate path (generateScoringLink, panelMemberId given)
  {
    const t = w(); const run = oldGenerate(C.recruiter, K.v, OLD_BODY, t);
    const toks = tokensWritten(run);
    add({ id: 'G1', group: 'old-generate', label: 'old path: link made', before: t, run, secrets: toks, names: toks.map((x) => [x, 'NEW']), names3: { cand: K.v, iv: K.i1 }, cardStatus: 201 });
  }
  {
    const t = w(); const run = oldGenerate(C.recruiter, K.v, { ...OLD_BODY, panelMemberId: PM_EXISTING }, t);
    add({ id: 'G2', group: 'old-generate', label: 'old path: an existing valid link returned', before: t, run, secrets: [TOK.existing], names: [[TOK.existing, 'EXISTING']], names3: { cand: K.v, iv: K.i1 } });
  }
  {
    const t = w(); const f = failOn((fail) => oldGenerate(C.recruiter, K.v, OLD_BODY, t, fail), 'PutItem', isCandLink, msg());
    const toks = tokensWritten(f.run);
    add({ id: 'G3', group: 'old-generate', label: 'old path: the candidate-indexed write fails', before: t, run: f.run, planted: f.place, secrets: toks, names: toks.map((x) => [x, 'NEW']), names3: { cand: K.v, iv: K.i1 } });
  }
  {
    const t = w(); const f = failOn((fail) => oldGenerate(C.recruiter, K.v, OLD_BODY, t, fail), 'PutItem', isTokenLink, msg());
    const toks = tokensWritten(f.run);
    add({ id: 'G4', group: 'old-generate', label: 'old path: the token-indexed write fails', before: t, run: f.run, planted: f.place, secrets: toks, names: toks.map((x) => [x, 'NEW']), names3: { cand: K.v, iv: K.i1 } });
  }
  {
    const t = w(); const f = failOn((fail) => oldGenerate(C.recruiter, K.v, OLD_BODY, t, fail), 'GetItem', (i) => keyOf(i) === `CANDIDATE#${K.v}|SAGA`, msg());
    const toks = tokensWritten(f.run);
    add({ id: 'G5', group: 'old-generate', label: 'old path: the candidate (saga) read fails', before: t, run: f.run, planted: f.place, secrets: toks, names: toks.map((x) => [x, 'NEW']) });
  }
  {
    const t = w(); const f = failOn((fail) => oldGenerate(C.recruiter, K.v, OLD_BODY, t, fail), 'Query', (i) => JSON.stringify(i ?? {}).includes('SCORING_LINK#'), msg());
    const toks = tokensWritten(f.run);
    add({ id: 'G6', group: 'old-generate', label: 'old path: the existing-link read fails (the run goes on and makes a link)', before: t, run: f.run, planted: f.place, secrets: toks, names: toks.map((x) => [x, 'NEW']) });
  }

  // ---------------------------------------------------------------- REC-07 paths
  {
    const t = w(); const run = oldGenerate(C.recruiter, K.v, REC07_BODY, t);
    const raw = typeof bodyOf(run)?.token === 'string' ? (bodyOf(run).token as string) : '';
    const hashes = hashesWritten(run);
    add({ id: 'R0', group: 'rec07', label: 'REC-07 generate path: link made', before: t, run, secrets: [raw, ...hashes].filter(Boolean), names: [...(raw ? [[raw, 'RAW'] as [string, string]] : []), ...hashes.map((h) => [h, 'HASH'] as [string, string])], cardStatus: 201 });
  }
  const guestNames: [string, string][] = [[TOK.guest, 'GUEST'], [TOK.guestExpired, 'GUEST_EXPIRED']];
  { const t = w(); add({ id: 'R1', group: 'rec07', label: 'rec07.mjs read: ok', before: t, run: linkRead(TOK.guest, t), secrets: [TOK.guest], names: guestNames, cardStatus: 200 }); }
  { const t = w(); add({ id: 'R2', group: 'rec07', label: 'rec07.mjs read: expired', before: t, run: linkRead(TOK.guestExpired, t), secrets: [TOK.guestExpired], names: guestNames, cardStatus: 410 }); }
  {
    const t = w(); const f = failOn((fail) => linkRead(TOK.guest, t, fail), 'GetItem', (i) => /^SCORING_LINK#/.test(i?.Key?.PK?.S ?? ''), msg(TOK.guest));
    add({ id: 'R3', group: 'rec07', label: 'rec07.mjs read: the link read fails', before: t, run: f.run, planted: f.place, secrets: [TOK.guest], names: guestNames });
  }
  { const t = w(); add({ id: 'R4', group: 'rec07', label: 'rec07.mjs vote: ok', before: t, run: linkVote(TOK.guest, REC07_VOTE, t), secrets: [TOK.guest], names: guestNames }); }
  { const t = w(); add({ id: 'R5', group: 'rec07', label: 'rec07.mjs vote: expired', before: t, run: linkVote(TOK.guestExpired, REC07_VOTE, t), secrets: [TOK.guestExpired], names: guestNames, cardStatus: 410 }); }
  {
    const t = w(); const f = failOn((fail) => linkVote(TOK.guest, REC07_VOTE, t, fail), 'GetItem', (i) => /^SCORING_LINK#/.test(i?.Key?.PK?.S ?? ''), msg(TOK.guest));
    add({ id: 'R6', group: 'rec07', label: 'rec07.mjs vote: the link read fails', before: t, run: f.run, planted: f.place, secrets: [TOK.guest], names: guestNames });
  }
  { const t = w(); add({ id: 'R7', group: 'rec07', label: 'rec07.mjs read of an old-path link (the legacy branch)', before: t, run: linkRead(K.oldToken, t), secrets: [K.oldToken], names: [[K.oldToken, 'OLD']] }); }

  // ---------------------------------------------------------------- old vote path (POST /v1/scoring/{token}/votes)
  { const t = w(); add({ id: 'V1', group: 'old-vote', label: 'old vote: token not found', before: t, run: oldVote(TOK.notFound, OLD_VOTE, t), secrets: [TOK.notFound], names: [[TOK.notFound, 'UNKNOWN']], cardStatus: 403 }); }
  {
    const t = w(); const f = failOn((fail) => oldVote(K.oldToken, OLD_VOTE, t, fail), 'GetItem', (i) => keyOf(i) === `SCORING_LINK#${K.oldToken}|META`, msg(K.oldToken));
    add({ id: 'V2', group: 'old-vote', label: 'old vote: the token read fails', before: t, run: f.run, planted: f.place, secrets: [K.oldToken], names: [[K.oldToken, 'OLD']], cardStatus: 500 });
  }
  { const t = w(); add({ id: 'V3', group: 'old-vote', label: 'old vote: expired', before: t, run: oldVote(K.oldExpiredToken, OLD_VOTE, t), secrets: [K.oldExpiredToken], names: [[K.oldExpiredToken, 'OLD_EXPIRED']], names3: { cand: K.v, iv: K.i1 }, cardStatus: 410 }); }
  { const t = w(); add({ id: 'V4', group: 'old-vote', label: 'old vote: already used', before: t, run: oldVote(TOK.used, OLD_VOTE, t), secrets: [TOK.used], names: [[TOK.used, 'USED']], names3: { cand: K.v, iv: K.i1 }, cardStatus: 410 }); }
  { const t = w(); add({ id: 'V5', group: 'old-vote', label: 'old vote: vote saved', before: t, run: oldVote(K.oldToken, OLD_VOTE, t), secrets: [K.oldToken], names: [[K.oldToken, 'OLD']], cardStatus: 200 }); }
  {
    const t = w(); const f = failOn((fail) => oldVote(K.oldToken, OLD_VOTE, t, fail), 'UpdateItem', (i) => keyOf(i) === `SCORING_LINK#${K.oldToken}|META`, msg(K.oldToken));
    add({ id: 'V6', group: 'old-vote', label: 'old vote: the mark-used write fails', before: t, run: f.run, planted: f.place, secrets: [K.oldToken], names: [[K.oldToken, 'OLD']], names3: { cand: K.v, iv: K.i1 } });
  }
  {
    const t = w(); const run = oldVote(K.oldToken, OLD_VOTE, t, { service: 'events', message: msg(K.oldToken), name: 'InternalServerError' });
    const published = run.calls.some((c: any) => c.service === 'events');
    add({ id: 'V7', group: 'old-vote', label: 'old vote: the VotingCompleted publish fails', before: t, run, planted: published ? 1 : 0, secrets: [K.oldToken], names: [[K.oldToken, 'OLD']] });
  }

  // ---------------------------------------------------------------- company B and refusals
  {
    const t = w(); const run = oldGenerate(C.recruiterB, K.v, OLD_BODY, t);
    const toks = tokensWritten(run);
    add({ id: 'B1', group: 'company-b', label: 'a company-B Recruiter asks for an old-path link on a company-A candidate', before: t, run, secrets: toks, names: toks.map((x) => [x, 'NEW']), cardStatus: 404 });
  }
  {
    const t = w(); const run = oldGenerate(C.recruiterB, K.v, REC07_BODY, t);
    const raw = typeof bodyOf(run)?.token === 'string' ? (bodyOf(run).token as string) : '';
    add({ id: 'B1R', group: 'company-b', label: 'a company-B Recruiter asks for a REC-07 link on a company-A candidate', before: t, run, secrets: [raw, ...hashesWritten(run)].filter(Boolean), names: raw ? [[raw, 'RAW']] : [], cardStatus: 404 });
  }
  { const t = w(); add({ id: 'B2', group: 'company-b', label: 'old vote: a token row of company A whose candidate (saga) is company B', before: t, run: oldVote(K.forgedToken, OLD_VOTE, t), secrets: [K.forgedToken], names: [[K.forgedToken, 'FORGED']], cardStatus: 403 }); }
  { const t = w(); add({ id: 'B2R', group: 'company-b', label: 'rec07.mjs read: the same forged row', before: t, run: linkRead(K.forgedToken, t), secrets: [K.forgedToken], names: [[K.forgedToken, 'FORGED']], cardStatus: 410 }); }
  { const t = w(); add({ id: 'B3', group: 'company-b', label: 'old vote: a token row with no company', before: t, run: oldVote(TOK.noCompany, OLD_VOTE, t), secrets: [TOK.noCompany], names: [[TOK.noCompany, 'NO_COMPANY']], cardStatus: 403 }); }
  { const t = w(); add({ id: 'B4', group: 'company-b', label: 'old vote: the link\'s company has Recruitment off', before: t, run: oldVote(TOK.moduleOff, OLD_VOTE, t), secrets: [TOK.moduleOff], names: [[TOK.moduleOff, 'MODULE_OFF']], cardStatus: 410 }); }
  {
    const t = w(); const run = forged(() => oldGenerate(C.recruiter, K.v, OLD_BODY, t));
    const toks = tokensWritten(run);
    add({ id: 'F1', group: 'company-b', label: 'old path: link made with company B named in the body, headers and query', before: t, run, secrets: toks, names: toks.map((x) => [x, 'NEW']), names3: { cand: K.v, iv: K.i1 }, cardStatus: 201 });
  }
  { const t = w(); add({ id: 'F2', group: 'company-b', label: 'old vote: vote saved with company B named in the body, headers and query', before: t, run: forged(() => oldVote(K.oldToken, OLD_VOTE, t)), secrets: [K.oldToken], names: [[K.oldToken, 'OLD']], cardStatus: 200 }); }

  cache = out;
  return out;
}
