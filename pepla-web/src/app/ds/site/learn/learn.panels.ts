import { ChangeDetectionStrategy, Component } from '@angular/core';
import { PpIcon } from '../../core/icon';

// The panels of the Learn more demos that more than one page shares (SITE-08). Each is the kit's panel, word for word; what moves in it
// is `learn.engines.ts`, started by the demo section that holds it. A page that needs another panel adds its own beside these.

/** Rows that step in one after another: the leave types of the Leave page, the "Demo section" of the kit. Spec: SITE-08, kit "Site pages" (Leave page, `data-demo="types"`); timings in `learn.engines.ts`. */
@Component({
  selector: 'div[ppSiteLearnRows]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
<div class="pp-site-demo__top"><span class="pp-site-demo__top-title">Leave types</span><span class="pp-site-demo__top-note">Sample data</span></div>
<div class="pp-site-demo__body"><div class="pp-site-demo__row pp-site-step pp-site-step--in"><span class="pp-site-demo__row-name">Annual leave</span><span class="pp-site-demo__row-note">15 working days a year</span><span class="pp-site-status">BCEA</span></div>
<div class="pp-site-demo__row pp-site-step pp-site-step--in"><span class="pp-site-demo__row-name">Sick leave</span><span class="pp-site-demo__row-note">30 days over a 36-month cycle</span><span class="pp-site-status">BCEA</span></div>
<div class="pp-site-demo__row pp-site-step pp-site-step--in"><span class="pp-site-demo__row-name">Family responsibility leave</span><span class="pp-site-demo__row-note">3 days a year</span><span class="pp-site-status">BCEA</span></div>
<div class="pp-site-demo__row pp-site-step pp-site-step--in"><span class="pp-site-demo__row-name">Maternity leave</span><span class="pp-site-demo__row-note">4 consecutive months</span><span class="pp-site-status">BCEA</span></div>
<div class="pp-site-demo__row pp-site-demo__row--brand pp-site-step pp-site-step--in"><span class="pp-site-demo__row-name">Study leave</span><span class="pp-site-demo__row-note">Added by Jane Smith · 5 days a year</span><span class="pp-site-status pp-site-status--brand">Company type</span></div>
</div>
<button class="pp-site-demo__again pp-site-demo__again--in" type="button">Play again</button>
  `,
  host: { 'class': 'pp-site-demo__panel', 'role': 'group', 'aria-label': 'Sample: leave types' },
})
export class PpSiteLearnRows {}

/** The timeline piece: events arrive one after another along a line, with a suggestion from Batsi (Recruitment, reminders). Spec: SITE-08, kit "Site pages" (Recruitment page, `data-demo="follow"`); timings in `learn.engines.ts`. */
@Component({
  selector: 'div[ppSiteLearnTimeline]',
  imports: [PpIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
<div class="pp-site-demo__top"><span class="pp-site-demo__top-title">Candidate 3</span><span class="pp-site-state" role="status"><span aria-hidden="true" class="pp-site-status pp-site-status--warning pp-site-state__item" data-state="f2">Feedback 2 of 3</span><span aria-hidden="true" class="pp-site-status pp-site-status--success pp-site-state__item" data-state="f3">Feedback 3 of 3</span><span aria-hidden="true" class="pp-site-status pp-site-status--warning pp-site-state__item" data-state="nr">No reply</span><span class="pp-site-status pp-site-status--success pp-site-state__item pp-site-state__item--on" data-state="rs">Reminder sent</span></span><span class="pp-site-demo__top-note">Panel interview · Thu</span></div>
<div class="pp-site-demo__body"><div class="pp-site-timeline"><ol class="pp-site-timeline__list"><li aria-hidden="true" class="pp-site-timeline__line"></li>
<li aria-hidden="true" class="pp-site-timeline__fill" style="--_fill: 1"></li>
<li class="pp-site-timeline__item pp-site-step pp-site-step--in"><span class="pp-site-timeline__dot"></span><div class="pp-site-timeline__text"><span>Feedback submitted by Panel 1 and Panel 2<span class="pp-visually-hidden"> on</span></span><span class="pp-site-timeline__when">Thu 13 Nov, 16:00</span></div>
<span class="pp-site-status pp-site-status--success">2 of 3</span></li>
<li class="pp-site-timeline__item pp-site-step pp-site-step--in"><span class="pp-site-timeline__dot"></span><div class="pp-site-timeline__text"><span>Reminder to Panel 3<span class="pp-visually-hidden"> on</span></span><span class="pp-site-timeline__when">Fri 14 Nov, 09:00</span></div>
<span class="pp-lozenge pp-lozenge--agent"><svg ppIcon="sparkles" />Batsi</span></li>
<li class="pp-site-timeline__item pp-site-timeline__item--done pp-site-step pp-site-step--in"><span class="pp-site-timeline__dot"></span><div class="pp-site-timeline__text"><span>Feedback submitted by Panel 3<span class="pp-visually-hidden"> on</span></span><span class="pp-site-timeline__when">Fri 14 Nov, 11:40</span></div>
<span class="pp-site-status pp-site-status--success">3 of 3</span></li>
<li class="pp-site-timeline__item pp-site-timeline__item--hr pp-site-step pp-site-step--in"><span class="pp-site-timeline__dot"></span><div class="pp-site-timeline__text"><span>No reply from Candidate 3 in 5 days</span><span class="pp-site-timeline__when">Mon 17 Nov, 09:00</span></div>
<span class="pp-site-status pp-site-status--warning">Flagged</span></li>
<li class="pp-site-timeline__item pp-site-step pp-site-step--in"><span class="pp-site-timeline__dot"></span><div class="pp-site-timeline__text"><span>Reminder drafted, sent by Jane Smith</span><span class="pp-site-timeline__when">Mon 17 Nov, 09:42</span></div>
<span class="pp-lozenge pp-lozenge--agent"><svg ppIcon="sparkles" />Batsi</span></li>
</ol></div>
<div class="pp-site-suggest pp-site-step pp-site-step--in"><span aria-hidden="true" class="pp-site-suggest__icon"><svg ppIcon="sparkles" /></span><span class="pp-site-suggest__text"><span class="pp-site-suggest__lead">Draft for Candidate 3.</span> "A reminder that your panel interview for Sales Consultant is on Thursday at 10:00. Please confirm you can attend."</span></div>
</div>
<button class="pp-site-demo__again pp-site-demo__again--in" type="button">Play again</button>
  `,
  host: { 'class': 'pp-site-demo__panel', 'role': 'group', 'aria-label': 'Sample: reminders on Candidate 3' },
})
export class PpSiteLearnTimeline {}

