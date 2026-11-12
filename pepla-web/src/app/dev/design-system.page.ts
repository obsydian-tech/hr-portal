import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import {
  PpAccordion, PpAccordionItem, PpAgentMark, PpAppIcon, PpAuditEvent, PpAuditLog, PpAutocomplete, PpAvatar, PpAvatarGroup, PpBadge,
  PpBanner, PpButton, PpButtonGroup, PpCard, PpCardAside, PpCardFooter, PpCell, PpCheckbox, PpChecklist, PpChecklistRow,
  PpConfidence, PpConfigVersion, PpDatePicker, PpDeadline, PpDescriptionList, PpDocumentChecklist, PpDocumentRow, PpDrawer, PpDrawerFooter,
  PpDropdownMenu, PpEmptyState, PpField, PpFlagGroup, PpFlags, PpForm, PpFormFooter, PpFormRow, PpFormSection, PpIcon, PpIconTile,
  PpInlineMessage, PpLink, PpLogo, PpLozenge, PpMaskedField, PpMenuItem, PpMenuSection, PpModalDialog, PpModalFooter, PpMultiSelect,
  PpPageHeader, PpPageHeaderActions, PpPagination, PpPerson, PpPersonHeader, PpPersonHeaderActions, PpProgressBar, PpProgressTracker,
  PpProposalCard, PpProposalList, PpProposalRow, PpRadioGroup, PpRestrictedCell, PpRole, PpSearch, PpSectionMessage,
  PpSectionMessageActions, PpSelect, PpSkeleton, PpSkeletonGroup, PpSkeletonRow, PpSkeletonStack, PpSortHeader, PpSpinner, PpStat,
  PpStatRow, PpTableDirective, PpTableWrap, PpTabs, PpTag, PpTagGroup, PpTextField, PpTextarea, PpTimeline, PpToggle, PpTooltip,
  PpVerification, PpLongTable, Option, Proposal, ProposalState, ProposalOutcome, PpCardBody, Step, TimelineDay, Column, PageRequest, PanelMessage, PipelineStage,
} from '../ds';
import { PP_ALL } from '../ds/all';

/**
 * /dev/design-system: every pp-* component, in its states, on one page. Built only from ds
 * components and Layout classes, like any screen, so it also proves the components cover real work.
 */
@Component({
  selector: 'app-design-system-page',
  imports: [...PP_ALL],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './design-system.page.html',
})
export class DesignSystemPage {
  private readonly flags = inject(PpFlags);
  protected readonly now = new Date(2026, 10, 11, 9, 0);

  // A long list, loaded 20 at a time as you scroll
  private readonly applicants = Array.from({ length: 60 }, (_, i) => ({
    name: ['Thandeka Dlamini', 'Sipho Ndlovu', 'Lerato Mokoena', 'Kagiso Molefe', 'Tendai Moyo', 'Chipo Banda'][i % 6],
    role: ['Bookkeeper', 'Sales rep', 'HR officer', 'Driver', 'Store manager', 'Accountant'][i % 6],
    applied: `${(i % 27) + 1} Oct 2026`,
    score: (3 + ((i * 7) % 20) / 10).toFixed(1),
  }));
  protected readonly candidateColumns: Column[] = [
    { key: 'name', label: 'Candidate' }, { key: 'role', label: 'Job' }, { key: 'applied', label: 'Applied' }, { key: 'score', label: 'Score', num: true },
  ];
  protected readonly candidates = signal(this.applicants.slice(0, 20));
  protected readonly loadingCandidates = signal(false);
  protected more(r: PageRequest) {
    this.loadingCandidates.set(true);
    setTimeout(() => {
      this.candidates.update((rows) => [...rows, ...this.applicants.slice(r.first, r.first + r.rows)]);
      this.loadingCandidates.set(false);
    }, 300);
  }
  protected readonly modal = signal(false);
  protected readonly drawer = signal(false);
  protected readonly busy = signal(false);
  protected readonly proposalState = signal<ProposalState>('waiting');
  protected readonly proposalOutcome = signal<ProposalOutcome | undefined>(undefined);
  protected approveProposal() {
    this.proposalState.set('working');
    setTimeout(() => {
      this.proposalOutcome.set({ text: 'Approved by Thandeka Dlamini. Payroll has the details.', at: '2026-11-11T09:12', when: '11 Nov 2026, 09:12' });
      this.proposalState.set('approved');
    }, 1200);
  }
  protected readonly tab = signal('interviews');
  protected readonly page = signal(2);
  protected readonly dept = signal<string | null>('people');
  protected readonly contract = signal<string | null>('permanent');
  protected readonly email = signal(true);
  protected readonly remind = signal(true);
  protected readonly query = signal('Ndlovu');
  protected readonly start = signal<Date | null>(new Date(2026, 10, 23));
  protected readonly manager = signal<Option | null>(null);
  protected readonly teams = signal<string[]>(['finance']);
  protected readonly people = signal<Option[]>([]);

