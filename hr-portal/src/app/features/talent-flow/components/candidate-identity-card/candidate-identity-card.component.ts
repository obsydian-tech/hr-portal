import { Component, ChangeDetectionStrategy, computed, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TagModule } from 'primeng/tag';
import { Candidate } from '../../models/talent-flow.models';

/**
 * CandidateIdentityCard
 *
 * Design source: naleko-design-handoff/preview/EmployeeDetail.jsx header block
 * - Avatar: .ed__avatar — naleko-grad-cta gradient, border-radius:16px, initials
 * - Name:   .ed__name   — Manrope 800, letter-spacing -0.02em
 * - Meta:   .ed__meta   — pi icons + on-surface-variant text
 * - Chips:  .ed__risk-chip + .pill from 19-status-pills.html
 *
 * Tech stack: Angular 19 standalone, input(), computed(), PrimeNG TagModule,
 * PrimeIcons, PrimeFlex, --naleko-* tokens, OnPush.
 */
@Component({
  selector: 'tf-candidate-identity-card',
  standalone: true,
  imports: [CommonModule, TagModule],
  templateUrl: './candidate-identity-card.component.html',
  styleUrl: './candidate-identity-card.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CandidateIdentityCardComponent {
  readonly candidate = input.required<Candidate>();

  readonly initials = computed(() => {
    const c = this.candidate();
    return (c.firstName[0] + c.lastName[0]).toUpperCase();
  });

  readonly fullName = computed(() => {
    const c = this.candidate();
    return `${c.firstName} ${c.lastName}`;
  });

  readonly appliedFormatted = computed(() => {
    const c = this.candidate();
    return new Date(c.appliedDate).toLocaleDateString('en-ZA', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  });

  /** Card border class driven by SLA health (D021 signal health language) */
  readonly cardStateClass = computed<string>(() => {
    const status = this.candidate().slaStatus;
    if (status === 'BREACHED') return 'card--escalation';
    if (status === 'AT_RISK') return 'card--at-risk';
    return '';
  });

  /** SLA chip config — D021: signal health language only */
  readonly slaChip = computed<{ label: string; cssClass: string } | null>(() => {
    const status = this.candidate().slaStatus;
    if (!status || status === 'ON_TRACK') return null;
    return {
      label:    status === 'BREACHED' ? 'Breached' : 'At Risk',
      cssClass: status === 'BREACHED' ? 'chip--red' : 'chip--amber',
    };
  });

  // D007/D034: show interviewSentiment (Trigger 1 baseline); only surface risk signals
  readonly sentimentChip = computed<{ label: string; cssClass: string } | null>(() => {
    const s = this.candidate().interviewSentiment;
    if (!s) return null;
    const map: Record<string, { label: string; cssClass: string }> = {
      HESITANT:        { label: 'Hesitant',   cssClass: 'chip--warning' },
      DISENGAGED:      { label: 'Disengaged', cssClass: 'chip--red' },
      NEUTRAL:         { label: 'Neutral',    cssClass: 'chip--neutral' },
      INTERESTED:      { label: 'Interested', cssClass: 'chip--green' },
      VERY_INTERESTED: { label: 'Very Interested', cssClass: 'chip--green' },
    };
    return map[s] ?? null;
  });
}
