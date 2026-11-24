'use strict';
// REC-15 step B: the role check, the company, the module, then the new body (rules 19 to 23).
exports.handler = async (event) => {
  const RA = await import('../shared/recruitment-access.mjs');
  const notRecruiter = RA.requireRecruiter(event);
  if (notRecruiter) return notRecruiter;
  const T = await import('../shared/tenant.mjs');
  const { tenantId, refusal } = T.requireTenant(event);
  if (refusal) return refusal;
  const { requireModule } = await import('../shared/modules.mjs');
  const moduleOff = await requireModule(event, 'recruitment');
  if (moduleOff) return moduleOff;
  const personId = RA.callerId(event);
  if (!personId) return RA.forbidden();
  let body;
  try {
    const raw = event.body ? (event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body) : '{}';
    body = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch { body = undefined; }
  const headerKey = Object.entries(event.headers ?? {}).find(([n]) => n.toLowerCase() === 'idempotency-key')?.[1];
  // REC-12: a new candidate is locked to the active settings (rec-12 AC-8 reads this import).
  const S = await import('../shared/recruitment-settings.mjs');
  const { addCandidate } = await import('../shared/recruitment-actions/add-candidate.mjs');
  const { json } = await import('../shared/hr-group.mjs');
  try {
    return await addCandidate({ tenantId, personId, event, activeVersions: S.activeVersions }, { body, headerKey });
  } catch (e) {
    console.error('createCandidate failed', { error: e?.name ?? 'Error' });
    return json(500, { error: 'Something went wrong' });
  }
};
