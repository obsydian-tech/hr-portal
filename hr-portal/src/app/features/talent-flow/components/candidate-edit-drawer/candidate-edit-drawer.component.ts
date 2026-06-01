import {
  Component,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  inject,
  input,
  output,
  signal,
  effect,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { TalentFlowApiService } from '../../services/talent-flow-api.service';
import { Candidate, PositionLevel, UpdateCandidatePayload } from '../../models/talent-flow.models';

// Stages at which positionLevel becomes immutable (evaluation scores already cast)
const LEVEL_LOCKED_STAGES = new Set([
  'EVALUATION', 'BACKGROUND_CHECK',
  'OFFER_PREPARATION', 'OFFER_APPROVAL', 'OFFER_DELIVERY',
  'CONTRACT_SIGNING', 'PRE_BOARDING', 'ONBOARDING',
]);

const SOURCE_OPTIONS = [
  { label: 'LinkedIn',  value: 'LINKEDIN' },
  { label: 'Referral',  value: 'REFERRAL' },
  { label: 'Job Board', value: 'JOB_BOARD' },
  { label: 'Direct',    value: 'DIRECT' },
  { label: 'Agency',    value: 'AGENCY' },
];

const SENIORITY_OPTIONS: { value: PositionLevel; label: string }[] = [
  { value: 'JUNIOR', label: 'Junior (0–2 yrs)' },
  { value: 'MID',    label: 'Mid (3–5 yrs)'    },
  { value: 'SENIOR', label: 'Senior (6+ yrs)'  },
];

interface EditForm {
  firstName:       string;
  lastName:        string;
  phone:           string;
  role:            string;
  department:      string;
  location:        string;
  experienceYears: number;
  source:          string;
  positionLevel:   PositionLevel | '';
}

@Component({
  selector: 'tf-candidate-edit-drawer',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './candidate-edit-drawer.component.html',
  styleUrl: './candidate-edit-drawer.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CandidateEditDrawerComponent {
  readonly candidate = input.required<Candidate>();
  readonly visible   = input(false);

  readonly saved    = output<Candidate>();
  readonly closed   = output<void>();

  private readonly api = inject(TalentFlowApiService);
  private readonly cdr = inject(ChangeDetectorRef);

  readonly sourceOptions   = SOURCE_OPTIONS;
  readonly seniorityOptions = SENIORITY_OPTIONS;

  readonly saving    = signal(false);
  readonly saveError = signal<string | null>(null);

  readonly form = signal<EditForm>({
    firstName:       '',
    lastName:        '',
    phone:           '',
    role:            '',
    department:      '',
    location:        '',
    experienceYears: 0,
    source:          '',
    positionLevel:   '',
  });

  constructor() {
    effect(() => {
      const c = this.candidate();
      if (this.visible()) {
        this.form.set({
          firstName:       c.firstName       ?? '',
          lastName:        c.lastName        ?? '',
          phone:           c.phone           ?? '',
          role:            c.role            ?? '',
          department:      c.department      ?? '',
          location:        c.location        ?? '',
          experienceYears: c.experienceYears ?? 0,
          source:          c.source          ?? '',
          positionLevel:   c.positionLevel   ?? '',
        });
        this.saveError.set(null);
      }
    });
  }

  get levelLocked(): boolean {
    return LEVEL_LOCKED_STAGES.has(this.candidate().currentStage);
  }

  // ── Form field setters (no arrow functions in templates) ─────────────────
  setFirstName(e: Event): void {
    this.form.update((f) => ({ ...f, firstName: (e.target as HTMLInputElement).value }));
  }
  setLastName(e: Event): void {
    this.form.update((f) => ({ ...f, lastName: (e.target as HTMLInputElement).value }));
  }
  setPhone(e: Event): void {
    this.form.update((f) => ({ ...f, phone: (e.target as HTMLInputElement).value }));
  }
  setRole(e: Event): void {
    this.form.update((f) => ({ ...f, role: (e.target as HTMLInputElement).value }));
  }
  setDepartment(e: Event): void {
    this.form.update((f) => ({ ...f, department: (e.target as HTMLInputElement).value }));
  }
  setLocation(e: Event): void {
    this.form.update((f) => ({ ...f, location: (e.target as HTMLInputElement).value }));
  }
  setExperienceYears(e: Event): void {
    const val = parseInt((e.target as HTMLInputElement).value, 10);
    this.form.update((f) => ({ ...f, experienceYears: isNaN(val) ? 0 : val }));
  }
  setSource(e: Event): void {
    this.form.update((f) => ({ ...f, source: (e.target as HTMLSelectElement).value }));
  }
  setPositionLevel(e: Event): void {
    this.form.update((f) => ({ ...f, positionLevel: (e.target as HTMLSelectElement).value as PositionLevel }));
  }

  close(): void {
    this.closed.emit();
  }

  save(): void {
    if (this.saving()) return;
    const f = this.form();
    const c = this.candidate();

    if (!f.firstName.trim() || !f.lastName.trim()) {
      this.saveError.set('First name and last name are required.');
      return;
    }

    // Build PATCH payload — only include fields that actually changed
    const patch: UpdateCandidatePayload = {};
    if (f.firstName.trim()  !== c.firstName)       patch.firstName       = f.firstName.trim();
    if (f.lastName.trim()   !== c.lastName)        patch.lastName        = f.lastName.trim();
    if (f.phone.trim()      !== (c.phone ?? ''))   patch.phone           = f.phone.trim() || undefined;
    if (f.role.trim()       !== c.role)            patch.role            = f.role.trim();
    if (f.department.trim() !== (c.department ?? '')) patch.department   = f.department.trim() || undefined;
    if (f.location.trim()   !== (c.location ?? ''))   patch.location     = f.location.trim() || undefined;
    if (f.experienceYears   !== c.experienceYears) patch.experienceYears = f.experienceYears;
    if (f.source            !== (c.source ?? ''))  patch.source          = f.source || undefined;
    if (!this.levelLocked && f.positionLevel && f.positionLevel !== c.positionLevel) {
      patch.positionLevel = f.positionLevel as PositionLevel;
    }

    if (Object.keys(patch).length === 0) {
      this.closed.emit();
      return;
    }

    this.saving.set(true);
    this.saveError.set(null);

    this.api.updateCandidate(c.id, patch).subscribe({
      next: ({ updatedAt }) => {
        this.saving.set(false);
        // Build updated candidate with the patched values so parent can refresh
        const updated: Candidate = {
          ...c,
          ...patch,
          phone:         patch.phone         ?? c.phone,
          department:    patch.department    ?? c.department,
          location:      patch.location      ?? c.location,
          source:        patch.source        ?? c.source,
          positionLevel: patch.positionLevel ?? c.positionLevel,
          updatedAt,
        };
        this.saved.emit(updated);
      },
      error: (err: { userMessage?: string }) => {
        this.saveError.set(err.userMessage ?? 'Failed to save changes. Please try again.');
        this.saving.set(false);
        this.cdr.markForCheck();
      },
    });
  }
}
