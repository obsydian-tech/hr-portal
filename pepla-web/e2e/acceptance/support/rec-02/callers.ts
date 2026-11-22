import { SUB, type Caller } from './world';

/**
 * REC-02: copied from ../rec-12/callers.ts (a second Recruiter and the five panel members of the vote candidate added).
 *
 * REC-12: copied from ../rec-01/callers.ts (adminB added).
 *
 * REC-01: the callers of the card's acceptance criteria. Each is a person of company A unless it says otherwise.
 * Groups are sent the way API Gateway sends them ("[a b]"); `claims` replaces or adds claims (the real list form, the
 * old TalentFlow pool's custom:roles and custom:isAdmin).
 */
const p = (name: string, groups: string[] | string | undefined, sub: string, extra: Partial<Caller> = {}): Caller => ({ name, groups, sub, ...extra });

export const C = {
  recruiter: p('Recruiter (hr_staff + perm-recruitment)', ['hr_staff', 'perm-recruitment'], SUB.recA),
  adminHr: p('Admin who is also HR with the tick', ['admin', 'hr_staff', 'perm-recruitment'], 'sub-adminhr-a'),
  hrNoTick: p('HR without the tick', ['hr_staff'], 'sub-hrnotick-a'),
  tickNoHr: p('The tick without HR', ['perm-recruitment'], 'sub-ticknohr-a'),
  adminOnly: p('Admin only', ['admin'], 'sub-admin-a'),
  hmC1: p('Manager, hiring manager of C1', ['manager'], SUB.hmA),
  hmOther: p('Manager of another role (hiring manager of C2)', ['manager'], SUB.hm2A),
  panelA: p('Panel member of I1 (employee)', ['employee'], SUB.panelA),
  panel2A: p('Panel member of I2 (employee)', ['employee'], SUB.panel2A),
  approver: p('Approver (perm-approve-offers)', ['perm-approve-offers'], 'sub-approver-a'),
  employee: p('Employee', ['employee'], 'sub-employee-a'),
  guest: p('Guest', ['guest'], 'sub-guest-a'),
  itOnly: p('IT only (perm-it)', ['perm-it'], 'sub-it-a'),
  noGroups: p('No groups claim', undefined, 'sub-nogroups-a'),
  // Today's TalentFlow pool people (TEN-05's OLD_GROUPS; TEN-06 moves them later).
  oldHr: p('Old TalentFlow HR (naleko-talentflow-hr)', ['naleko-talentflow-hr'], 'sub-oldhr-a'),
  hrDirector: p('Old HRDirector', ['HRDirector'], 'sub-hrdirector-a'),
  // S-1: the old pool's pre-token trigger gives custom:roles ["TA"] to everyone who is not ADMIN, HM or IT. The claim is not HR.
  taClaim: p('Old custom:roles ["TA"], no group', [], 'sub-ta-a', { claims: { 'custom:roles': '["TA"]' } }),
  taNoGroupsClaim: p('Old custom:roles ["TA"], no groups claim', undefined, 'sub-ta-b', { claims: { 'custom:roles': '["TA"]' } }),
  taPanelMember: p('PanelMember with the TA claim (on no panel)', ['PanelMember'], 'sub-ta-panel-a', { claims: { 'custom:roles': '["TA"]' } }),
  taFinanceLead: p('Old FinanceLead with the TA claim', ['FinanceLead'], 'sub-ta-finance-a', { claims: { 'custom:roles': '["TA"]' } }),
  taCompliance: p('ComplianceOfficer with the TA claim', ['ComplianceOfficer'], 'sub-ta-compliance-a', { claims: { 'custom:roles': '["TA"]' } }),
  taItSpecialist: p('ITSpecialist with the TA claim', ['ITSpecialist'], 'sub-ta-itspec-a', { claims: { 'custom:roles': '["TA"]' } }),
  /** A PanelMember with the TA claim who IS on the panel of I2: votes as themself, and is not a Recruiter. */
  taPanelOn2: p('PanelMember with the TA claim, on the panel of I2', ['PanelMember'], SUB.panel2A, { claims: { 'custom:roles': '["TA"]' } }),
  oldAdmin: p('Old TalentFlowAdmin', ['TalentFlowAdmin'], 'sub-oldadmin-a'),
  oldAdminClaim: p('Old custom:isAdmin "true", no group', [], 'sub-oldadminclaim-a', { claims: { 'custom:isAdmin': 'true' } }),
  oldHm: p('Old HiringManager (hiring manager of C1)', ['HiringManager'], SUB.hmA),
  oldOnboardingHr: p('Old naleko-onboarding-hr', ['naleko-onboarding-hr'], 'sub-onbhr-a'),
  financeLead: p('Old FinanceLead', ['FinanceLead'], 'sub-finance-a'),
  // Near names: none of these is a role or a tick.
  nearHrStaffx: p('hr_staffx + perm-recruitment', ['hr_staffx', 'perm-recruitment'], 'sub-near1-a'),
  nearXhrStaff: p('xhr_staff + perm-recruitment', ['xhr_staff', 'perm-recruitment'], 'sub-near2-a'),
  nearTickx: p('hr_staff + perm-recruitmentx', ['hr_staff', 'perm-recruitmentx'], 'sub-near3-a'),
  nearXtick: p('hr_staff + xperm-recruitment', ['hr_staff', 'xperm-recruitment'], 'sub-near4-a'),
  nearUpper: p('HR_STAFF + PERM-RECRUITMENT', ['HR_STAFF', 'PERM-RECRUITMENT'], 'sub-near5-a'),
  nearOneString: p('one string "hr_staff-perm-recruitment"', ['hr_staff-perm-recruitment'], 'sub-near6-a'),
  nearAdmins: p('admins', ['admins'], 'sub-near7-a'),
  // The other company.
  recruiterB: p('Recruiter of B', ['hr_staff', 'perm-recruitment'], SUB.recB, { company: 'B' }),
  managerB: p('Manager of B', ['manager'], SUB.hmB, { company: 'B' }),
  panelB: p('Panel member of B', ['employee'], SUB.panelB, { company: 'B' }),
  adminB: p('Admin of B', ['admin'], 'sub-admin-b', { company: 'B' }),
  recruiterD: p('Recruiter of D (Recruitment off)', ['hr_staff', 'perm-recruitment'], 'sub-rec-d', { company: 'D' }),
  employeeD: p('Employee of D (Recruitment off)', ['employee'], 'sub-employee-d', { company: 'D' }),
  recruiterNoCompany: p('Recruiter with no company', ['hr_staff', 'perm-recruitment'], 'sub-rec-none', { company: null }),
  employeeNoCompany: p('Employee with no company', ['employee'], 'sub-employee-none', { company: null }),
  // REC-02: a second Recruiter of A (a different person who may decide), and the five panel members of the vote candidate.
  recruiter2: p('A second Recruiter', ['hr_staff', 'perm-recruitment'], 'sub-rec2-a'),
  v1: p('Panel member 1 of the vote interview', ['employee'], 'sub-v1-a'),
  v2: p('Panel member 2 of the vote interview', ['employee'], 'sub-v2-a'),
  v3: p('Panel member 3 of the vote interview', ['employee'], 'sub-v3-a'),
  v4: p('Panel member 4 of the vote interview', ['employee'], 'sub-v4-a'),
  v5: p('Panel member 5 of the vote interview', ['employee'], 'sub-v5-a'),
} satisfies Record<string, Caller>;

