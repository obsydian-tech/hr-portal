/** The five roles and three ticks (TEN-05 rule 1). The one place their names are written in the app. */
export const ROLE = { admin: 'admin', hrStaff: 'hr_staff', manager: 'manager', employee: 'employee', guest: 'guest' } as const;
export const PERM = { recruitment: 'perm-recruitment', it: 'perm-it', approveOffers: 'perm-approve-offers' } as const;

const ROLES: readonly string[] = Object.values(ROLE);
const PERMS: readonly string[] = Object.values(PERM);

/** The group names in a cognito:groups claim: a list, JSON text, or the "[a b]" text API Gateway sends. */
export function groupNames(claim: unknown): string[] {
  if (Array.isArray(claim)) return claim.filter((g): g is string => typeof g === 'string');
  if (typeof claim !== 'string') return [];
  const text = claim.trim();
  if (!text.startsWith('[')) return text ? [text] : [];
  try {
    const parsed: unknown = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed.filter((g): g is string => typeof g === 'string');
  } catch { /* not JSON: the [a b] form */ }
  return text.replace(/^\[|\]$/g, '').split(/[\s,]+/).filter(Boolean);
}

export function rolesOf(claim: unknown): { roles: string[]; perms: string[] } {
  const names = [...new Set(groupNames(claim))];
  return { roles: names.filter((n) => ROLES.includes(n)), perms: names.filter((n) => PERMS.includes(n)) };
}
