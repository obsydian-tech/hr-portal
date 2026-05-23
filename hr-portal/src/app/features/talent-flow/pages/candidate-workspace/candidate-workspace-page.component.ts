import {
  Component,
  ChangeDetectionStrategy,
  OnInit,
  inject,
  signal,
  computed,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { ButtonModule } from 'primeng/button';
import { TalentFlowStateService } from '../../services/talent-flow-state.service';
import { TalentFlowApiService } from '../../services/talent-flow-api.service';
import { STAGE_LABELS } from '../../components/stage-selector/stage-selector.component';
import { AiChatPanelComponent } from '../../components/ai-chat-panel/ai-chat-panel.component';
import { AddPanelMembersPayload, AdhocPanelMember, Candidate, CandidateEvent, EngagementSentiment, HiringStage, InterviewType, PanelMember, ScheduleInterviewPayload, ScoringWeights, DEFAULT_SCORING_WEIGHTS, PHASE_MAP } from '../../models/talent-flow.models';
import { OfferTabComponent } from '../../components/offer-tab/offer-tab.component';
import { CandidateEditDrawerComponent } from '../../components/candidate-edit-drawer/candidate-edit-drawer.component';

/**
 * CandidateWorkspacePageComponent — FE-004 / NH-137
 *
 * Design source: EmployeeDetail.jsx master-detail layout
 *   - Left rail: avatar header + identity + stage stepper
 *   - Right panel: tabbed detail (Overview, Timeline, Votes)
 *
 * Route: /talent-flow/candidates/:id
 *
 * On init: reads route param → loads candidate if not in pipeline cache →
 *   sets activeCandidateId on TalentFlowStateService.
 *
 * StageSelector: rendered readonly — hiring managers progress stage
 *   via explicit action buttons, not drag → FE-005/006.
 */

// D027: fixed 5 tabs in this order
export type WorkspaceTab = 'overview' | 'interviews' | 'offer' | 'engagement' | 'notes';

/** All HiringStage values in workflow order */
export const ALL_STAGES: HiringStage[] = Object.keys(STAGE_LABELS) as HiringStage[];

@Component({
  selector: 'tf-candidate-workspace-page',
  standalone: true,
  imports: [
    CommonModule,
    ButtonModule,
    AiChatPanelComponent,
    OfferTabComponent,
    CandidateEditDrawerComponent,
  ],
  templateUrl: './candidate-workspace-page.component.html',
  styleUrl: './candidate-workspace-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CandidateWorkspacePageComponent implements OnInit {
  protected readonly state = inject(TalentFlowStateService);
  private readonly api = inject(TalentFlowApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly defaultWeights: ScoringWeights = DEFAULT_SCORING_WEIGHTS;

  protected readonly activeTab        = signal<WorkspaceTab>('overview');
  protected readonly candidateId      = signal<string | null>(null);
  protected readonly loading          = signal<boolean>(false);
  protected readonly fetchError       = signal<string | null>(null);
  protected readonly chatVisible      = signal<boolean>(false);
  protected readonly editDrawerVisible = signal<boolean>(false);

  // FE-006: event timeline
  protected readonly eventsLoading = signal<boolean>(false);
  protected readonly eventsError   = signal<string | null>(null);
  protected readonly events         = signal<CandidateEvent[]>([]);
  private _eventsLoaded             = false;

  /** All stages shown for the stepper */
  protected readonly allStages = ALL_STAGES;

  /**
   * Candidate record: prefer pipeline cache (populated when coming from pipeline
   * page), fall back to direct fetch result (when navigating directly via URL).
   */
  private readonly _directCandidate = signal<Candidate | undefined>(undefined);

  protected readonly candidate = computed<Candidate | undefined>(
    () => this.state.activeCandidate() ?? this._directCandidate(),
  );

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      void this.router.navigate(['/platform/talentflow']);
      return;
    }
    this.candidateId.set(id);

    // If candidate already in pipeline cache (e.g. came from pipeline page), use it
    const inCache = this.state.pipeline().find((c) => c.id === id);
    if (inCache) {
      this.state.setActiveCandidate(id);
      if (inCache.interviewSentiment) {
        const s = inCache.interviewSentiment as EngagementSentiment;
        this.engagementSentiment.set(s);
      }
      this._loadEvents(id);
      return;
    }

    // Not in cache — fetch directly to avoid race condition with pipeline load
    this.loading.set(true);
    this.state.setActiveCandidate(id);
    this.api.getCandidate(id).subscribe({
      next: (c: Candidate) => {
        this._directCandidate.set(c);
        this.loading.set(false);
        if (c.interviewSentiment) {
          this.engagementSentiment.set(c.interviewSentiment as EngagementSentiment);
        }
        this._loadEvents(id);
      },
      error: () => {
        this.fetchError.set('Could not load candidate.');
        this.loading.set(false);
      },
    });
  }

  protected setTab(tab: WorkspaceTab): void {
    this.activeTab.set(tab);
    // lazy-load event history when switching to Engagement tab
    if (tab === 'engagement' && !this._eventsLoaded) {
      const id = this.candidateId();
      if (id) this._loadEvents(id);
    }
  }

  private _loadEvents(id: string): void {
    this._eventsLoaded = true;
    this.eventsLoading.set(true);
    this.eventsError.set(null);
    this.api.getCandidateEvents(id, { limit: 100 }).subscribe({
      next: (res) => {
        this.events.set(res.events);
        this.eventsLoading.set(false);
      },
      error: () => {
        this.eventsError.set('Could not load event timeline.');
        this.eventsLoading.set(false);
      },
    });
  }

  protected goBack(): void {
    void this.router.navigate(['/platform/talentflow/pipeline']);
  }

  protected onCandidateSaved(updated: Candidate): void {
    this._directCandidate.set(updated);
    this.state.patchCandidate(updated);
    this.editDrawerVisible.set(false);
  }

  protected toggleChat(): void {
    this.chatVisible.update((v) => !v);
  }

  protected goToEvaluate(candidateId: string): void {
    // Evaluation route removed (D048 — inline scoring in HM dashboard).
    // Navigate to the candidate workspace so TA can review submitted panel votes.
    void this.router.navigate(['/platform/talentflow/candidates', candidateId]);
  }

  protected toDate(iso: string): Date {
    return new Date(iso);
  }

  protected readonly defaultThreshold = 72;

  // ── Phase stepper (D029) ──────────────────────────────────────────────────
  protected readonly PHASES = [
    { phase: 1, label: 'Interview & Evaluation', desc: 'Screen, evaluate, decide' },
    { phase: 2, label: 'Offer & Acceptance',      desc: 'Create, approve, convert' },
    { phase: 3, label: 'Pre-Onboarding',          desc: 'Prepare, provision, clear' },
    { phase: 4, label: 'Onboarding & Day 1',      desc: 'Engage, activate, confirm' },
  ] as const;

  protected currentPhase(c: Candidate): number {
    return PHASE_MAP[c.currentStage] ?? 1;
  }

  protected healthPillClass(c: Candidate): string {
    if (c.slaStatus === 'BREACHED') return 'tf-health-pill tf-health-pill--breached';
    if (c.slaStatus === 'AT_RISK')  return 'tf-health-pill tf-health-pill--at-risk';
    return 'tf-health-pill tf-health-pill--on-track';
  }

  protected healthLabel(c: Candidate): string {
    if (c.slaStatus === 'BREACHED') return 'Breached';
    if (c.slaStatus === 'AT_RISK')  return 'At Risk';
    return 'On Track';
  }

  protected slaBarWidth(c: Candidate): number {
    if (c.slaStatus === 'BREACHED') return 100;
    if (c.slaStatus === 'AT_RISK')  return 82;
    return 35;
  }

  protected initials(c: Candidate): string {
    return (c.firstName[0] + c.lastName[0]).toUpperCase();
  }

  protected workflowLabel(id: string): string {
    const map: Record<string, string> = {
      'standard-v1':  'Standard',
      'fasttrack-v1': 'Fast Track',
    };
    return map[id] ?? id;
  }

  protected avatarClass(c: Candidate): string {
    if (c.slaStatus === 'BREACHED') return 'tf-ws-avatar tf-ws-avatar--breached';
    if (c.slaStatus === 'AT_RISK')  return 'tf-ws-avatar tf-ws-avatar--at-risk';
    return 'tf-ws-avatar tf-ws-avatar--healthy';
  }

  // ── Advance Stage ─────────────────────────────────────────────────────
  protected readonly advancingStage  = signal<boolean>(false);
  protected readonly advanceError    = signal<string | null>(null);
  protected readonly advanceSuccess  = signal<string | null>(null);

  protected readonly stageLabels = STAGE_LABELS;

  protected stageLabelFor(stage: string | null | undefined): string {
    return stage ? (STAGE_LABELS[stage as HiringStage] ?? stage) : '';
  }

  protected nextStageFor(current: HiringStage): HiringStage | null {
    return TalentFlowApiService.nextStage(current);
  }

  protected advanceStage(candidateId: string, newStage: HiringStage): void {
    this.advancingStage.set(true);
    this.advanceError.set(null);
    this.advanceSuccess.set(null);

    this.api.advanceStage(candidateId, newStage).subscribe({
      next: (res) => {
        this.advancingStage.set(false);
        this.advanceSuccess.set(res.newStage);
        // Refresh candidate to update stage stepper
        this.api.getCandidate(candidateId).subscribe({
          next: (c) => {
            this._directCandidate.set(c);
            // Also update pipeline cache
            const idx = this.state.pipeline().findIndex((p) => p.id === candidateId);
            if (idx >= 0) {
              const updated = [...this.state.pipeline()];
              updated[idx] = c;
            }
          },
          error: () => { /* non-fatal */ },
        });
      },
      error: (err) => {
        this.advancingStage.set(false);
        const msg = err?.error?.error ?? err?.message ?? 'Failed to advance stage';
        this.advanceError.set(msg);
      },
    });
  }
  protected readonly showScheduleForm    = signal<boolean>(false);
  protected readonly scheduleSubmitting  = signal<boolean>(false);
  protected readonly scheduleSuccess     = signal<string | null>(null);
  protected readonly scheduleError       = signal<string | null>(null);

  // D005/D041: dynamic panel member directory
  protected readonly panelMembers        = signal<PanelMember[]>([]);
  protected readonly panelMembersLoading = signal<boolean>(false);
  protected readonly panelMembersError   = signal<string | null>(null);

  // D041: ad hoc member inline form
  protected readonly showAdhocForm = signal<boolean>(false);
  protected readonly adhocForm     = signal<{ name: string; email: string; role: string }>({
    name: '', email: '', role: '',
  });

  /** Mutable form model for the schedule interview panel */
  protected readonly scheduleForm = signal<{
    interviewType:     InterviewType;
    scheduledAt:       string;
    panelMemberIds:    string[];
    adhocPanelMembers: AdhocPanelMember[];
  }>({
    interviewType:     'PHONE_SCREEN',
    scheduledAt:       '',
    panelMemberIds:    [],
    adhocPanelMembers: [],
  });

  protected toggleScheduleForm(): void {
    const opening = !this.showScheduleForm();
    this.showScheduleForm.set(opening);
    if (opening) this._loadPanelMembers();
  }

  private _loadPanelMembers(): void {
    if (this.panelMembers().length > 0) return;
    this.panelMembersLoading.set(true);
    this.panelMembersError.set(null);
    this.api.getPanelMembers().subscribe({
      next: (members) => {
        this.panelMembers.set(members);
        this.panelMembersLoading.set(false);
      },
      error: () => {
        this.panelMembersError.set('Could not load panel directory.');
        this.panelMembersLoading.set(false);
      },
    });
  }

  protected setAdhocName(event: Event): void {
    this.adhocForm.update((f) => ({ ...f, name: (event.target as HTMLInputElement).value }));
  }

  protected setAdhocEmail(event: Event): void {
    this.adhocForm.update((f) => ({ ...f, email: (event.target as HTMLInputElement).value }));
  }

  protected setAdhocRole(event: Event): void {
    this.adhocForm.update((f) => ({ ...f, role: (event.target as HTMLInputElement).value }));
  }

  protected addAdhocMember(): void {
    const f = this.adhocForm();
    if (!f.name.trim() || !f.email.trim()) return;
    const member: AdhocPanelMember = {
      name:  f.name.trim(),
      email: f.email.trim(),
      role:  f.role.trim() || undefined,
    };
    this.scheduleForm.update((s) => ({
      ...s,
      adhocPanelMembers: [...s.adhocPanelMembers, member],
    }));
    this.adhocForm.set({ name: '', email: '', role: '' });
    this.showAdhocForm.set(false);
  }

  protected removeAdhocMember(email: string): void {
    this.scheduleForm.update((s) => ({
      ...s,
      adhocPanelMembers: s.adhocPanelMembers.filter((m) => m.email !== email),
    }));
  }

  protected setInterviewType(event: Event): void {
    const value = (event.target as HTMLSelectElement).value as InterviewType;
    this.scheduleForm.update((f) => ({ ...f, interviewType: value }));
  }

  protected setScheduledAt(event: Event): void {
    // Store raw datetime-local value (yyyy-MM-ddThh:mm) — Z suffix added on submit
    const value = (event.target as HTMLInputElement).value;
    this.scheduleForm.update((f) => ({ ...f, scheduledAt: value }));
  }

  protected togglePanelMember(memberId: string): void {
    const current = this.scheduleForm();
    const ids = current.panelMemberIds.includes(memberId)
      ? current.panelMemberIds.filter((id) => id !== memberId)
      : [...current.panelMemberIds, memberId];
    this.scheduleForm.set({ ...current, panelMemberIds: ids });
  }

  // ── Engagement Sentiment (v2 5-option selector) ───────────────────────────
  protected readonly engagementSentiment = signal<EngagementSentiment | null>(null);

  protected readonly ENGAGEMENT_OPTIONS: { value: EngagementSentiment; label: string; dotClass: string }[] = [
    { value: 'VERY_INTERESTED', label: 'Very Interested', dotClass: 'tf-sent-dot--excited' },
    { value: 'INTERESTED',      label: 'Interested',      dotClass: 'tf-sent-dot--positive' },
    { value: 'NEUTRAL',         label: 'Neutral',         dotClass: 'tf-sent-dot--neutral' },
    { value: 'HESITANT',        label: 'Hesitant',        dotClass: 'tf-sent-dot--hesitant' },
    { value: 'DISENGAGED',      label: 'Disengaged',      dotClass: 'tf-sent-dot--reluctant' },
  ];

  protected readonly sentimentSubmitting = signal<boolean>(false);
  protected readonly sentimentSuccess    = signal<string | null>(null);
  protected readonly sentimentError      = signal<string | null>(null);

  protected setEngagementSentiment(v: EngagementSentiment): void {
    this.engagementSentiment.set(v);
    this.sentimentSuccess.set(null);
    this.sentimentError.set(null);
  }

  protected submitSentiment(candidateId: string): void {
    const sentiment = this.engagementSentiment();
    if (!sentiment) return;

    this.sentimentSubmitting.set(true);
    this.sentimentSuccess.set(null);
    this.sentimentError.set(null);

    this.api.captureSentiment(candidateId, sentiment).subscribe({
      next: (res) => {
        this.sentimentSubmitting.set(false);
        this.sentimentSuccess.set(res.interviewSentiment);
        // Refresh candidate so header sentiment pill updates
        this.api.getCandidate(candidateId).subscribe({
          next: (c) => this._directCandidate.set(c),
          error: () => { /* non-fatal */ },
        });
      },
      error: (err) => {
        this.sentimentSubmitting.set(false);
        this.sentimentError.set(err?.userMessage ?? 'Failed to save sentiment');
      },
    });
  }

  // ── Activity Log panel (D035) ─────────────────────────────────────────────
  protected readonly activityFilter = signal<'all' | 'interviews' | 'scores' | 'sentiment'>('all');

  protected readonly filteredEvents = computed(() => {
    const filter = this.activityFilter();
    const evs    = this.events();
    if (filter === 'all')        return evs;
    if (filter === 'interviews') return evs.filter((e) => /interview|stage/i.test(e.eventType));
    if (filter === 'scores')     return evs.filter((e) => /vote|score/i.test(e.eventType));
    if (filter === 'sentiment')  return evs.filter((e) => /sentiment/i.test(e.eventType));
    return evs;
  });

  protected activityDotClass(eventType: string): string {
    if (/interview|stage|workflow/i.test(eventType)) return 'tf-act-dot--blue';
    if (/vote|score/i.test(eventType))               return 'tf-act-dot--green';
    if (/sentiment/i.test(eventType))                return 'tf-act-dot--amber';
    return 'tf-act-dot--grey';
  }

  // ── Signal Intelligence (contextual message) ──────────────────────────────
  protected intelMessage(c: Candidate): string {
    if (c.slaStatus === 'BREACHED') {
      return `SLA is breached. Immediate action required — progress the workflow or escalate now.`;
    }
    if (c.slaStatus === 'AT_RISK' && c.interviewSentiment === 'HESITANT') {
      return `Sentiment is Hesitant and the SLA is at risk. Scheduling delays increase drop-off risk. Recommended: schedule the next interview today.`;
    }
    if (c.slaStatus === 'AT_RISK') {
      return `SLA is at risk. Consider advancing the stage or scheduling the next interview to stay on track.`;
    }
    if (c.interviewSentiment === 'HESITANT') {
      return `Candidate sentiment is Hesitant. Avoid unnecessary delays and keep the candidate engaged through the process.`;
    }
    return `Candidate is progressing on track. Current stage: ${STAGE_LABELS[c.currentStage] ?? c.currentStage}.`;
  }

  // ── Add Panel Members to existing interview ───────────────────────────────
  protected readonly addingPanelMember  = signal<boolean>(false);
  protected readonly addPanelSubmitting = signal<boolean>(false);
  protected readonly addPanelSuccess    = signal<boolean>(false);
  protected readonly addPanelError      = signal<string | null>(null);

  protected readonly addPanelForm = signal<{
    panelMemberIds:    string[];
    adhocPanelMembers: AdhocPanelMember[];
  }>({ panelMemberIds: [], adhocPanelMembers: [] });

  protected readonly showAdhocFormAdd = signal<boolean>(false);
  protected readonly adhocFormAdd     = signal<{ name: string; email: string; role: string }>({
    name: '', email: '', role: '',
  });

  protected openAddPanel(): void {
    this.addingPanelMember.set(true);
    this.addPanelSuccess.set(false);
    this.addPanelError.set(null);
    this.addPanelForm.set({ panelMemberIds: [], adhocPanelMembers: [] });
    this.showAdhocFormAdd.set(false);
    this.adhocFormAdd.set({ name: '', email: '', role: '' });
    this._loadPanelMembers();
  }

  protected toggleAddPanelMember(memberId: string): void {
    const current = this.addPanelForm();
    const ids = current.panelMemberIds.includes(memberId)
      ? current.panelMemberIds.filter((id) => id !== memberId)
      : [...current.panelMemberIds, memberId];
    this.addPanelForm.set({ ...current, panelMemberIds: ids });
  }

  protected setAddAdhocName(event: Event): void {
    this.adhocFormAdd.update((f) => ({ ...f, name: (event.target as HTMLInputElement).value }));
  }

  protected setAddAdhocEmail(event: Event): void {
    this.adhocFormAdd.update((f) => ({ ...f, email: (event.target as HTMLInputElement).value }));
  }

  protected setAddAdhocRole(event: Event): void {
    this.adhocFormAdd.update((f) => ({ ...f, role: (event.target as HTMLInputElement).value }));
  }

  protected addAdhocToPanel(): void {
    const f = this.adhocFormAdd();
    if (!f.name.trim() || !f.email.trim()) return;
    const member: AdhocPanelMember = {
      name:  f.name.trim(),
      email: f.email.trim(),
      role:  f.role.trim() || undefined,
    };
    this.addPanelForm.update((s) => ({
      ...s,
      adhocPanelMembers: [...s.adhocPanelMembers, member],
    }));
    this.adhocFormAdd.set({ name: '', email: '', role: '' });
    this.showAdhocFormAdd.set(false);
  }

  protected removeAdhocFromPanel(email: string): void {
    this.addPanelForm.update((s) => ({
      ...s,
      adhocPanelMembers: s.adhocPanelMembers.filter((m) => m.email !== email),
    }));
  }

  protected submitAddPanelMembers(candidateId: string, interviewId: string): void {
    const form = this.addPanelForm();
    if (form.panelMemberIds.length === 0 && form.adhocPanelMembers.length === 0) return;

    this.addPanelSubmitting.set(true);
    this.addPanelError.set(null);
    this.addPanelSuccess.set(false);

    const payload: AddPanelMembersPayload = {
      panelMemberIds:    form.panelMemberIds.length > 0 ? form.panelMemberIds : undefined,
      adhocPanelMembers: form.adhocPanelMembers.length > 0 ? form.adhocPanelMembers : undefined,
    };

    this.api.addPanelMembers(candidateId, interviewId, payload).subscribe({
      next: () => {
        this.addPanelSubmitting.set(false);
        this.addPanelSuccess.set(true);
        this.addingPanelMember.set(false);
        this.addPanelForm.set({ panelMemberIds: [], adhocPanelMembers: [] });
      },
      error: (err) => {
        this.addPanelSubmitting.set(false);
        const msg = err?.error?.error ?? err?.message ?? 'Failed to add panel members';
        this.addPanelError.set(msg);
      },
    });
  }

  protected submitScheduleInterview(candidateId: string): void {
    const form = this.scheduleForm();
    const hasPanel = form.panelMemberIds.length > 0 || form.adhocPanelMembers.length > 0;
    if (!form.scheduledAt || !hasPanel) return;

    this.scheduleSubmitting.set(true);
    this.scheduleError.set(null);
    this.scheduleSuccess.set(null);

    const payload: ScheduleInterviewPayload = {
      interviewType:     form.interviewType,
      scheduledAt:       form.scheduledAt.length === 16 ? form.scheduledAt + ':00Z' : form.scheduledAt,
      panelMemberIds:    form.panelMemberIds,
      adhocPanelMembers: form.adhocPanelMembers.length > 0 ? form.adhocPanelMembers : undefined,
    };

    this.api.scheduleInterview(candidateId, payload).subscribe({
      next: (res) => {
        this.scheduleSubmitting.set(false);
        this.scheduleSuccess.set(res.interviewId);
        this.showScheduleForm.set(false);
        this.scheduleForm.set({ interviewType: 'PHONE_SCREEN', scheduledAt: '', panelMemberIds: [], adhocPanelMembers: [] });
        this.showAdhocForm.set(false);
        this.adhocForm.set({ name: '', email: '', role: '' });
        this.api.getCandidate(candidateId).subscribe({
          next: (c) => this._directCandidate.set(c),
          error: () => { /* non-fatal */ },
        });
      },
      error: (err) => {
        this.scheduleSubmitting.set(false);
        const msg = err?.error?.error ?? err?.message ?? 'Failed to schedule interview';
        this.scheduleError.set(msg);
      },
    });
  }
}
