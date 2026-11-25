import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ON_DEV, expect, test } from './support/fixtures';
import { REPO, attributes, blocks, tfFiles } from './support/infra-harness';

/**
 * REC-05 key follow-up (NH-239, after PR 507). The tenants table and the uploads bucket are encrypted with the PII key
 * (module kms_pii in infra/kms.tf). manageOffers and the hourly offer expiry in monitorTalentFlowSLAs read the tenants
 * table to check that Recruitment is on, and manageOffers signs uploads into the bucket. Neither role is on the key's
 * lists on develop 8283605, so every /v1/offers route answers 403 on pepla-dev and the expiry skips every offer.
 * Review: onboarding-cards/specs/REC-05-build-security-review-507.md, "KMS follow-up". Notes: cards/rec-05-kms.md.
 *
 * Every test reads files only (Terraform and the dev seed as text). Nothing here calls AWS or any AI. Runs once, at 1280.
 * On develop 8283605 AC-1, AC-2 and AC-5 fail; AC-3 and AC-4 pass (they guard the change: right roles, nothing else moves).
 */

const once = (projectName: string) => {
  test.skip(ON_DEV, 'No-backend run only: it reads files.');
  test.skip(projectName !== 'desktop-1280', 'Runs once: nothing here has a screen width.');
};

const TF = join(REPO, 'talent-flow-infra');
const BASE = JSON.parse(readFileSync(join(__dirname, 'support', 'rec-05-kms', 'kms-lists.8283605.json'), 'utf8')) as {
  allowed_role_arns: string[];
  dynamodb_read_role_arns: string[];
  roles: Record<string, string>;
};
/** How infra/kms.tf names a role of the talent-flow-infra stack: quoted, the account variable, the /talent-flow/ path. */
const arnOf = (roleName: string) => `"arn:aws:iam::\${var.aws_account_id}:role/talent-flow/${roleName}"`;
const OFFERS = arnOf('talent-flow-role-manageOffers');
const EXPIRY = arnOf('talent-flow-role-monitorTalentFlowSLAs');

/** The entries of one list of module kms_pii, comments left out, whitespace removed. */
const kmsList = (name: string): string[] => {
  const mod = blocks(tfFiles(), 'module').filter((b) => b.labels[0] === 'kms_pii');
  expect(mod, 'one module kms_pii in infra/').toHaveLength(1);
  const v = attributes(mod[0]!.body).get(name) ?? '';
  expect(v, `kms_pii sets ${name} as a list`).toMatch(/^\[[\s\S]*\]$/);
  return v.slice(1, -1).split(',').filter(Boolean);
};
const count = (list: string[], entry: string) => list.filter((e) => e === entry).length;
const withoutOnce = (list: string[], entry: string) => {
  const i = list.indexOf(entry);
  return i < 0 ? [...list] : [...list.slice(0, i), ...list.slice(i + 1)];
};

/** A talent-flow-infra local's string value (plain string locals only). */
const local = (name: string): string => {
  const hits = tfFiles(TF).map((f) => new RegExp(`^\\s*${name}\\s*=\\s*"([^"]*)"`, 'm').exec(readFileSync(f, 'utf8'))?.[1]).filter((x) => x !== undefined);
  expect(hits, `local.${name} is set once in talent-flow-infra`).toHaveLength(1);
  return hits[0]!;
};
const resolveLocals = (v: string) => v.replace(/\$\{local\.(\w+)\}/g, (_m, n: string) => local(n));

