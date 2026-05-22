import {
  Component,
  ChangeDetectionStrategy,
  inject,
  input,
  output,
  signal,
  computed,
} from '@angular/core';
import {
  FormBuilder,
  ReactiveFormsModule,
  Validators,
  AbstractControl,
} from '@angular/forms';
import { CommonModule } from '@angular/common';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { SelectModule } from 'primeng/select';
import { TalentFlowApiService } from '../../services/talent-flow-api.service';
import { PositionLevel } from '../../models/talent-flow.models';

/**
 * CandidateCreatePageComponent — Phase B rebuild (D036–D043)
 * Visual seniority cards (D038), workflow cards (D039),
 * completeness bar (D037), fixed footer CTA (D041).
 */

const SOURCE_OPTIONS = [
  { label: 'LinkedIn',  value: 'LINKEDIN' },
  { label: 'Referral',  value: 'REFERRAL' },
  { label: 'Job Board', value: 'JOB_BOARD' },
  { label: 'Direct',    value: 'DIRECT' },
  { label: 'Agency',    value: 'AGENCY' },
];

const SENIORITY_CARDS: { value: PositionLevel; label: string; desc: string; icon: string }[] = [
  { value: 'JUNIOR',  label: 'Junior',  desc: '0–2 yrs',  icon: 'pi-star-o' },
  { value: 'MID',     label: 'Mid',     desc: '3–5 yrs',  icon: 'pi-star-half' },
  { value: 'SENIOR',  label: 'Senior',  desc: '6+ yrs',   icon: 'pi-star' },
];

const WORKFLOW_CARDS = [
  { value: 'standard-v1',  label: 'Standard',   desc: 'Full 12-stage pipeline', icon: 'pi-sitemap' },
  { value: 'fasttrack-v1', label: 'Fast-Track',  desc: 'Accelerated 6 stages',  icon: 'pi-bolt' },
];

@Component({
  selector: 'tf-candidate-create-page',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    ButtonModule,
    InputTextModule,
    InputNumberModule,
    SelectModule,
  ],
  templateUrl: './candidate-create-page.component.html',
  styleUrl:    './candidate-create-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CandidateCreatePageComponent {
  private readonly fb  = inject(FormBuilder);
  private readonly api = inject(TalentFlowApiService);

  readonly isDrawer = input(false);

  readonly cancelled = output<void>();
  readonly created   = output<string>();

  readonly seniorityCards = SENIORITY_CARDS;
  readonly workflowCards  = WORKFLOW_CARDS;
  readonly sourceOptions  = SOURCE_OPTIONS;

  readonly saving         = signal(false);
  readonly saveError      = signal<string | null>(null);
  readonly showInterview  = signal(false);

  readonly form = this.fb.group({
    firstName:          ['', [Validators.required, Validators.minLength(2)]],
    lastName:           ['', [Validators.required, Validators.minLength(2)]],
    email:              ['', [Validators.required, Validators.email]],
    phone:              [''],
    role:               ['', Validators.required],
    department:         [''],
    location:           [''],
    positionLevel:      [null as PositionLevel | null, Validators.required],
    workflowTemplateId: ['standard-v1', Validators.required],
    experienceYears:    [0, [Validators.required, Validators.min(0), Validators.max(50)]],
    source:             [null as string | null],
  });

  // ── Completeness bar (D037) ──────────────────────────────────────────────
  readonly completeness = computed<number>(() => {
    const required = ['firstName', 'lastName', 'email', 'role', 'positionLevel', 'workflowTemplateId'];
    const filled   = required.filter(f => {
      const v = this.form.get(f)?.value;
      return v !== null && v !== '' && v !== undefined;
    });
    return Math.round((filled.length / required.length) * 100);
  });

  // ── Visual card setters ───────────────────────────────────────────────────
  selectSeniority(v: PositionLevel): void {
    this.form.patchValue({ positionLevel: v });
    this.form.get('positionLevel')?.markAsDirty();
  }

  selectWorkflow(v: string): void {
    this.form.patchValue({ workflowTemplateId: v });
  }

  field(name: string): AbstractControl {
    return this.form.get(name)!;
  }

  isInvalid(name: string): boolean {
    const c = this.field(name);
    return c.invalid && (c.dirty || c.touched);
  }

  submit(): void {
    if (this.saving()) return;
    this.form.markAllAsTouched();
    if (this.form.invalid) return;

    this.saving.set(true);
    this.saveError.set(null);

    const v = this.form.getRawValue();

    this.api.createCandidate({
      firstName:          v.firstName!,
      lastName:           v.lastName!,
      email:              v.email!,
      phone:              v.phone || undefined,
      role:               v.role!,
      department:         v.department || undefined,
      location:           v.location  || undefined,
      positionLevel:      v.positionLevel!,
      experienceYears:    v.experienceYears ?? 0,
      source:             v.source || undefined,
      workflowTemplateId: v.workflowTemplateId || undefined,
    }).subscribe({
      next: ({ candidateId }) => this.created.emit(candidateId),
      error: (err: { userMessage?: string }) => {
        this.saveError.set(err.userMessage ?? 'Failed to create candidate.');
        this.saving.set(false);
      },
    });
  }

  cancel(): void {
    this.cancelled.emit();
  }
}