/** The document read piece: Batsi reads a document, the checks tick, HR accepts (Onboarding). Spec: SITE-08, kit "Site pages" (Onboarding page, `data-demo="read"`); timings in `learn.engines.ts`. */
@Component({
  selector: 'div[ppSiteLearnDocRead]',
  imports: [PpIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
<div class="pp-site-demo__top"><span class="pp-site-demo__top-title">ID document</span><span class="pp-site-state" role="status"><span aria-hidden="true" class="pp-site-status pp-site-status--brand pp-site-state__item pp-site-state__item--pulse" data-state="reading">Reading</span><span aria-hidden="true" class="pp-site-status pp-site-status--success pp-site-state__item" data-state="matches">Matches</span><span class="pp-site-status pp-site-status--success pp-site-state__item pp-site-state__item--on" data-state="accepted">Accepted</span></span><span class="pp-site-demo__top-note">John Doe</span></div>
<div class="pp-site-demo__body"><div class="pp-site-read"><div class="pp-site-read__row"><div aria-hidden="true" class="pp-site-read__doc"><span class="pp-site-read__scan"></span></div>
<div class="pp-site-read__fields"><div class="pp-site-read__field"><span class="pp-site-read__label">Name</span><strong class="pp-site-read__value pp-site-read__value--in">John Doe</strong></div>
<div class="pp-site-read__field"><span class="pp-site-read__label">ID number</span><strong class="pp-site-read__value pp-site-read__value--in">Hidden · ends 0861</strong></div>
<div class="pp-site-read__field"><span class="pp-site-read__label">Date of birth</span><strong class="pp-site-read__value pp-site-read__value--in">14 Jun 1996</strong></div>
<div class="pp-site-read__field"><span class="pp-site-read__label">Citizenship</span><strong class="pp-site-read__value pp-site-read__value--in">South African</strong></div>
</div>
</div>
<div class="pp-site-read__checks"><div class="pp-site-read__check pp-site-step pp-site-step--in"><span class="pp-site-ok pp-site-ok--in"><svg ppIcon="check" /></span>ID number has 13 digits</div>
<div class="pp-site-read__check pp-site-step pp-site-step--in"><span class="pp-site-ok pp-site-ok--in"><svg ppIcon="check" /></span>Date of birth matches the ID number</div>
<div class="pp-site-read__check pp-site-step pp-site-step--in"><span class="pp-site-ok pp-site-ok--in"><svg ppIcon="check" /></span>Name matches the employee record</div>
</div>
<div class="pp-site-read__suggest pp-site-step pp-site-step--in"><span class="pp-site-read__who"><svg ppIcon="sparkles" />Suggested by Batsi</span><span class="pp-site-status pp-site-status--success">Matches</span><span class="pp-site-status">Confidence: High</span><span class="pp-site-read__why">Name, ID number and date of birth agree with the employee record.</span></div>
<div class="pp-site-read__decide pp-site-read__decide--done pp-site-step pp-site-step--in"><button class="pp-button pp-button--primary pp-button--small" type="button">Accept document</button>
<button class="pp-button pp-button--default pp-button--small" tabindex="-1" type="button">Ask for a new one</button>
<span class="pp-site-read__accepted"><span class="pp-site-ok pp-site-ok--in"><svg ppIcon="check" /></span>Accepted by Jane Smith, 09:42</span></div>
<span class="pp-site-read__log pp-site-step pp-site-step--in"><svg ppIcon="file-text" />Logged: Batsi suggested, Jane Smith decided</span></div>
</div>
<button class="pp-site-demo__again pp-site-demo__again--in" type="button">Play again</button>
  `,
  host: { 'class': 'pp-site-demo__panel', 'role': 'group', 'aria-label': 'Sample: ID document check' },
})
export class PpSiteLearnDocRead {}

/** The suggestion piece: a request waits, Batsi reminds, a person approves or declines (Leave approvals). Spec: SITE-08, kit "Site pages" (Leave page, `data-demo="appr"`); timings in `learn.engines.ts`. */
@Component({
  selector: 'div[ppSiteLearnSuggestion]',
  imports: [PpIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
<div class="pp-site-demo__top"><span class="pp-site-demo__top-title">John Doe · Annual leave</span><span class="pp-site-state pp-site-state--end" role="status"><span aria-hidden="true" class="pp-site-status pp-site-state__item" data-state="none">No request</span><span aria-hidden="true" class="pp-site-status pp-site-status--warning pp-site-state__item" data-state="wait">Waiting for approval</span><span class="pp-site-status pp-site-status--success pp-site-state__item pp-site-state__item--on" data-state="done">Approved</span><span aria-hidden="true" class="pp-site-status pp-site-status--brand pp-site-state__item" data-state="no">Declined with a reason</span></span></div>
<div class="pp-site-demo__body"><div class="pp-site-approval"><p class="pp-site-approval__meta">14 to 18 Dec · 4 working days · Line manager approval</p>
<div class="pp-site-suggest pp-site-step pp-site-step--in"><span aria-hidden="true" class="pp-site-suggest__icon"><svg ppIcon="sparkles" /></span><span class="pp-site-suggest__text"><span class="pp-site-suggest__lead">Batsi.</span> Waiting 1 day. Reminder sent to the line manager.</span></div>
<div class="pp-site-approval__decide pp-site-approval__decide--done"><button class="pp-button pp-button--primary pp-button--small" type="button">Approve</button>
<button class="pp-button pp-button--default pp-button--small" type="button">Decline</button>
<span class="pp-site-approval__accepted"><span aria-hidden="true" class="pp-site-ok pp-site-ok--in"><svg ppIcon="check" /></span>Approved by the line manager, 10:05</span></div>
<span class="pp-site-approval__log pp-site-step pp-site-step--in"><svg ppIcon="file-text" /> Logged: annual leave approved, 4 days deducted</span></div>
</div>
<button class="pp-site-demo__again pp-site-demo__again--in" type="button">Play again</button>
  `,
  host: { 'class': 'pp-site-demo__panel', 'role': 'group', 'aria-label': 'Sample: leave approval' },
})
export class PpSiteLearnSuggestion {}

/** The live status piece: a status that follows the steps of a chase until it is received (Onboarding follow-ups). Spec: SITE-08, kit "Site pages" (Onboarding page, `data-demo="follow"`); timings in `learn.engines.ts`. */
@Component({
  selector: 'div[ppSiteLearnLiveStatus]',
  imports: [PpIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
<div class="pp-site-demo__top"><span class="pp-site-demo__top-title">UIF reference number</span><span class="pp-site-state" role="status"><span aria-hidden="true" class="pp-site-status pp-site-status--warning pp-site-state__item" data-state="missing">Missing</span><span class="pp-site-status pp-site-status--success pp-site-state__item pp-site-state__item--on" data-state="received">Received</span></span><span class="pp-site-demo__top-note">John Doe</span></div>
<div class="pp-site-demo__body"><div class="pp-site-timeline"><ol class="pp-site-timeline__list"><li aria-hidden="true" class="pp-site-timeline__line"></li>
<li aria-hidden="true" class="pp-site-timeline__fill" style="--_fill: 1"></li>
<li class="pp-site-timeline__item pp-site-step pp-site-step--in"><span class="pp-site-timeline__dot"></span><div class="pp-site-timeline__text"><span>Requested from John Doe</span><span class="pp-site-timeline__when">Mon 17 Nov, 09:00</span></div>
<span class="pp-lozenge pp-lozenge--agent"><svg ppIcon="sparkles" />Batsi</span></li>
<li class="pp-site-timeline__item pp-site-step pp-site-step--in"><span class="pp-site-timeline__dot"></span><div class="pp-site-timeline__text"><span>Reminder sent</span><span class="pp-site-timeline__when">Wed 19 Nov, 09:00</span></div>
<span class="pp-lozenge pp-lozenge--agent"><svg ppIcon="sparkles" />Batsi</span></li>
<li class="pp-site-timeline__item pp-site-step pp-site-step--in"><span class="pp-site-timeline__dot"></span><div class="pp-site-timeline__text"><span>Second reminder sent</span><span class="pp-site-timeline__when">Fri 21 Nov, 09:00</span></div>
<span class="pp-lozenge pp-lozenge--agent"><svg ppIcon="sparkles" />Batsi</span></li>
<li class="pp-site-timeline__item pp-site-timeline__item--hr pp-site-step pp-site-step--in"><span class="pp-site-timeline__dot"></span><div class="pp-site-timeline__text"><span>Jane Smith told: still missing</span><span class="pp-site-timeline__when">Mon 24 Nov, 09:00</span></div>
<span class="pp-site-status pp-site-status--warning">HR</span></li>
<li class="pp-site-timeline__item pp-site-timeline__item--done pp-site-step pp-site-step--in"><span class="pp-site-timeline__dot"></span><div class="pp-site-timeline__text"><span>Received and matched</span><span class="pp-site-timeline__when">Mon 24 Nov, 11:20</span></div>
<span class="pp-site-status pp-site-status--success">Done</span></li>
</ol><div class="pp-site-timeline__waiting pp-site-step pp-site-step--in"><span class="pp-site-timeline__group">Waiting on</span><div class="pp-site-timeline__waiting-row">Employee 2 · Bank letter<span class="pp-site-status pp-site-status--warning">2 reminders sent</span></div>
<div class="pp-site-timeline__waiting-row">Employee 3 · Matric certificate<span class="pp-site-status pp-site-status--brand">Requested today</span></div>
</div>
</div>
</div>
<button class="pp-site-demo__again pp-site-demo__again--in" type="button">Play again</button>
  `,
  host: { 'class': 'pp-site-demo__panel', 'role': 'group', 'aria-label': 'Sample: follow-ups for a missing document' },
})
export class PpSiteLearnLiveStatus {}

/** The approval decision and log line piece: waiting actions, Approve, and the line that records it (Security approvals). Spec: SITE-08, kit "Site pages" (Security page, `data-demo="sec-appr"`); timings in `learn.engines.ts`. */
@Component({
  selector: 'div[ppSiteLearnApprovalLog]',
  imports: [PpIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
<div class="pp-site-demo__top"><span class="pp-site-demo__top-title">Approval queue</span><span class="pp-site-demo__top-note">Sample data</span></div>
<div class="pp-site-demo__body"><div class="pp-site-queue"><div class="pp-site-queue__item pp-site-queue__item--agent pp-site-step pp-site-step--in"><div class="pp-site-queue__row"><span class="pp-site-who pp-site-who--agent"><span class="pp-site-who__kind">Agent</span>Batsi</span><span class="pp-site-state" role="status"><span aria-hidden="true" class="pp-site-status pp-site-status--warning pp-site-state__item" data-state="wait">Waiting for approval</span><span class="pp-site-status pp-site-status--success pp-site-state__item pp-site-state__item--on" data-state="done">Approved</span></span></div>
<span class="pp-site-queue__name">Reminder to Candidate 3</span><span class="pp-site-queue__note">Bank letter and matric missing. Drafted 09:43.</span></div>
<div class="pp-site-queue__item pp-site-step pp-site-step--in"><div class="pp-site-queue__row"><span class="pp-site-queue__name">HR system sync</span><span class="pp-site-status">API key</span></div>
<span class="pp-site-queue__note">Check documents · John Doe · 10:12</span></div>
</div>
<div class="pp-site-approval"><div class="pp-site-approval__decide pp-site-approval__decide--done pp-site-step pp-site-step--in"><button class="pp-button pp-button--primary pp-button--small" type="button">Approve</button>
<button class="pp-button pp-button--default pp-button--small" tabindex="-1" type="button">Reject</button>
<span class="pp-site-approval__accepted"><span aria-hidden="true" class="pp-site-ok pp-site-ok--in"><svg ppIcon="check" /></span>Approved by Jane Smith, 09:44. Reminder sent.</span></div>
<span class="pp-site-approval__log pp-site-step pp-site-step--in"><svg ppIcon="file-text" />Logged: reminder approved by Jane Smith</span></div>
</div>
<button class="pp-site-demo__again pp-site-demo__again--in" type="button">Play again</button>
  `,
  host: { 'class': 'pp-site-demo__panel', 'role': 'group', 'aria-label': 'Sample: approval queue' },
})
export class PpSiteLearnApprovalLog {}

/** The choices and slots piece: buttons that choose what the panel shows, cycling until one is pressed (Platform roles). Spec: SITE-08, kit "Site pages" (Platform page, `data-demo="plat-roles"`); timings in `learn.engines.ts`. */
@Component({
  selector: 'div[ppSiteLearnChoices]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
<div class="pp-site-demo__top"><span class="pp-site-demo__top-title">Roles and access</span><span class="pp-site-demo__top-note">Sample company</span></div>
<div class="pp-site-demo__body"><div class="pp-site-roles"><div class="pp-site-slots"><div aria-label="Roles" class="pp-site-slots__row" role="group"><button aria-pressed="true" class="pp-site-slot" data-r="0" type="button"><span class="pp-site-slot__label">Administrator</span><span aria-hidden="true" class="pp-site-slot__label pp-site-slot__label--on">Administrator</span></button>
<button aria-pressed="false" class="pp-site-slot" data-r="1" type="button"><span class="pp-site-slot__label">HR</span><span aria-hidden="true" class="pp-site-slot__label pp-site-slot__label--on">HR</span></button>
<button aria-pressed="false" class="pp-site-slot" data-r="2" type="button"><span class="pp-site-slot__label">Manager</span><span aria-hidden="true" class="pp-site-slot__label pp-site-slot__label--on">Manager</span></button>
<button aria-pressed="false" class="pp-site-slot" data-r="3" type="button"><span class="pp-site-slot__label">Employee</span><span aria-hidden="true" class="pp-site-slot__label pp-site-slot__label--on">Employee</span></button>
<button aria-pressed="false" class="pp-site-slot" data-r="4" type="button"><span class="pp-site-slot__label">Guest</span><span aria-hidden="true" class="pp-site-slot__label pp-site-slot__label--on">Guest</span></button>
</div>
</div>
<div aria-live="polite" class="pp-site-roles__box"><h3 class="pp-site-roles__name">Administrator</h3>
<p class="pp-site-roles__text">Sets up the company, users and roles.</p>
<div class="pp-site-roles__access"><div class="pp-site-roles__item"><span>Settings and users</span><span class="pp-site-status pp-site-status--success">Full</span></div>
<div class="pp-site-roles__item"><span>All modules switched on</span><span class="pp-site-status pp-site-status--success">Full</span></div>
<div class="pp-site-roles__item"><span>Audit log</span><span class="pp-site-status pp-site-status--success">View</span></div>
</div>
</div>
</div>
</div>
  `,
  host: { 'class': 'pp-site-demo__panel', 'role': 'group', 'aria-label': 'Sample: roles and access' },
})
export class PpSiteLearnChoices {}
