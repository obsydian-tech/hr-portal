import { registerNav, type Access } from './nav';
import { PERM, ROLE } from './roles';

/** Hire needs the Recruitment module, the HR role and the Recruitment tick together (MOD-02 `allOf`). The group names stay in core/. */
export const HIRE_ACCESS: Access = { module: 'recruitment', allOf: [ROLE.hrStaff, PERM.recruitment] };

/** The Hire entries (REC-UI-01). Register once, before the first sidebar is built. */
export function registerRecruitmentNav(): void {
  registerNav([
    { id: 'rec-roles', group: 'Hire', label: 'Roles', icon: 'briefcase', route: '/hire/roles', order: 1, ...HIRE_ACCESS },
    { id: 'rec-pipeline', group: 'Hire', label: 'Pipeline', icon: 'columns-3', route: '/hire/pipeline', order: 2, ...HIRE_ACCESS },
  ]);
}