test.describe('REC-05 key follow-up · manageOffers and the offer expiry can use the PII key', () => {
  test('AC-1 manageOffers is on the encrypt list once; the offer expiry is not on it', async ({}, testInfo) => {
    once(testInfo.project.name);
    const allowed = kmsList('allowed_role_arns');
    expect(count(allowed, OFFERS), `allowed_role_arns holds ${OFFERS} once (signed uploads into the bucket this key encrypts)`).toBe(1);
    expect(allowed.filter((e) => /monitorTalentFlowSLAs/.test(e)), 'the offer expiry only reads, so it is not on allowed_role_arns').toEqual([]);
  });

  test('AC-2 Both roles are on the read list once each (Decrypt only, through DynamoDB)', async ({}, testInfo) => {
    once(testInfo.project.name);
    const reads = kmsList('dynamodb_read_role_arns');
    expect(count(reads, OFFERS), `dynamodb_read_role_arns holds ${OFFERS} once (the Recruitment check on the tenants table)`).toBe(1);
    expect(count(reads, EXPIRY), `dynamodb_read_role_arns holds ${EXPIRY} once (the expiry's Recruitment check)`).toBe(1);
    expect(reads.filter((e) => /manageOffers|monitorTalentFlowSLAs/.test(e) && e !== OFFERS && e !== EXPIRY), 'no other spelling of either role').toEqual([]);
  });

  test('AC-3 Each ARN is the role its Lambda runs as, and both roles were made by an earlier merge', async ({}, testInfo) => {
    once(testInfo.project.name);
    const roles = blocks(tfFiles(TF), 'resource').filter((b) => b.labels[0] === 'aws_iam_role');
    const fns = blocks(tfFiles(TF), 'resource').filter((b) => b.labels[0] === 'aws_lambda_function');
    for (const [fnName, label, arn] of [['manageOffers', 'manage_offers', OFFERS], ['monitorTalentFlowSLAs', 'monitor_slas', EXPIRY]] as const) {
      const fn = fns.filter((b) => resolveLocals((attributes(b.body).get('function_name') ?? '').replace(/^local\.(\w+)$/, '"${local.$1}"')) === `"${fnName}"`);
      expect(fn, `one Lambda ${fnName} in talent-flow-infra`).toHaveLength(1);
      expect(attributes(fn[0]!.body).get('role'), `${fnName} runs as aws_iam_role.${label}`).toBe(`aws_iam_role.${label}.arn`);
      const role = roles.filter((b) => b.labels[1] === label);
      expect(role, `one aws_iam_role.${label}`).toHaveLength(1);
      const a = attributes(role[0]!.body);
      const name = resolveLocals(a.get('name') ?? '').replace(/^"|"$/g, '');
      expect(a.get('path'), `aws_iam_role.${label} has the path /talent-flow/`).toBe('"/talent-flow/"');
      expect(arnOf(name), `the key names aws_iam_role.${label} by its own name and path`).toBe(arn);
      // infra/ applies before talent-flow-infra/, and KMS refuses a role that does not exist yet (CHAT-15, 20 Nov): the role
      // must already be on develop before the key names it. Both were on develop 8283605.
      expect(BASE.roles[`talent-flow-infra/aws_iam_role.${label}`], `aws_iam_role.${label} was already on develop 8283605 as ${name}`).toBe(name);
    }
  });

  test('AC-4 Nothing else on the key\'s two role lists moves', async ({}, testInfo) => {
    once(testInfo.project.name);
    expect(withoutOnce(kmsList('allowed_role_arns'), OFFERS), 'allowed_role_arns is as on develop 8283605 apart from manageOffers').toEqual(BASE.allowed_role_arns);
    expect(withoutOnce(withoutOnce(kmsList('dynamodb_read_role_arns'), OFFERS), EXPIRY), 'dynamodb_read_role_arns is as on develop 8283605 apart from the two roles').toEqual(BASE.dynamodb_read_role_arns);
    // The key's third role list gives direct Decrypt on the whole key (not only through DynamoDB). Neither role may join it:
    // it stays exactly the Cognito email sender, as on develop 8283605 (lock check round 1, F-1).
    expect(kmsList('cognito_sender_decrypt_role_arns'), 'cognito_sender_decrypt_role_arns stays exactly the Cognito email sender').toEqual(['aws_iam_role.cognito_email_sender.arn']);
  });

  test('AC-5 The dev seed clears the seeded candidate\'s live-offer lock every run', async ({}, testInfo) => {
    once(testInfo.project.name);
    // If the dev test stops before its last withdraw, the lock row stays and every later run gets 409 OFFER_EXISTS
    // (review finding 3). The seed deletes TENANT#<company>#OFFER_LIVE#<candidate> SK LOCK for ids["candidate"], in the company it seeds.
    const seed = readFileSync(join(REPO, 'scripts', 'ci', 'seed-dev.py'), 'utf8');
    const fn = /^def seed_rec05\([\s\S]*?(?=^def |^\S)/m.exec(seed.replace(/^(\s*)#.*$/gm, '$1'))?.[0] ?? '';
    expect(fn, 'seed_rec05 is in scripts/ci/seed-dev.py').not.toBe('');
    const deletes = [...fn.matchAll(/delete_item\(([\s\S]*?)\)\s*$/gm)].map((m) => m[1]!);
    // The whole key, as offers.mjs lockKey writes it: PK f"TENANT#{tenant_id}#OFFER_LIVE#{ids['candidate']}", SK "LOCK" (round 1, F-2:
    // a key without the TENANT#<company># prefix deletes nothing).
    const pk = /["']PK["']\s*:\s*\{\s*["']S["']\s*:\s*f["']TENANT#\{tenant_id\}#OFFER_LIVE#\{ids\[["']candidate["']\]\}["']\s*\}/;
    expect(deletes.some((d) => /TableName\s*=\s*STATE_TABLE/.test(d) && pk.test(d) && /["']SK["']\s*:\s*\{\s*["']S["']\s*:\s*["']LOCK["']\s*\}/.test(d)),
      'seed_rec05 deletes the state-table row TENANT#<company>#OFFER_LIVE#<ids["candidate"]>, SK LOCK').toBe(true);
  });
});
