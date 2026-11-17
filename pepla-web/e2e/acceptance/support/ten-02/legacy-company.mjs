// TEN-02: the cards written before tenancy run their handlers as the one company there was then.
//   - Every real ID token now carries tenant_id (TEN-01's pre-token trigger), and the Agent API key carries
//     AGENT_TENANT_ID, so a signed-in caller or the agent here is a member of that company.
//   - Rows those cards seed carry no company, as rows written before TEN-02 do; the legacy rule
//     (LEGACY_TENANT_ID) gives them to that company, as it does in pepla-dev until step 2.
//   - The company list (tenants table) exists and starts empty: nobody has a Member row, so a sign-in's company is
//     the legacy one, and new invites write their Member row there.
//   - issueInvite now takes the caller's company; a card that calls it directly passes that company.
//   - The owner of an employee row is now matched on the sign-in id (user_sub), which the TEN-02 backfill fills
//     from the pool by the row's email. A signed-in caller here is that pool user, so an employee row with the
//     caller's email and no user_sub gets the caller's sub, as the backfill would give it. Every other check
//     (email_verified, the email itself, the groups) is untouched.
// A setting or claim a test sets itself is kept. A token with no claims, or no authorizer, is left as it is.
export const LEGACY_COMPANY = 'ten_founding000000000000000000';
export const TENANTS_TABLE = 'naleko-people-dev-tenants';

export function legacySettings() {
  process.env.LEGACY_TENANT_ID ??= LEGACY_COMPANY;
  process.env.AGENT_TENANT_ID ??= LEGACY_COMPANY;
  process.env.TENANTS_TABLE ??= TENANTS_TABLE;
}

let theWorld;
export function legacyTables(world, keys) {
  theWorld = world;
  if (world && typeof world === 'object') {
    world.tables ??= {};
    world.tables[TENANTS_TABLE] ??= [];
  }
  if (keys && typeof keys === 'object') keys[TENANTS_TABLE] ??= ['pk', 'sk'];
}

export function asLegacyCompany(event, call) {
  if (!event || typeof event !== 'object') return event;
  if (call === 'issueInvite') return event.tenantId === undefined ? { ...event, tenantId: LEGACY_COMPANY } : event;
  const auth = event.requestContext?.authorizer;
  const claims = auth?.jwt?.claims;
  if (claims && typeof claims === 'object' && claims.tenant_id === undefined) claims.tenant_id = LEGACY_COMPANY;
  if (claims && typeof claims === 'object') backfillOwner(claims);
  if (auth?.lambda && typeof auth.lambda === 'object' && auth.lambda.actor === 'AGENT' && auth.lambda.tenant_id === undefined) auth.lambda.tenant_id = LEGACY_COMPANY;
  return event;
}

const norm = (v) => String(v ?? '').trim().toLowerCase();
function backfillOwner(claims) {
  const sub = typeof claims.sub === 'string' ? claims.sub : '';
  const email = norm(claims.email);
  const rows = theWorld?.tables?.employees;
  // As the backfill does: only a verified address gives a row its owner, and only a row with none yet.
  const v = claims.email_verified;
  const verified = v === true || (typeof v === 'string' && v.toLowerCase() === 'true');
  if (!sub || !email || !verified || !Array.isArray(rows)) return;
  for (const r of rows) {
    if (!r || typeof r !== 'object' || r.user_sub !== undefined) continue;
    const e = r.email && typeof r.email === 'object' ? r.email.S : r.email;
    if (norm(e) !== email) continue;
    r.user_sub = r.email && typeof r.email === 'object' ? { S: sub } : sub;
  }
}
