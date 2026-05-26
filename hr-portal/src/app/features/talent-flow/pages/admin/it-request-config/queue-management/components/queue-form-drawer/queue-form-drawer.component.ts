import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
  signal,
  effect,
  inject,
  OnInit,
  untracked,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { SidebarModule } from 'primeng/sidebar';
import { InputTextModule } from 'primeng/inputtext';
import { Textarea } from 'primeng/inputtextarea';
import { InputNumberModule } from 'primeng/inputnumber';
import { DropdownModule } from 'primeng/dropdown';
import { MultiSelectModule } from 'primeng/multiselect';
import { ITQueue, QueueCategory } from '../../../it-request.models';
import { TalentFlowApiService } from '../../../../../../services/talent-flow-api.service';

const CATEGORY_OPTIONS: Array<{ label: string; value: QueueCategory }> = [
  { label: 'Hardware',        value: 'HARDWARE' },
  { label: 'Software',        value: 'SOFTWARE' },
  { label: 'Access & Perms',  value: 'ACCESS'   },
  { label: 'Infrastructure',  value: 'INFRA'    },
];

const EMPTY_QUEUE = (): ITQueue => ({
  id:                   crypto.randomUUID(),
  name:                 '',
  description:          '',
  category:             'HARDWARE',
  slaHours:             48,
  assignedSpecialists:  [],
  active:               true,
});

/**
 * QueueFormDrawerComponent — 480px sidebar for creating/editing an IT Queue.
 *
 * Usage:
 *   <tf-queue-form-drawer
 *     [visible]="drawerVisible()"
 *     [queue]="editingQueue()"
 *     (saved)="saveQueue($event)"
 *     (closed)="closeDrawer()"
 *   />
 */
@Component({
  selector: 'tf-queue-form-drawer',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonModule, SidebarModule, InputTextModule,
            Textarea, InputNumberModule, DropdownModule, MultiSelectModule],
  templateUrl: './queue-form-drawer.component.html',
  styleUrl:    './queue-form-drawer.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class QueueFormDrawerComponent implements OnInit {
  private readonly api = inject(TalentFlowApiService);

  readonly visible = input<boolean>(false);
  readonly queue   = input<ITQueue | null>(null);

  readonly saved  = output<ITQueue>();
  readonly closed = output<void>();

  readonly form                = signal<ITQueue>(EMPTY_QUEUE());
  readonly categoryOpts        = CATEGORY_OPTIONS;
  readonly isEditMode          = signal(false);
  readonly availableSpecialists = signal<Array<{ id: string; label: string; email: string }>>([]);
  readonly specialistsLoading  = signal(false);

  constructor() {
    // Sync form when queue input changes — allowSignalWrites required (NG0600)
    effect(() => {
      const q = this.queue();
      untracked(() => {
        if (q) {
          this.form.set({ ...q, assignedSpecialists: [...q.assignedSpecialists] });
          this.isEditMode.set(true);
        } else {
          this.form.set(EMPTY_QUEUE());
          this.isEditMode.set(false);
        }
      });
    }, { allowSignalWrites: true });
  }

  ngOnInit(): void {
    this.specialistsLoading.set(true);
    this.api.getItSpecialists().subscribe({
      next: (specialists) => {
        this.availableSpecialists.set(specialists);
        this.specialistsLoading.set(false);
      },
      error: () => this.specialistsLoading.set(false),
    });
  }

  get valid(): boolean {
    const f = this.form();
    return f.name.trim().length > 0 && f.slaHours > 0;
  }

  patchForm(patch: Partial<ITQueue>): void {
    this.form.update((f) => ({ ...f, ...patch }));
  }

  submit(): void {
    if (!this.valid) return;
    this.saved.emit({ ...this.form() });
  }

  close(): void {
    this.closed.emit();
  }
}
