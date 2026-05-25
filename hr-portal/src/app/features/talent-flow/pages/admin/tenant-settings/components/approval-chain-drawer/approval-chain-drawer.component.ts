import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  input,
  output,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';
import { DropdownModule } from 'primeng/dropdown';
import { CheckboxModule } from 'primeng/checkbox';
import { FormsModule } from '@angular/forms';
import {
  ApprovalChain,
  ApprovalStep,
  APPROVAL_ROLE_LABELS,
  APPROVAL_ROLE_COLOURS,
} from '../../../../../models/admin.models';

type ChainKey = 'offerApprovalChain' | 'provisioningApprovalChain';

const ROLE_OPTIONS = [
  { label: 'TA Specialist',   value: 'TA'          },
  { label: 'Hiring Manager',  value: 'HM'          },
  { label: 'HR Director',     value: 'HR_DIRECTOR' },
  { label: 'Finance',         value: 'FINANCE'     },
];

/** Sidebar drawer for editing a single seniority tier's approval chains */
@Component({
  selector: 'tf-approval-chain-drawer',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonModule, TagModule, TooltipModule, DropdownModule, CheckboxModule],
  templateUrl: './approval-chain-drawer.component.html',
  styleUrl:    './approval-chain-drawer.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ApprovalChainDrawerComponent {
  // Inputs / outputs
  readonly chain   = input.required<ApprovalChain>();
  readonly saved   = output<ApprovalChain>();
  readonly closed  = output<void>();

  readonly roleOptions = ROLE_OPTIONS;
  readonly roleLabels  = APPROVAL_ROLE_LABELS;

  // Local mutable copy of the chain being edited
  readonly offerSteps        = signal<ApprovalStep[]>([]);
  readonly provisioningSteps = signal<ApprovalStep[]>([]);

  private initialised = false;

  ngOnChanges(): void {
    if (!this.initialised && this.chain()) {
      this.offerSteps.set(structuredClone(this.chain().offerApprovalChain));
      this.provisioningSteps.set(structuredClone(this.chain().provisioningApprovalChain));
      this.initialised = true;
    }
  }

  // ── Offer chain ───────────────────────────────────────────────────────

  addOfferStep(): void {
    this.offerSteps.update((steps) => [
      ...steps,
      { order: steps.length + 1, role: 'HM', label: 'Hiring Manager', isRequired: true },
    ]);
  }

  removeOfferStep(index: number): void {
    this.offerSteps.update((steps) =>
      steps.filter((_, i) => i !== index).map((s, i) => ({ ...s, order: i + 1 })),
    );
  }

  moveOfferUp(index: number): void {
    if (index === 0) return;
    this.offerSteps.update((steps) => {
      const s = [...steps];
      [s[index - 1], s[index]] = [s[index], s[index - 1]];
      return s.map((step, i) => ({ ...step, order: i + 1 }));
    });
  }

  moveOfferDown(index: number): void {
    this.offerSteps.update((steps) => {
      if (index >= steps.length - 1) return steps;
      const s = [...steps];
      [s[index], s[index + 1]] = [s[index + 1], s[index]];
      return s.map((step, i) => ({ ...step, order: i + 1 }));
    });
  }

  patchOfferStep(index: number, field: keyof ApprovalStep, value: unknown): void {
    this.offerSteps.update((steps) => {
      const updated = [...steps];
      const step    = { ...updated[index], [field]: value };
      if (field === 'role') {
        step.label = APPROVAL_ROLE_LABELS[value as string] ?? String(value);
      }
      updated[index] = step;
      return updated;
    });
  }

  // ── Provisioning chain ────────────────────────────────────────────────

  addProvisioningStep(): void {
    this.provisioningSteps.update((steps) => [
      ...steps,
      { order: steps.length + 1, role: 'HM', label: 'Hiring Manager', isRequired: true },
    ]);
  }

  removeProvisioningStep(index: number): void {
    this.provisioningSteps.update((steps) =>
      steps.filter((_, i) => i !== index).map((s, i) => ({ ...s, order: i + 1 })),
    );
  }

  moveProvisioningUp(index: number): void {
    if (index === 0) return;
    this.provisioningSteps.update((steps) => {
      const s = [...steps];
      [s[index - 1], s[index]] = [s[index], s[index - 1]];
      return s.map((step, i) => ({ ...step, order: i + 1 }));
    });
  }

  moveProvisioningDown(index: number): void {
    this.provisioningSteps.update((steps) => {
      if (index >= steps.length - 1) return steps;
      const s = [...steps];
      [s[index], s[index + 1]] = [s[index + 1], s[index]];
      return s.map((step, i) => ({ ...step, order: i + 1 }));
    });
  }

  patchProvisioningStep(index: number, field: keyof ApprovalStep, value: unknown): void {
    this.provisioningSteps.update((steps) => {
      const updated = [...steps];
      const step    = { ...updated[index], [field]: value };
      if (field === 'role') {
        step.label = APPROVAL_ROLE_LABELS[value as string] ?? String(value);
      }
      updated[index] = step;
      return updated;
    });
  }

  // ── Save / close ──────────────────────────────────────────────────────

  save(): void {
    const updated: ApprovalChain = {
      seniority:                  this.chain().seniority,
      offerApprovalChain:         this.offerSteps(),
      provisioningApprovalChain:  this.provisioningSteps(),
    };
    this.saved.emit(updated);
  }

  close(): void {
    this.initialised = false;
    this.closed.emit();
  }

  tagColour(role: string): 'secondary' | 'info' | 'primary' | 'warn' {
    return (APPROVAL_ROLE_COLOURS[role] as 'secondary' | 'info' | 'primary' | 'warn') ?? 'secondary';
  }
}