  protected readonly departments: Option[] = [
    { value: 'finance', label: 'Finance' }, { value: 'people', label: 'People and culture' },
    { value: 'operations', label: 'Operations' }, { value: 'sales', label: 'Sales' },
  ];
  protected readonly contractTypes: Option[] = [
    { value: 'permanent', label: 'Permanent' },
    { value: 'fixed', label: 'Fixed term', description: 'You will be asked for the end date next' },
    { value: 'intern', label: 'Learnership or internship' },
  ];
  private readonly everyone: Option[] = ['Sipho Ndlovu', 'Lerato Mokoena', 'Thandeka Dlamini', 'Kagiso Molefe', 'Chipo Banda', 'Tariro Moyo'].map((n) => ({ value: n, label: n }));
  protected find(q: string) { this.people.set(this.everyone.filter((p) => p.label.toLowerCase().includes(q.toLowerCase()))); }

  protected readonly steps: Step[] = [
    { label: 'Offer signed', state: 'done', meta: 'Done 28 Oct' },
    { label: 'Documents checked', state: 'agent', meta: 'Checked by Batsi, 3 Nov' },
    { label: 'Laptop and access', state: 'current', meta: 'Due in 2 days' },
    { label: 'First day', state: 'upcoming', meta: '23 Nov' },
  ];
  protected readonly proposal: Proposal = {
    title: "Send Kagiso Molefe's bank details to payroll",
    whyNow: 'Kagiso starts on 16 Nov. Payroll closes for November on 20 Nov.',
    sources: [
      { label: 'Bank letter, FNB', icon: 'file-text', link: '/dev/design-system' },
      { label: 'Signed offer', icon: 'file-text', link: '/dev/design-system' },
      { label: "Kagiso's profile", icon: 'user', link: '/dev/design-system' },
    ],
    destinations: [
      { where: 'Payroll system, South Africa', what: 'name, ID ending 0876, account ending 4821', external: true },
      { where: 'Naleko People, Cape Town', what: 'a record of this change', external: false },
    ],
    confidence: 'high',
    status: { status: 'warning', text: 'Expires in 2 days', icon: 'clock' },
  };
  protected readonly reminder: Proposal = {
    title: 'Remind 3 new employees to upload bank letters', whyNow: 'Payroll needs them 5 working days before the first pay run',
    sources: [{ label: 'Document checklist', icon: 'file-text', link: '/dev/design-system' }],
    destinations: [{ where: 'Naleko People', what: 'emails to 3 people', external: false }], confidence: 'high',
  };
  protected readonly unsure: Proposal = {
    title: "Mark Kagiso Molefe's ID as verified", whyNow: 'Kagiso starts 16 Nov',
    sources: [{ label: 'ID document', icon: 'id-card', link: '/dev/design-system' }, { label: 'Home Affairs', icon: 'shield-check', link: '/dev/design-system' }],
    destinations: [{ where: 'Naleko People', what: 'the verification result', external: false }], confidence: 'check',
  };
  protected readonly history: TimelineDay[] = [
    { day: 'Today', events: [
      { actor: 'Batsi', summary: "drafted Kagiso's offer letter", detail: 'Approved by Thandeka Dlamini, 10 min ago', when: '2 hours ago', at: '2026-11-11T09:12', exact: '11 Nov 2026, 09:12' },
      { actor: 'Lerato Mokoena', summary: 'moved Kagiso to Offer', when: '3 hours ago', at: '2026-11-11T08:05', exact: '11 Nov 2026, 08:05' },
    ] },
    { day: 'Yesterday', events: [
      { actor: 'Sipho Ndlovu', summary: 'scored the panel interview', detail: '4.2 of 5', when: '10 Nov, 16:30', at: '2026-11-10T16:30', exact: '10 Nov 2026, 16:30' },
    ] },
  ];

