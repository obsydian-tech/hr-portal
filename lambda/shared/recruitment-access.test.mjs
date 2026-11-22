/**
 * REC-01 rule 6: the CI list can only shrink. Every Lambda on the list below must import lambda/shared/recruitment-access.mjs
 * and call one of its functions before its first AWS call. A folder on the list that does not fails this test and is named.
 *
 * Run: node --test recruitment-access.test.mjs   (npm test in lambda/shared runs it)
 *
 * The list is the routes of the REC-01 table (specs/REC-01.md rule 2). A new Recruitment Lambda that reads or changes
 * candidates, interviews, offers, tiles or Recruitment settings is added here in the same change; the REC cards add theirs.
 * Left out on purpose: the pickers, a person's own notifications, the public vote by token, the approver routes (REC-05,
 * REC-10) and the event handlers.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as access from './recruitment-access.mjs';

const LAMBDA = join(dirname(fileURLToPath(import.meta.url)), '..');

export const RECRUITMENT_LAMBDAS = [
  'createCandidate', 'updateCandidate', 'advanceCandidateStage', 'scheduleInterview', 'generateScoringLink', 'captureSentiment',
  'createOffer', 'advanceOfferState', 'acknowledgeTile', 'snoozeTile', 'dismissTile',
  'getCandidates', 'getIntelligenceTiles', 'getCandidate', 'getCandidateEvents', 'getOffer',
  'manageTalentFlowConfig', 'submitVote',
];

/**
 * Only the import and a call are checked for these (the order is proven by the locked acceptance tests, REC-01 AC-2 and AC-6):
 *  - manageTalentFlowConfig keeps its role check in the helper each of its three methods runs;
 *  - getCandidate and getCandidateEvents open one candidate: who may see it is judged on the candidate's own rows
 *    (decision D-REC-1.4, a person who may not gets 404), so they read the row first and call the check on it.
 */
const CHECK_IN_HELPER = new Set(['manageTalentFlowConfig']);
const JUDGED_ON_THE_ROW = new Set(['getCandidate', 'getCandidateEvents']);

/** JavaScript with comments blanked out; strings kept. */
function stripComments(src) {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const two = src.slice(i, i + 2);
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < src.length && src[j] !== c) j += src[j] === '\\' ? 2 : 1;
      out += src.slice(i, j + 1);
      i = j + 1;
    } else if (two === '//') {
      while (i < src.length && src[i] !== '\n') { out += ' '; i++; }
    } else if (two === '/*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end < 0 ? src.length : end + 2;
      out += src.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop;
    } else { out += c; i++; }
  }
  return out;
}

const FUNCTIONS = Object.keys(access).filter((n) => typeof access[n] === 'function');
const CALL = new RegExp(`\\b(${FUNCTIONS.join('|')})\\s*\\(`);

for (const name of RECRUITMENT_LAMBDAS) {
  test(`${name} imports recruitment-access.mjs and calls it before its first AWS call`, () => {
    const file = ['index.js', 'index.mjs'].map((f) => join(LAMBDA, name, f)).find(existsSync);
    assert.ok(file, `${name}: has no handler file`);
    const src = stripComments(readFileSync(file, 'utf8'));
    assert.match(src, /recruitment-access\.mjs/, `${name}: does not import lambda/shared/recruitment-access.mjs`);
    const call = src.search(CALL);
    assert.ok(call >= 0, `${name}: never calls a recruitment-access function`);
    if (CHECK_IN_HELPER.has(name) || JUDGED_ON_THE_ROW.has(name)) return;
    const handler = src.search(/exports\.handler|export\s+(const|async\s+function)\s+handler/);
    const fromHandler = handler >= 0 ? src.slice(handler) : src;
    const first = fromHandler.search(/\.send\s*\(/);
    const callInHandler = fromHandler.search(CALL);
    assert.ok(callInHandler >= 0, `${name}: the handler never calls a recruitment-access function`);
    assert.ok(first < 0 || callInHandler < first, `${name}: its first AWS call comes before its access check`);
  });
}

test('the list names a folder that exists for every entry, once', () => {
  assert.equal(new Set(RECRUITMENT_LAMBDAS).size, RECRUITMENT_LAMBDAS.length, 'a Lambda is listed twice');
  for (const name of RECRUITMENT_LAMBDAS) {
    assert.ok(['index.js', 'index.mjs'].some((f) => existsSync(join(LAMBDA, name, f))), `${name}: no such Lambda folder`);
  }
});

test('the access file exports the functions the handlers and REC-02 to REC-12 build on', () => {
  for (const n of ['requireRecruiter', 'requireAdmin', 'requireApprover', 'hiringManagerOf', 'panelMemberOf', 'callerId', 'canDecide']) {
    assert.equal(typeof access[n], 'function', `${n} is exported`);
  }
});
