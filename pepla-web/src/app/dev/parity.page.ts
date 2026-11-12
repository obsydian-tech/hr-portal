import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PP_ALL } from '../ds/all';
import { PipelineCard, PipelineStage } from '../ds';
import { Proposal, LogFilter, TimelineDay, PanelMessage, NavSection, NavItem, IconName } from '../ds';

/**
 * /dev/parity: design system examples rebuilt with the Angular components, with the same words,
 * so scripts/parity.cjs can compare the two by structure and by pixels.
 * Each section is data-parity="<component slug>|<example title in the design system>".
 */
@Component({
  selector: 'app-parity-page',
  imports: [...PP_ALL, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './parity.page.html',
})
export class ParityPage {
  protected readonly now = new Date(2026, 10, 11, 14, 0);
  protected readonly shown = new Date(2026, 10, 11, 14, 2);
  private readonly bongani: PipelineCard = { id: 'bm', name: 'Bongani Mthembu', link: '/dev/parity', colour: 'green', meta: 'Interviewed 3 Nov', deadline: { due: '2026-11-10', subject: 'Interview feedback' } };
  private readonly rudo: PipelineCard = { id: 'rn', name: 'Rudo Nyathi', link: '/dev/parity', colour: 'sky', meta: 'Sales rep, Harare', lozenge: { status: 'agent', icon: 'sparkles', text: 'Interview booked by Batsi' } };
  protected readonly board: PipelineStage[] = [
    { id: 'applied', name: 'Applied', alert: { text: '1 waiting over 5 days', tone: 'warning' }, cards: [
      { id: 'tn', name: 'Tendai Ncube', link: '/dev/parity', colour: 'sky', meta: 'Applied 4 Nov', lozenge: { status: 'warning', icon: 'clock', text: 'Waiting 7 days' } },
      { id: 'mp', name: 'Mpho Phiri', link: '/dev/parity', colour: 'violet', meta: 'Applied 9 Nov · Referral' },
      { id: 'am', name: 'Ayanda Mkhize', link: '/dev/parity', colour: 'amber', meta: 'Applied 10 Nov' }] },
    { id: 'interview', name: 'Interview', alert: { text: '1 interview feedback overdue', tone: 'danger' }, cards: [this.bongani, this.rudo,
      { id: 'tk', name: 'Thabo Khumalo', link: '/dev/parity', colour: 'blue', meta: 'Interviewed 5 Nov' }] },
    { id: 'offer', name: 'Offer', cards: [{ id: 'lm', name: 'Lerato Mokoena', link: '/dev/parity', colour: 'amber', meta: 'Sales rep, Durban', lozenge: { status: 'information', icon: 'clock', text: 'Offer waits for HR' } }] },
    { id: 'hired', name: 'Hired', cards: [] },
  ];
  protected readonly phoneBoard: PipelineStage[] = [
    { id: 'applied', name: 'Applied', cards: this.board[0].cards },
    { id: 'interview', name: 'Interview', alert: { text: '1 interview feedback overdue', tone: 'danger' }, cards: [this.bongani, this.rudo] },
    { id: 'offer', name: 'Offer', cards: this.board[2].cards },
    { id: 'hired', name: 'Hired', cards: [] },
  ];
  protected readonly on = signal(true);
  protected readonly today = new Date(2026, 10, 11);
  protected readonly nov23 = new Date(2026, 10, 23);
  protected readonly dob = new Date(1992, 2, 14);
  protected readonly shownAt = new Date(2026, 10, 11, 14, 30);
  private readonly scoreWords = ['', 'weak', 'weak', 'weak', 'fair', 'fair', 'good', 'strong', 'strong', 'excellent', 'excellent'];
  protected readonly score = (v: number) => `${v} out of 10, ${this.scoreWords[v]}`;
  protected readonly percent = (v: number) => `${v}%`;
  protected readonly kagisoBank: Proposal = {
    title: "Send Kagiso Molefe's bank details to payroll", whyNow: 'Kagiso starts on 16 Nov. Payroll closes for November on 20 Nov.', confidence: 'high',
    status: { status: 'warning', text: 'Expires in 2 days', icon: 'clock' },
    sources: [{ label: 'Bank letter, FNB', icon: 'file-text', link: '/dev/bank-letter' }, { label: 'Signed offer', icon: 'file-text', link: '/dev/offer' }, { label: "Kagiso's profile", icon: 'user', link: '/dev/profile' }],
    destinations: [{ where: 'Payroll system, South Africa', what: 'name, ID ending 0876, account ending 4821', external: true }, { where: 'Naleko People, Cape Town', what: 'a record of this change', external: false }],
  };
  protected readonly tariroLaptop: Proposal = { title: 'Order the Office starter laptop and access for Tariro Moyo', whyNow: 'Tariro starts on 1 Dec.', confidence: 'high', sources: [], destinations: [] };
  protected readonly chipoReminder: Proposal = { title: 'Remind Chipo Banda to upload her tax form', whyNow: 'Her tax form is due.', confidence: 'high', sources: [], destinations: [] };
  protected readonly nomvulaBank: Proposal = {
    title: "Send Nomvula Zulu's bank details to payroll", whyNow: '', confidence: 'high', sources: [],
    destinations: [{ where: 'Payroll system, South Africa', what: 'name, account number', external: true }],
  };
  protected readonly remindBankLetters: Proposal = {
    title: 'Remind 3 new employees to upload bank letters', whyNow: 'Payroll needs them 5 working days before the first pay run', confidence: 'high', sources: [], destinations: [], effect: 'Emails to 3 people',
  };
  protected readonly kagisoId: Proposal = {
    title: "Mark Kagiso Molefe's ID as verified", whyNow: 'Kagiso starts 16 Nov', confidence: 'check', destinations: [],
    sources: [{ label: 'SA ID', icon: 'id-card', link: '/dev/id' }, { label: 'Selfie', icon: 'file-text', link: '/dev/selfie' }],
  };
  protected readonly tariroInterview: Proposal = { title: "Book Tariro Moyo's panel interview", whyNow: '', confidence: 'high', sources: [], destinations: [] };
  protected readonly verifyThree: Proposal = { title: 'Mark 3 documents as verified', whyNow: 'All three start before 1 Dec.', confidence: 'high', sources: [], destinations: [] };
  protected readonly percentSpoken = (v: number) => `${v} percent`;

  protected readonly logFilters: LogFilter[] = [
    { value: 'all', label: 'All', count: 24 }, { value: 'approved', label: 'Approved', count: 15 }, { value: 'declined', label: 'Declined', count: 3 },
    { value: 'rule', label: 'Done by a rule', count: 4 }, { value: 'failed', label: 'Expired or failed', count: 2 },
  ];
  protected readonly agentLog: TimelineDay[] = [
    { day: 'Today', events: [
      { actor: 'Batsi', summary: "sent Nomvula Zulu's bank details to payroll", outcome: { tone: 'failed', icon: 'octagon-alert', text: 'Approved by Thandeka Dlamini, but payroll refused the account number' }, when: '1 hour ago', at: '2026-11-11T10:05', exact: '11 Nov 2026, 10:05' },
      { actor: 'Batsi', summary: "sent Kagiso Molefe's bank details to payroll", outcome: { tone: 'approved', icon: 'circle-check', text: 'Approved by Thandeka Dlamini' }, when: '2 hours ago', at: '2026-11-11T09:12', exact: '11 Nov 2026, 09:12' },
      { actor: 'Batsi', summary: 'reminded Lindiwe Sibanda to upload her bank letter', outcome: { icon: 'list-checks', text: 'Done on its own under the rule', link: { label: 'Remind about missing documents', to: '/dev/rules' }, after: ', set up by Lerato Mokoena' }, when: '3 hours ago', at: '2026-11-11T08:00', exact: '11 Nov 2026, 08:00' },
      { actor: 'Batsi', summary: "suggested marking Mwila Phiri's NRC as verified", outcome: { tone: 'waiting', icon: 'info', text: 'Waiting for you.', link: { label: 'Review', to: '/dev/proposal' } }, when: '3 hours ago', at: '2026-11-11T07:45', exact: '11 Nov 2026, 07:45' },
    ] },
    { day: 'Yesterday', events: [
      { actor: 'Batsi', summary: 'suggested the Office starter laptop and access for Tariro Moyo', outcome: { icon: 'circle-x', text: 'Declined by Sipho Ndlovu' }, quote: 'Tariro is field sales. She needs the Field sales laptop and access with a phone.', when: 'Yesterday, 15:40', at: '2026-11-10T15:40', exact: '10 Nov 2026, 15:40' },
      { actor: 'Batsi', summary: 'suggested reminding Chipo Banda about her tax form', outcome: { icon: 'clock-alert', text: 'Expired. No one decided by 9 Nov, 17:00' }, when: '8 Nov 2026, 09:00', at: '2026-11-08T09:00', exact: '8 Nov 2026, 09:00' },
    ] },
  ];

  protected readonly panelChat: PanelMessage[] = [
    { day: 'Today', from: 'person', text: 'Is Kagiso ready for payroll?', at: '09:02' },
    { from: 'pepla', text: 'Nearly. His bank letter and ID check out. Payroll does not have his bank details yet. I can send them.', at: '09:02' },
    { from: 'proposal', proposal: { title: "Send Kagiso's bank details to payroll", whyNow: 'Payroll closes 20 Nov', sources: [],
      destinations: [{ where: 'Payroll system, South Africa', what: 'name, ID ending 0876, account ending 4821', external: true }], confidence: 'high' } },
  ];

  /** The app shell examples' sidebar, with `current` linked to this page so it shows as the current page. */
  protected shellNav(current: string): NavSection[] {
    const i = (label: string, icon: IconName, count?: number) => ({ label, icon, count, link: label === current ? '/dev/parity' : '/dev/' + label.toLowerCase().replace(/ /g, '-') });
    return [
      { items: [i('Today', 'house'), i('Approvals', 'circle-check', 3), i('People', 'users')] },
      { heading: 'Work', items: [i('Hire', 'user-plus'), i('Onboard', 'rocket', 2), i('Leave', 'calendar-days')] },
      { heading: 'Admin', items: [i('Payroll connection', 'plug'), i('Audit trail', 'history')] },
    ];
  }
  protected readonly shellFooter: NavItem[] = [{ label: 'Settings', icon: 'settings', link: '/dev/settings' }];
}