/** Claim forms: the same recruiter as API Gateway can hand the groups over. */
export const RECRUITER_FORMS: Caller[] = [
  { name: 'groups as "[hr_staff perm-recruitment]"', groups: ['hr_staff', 'perm-recruitment'], sub: SUB.recA },
  { name: 'groups as a JSON list string', groups: '["hr_staff","perm-recruitment"]', sub: SUB.recA },
  { name: 'groups as "a,b"', groups: 'hr_staff,perm-recruitment', sub: SUB.recA },
  { name: 'groups as a real list', groups: [], sub: SUB.recA, claims: { 'cognito:groups': ['hr_staff', 'perm-recruitment'] } },
];

/** Who gets through the Recruiter check (rule 1; the old TalentFlow HR group names count until TEN-06, decision D-REC-1.3; the TA claim does not, S-1). */
export const RECRUITERS: Caller[] = [C.recruiter, C.adminHr, C.oldHr, C.hrDirector, ...RECRUITER_FORMS];
/** Everyone of company A who is not a Recruiter, as the cases of "403 everywhere". */
export const NOT_RECRUITERS: Caller[] = [
  C.hrNoTick, C.tickNoHr, C.adminOnly, C.hmC1, C.hmOther, C.panelA, C.panel2A, C.approver, C.employee, C.guest, C.itOnly, C.noGroups,
  C.oldAdmin, C.oldAdminClaim, C.oldHm, C.oldOnboardingHr, C.financeLead,
  C.taClaim, C.taNoGroupsClaim, C.taPanelMember, C.taFinanceLead, C.taCompliance, C.taItSpecialist,
  C.nearHrStaffx, C.nearXhrStaff, C.nearTickx, C.nearXtick, C.nearUpper, C.nearOneString, C.nearAdmins,
];
/** Admin by role (new or old name or claim). */
export const ADMINS: Caller[] = [C.adminOnly, C.adminHr, C.oldAdmin, C.oldAdminClaim];
/** A manager role (new or old name). */
export const MANAGERS: Caller[] = [C.hmC1, C.oldHm, C.hmOther];
