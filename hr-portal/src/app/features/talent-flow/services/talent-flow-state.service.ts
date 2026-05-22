import { Injectable, computed, inject, signal } from '@angular/core';
import { TalentFlowApiService } from './talent-flow-api.service';
import { TalentFlowAgentApiService } from './talent-flow-agent-api.service';
import { Candidate, PendingAction, PipelineFilters } from '../models/talent-flow.models';

/**
 * TalentFlowStateService
 *
 * Signals-based client-side state for the TalentFlow module.
 * Injectable at root — single instance shared across all TalentFlow components.
 *
 * Pattern: components read signals directly (no subscriptions),
 * call methods to trigger data loads, which update signals on completion.
 */
@Injectable({ providedIn: 'root' })
export class TalentFlowStateService {
  private readonly api = inject(TalentFlowApiService);
  private readonly agentApi = inject(TalentFlowAgentApiService);

  // ─── State Signals ─────────────────────────────────────────────────────────

  readonly pipeline = signal<Candidate[]>([]);
  readonly activeCandidateId = signal<string | null>(null);
  readonly configVersion = signal<string>('v1');
  readonly pendingActions = signal<PendingAction[]>([]);
  readonly isLoading = signal<boolean>(false);
  readonly error = signal<string | null>(null);

  // ─── Derived / Computed ────────────────────────────────────────────────────

  /** The currently selected candidate record, derived from pipeline + activeCandidateId */
  readonly activeCandidate = computed<Candidate | undefined>(() =>
    this.pipeline().find((c) => c.id === this.activeCandidateId()),
  );

  /** Count of candidates with slaStatus BREACHED — shown as badge on bell (D021) */
  readonly slaBreachCount = computed<number>(
    () => this.pipeline().filter((c) => c.slaStatus === 'BREACHED').length,
  );

  /** Count of pending HITL actions awaiting approval */
  readonly pendingActionsCount = computed<number>(() => this.pendingActions().length);

  // ─── Actions ───────────────────────────────────────────────────────────────

  loadPipeline(filters?: PipelineFilters): void {
    this.isLoading.set(true);
    this.error.set(null);

    this.api.getCandidates(filters).subscribe({
      next: (response) => {
        this.pipeline.set(response.candidates);
        this.isLoading.set(false);
      },
      error: (err: { userMessage?: string }) => {
        this.error.set(err.userMessage ?? 'Failed to load pipeline.');
        this.isLoading.set(false);
      },
    });
  }

  setActiveCandidate(id: string | null): void {
    this.activeCandidateId.set(id);
  }

  loadPendingActions(): void {
    this.agentApi.getPendingActions().subscribe({
      next: (actions) => this.pendingActions.set(actions),
      error: (err: { userMessage?: string }) =>
        this.error.set(err.userMessage ?? 'Failed to load pending actions.'),
    });
  }

  patchCandidate(updated: Candidate): void {
    this.pipeline.update((list) =>
      list.map((c) => (c.id === updated.id ? updated : c)),
    );
  }

  clearError(): void {
    this.error.set(null);
  }
}
