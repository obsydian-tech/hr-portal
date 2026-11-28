// REC-09 rule 3: who a flag goes to, by role, from the company's own people. Never an address in a rule or a setting.
import { CognitoIdentityProviderClient, ListUsersInGroupCommand, AdminGetUserCommand } from '@aws-sdk/client-cognito-identity-provider';
import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { companiesOf } from './membership.mjs';
import { TARGETS } from './intelligence-rules.mjs';

const cognito = new CognitoIdentityProviderClient({});
const db = new DynamoDBClient({});

async function inGroup(group) {
  const pool = process.env.COGNITO_POOL_ID ?? process.env.HM_COGNITO_POOL_ID;
  const out = new Map();
  let token;
  try {
    do {
      const page = await cognito.send(new ListUsersInGroupCommand({ UserPoolId: pool, GroupName: group, NextToken: token }));
      for (const u of page.Users ?? []) {
        const sub = (u.Attributes ?? []).find((a) => a.Name === 'sub')?.Value;
        if (sub && u.UserStatus === 'CONFIRMED' && u.Enabled !== false) out.set(sub, u);
      }
      token = page.NextToken;
    } while (token);
  } catch (e) {
    if (e?.name !== 'ResourceNotFoundException') throw e;
  }
  return out;
}
const member = async (sub, tenantId) => {
  const mine = await companiesOf(sub);
  return mine.length === 1 && mine[0] === tenantId;
};
/** A person named by a role or a panel (not found through a group) must have a working sign-in: confirmed and not disabled. */
async function usable(sub) {
  try {
    const got = await cognito.send(new AdminGetUserCommand({ UserPoolId: process.env.COGNITO_POOL_ID ?? process.env.HM_COGNITO_POOL_ID, Username: sub }));
    return got.UserStatus === 'CONFIRMED' && got.Enabled !== false;
  } catch (e) {
    if (e?.name === 'UserNotFoundException') return false;
    throw e;
  }
}
async function keep(subs, tenantId, { check = true } = {}) {
  const out = [];
  for (const s of new Set(subs)) if (typeof s === 'string' && s && (await member(s, tenantId)) && (!check || (await usable(s)))) out.push(s);
  return out.sort();
}
const recruiters = async (tenantId) => {
  const [hr, tick] = await Promise.all([inGroup('hr_staff'), inGroup('perm-recruitment')]);
  return keep([...hr.keys()].filter((s) => tick.has(s)), tenantId, { check: false });
};

/** context: { candidate, interview, votes, offer, rejectionRules } as plain rows; whatever the target needs. */
export async function resolveRecipients(tenantId, target, context = {}) {
  if (!TARGETS.includes(target)) return [];
  const c = context.candidate ?? {};
  switch (target) {
    case 'HR_RECRUITMENT': return recruiters(tenantId);
    case 'HIRING_MANAGER': return keep([await hiringManagerOf(tenantId, c)], tenantId);
    case 'PANEL_MEMBER': {
      const iv = context.interview ?? {};
      const voted = new Set((context.votes ?? []).filter((v) => v.interviewId === iv.interviewId).map((v) => v.voterId));
      return keep((iv.panelMemberIds ?? []).filter((p) => !voted.has(p)), tenantId);
    }
    case 'DECIDER': {
      const who = (context.rejectionRules?.decider ?? {})[c.positionLevel] ?? 'HR_OR_HM';
      const list = await recruiters(tenantId);
      return who === 'HR_OR_HM' ? keep([...list, await hiringManagerOf(tenantId, c)], tenantId) : list;
    }
    case 'APPROVER': {
      const approvers = await inGroup('perm-approve-offers');
      return keep([...approvers.keys()].filter((s) => s !== context.offer?.drafted_by), tenantId, { check: false });
    }
    default: return [];
  }
}
async function hiringManagerOf(tenantId, candidate) {
  if (candidate.role_id && process.env.ROLES_TABLE_NAME) {
    const r = await db.send(new GetItemCommand({ TableName: process.env.ROLES_TABLE_NAME, Key: marshall({ pk: `TENANT#${tenantId}`, sk: `ROLE#${candidate.role_id}` }) }));
    const row = r.Item ? unmarshall(r.Item) : null;
    if (row && row.tenant_id === tenantId && row.hiring_manager_id) return row.hiring_manager_id;
  }
  return candidate.hiringManagerId;
}
