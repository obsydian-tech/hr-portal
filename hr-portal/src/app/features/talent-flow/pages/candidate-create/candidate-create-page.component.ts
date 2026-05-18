import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
} from '@angular/core';
import {
  FormBuilder,
  ReactiveFormsModule,
  Validators,
  AbstractControl,
} from '@angular/forms';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { DropdownModule } from 'primeng/dropdown';
import { TalentFlowApiService } from '../../services/talent-flow-api.service';
import { PositionLevel } from '../../models/talent-flow.models';

/**
 * CandidateCreatePageComponent — FE-007 / NH-140
 *
 * Design source: naleko-design-handoff/preview/16-inputs.html
 * Route: /talent-flow/candidates/new
 *
 * On submit: POST createCandidate → redirect to /talent-flow/candidates/:id
 */

const POSITION_LEVELS: { label: string; value: PositionLevel }[] = [
  { label: 'Junior',    value: 'JUNIOR' },
  { label: 'Mid',       value: 'MID' },
  { label: 'Senior',    value: 'SENIOR' },
  { label: 'Director',  value: 'DIRECTOR' },
];

const SOURCE_OPTIONS = [
  { label: 'LinkedIn',   value: 'LINKEDIN' },
  { label: 'Referral',   value: 'REFERRAL' },
  { label: 'Job Board',  value: 'JOB_BOARD' },
  { label: 'Direct',     value: 'DIRECT' },
  { label: 'Agency',     value: 'AGENCY' },
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
    DropdownModule,
  ],
  templateUrl: './candidate-create-page.component.html',
  styleUrl:    './candidate-create-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CandidateCreatePageComponent {
  private readonly fb     = inject(FormBuilder);
  private readonly api    = inject(TalentFlowApiService);
  private readonly router = inject(Router);

  readonly positionLevels = POSITION_LEVELS;
  readonly sourceOptions  = SOURCE_OPTIONS;

  readonly saving    = signal(false);
  readonly saveError = signal<string | null>(null);

  readonly form = this.fb.group({
    firstName:       ['', [Validators.required, Validators.minLength(2)]],
    lastName:        ['', [Validators.required, Validators.minLength(2)]],
    email:           ['', [Validators.required, Validators.email]],
    phone:           [''],
    role:            ['', Validators.required],
    positionLevel:   [null as PositionLevel | null, Validators.required],
    experienceYears: [0, [Validators.required, Validators.min(0), Validators.max(50)]],
    source:          [null as string | null],
  });

  field(name: string): AbstractControl {
    return this.form.get(name)!;
  }

  isInvalid(name: string): boolean {
    const c = this.field(name);
    return c.invalid && (c.dirty || c.touched);
  }

  submit(): void {
    if (this.form.invalid || this.saving()) return;
    this.form.markAllAsTouched();
    if (this.form.invalid) return;

    this.saving.set(true);
    this.saveError.set(null);

    const v = this.form.getRawValue();

    this.api.createCandidate({
      firstName:       v.firstName!,
      lastName:        v.lastName!,
      email:           v.email!,
      phone:           v.phone || undefined,
      role:            v.role!,
      positionLevel:   v.positionLevel!,
      experienceYears: v.experienceYears ?? 0,
      source:          v.source || undefined,
    }).subscribe({
      next: ({ candidateId }) => {
        void this.router.navigate(['/talent-flow/candidates', candidateId]);
      },
      error: (err: { userMessage?: string }) => {
        this.saveError.set(err.userMessage ?? 'Failed to create candidate.');
        this.saving.set(false);
      },
    });
  }

  cancel(): void {
    void this.router.navigate(['/talent-flow/pipeline']);
  }
}