  protected save() { this.busy.set(true); setTimeout(() => { this.busy.set(false); this.flags.show({ tone: 'success', title: 'Contract sent to Lerato Mokoena', body: "She'll get an email and an SMS." }); }, 1200); }
  protected flag(tone: 'success' | 'warning' | 'error' | 'agent') {
    const t = { success: 'Leave approved', warning: 'Payroll sync is slow', error: "Couldn't send the contract", agent: 'Batsi chased 2 documents' }[tone];
    this.flags.show({ tone, title: t, body: tone === 'error' ? 'Check your connection and try again.' : undefined, action: tone === 'success' ? { label: 'Undo', run: () => {} } : undefined });
  }

  // Try them: live versions of the newer pieces. Batsi's replies here are canned: nothing calls a model.
  protected readonly pepla = signal(false);
  protected readonly thinking = signal<string | undefined>(undefined);
  protected readonly chat = signal<PanelMessage[]>([{ day: 'Today', from: 'pepla', text: 'Hi. This is a preview: I answer with a fixed line and change nothing.' }]);
  protected ask(text: string) {
    this.chat.update((c) => [...c, { from: 'person', text, at: '09:00' }]);
    this.thinking.set('Batsi is reading the question');
    setTimeout(() => {
      if (!this.thinking()) return;
      this.thinking.set(undefined);
      this.chat.update((c) => [...c, { from: 'pepla', text: 'In the app I would answer here. In this preview I only show how the panel behaves.', at: '09:00' }]);
    }, 900);
  }
  protected readonly stage = signal<string | null>('second');
  protected readonly stages: Option[] = [
    { group: 'Screening', value: 'applied', label: 'Applied' }, { group: 'Screening', value: 'phone', label: 'Phone screen' },
    { group: 'Interviews', value: 'second', label: 'Second interview' },
    { group: 'Interviews', value: 'offer', label: 'Offer', description: "Needs the hiring manager's approval" },
    { group: 'Interviews', value: 'hired', label: 'Hired', description: 'After the offer is signed', disabled: true },
  ];
  protected readonly buddy = signal<string | null>(null);
  protected readonly buddies: Option[] = [
    ['Thandeka Dlamini', 'People and culture, Johannesburg'], ['Thabo Khumalo', 'Finance, Harare'], ['Sipho Ndlovu', 'Finance, Johannesburg'],
    ['Chipo Banda', 'Sales, Lusaka'], ['Tariro Moyo', 'Sales, Harare'], ['Lerato Mokoena', 'HR, Durban'],
  ].map(([label, description]) => ({ value: label, label, description, icon: 'user' as const }));
  protected readonly accent = signal('00668D');
  protected readonly board = signal<PipelineStage[]>([
    { id: 'applied', name: 'Applied', cards: [
      { id: 'tn', name: 'Tendai Ncube', link: '/dev/design-system', colour: 'sky', meta: 'Applied 4 Nov' },
      { id: 'mp', name: 'Mpho Phiri', link: '/dev/design-system', colour: 'violet', meta: 'Applied 9 Nov · Referral' }] },
    { id: 'interview', name: 'Interview', cards: [{ id: 'tk', name: 'Thabo Khumalo', link: '/dev/design-system', colour: 'blue', meta: 'Interviewed 5 Nov' }] },
    { id: 'offer', name: 'Offer', cards: [] },
    { id: 'hired', name: 'Hired', cards: [] },
  ]);
}
