import { A, TABLE, TENANTS, av, plain, tables } from './world';
import type { Row, Tables } from './lambda-harness';

/**
 * TEN-03 AC-8: the seeded world plus legacy records of every kind the move meets, each with a marker `m` (so a test
 * can find it again after its key changed): company DEFAULT, company NALEKO, no company, in a key, in an index key,
 * in an attribute, and in tables the handlers never wrote a company to. Also records of another company, which
 * the move must count and leave alone.
 */
const NOW = '2026-10-01T08:00:00.000Z';
const OTHER = 'OTHERCO';

export function legacyWorld(): { world: { tables: Tables }; legacy: Set<string> } {
  const t = tables();
  const legacy = new Set<string>();
  const add = (table: string, row: Record<string, any>) => {
    legacy.add(row['m']);
    (t[table] ??= []).push(av(row));
  };
  let n = 0;
  const m = (what: string) => `L${++n}-${what.replace('DEFAULT', 'd').replace('NALEKO', 'n')}`;

  // Candidates: a SAGA, its children, and the snapshot, under each legacy company.
  for (const [co, cid] of [['DEFAULT', 'CAND-LEGACY-D1'], ['NALEKO', 'CAND-LEGACY-N1']] as const) {
    add(TABLE.state, { m: m(`saga-${co}`), PK: `CANDIDATE#${cid}`, SK: 'SAGA', GSI1PK: `TENANT#${co}`, GSI1SK: `SAGA#${NOW}`, candidateId: cid, tenantId: co, firstName: 'Lena', lastName: 'Legacy', currentStage: 'APPLICATION_REVIEW', createdAt: NOW });
    add(TABLE.state, { m: m(`interview-${co}`), PK: `CANDIDATE#${cid}`, SK: 'INTERVIEW#iv-legacy-1', candidateId: cid, tenantId: co, interviewId: 'iv-legacy-1', status: 'SCHEDULED', createdAt: NOW });
    add(TABLE.state, { m: m(`vote-${co}`), PK: `CANDIDATE#${cid}`, SK: `VOTE#sub-x#${NOW}`, candidateId: cid, voterId: 'sub-x', rating: 'YES', createdAt: NOW });
    add(TABLE.state, { m: m(`snap-${co}`), PK: `TENANT#${co}#SNAP`, SK: `CAND#${cid}`, GSI1PK: 'OWNER#sub-x#TA', GSI1SK: NOW, entityId: cid, tenantId: co, signals: { SLA_STATUS: 'ON_TRACK' }, computedAt: NOW });
  }
  add(TABLE.state, { m: m('saga-none'), PK: 'CANDIDATE#CAND-LEGACY-X1', SK: 'SAGA', candidateId: 'CAND-LEGACY-X1', firstName: 'Nomi', lastName: 'Nocompany', currentStage: 'APPLICATION_REVIEW', createdAt: NOW });
  add(TABLE.state, { m: m('offer-none'), PK: 'CANDIDATE#CAND-LEGACY-X1', SK: 'OFFER', candidateId: 'CAND-LEGACY-X1', offerId: 'OFFER#CAND-LEGACY-X1', state: 'OFFER_CREATED', createdAt: NOW });
  // Config of each legacy company (types A does not already hold, so a copy never lands on A's row).
  add(TABLE.config, { m: m('config-DEFAULT'), PK: 'TENANT#DEFAULT', SK: 'CONFIG#SLA_THRESHOLDS#v1', GSI1PK: 'TENANT#DEFAULT#ACTIVE', GSI1SK: 'CONFIG#SLA_THRESHOLDS', tenantId: 'DEFAULT', configType: 'SLA_THRESHOLDS', version: 1, isActive: true, data: { days: 5 }, createdAt: NOW });
  add(TABLE.config, { m: m('config-NALEKO'), PK: 'TENANT#NALEKO', SK: 'CONFIG#STAGE_CONFIG#v1', GSI1PK: 'TENANT#NALEKO#ACTIVE', GSI1SK: 'CONFIG#STAGE_CONFIG', tenantId: 'NALEKO', configType: 'STAGE_CONFIG', version: 1, isActive: true, data: { enabled: ['APPLICATION_REVIEW'] }, createdAt: NOW });
  // Tables whose company sits in an attribute only.
  add(TABLE.dismissals, { m: m('dismiss-NALEKO'), PK: 'USER#sub-x', SK: 'TILEDISMISS#CAND-LEGACY-N1#RULE-SLA-002', tenantId: 'NALEKO', dismissedAt: NOW });
  add(TABLE.dismissals, { m: m('dismiss-none'), PK: 'USER#sub-y', SK: 'TILEDISMISS#CAND-LEGACY-X1#RULE-SLA-002', dismissedAt: NOW });
  add(TABLE.notifications, { m: m('notif-DEFAULT'), PK: 'USER#sub-x', SK: `NOTIF#${NOW}#legacy`, GSI1PK: 'USER#sub-x#UNREAD', GSI1SK: `NOTIF#${NOW}`, tenantId: 'DEFAULT', read: false, createdAt: NOW });
  add(TABLE.notifications, { m: m('notif-none'), PK: 'USER#sub-y', SK: `NOTIF#${NOW}#legacy2`, read: true, createdAt: NOW });
  add(TABLE.events, { m: m('event-NALEKO'), PK: 'CANDIDATE#CAND-LEGACY-N1', SK: `EVENT#${NOW}`, tenantId: 'NALEKO', eventType: 'StageAdvanced', createdAt: NOW });
  add(TABLE.users, { m: m('user-none'), PK: 'USER#sub-x', SK: 'PROFILE', lastActionAt: NOW });
  add(TABLE.pending, { m: m('action-none'), actionId: 'act-legacy-1', status: 'PENDING_APPROVAL', toolName: 'advance_stage', createdAt: NOW });
  // IT tasks and bundles: company in an attribute, or none.
  add(TABLE.itTasks, { m: m('task-NALEKO'), taskId: 'task-legacy-1', tenantId: 'NALEKO', taskStatus: 'UNASSIGNED', queue: 'Laptops', createdAt: NOW });
  add(TABLE.itTasks, { m: m('task-DEFAULT'), taskId: 'task-legacy-2', tenantId: 'DEFAULT', taskStatus: 'CLAIMED', queue: 'Laptops', createdAt: NOW });
  add(TABLE.itTasks, { m: m('task-none'), taskId: 'task-legacy-3', taskStatus: 'UNASSIGNED', queue: 'Laptops', createdAt: NOW });
  add(TABLE.bundles, { m: m('bundle-NALEKO'), bundleId: 'bundle-legacy-1', tenantId: 'NALEKO', hmUserId: 'sub-x', candidateId: 'CAND-LEGACY-N1', bundleStatus: 'PENDING_REVIEW', createdAt: NOW });
  add(TABLE.bundles, { m: m('bundle-none'), bundleId: 'bundle-legacy-2', hmUserId: 'sub-x', candidateId: 'CAND-LEGACY-X1', bundleStatus: 'APPROVED', createdAt: NOW });

  // Another company's records: counted, never touched.
  (t[TABLE.state] ??= []).push(
    av({ PK: 'CANDIDATE#CAND-OTHER-1', SK: 'SAGA', GSI1PK: `TENANT#${OTHER}`, GSI1SK: `SAGA#${NOW}`, candidateId: 'CAND-OTHER-1', tenantId: OTHER, firstName: 'Olga', lastName: 'Other', createdAt: NOW }),
    av({ PK: `TENANT#${OTHER}#SNAP`, SK: 'CAND#CAND-OTHER-1', tenantId: OTHER, signals: {}, computedAt: NOW }),
  );
  (t[TABLE.config] ??= []).push(av({ PK: `TENANT#${OTHER}`, SK: 'CONFIG#SCORING_WEIGHTS#v1', GSI1PK: `TENANT#${OTHER}#ACTIVE`, GSI1SK: 'CONFIG#SCORING_WEIGHTS', tenantId: OTHER, configType: 'SCORING_WEIGHTS', version: 1, data: {} }));
  (t[TABLE.itTasks] ??= []).push(av({ taskId: 'task-other-1', tenantId: OTHER, taskStatus: 'UNASSIGNED', queue: 'Laptops', createdAt: NOW }));
  (t[TABLE.bundles] ??= []).push(av({ bundleId: 'bundle-other-1', tenantId: OTHER, hmUserId: 'sub-z', createdAt: NOW }));

  // The company table is read, never written.
  t[TENANTS] = t[TENANTS] ?? [];
  void [A, plain];
  return { world: { tables: t }, legacy };
}
export type { Row };
