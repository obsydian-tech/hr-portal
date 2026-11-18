/**
 * TEN-06: the old app's TalentFlow and IT screens were built on the TalentFlow pool's groups and claims
 * (TalentFlowAdmin, HiringManager, ITAdmin ..., custom:isAdmin, custom:roles, custom:activeRole). After the move a
 * person's token carries the one pool's groups (admin, manager, guest, perm-recruitment, perm-it, perm-approve-offers;
 * lambda/shared/roles.mjs). This turns those back into what the screens read, so every screen behaves as today.
 * No Angular and no network here: plain functions, so they are easy to test.
 *
 * Not kept apart by the new groups: PanelMember (no role, no tick) and the difference between ITAdmin and a specialist.
 */
export type LegacyRole = 'ADMIN' | 'HM' | 'IT' | 'TA';

export interface LegacyClaims {
  isAdmin: boolean;
  roles: LegacyRole[];
  activeRole: LegacyRole;
  /** The TalentFlow pool group names the screens ask about (hasGroup). */
  groups: string[];
}

export function legacyClaimsOf(groups: readonly string[]): LegacyClaims {
  const has = (g: string) => groups.includes(g);
  const admin = has('admin') || has('naleko-talentflow-admin');
  const manager = has('manager');
  const legacy: string[] = [];
  if (admin) legacy.push('TalentFlowAdmin');
  if (manager) legacy.push('HiringManager');
  if (has('guest')) legacy.push('ComplianceOfficer');
  if (has('perm-it') && !admin) legacy.push('ITAdmin');
  if (has('perm-approve-offers') && !admin) legacy.push('FinanceLead');
  if (has('perm-recruitment') && !admin && !manager) legacy.push('HRDirector');
  const role: LegacyRole = admin ? 'ADMIN' : manager ? 'HM' : has('perm-it') ? 'IT' : 'TA';
  return { isAdmin: admin, roles: [role], activeRole: role, groups: legacy };
}
