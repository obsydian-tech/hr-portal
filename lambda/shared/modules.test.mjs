/**
 * MOD-01 rule 9: every Recruitment Lambda on the rule 4 list asks lambda/shared/modules.mjs before it does anything.
 * The list can only shrink with a card that says so. Run by `npm test` in lambda/shared (the Lambda unit tests job).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const LAMBDA = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Routes a person or agent calls: requireModule(event, 'recruitment') after requireTenant. */
const ROUTE_LAMBDAS = [
  'getCandidate', 'updateCandidate', 'advanceCandidateStage', 'scheduleInterview', 'submitVote', 'captureSentiment',
  'generateScoringLink', 'getOffer', 'createOffer', 'advanceOfferState', 'getCandidateEvents', 'dismissTile',
  'snoozeTile', 'acknowledgeTile', 'getCandidates', 'createCandidate', 'getIntelligenceTiles', 'manageTalentFlowConfig',
  'getUserNotifications', 'markNotificationRead', 'getPanelMembers', 'getHiringManagers', 'talentFlowApproveAction',
];
/** The chat's Recruitment tools, the public vote by token and the event handlers: modulesOf, then skip. */
const OTHER = {
  talentFlowAiChat: 'tool-resolver.mjs',
  submitVoteByToken: 'index.js',
  evaluateIntelligenceRules: 'index.js',
  sendTalentFlowNotification: 'index.js',
  orchestrateTalentFlowWorkflow: 'index.js',
};

const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
function handlerOf(folder, file) {
  for (const f of file ? [file] : ['index.js', 'index.mjs', 'index.cjs']) {
    const p = join(LAMBDA, folder, f);
    if (existsSync(p)) return strip(readFileSync(p, 'utf8'));
  }
  return null;
}
const IMPORTS = /(?:from\s*|import\s*\(\s*)['"]\.\.?\/shared\/modules\.mjs['"]/;

for (const folder of ROUTE_LAMBDAS) {
  test(`${folder} asks modules.mjs (requireModule, recruitment)`, () => {
    const code = handlerOf(folder);
    assert.ok(code !== null, `${folder}: no handler file`);
    assert.match(code, IMPORTS, `${folder}: does not import ../shared/modules.mjs`);
    assert.match(code, /requireModule\s*\(\s*event\s*,\s*['"]recruitment['"]\s*\)/, `${folder}: does not call requireModule(event, 'recruitment')`);
    const tenant = code.search(/requireTenant\s*\(/);
    const mod = code.search(/requireModule\s*\(\s*event/);
    assert.ok(tenant >= 0 && tenant < mod, `${folder}: requireModule must come after requireTenant`);
  });
}
for (const [folder, file] of Object.entries(OTHER)) {
  test(`${folder} asks modules.mjs (modulesOf, recruitment)`, () => {
    const code = handlerOf(folder, file);
    assert.ok(code !== null, `${folder}: no ${file}`);
    assert.match(code, IMPORTS, `${folder}: does not import ../shared/modules.mjs`);
    assert.match(code, /modulesOf\s*\(/, `${folder}: does not call modulesOf`);
    assert.match(code, /includes\(\s*['"]recruitment['"]\s*\)/, `${folder}: does not check recruitment`);
  });
}
