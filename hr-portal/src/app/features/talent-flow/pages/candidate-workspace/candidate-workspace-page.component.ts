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
import { TalentFlowAuthService } from '../../services/talent-flow-auth.service';
import { AuthService } from '../../../../core/services/auth.service';
import { STAGE_LABELS } from '../../components/stage-selector/stage-selector.component';
import { AiChatPanelComponent } from '../../components/ai-chat-panel/ai-chat-panel.component';
import {
  AddPanelMembersPayload,
  AdhocPanelMember,
  Candidate,
  CandidateEvent,
  EngagementSentiment,
  HiringStage,
  Interview,
  InterviewType,
  PanelMember,
  ScheduleInterviewPayload,
  ScoringWeights,
  DEFAULT_SCORING_WEIGHTS,
  PHASE_MAP,
  VotePayload,
} from '../../models/talent-flow.models';
import { OfferTabComponent } from '../../components/offer-tab/offer-tab.component';
import { CandidateEditDrawerComponent } from '../../components/candidate-edit-drawer/candidate-edit-drawer.component';
import { ProvisioningTabComponent } from '../../components/provisioning-tab/provisioning-tab.component';

// D027: tabs — Overview | Interviews | Offer | Provisioning | Notes
export type WorkspaceTab = 'overview' | 'interviews' | 'offer' | 'provisioning' | 'notes';

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
    ProvisioningTabComponent,
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
  private readonly tfAuth = inject(TalentFlowAuthService);
  private readonly nalekoAuth = inject(AuthService);

  // True for TAs — false for HMs.
  // Uses Naleko pool groups because tfAuth.currentUser() is always null
  // (pool consolidation: everyone logs in via the Naleko pool).
  protected readonly isTA = computed(() => {
    const user = this.nalekoAuth.currentUser();
    if (!user) return false; // not logged in → show nothing sensitive
    return !user.groups.includes('naleko-talentflow-hiringmanager');
  });

  protected readonly defaultWeights: ScoringWeights = DEFAULT_SCORING_WEIGHTS;

  protected readonly activeTab               = signal<WorkspaceTab>('overview');
  protected readonly candidateId             = signal<string | null>(null);
  protected readonly provisioningBreachCount = signal<number>(0);
  protected readonly loading                 = signal<boolean>(false);
  protected readonly fetchError              = signal<string | null>(null);
  protected readonly chatVisible             = signal<boolean>(false);
  protected readonly editDrawerVisible       = signal<boolean>(false);

  // Events (activity log)
  protected readonly eventsLoading = signal<boolean>(false);
  protected readonly eventsError   = signal<string | null>(null);
  protected readonly events        = signal<CandidateEvent[]>([]);
  private _eventsLoaded            = false;

  protected readonly allStages = ALL_STAGES;

  private readonly _directCandidate = signal<Candidate | undefined>(undefined);

  protected readonly candidate = computed<Candidate | undefined>(
    () => this.state.activeCandidate() ?? this._directCandidate(),
  );

  // ── Interview loop ────────────────────────────────────────────────────────
  protected readonly interviews        = signal<Interview[]>([]);
  protected readonly interviewsLoading = signal<boolean>(false);
  protected readonly interviewsError   = signal<string | null>(null);
  private _interviewsLoaded            = false;

  // Required interview types from PANEL_CONFIG for this candidate's positionLevel
  protected readonly requiredTypes     = signal<string[]>([]);
  protected readonly panelConfigLoaded = signal<boolean>(false);

  // Which interview the add-panel inline form targets
  protected readonly addPanelTargetId = signal<string | null>(null);
  // Which interview the complete inline form targets
  protected readonly completeTargetId = signal<string | null>(null);
  protected readonly completeOutcome  = signal<'PASS' | 'DEFER' | 'FAIL'>('PASS');

  protected readonly completedTypeSet = computed(() =>
    new Set(
      this.interviews()
        .filter((i) => i.status === 'COMPLETED')
        .map((i) => i.interviewType),
    ),
  );

  protected readonly loopProgress = computed(() => {
    const required = this.requiredTypes();
    const done = required.filter((t) => this.completedTypeSet().has(t)).length;
    return { done, total: required.length };
  });

  // True when any interview is currently in SCHEDULED state — blocks new scheduling
  protected readonly hasScheduledInterview = computed(() =>
    this.interviews().some((i) => i.status === 'SCHEDULED'),
  );

  // First required type in PANEL_CONFIG order that is not yet SCHEDULED or COMPLETED
  protected readonly nextScheduleableType = computed<string | null>(() => {
    const required = this.requiredTypes();
    if (required.length === 0) return null;
    const existing = this.interviews();
    return (
      required.find(
        (type) =>
          !existing.some(
            (i) => i.interviewType === type && (i.status === 'SCHEDULED' || i.status === 'COMPLETED'),
          ),
      ) ?? null
    );
  });

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      void this.router.navigate(['/platform/talentflow']);
      return;
    }
    this.candidateId.set(id);

    const inCache = this.state.pipeline().find((c) => c.id === id);
    if (inCache) {
      this.state.setActiveCandidate(id);
      if (inCache.interviewSentiment) {
        this.engagementSentiment.set(inCache.interviewSentiment as EngagementSentiment);
      }
      this._loadEvents(id);
      this._loadPanelConfig(inCache.positionLevel);
      return;
    }

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
        this._loadPanelConfig(c.positionLevel);
      },
      error: () => {
        this.fetchError.set('Could not load candidate.');
        this.loading.set(false);
      },
    });
  }

  protected setTab(tab: WorkspaceTab): void {
    this.activeTab.set(tab);
    if (tab === 'interviews') {
      const id = this.candidateId();
      if (id && !this._interviewsLoaded) this._loadInterviews(id);
      if (this.panelMembers().length === 0) this._loadPanelMembers();
    }
  }

  protected onProvisioningBreachCount(count: number): void {
    this.provisioningBreachCount.set(count);
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

  private _loadInterviews(id: string): void {
    this._interviewsLoaded = true;
    this.interviewsLoading.set(true);
    this.interviewsError.set(null);
    this.api.getInterviews(id).subscribe({
      next: (list) => { this.interviews.set(list); this.interviewsLoading.set(false); },
      error: () => {
        this.interviewsError.set('Could not load interviews.');
        this.interviewsLoading.set(false);
      },
    });
  }

  private _refreshInterviews(): void {
    const id = this.candidateId();
    if (!id) return;
    this._interviewsLoaded = false;
    this._loadInterviews(id);
  }

  private _loadPanelConfig(positionLevel: string): void {
    this.api.getConfig('PANEL_CONFIG').subscribe({
      next: (cfg) => {
        const reqs = (cfg.data as Record<string, unknown>)?.['interviewRequirements'] as
          Record<string, Array<{ type: string; required?: boolean }>> | undefined;
        const levelReqs = reqs?.[positionLevel] ?? [];
        const required = levelReqs.filter((r) => r.required !== false).map((r) => r.type);
        this.requiredTypes.set(required);
        this.panelConfigLoaded.set(true);
      },
      error: () => { this.panelConfigLoaded.set(true); },
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

  protected toDate(iso: string): Date {
    return new Date(iso);
  }

  protected readonly defaultThreshold = 72;

  // ── Phase stepper (D029) ─────────────────────────────────────────────────
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
    const f = c?.firstName?.[0] ?? '';
    const l = c?.lastName?.[0] ?? '';
    return (f + l).toUpperCase() || '?';
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

  // ── Advance Stage ─────────────────────────────────────────────────────────
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
        // Refresh candidate to update stage stepper + SLA display
        this.api.getCandidate(candidateId).subscribe({
          next: (c) => {
            // Patch pipeline signal first — activeCandidate() is derived from it
            // and takes priority in the candidate computed. Without this,
            // slaStatus and currentStage remain stale after stage advance.
            this.state.patchCandidate(c);
            // Also keep _directCandidate in sync (used as fallback)
            this._directCandidate.set(c);
            // Auto-clear the success banner after 4 s
            setTimeout(() => this.advanceSuccess.set(null), 4000);
          },
          error: () => {
            // Refresh failed — still clear success banner gracefully
            setTimeout(() => this.advanceSuccess.set(null), 4000);
          },
        });
      },
      error: (err) => {
        this.advancingStage.set(false);
        const msg = err?.error?.error ?? err?.message ?? 'Failed to advance stage';
        this.advanceError.set(msg);
      },
    });
  }

  // ── Schedule Interview ────────────────────────────────────────────────────
  protected readonly showScheduleForm    = signal<boolean>(false);
  protected readonly scheduleSubmitting  = signal<boolean>(false);
  protected readonly scheduleSuccess     = signal<string | null>(null);
  protected readonly scheduleError       = signal<string | null>(null);

  protected readonly panelMembers        = signal<PanelMember[]>([]);
  protected readonly panelMembersLoading = signal<boolean>(false);
  protected readonly panelMembersError   = signal<string | null>(null);

  protected readonly showAdhocForm = signal<boolean>(false);
  protected readonly adhocForm     = signal<{ name: string; email: string; role: string }>({
    name: '', email: '', role: '',
  });

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
    if (opening) {
      this._loadPanelMembers();
      const next = this.nextScheduleableType();
      if (next) {
        this.scheduleForm.update((f) => ({ ...f, interviewType: next as InterviewType }));
      }
    }
  }

  private _loadPanelMembers(): void {
    if (this.panelMembers().length > 0) return;
    this.panelMembersLoading.set(true);
    this.panelMembersError.set(null);
    this.api.getPanelMembers().subscribe({
      next: (members) => { this.panelMembers.set(members); this.panelMembersLoading.set(false); },
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
        this._refreshInterviews();
        this.api.getCandidate(candidateId).subscribe({
          next: (c) => { this.state.patchCandidate(c); this._directCandidate.set(c); },
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

  // ── Engagement Sentiment ──────────────────────────────────────────────────
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
        this.engagementSentiment.set(null); // clear selection — button stays disabled until new pick
        this.api.getCandidate(candidateId).subscribe({
          next: (c) => { this.state.patchCandidate(c); this._directCandidate.set(c); },
          error: () => { /* non-fatal */ },
        });
      },
      error: (err) => {
        this.sentimentSubmitting.set(false);
        this.sentimentError.set(err?.userMessage ?? 'Failed to save sentiment');
      },
    });
  }

  // ── Activity Log ─────────────────────────────────────────────────────────
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

  // Split camelCase event types into spaced words: "StageAdvanced" → "Stage Advanced"
  protected formatEventType(raw: string): string {
    return raw.replace(/([A-Z])/g, ' $1').trim();
  }

  // ── Signal Intelligence ───────────────────────────────────────────────────
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
      return `Candidate sentiment is Hesitant. Avoid unnecessary delays and keep the candidate engaged.`;
    }
    return `Candidate is progressing on track. Current stage: ${STAGE_LABELS[c.currentStage] ?? c.currentStage}.`;
  }

  // ── Add Panel Members ────────────────────────────────────────────────────
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

  protected openAddPanel(interviewId: string): void {
    this.addPanelTargetId.set(interviewId);
    this.addingPanelMember.set(true);
    this.addPanelSuccess.set(false);
    this.addPanelError.set(null);
    this.addPanelForm.set({ panelMemberIds: [], adhocPanelMembers: [] });
    this.showAdhocFormAdd.set(false);
    this.adhocFormAdd.set({ name: '', email: '', role: '' });
    this._loadPanelMembers();
  }

  protected closeAddPanel(): void {
    this.addingPanelMember.set(false);
    this.addPanelTargetId.set(null);
    this.addPanelError.set(null);
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

  protected submitAddPanelMembers(candidateId: string): void {
    const interviewId = this.addPanelTargetId();
    if (!interviewId) return;
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
        this.addPanelTargetId.set(null);
        this.addPanelForm.set({ panelMemberIds: [], adhocPanelMembers: [] });
        this._refreshInterviews();
      },
      error: (err) => {
        this.addPanelSubmitting.set(false);
        const msg = err?.error?.error ?? err?.message ?? 'Failed to add panel members';
        this.addPanelError.set(msg);
      },
    });
  }

  // ── Complete Interview ────────────────────────────────────────────────────
  protected readonly completeInterviewSubmitting = signal<boolean>(false);
  protected readonly completeInterviewSuccess    = signal<string | null>(null);
  protected readonly completeInterviewError      = signal<string | null>(null);

  protected openCompleteForm(interviewId: string): void {
    this.completeTargetId.set(interviewId);
    this.completeOutcome.set('PASS');
    this.completeInterviewError.set(null);
  }

  protected closeCompleteForm(): void {
    this.completeTargetId.set(null);
    this.completeInterviewError.set(null);
  }

  protected submitCompleteInterview(candidateId: string): void {
    const interviewId = this.completeTargetId();
    if (!interviewId) return;

    this.completeInterviewSubmitting.set(true);
    this.completeInterviewSuccess.set(null);
    this.completeInterviewError.set(null);

    this.api.completeInterview(candidateId, interviewId, this.completeOutcome()).subscribe({
      next: (res) => {
        this.completeInterviewSubmitting.set(false);
        this.completeInterviewSuccess.set(res.interviewId);
        this.completeTargetId.set(null);
        this._refreshInterviews();
        this.api.getCandidate(candidateId).subscribe({
          next: (c) => { this.state.patchCandidate(c); this._directCandidate.set(c); },
          error: () => { /* non-fatal */ },
        });
        setTimeout(() => this.completeInterviewSuccess.set(null), 4000);
      },
      error: (err) => {
        this.completeInterviewSubmitting.set(false);
        const msg = err?.error?.error ?? err?.message ?? 'Failed to complete interview';
        this.completeInterviewError.set(msg);
      },
    });
  }

  // ── Panel member name resolution ─────────────────────────────────────────
  protected panelMemberName(id: string): string {
    const member = this.panelMembers().find((m) => m.id === id);
    return member?.name ?? id;
  }

  // ── Interview type labels ────────────────────────────────────────────────
  protected readonly INTERVIEW_TYPE_LABELS: Record<string, string> = {
    PHONE_SCREEN: 'Phone Screen',
    TECHNICAL:    'Technical',
    BEHAVIORAL:   'Behavioral',
    CULTURE_FIT:  'Culture Fit',
    FINAL:        'Final Round',
  };

  protected interviewTypeLabel(type: string): string {
    return this.INTERVIEW_TYPE_LABELS[type] ?? type;
  }

  // ── Interview status helpers ─────────────────────────────────────────────
  protected interviewStatusForType(type: string): 'COMPLETED' | 'SCHEDULED' | 'PENDING' {
    const matching = this.interviews().filter((i) => i.interviewType === type);
    if (matching.some((i) => i.status === 'COMPLETED')) return 'COMPLETED';
    if (matching.some((i) => i.status === 'SCHEDULED')) return 'SCHEDULED';
    return 'PENDING';
  }

  protected experienceLabel(years: number | undefined | null): string {
    if (years == null) return '—';
    return years === 1 ? '1 year' : `${years} years`;
  }

  // Converts VERY_INTERESTED → "Very Interested" (titlecase doesn't handle underscores)
  protected sentimentLabel(v: string | null | undefined): string {
    if (!v) return '';
    return v
      .replace(/_/g, ' ')
      .toLowerCase()
      .replace(/\b\w/g, (ch) => ch.toUpperCase());
  }

  // ── Per-interview Vote Form ───────────────────────────────────────────────
  // Tracks which interviews have received a vote this session — hides the vote button after submission
  protected readonly votedInterviewIds = signal<ReadonlySet<string>>(new Set<string>());

  protected readonly voteTargetId   = signal<string | null>(null);
  protected readonly voteDecision   = signal<'STRONG_NO' | 'NO' | 'YES' | 'STRONG_YES'>('YES');
  protected readonly voteNotes      = signal<string>('');
  protected readonly voteScores     = signal<{
    technical: number; communication: number; culturalFit: number; problemSolving: number;
  }>({ technical: 5, communication: 5, culturalFit: 5, problemSolving: 5 });
  protected readonly voteSubmitting = signal<boolean>(false);
  protected readonly voteSuccess    = signal<string | null>(null);
  protected readonly voteError      = signal<string | null>(null);

  protected readonly VOTE_OPTIONS = [
    { value: 'STRONG_NO' as const,  label: 'Strong No' },
    { value: 'NO'        as const,  label: 'No' },
    { value: 'YES'       as const,  label: 'Yes' },
    { value: 'STRONG_YES'as const,  label: 'Strong Yes' },
  ];

  protected openVoteForm(interviewId: string): void {
    this.voteTargetId.set(interviewId);
    this.voteDecision.set('YES');
    this.voteNotes.set('');
    this.voteScores.set({ technical: 5, communication: 5, culturalFit: 5, problemSolving: 5 });
    this.voteError.set(null);
    this.voteSuccess.set(null);
  }

  protected closeVoteForm(): void {
    this.voteTargetId.set(null);
    this.voteError.set(null);
  }

  protected setVoteScore(
    key: 'technical' | 'communication' | 'culturalFit' | 'problemSolving',
    event: Event,
  ): void {
    const raw = parseInt((event.target as HTMLInputElement).value, 10);
    const value = isNaN(raw) ? 0 : Math.min(10, Math.max(0, raw));
    this.voteScores.update((s) => ({ ...s, [key]: value }));
  }

  protected setVoteNotes(event: Event): void {
    this.voteNotes.set((event.target as HTMLTextAreaElement).value);
  }

  protected submitVoteForInterview(candidateId: string): void {
    const interviewId = this.voteTargetId();
    if (!interviewId) return;

    this.voteSubmitting.set(true);
    this.voteError.set(null);

    const payload: VotePayload = {
      interviewId,
      decision: this.voteDecision(),
      scores:   this.voteScores(),
      notes:    this.voteNotes() || undefined,
    };

    this.api.submitVote(candidateId, payload).subscribe({
      next: (res) => {
        this.voteSubmitting.set(false);
        this.voteSuccess.set(res.voteId ?? interviewId);
        this.votedInterviewIds.update((prev) => new Set([...prev, interviewId]));
        this.voteTargetId.set(null);
        setTimeout(() => this.voteSuccess.set(null), 4000);
      },
      error: (err) => {
        this.voteSubmitting.set(false);
        const msg = err?.error?.error ?? err?.userMessage ?? 'Failed to submit vote';
        this.voteError.set(msg);
      },
    });
  }
}
