import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  computed,
  OnInit,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { ButtonModule } from 'primeng/button';
import { TalentFlowApiService } from '../../services/talent-flow-api.service';
import { TalentFlowStateService } from '../../services/talent-flow-state.service';
import { EvaluationScoringPanelComponent } from '../../components/evaluation-scoring-panel/evaluation-scoring-panel.component';
import {
  Candidate,
  VotePayload,
  DEFAULT_SCORING_WEIGHTS,
  ScoringWeights,
} from '../../models/talent-flow.models';

/**
 * EvaluationPageComponent — FE-007 / NH-140
 *
 * Route: /talent-flow/candidates/:id/evaluate
 *
 * Loads candidate from state cache or API.
 * Reuses EvaluationScoringPanelComponent.
 * On vote submit → POST submitVote → redirect back to CandidateWorkspace.
 */
@Component({
  selector: 'tf-evaluation-page',
  standalone: true,
  imports: [
    CommonModule,
    ButtonModule,
    EvaluationScoringPanelComponent,
  ],
  templateUrl: './evaluation-page.component.html',
  styleUrl:    './evaluation-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EvaluationPageComponent implements OnInit {
  private readonly route  = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly api    = inject(TalentFlowApiService);
  private readonly state  = inject(TalentFlowStateService);

  readonly candidateId = signal<string | null>(null);
  readonly loading     = signal(false);
  readonly submitted   = signal(false);
  readonly submitError = signal<string | null>(null);

  readonly candidate = computed<Candidate | undefined>(
    () => this.state.activeCandidate(),
  );

  readonly weights = computed<ScoringWeights>(() => DEFAULT_SCORING_WEIGHTS);

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) { void this.router.navigate(['/platform/talentflow/pipeline']); return; }
    this.candidateId.set(id);

    const inCache = this.state.pipeline().find((c) => c.id === id);
    if (inCache) {
      this.state.setActiveCandidate(id);
    } else {
      this.loading.set(true);
      this.state.loadPipeline();
      this.state.setActiveCandidate(id);
      this.loading.set(false);
    }
  }

  onScoreSubmitted(payload: VotePayload): void {
    const id = this.candidateId();
    if (!id) return;

    this.api.submitVote(id, payload).subscribe({
      next: () => {
        this.submitted.set(true);
        setTimeout(() => {
          void this.router.navigate(['/platform/talentflow/candidates', id]);
        }, 1200);
      },
      error: (err: { userMessage?: string }) => {
        this.submitError.set(err.userMessage ?? 'Failed to submit vote.');
      },
    });
  }

  goBack(): void {
    const id = this.candidateId();
    void this.router.navigate(id ? ['/platform/talentflow/candidates', id] : ['/platform/talentflow/pipeline']);
  }
}
