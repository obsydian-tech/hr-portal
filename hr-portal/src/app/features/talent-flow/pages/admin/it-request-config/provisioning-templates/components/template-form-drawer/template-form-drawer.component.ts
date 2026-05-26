import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
  signal,
  effect,
  computed,
  untracked,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DrawerModule } from 'primeng/drawer';
import { InputTextModule } from 'primeng/inputtext';
import { Textarea } from 'primeng/textarea';
import { SelectModule } from 'primeng/select';
import { CheckboxModule } from 'primeng/checkbox';
import { ProvisioningTemplate, TemplateRequirement, RequirementCategory } from '../../../it-request.models';

const CATEGORY_OPTIONS: Array<{ label: string; value: RequirementCategory }> = [
  { label: 'Hardware',     value: 'HARDWARE'    },
  { label: 'Software',     value: 'SOFTWARE'    },
  { label: 'Access',       value: 'ACCESS'      },
  { label: 'Peripherals',  value: 'PERIPHERALS' },
  { label: 'Other',        value: 'OTHER'       },
];

const EMPTY_TEMPLATE = (): ProvisioningTemplate => ({
  id:           crypto.randomUUID(),
  name:         '',
  description:  '',
  targetRole:   '',
  requirements: [],
  active:       true,
});

const EMPTY_REQ = (): TemplateRequirement => ({
  itemName: '',
  category: 'HARDWARE',
  optional: false,
});

/**
 * TemplateFormDrawerComponent — 560px sidebar for create/edit provisioning template.
 */
@Component({
  selector: 'tf-template-form-drawer',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonModule, DrawerModule, InputTextModule,
            Textarea, SelectModule, CheckboxModule],
  templateUrl: './template-form-drawer.component.html',
  styleUrl:    './template-form-drawer.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TemplateFormDrawerComponent {
  readonly visible  = input<boolean>(false);
  readonly template = input<ProvisioningTemplate | null>(null);

  readonly saved  = output<ProvisioningTemplate>();
  readonly closed = output<void>();

  readonly form         = signal<ProvisioningTemplate>(EMPTY_TEMPLATE());
  readonly isEditMode   = signal(false);
  readonly categoryOpts = CATEGORY_OPTIONS;

  readonly valid = computed(() => {
    const f = this.form();
    return f.name.trim().length > 0 && f.targetRole.trim().length > 0;
  });

  constructor() {
    // Sync form when template input changes
    effect(() => {
      const t = this.template();
      untracked(() => {
        if (t) {
          this.form.set({ ...t, requirements: t.requirements.map((r) => ({ ...r })) });
          this.isEditMode.set(true);
        } else {
          this.form.set(EMPTY_TEMPLATE());
          this.isEditMode.set(false);
        }
      });
    });
  }

  patchForm(patch: Partial<ProvisioningTemplate>): void {
    this.form.update((f) => ({ ...f, ...patch }));
  }

  addRequirement(): void {
    this.form.update((f) => ({ ...f, requirements: [...f.requirements, EMPTY_REQ()] }));
  }

  updateRequirement(index: number, patch: Partial<TemplateRequirement>): void {
    this.form.update((f) => ({
      ...f,
      requirements: f.requirements.map((r, i) => (i === index ? { ...r, ...patch } : r)),
    }));
  }

  removeRequirement(index: number): void {
    this.form.update((f) => ({
      ...f,
      requirements: f.requirements.filter((_, i) => i !== index),
    }));
  }

  submit(): void {
    if (!this.valid()) return;
    this.saved.emit({ ...this.form() });
  }

  close(): void {
    this.closed.emit();
  }
}
