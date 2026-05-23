import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  computed,
  OnInit,
} from '@angular/core';
import { Router, ActivatedRoute, RouterLink } from '@angular/router';
import { UpperCasePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { TalentFlowApiService } from '../../services/talent-flow-api.service';
import { TalentFlowAuthService } from '../../services/talent-flow-auth.service';
import { AuthService } from '../../../../core/services/auth.service';
import {
  ProvisioningBundle,
  ProvisioningItem,
  ProvisioningApprovalChainStep,
  ProvisioningRequirementType,
} from '../../models/talent-flow.models';

/**
 * HmBundleReviewPageComponent — Screen 2
 * IT Request Module — Bundle review before approval.
 *
 * Two-column layout:
 *   Left  — Candidate strip · Signal Intelligence · Requirement list with inline notes edit
 *   Right — Review SLA · Approval Chain · What Happens On Approval
 * Footer — Back | Approve bundle & send to IT queues | (lock warning)
 *
 * Locked decisions (Screen 2 — confirmed):
 *   - Inline pencil expands notes textarea ONLY (queue change not in scope here)
 *   - "From template" tag shown on auto-generated items, absent on manual additions
 *   - Approval chain sidebar shows Queues as steps (not individual IT specialists)
 *   - Hard lock after approval — cannot add or modify after approve action fires
 */
@Component({
  selector: 'tf-hm-bundle-review-page',
  standalone: true,
  imports: [RouterLink, FormsModule, ButtonModule, ProgressSpinnerModule, UpperCasePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './hm-bundle-review-page.component.html',
  styleUrl: './hm-bundle-review-page.component.scss',
})
export class HmBundleReviewPageComponent implements OnInit {
  private readonly api      = inject(TalentFlowApiService);
  private readonly route    = inject(ActivatedRoute);
  private readonly router   = inject(Router);
  protected readonly tfAuth = inject(TalentFlowAuthService);
  private readonly auth     = inject(AuthService);

  // ── State ───────────────────────────────────────────────────────────────

  protected readonly loading     = signal(true);
  protected readonly loadError   = signal('');
  protected readonly approving   = signal(false);
  protected readonly approved    = signal(false);

  private readonly _bundle       = signal<ProvisioningBundle | null>(null);
  protected readonly items       = signal<ProvisioningItem[]>([]);
  protected readonly editingId   = signal<string | null>(null);   // item id with open notes editor
  protected readonly editNote    = signal<string>('');

  // ── Derived ─────────────────────────────────────────────────────────────

  protected readonly bundle = computed(() => this._bundle());

  protected readonly daysToStart = computed<number | null>(() => {
    const b = this._bundle();
    if (!b) return null;
    const diff = new Date(b.startDate).getTime() - Date.now();
    return Math.ceil(diff / 86400000);
  });

  protected readonly currentUser = computed(() =>
    this.tfAuth.currentUser() ?? (this.auth.currentUser() as unknown as { givenName?: string; familyName?: string }),
  );

  protected readonly hmName = computed<string>(() => {
    const u = this.currentUser() as { givenName?: string; familyName?: string } | null;
    if (!u) return 'You';
    return [u.givenName, u.familyName].filter(Boolean).join(' ') || 'You';
  });

  /** Derive unique queues from items to build the approval chain sidebar */
  protected readonly approvalChain = computed<ProvisioningApprovalChainStep[]>(() => {
    const steps: ProvisioningApprovalChainStep[] = [
      {
        id: 'hm',
        type: 'HM',
        label: this.hmName(),
        sublabel: 'Hiring Manager · Bundle review',
      },
    ];
    const seenQueues = new Set<string>();
    for (const item of this.items()) {
      if (!seenQueues.has(item.queue)) {
        seenQueues.add(item.queue);
        steps.push({
          id: `queue-${item.queue}`,
          type: 'QUEUE',
          label: item.queue,
          sublabel: `IT specialist · ${item.label} fulfilment`,
        });
      }
    }
    return steps;
  });

  // ── Lifecycle ────────────────────────────────────────────────────────────

  ngOnInit(): void {
    const bundleId = this.route.snapshot.paramMap.get('bundleId') ?? '';
    this.api.getProvisioningBundle(bundleId).subscribe({
      next: (b) => {
        if (!b) {
          this.loadError.set('Bundle not found.');
        } else {
          this._bundle.set(b);
          this.items.set(b.items.map((i) => ({ ...i })));
        }
        this.loading.set(false);
      },
      error: (err: { message?: string }) => {
        this.loadError.set(err?.message ?? 'Failed to load bundle.');
        this.loading.set(false);
      },
    });
  }

  // ── Actions — inline edit ────────────────────────────────────────────────

  protected openEdit(item: ProvisioningItem): void {
    this.editingId.set(item.id);
    this.editNote.set(item.notes ?? '');
  }

  protected cancelEdit(): void {
    this.editingId.set(null);
    this.editNote.set('');
  }

  protected saveNote(itemId: string): void {
    this.items.update((list) =>
      list.map((i) => i.id === itemId ? { ...i, notes: this.editNote() } : i),
    );
    this.editingId.set(null);
    this.editNote.set('');
  }

  protected removeItem(id: string): void {
    this.items.update((list) => list.filter((i) => i.id !== id));
  }

  protected addRequirement(): void {
    // Phase 2: open requirement picker panel
    // For now add a blank manual item as placeholder
    const newId = `manual-${Date.now()}`;
    this.items.update((list) => [
      ...list,
      {
        id:           newId,
        type:         'ACCESS',
        label:        'New requirement',
        queue:        'Access & Identity',
        status:       'PENDING',
        fromTemplate: false,
      },
    ]);
    // Immediately open the edit panel for the new item
    this.editingId.set(newId);
    this.editNote.set('');
  }

  // ── Actions — approve ────────────────────────────────────────────────────

  protected approveBundle(): void {
    const b = this._bundle();
    if (!b || this.approving()) return;
    this.approving.set(true);
    // TODO: wire POST /v1/provisioning/bundles/:id/approve with { items: this.items() }
    // Simulate async
    setTimeout(() => {
      this.approving.set(false);
      this.approved.set(true);
      setTimeout(() => {
        void this.router.navigate(['/platform/talentflow/hm-provisioning']);
      }, 1200);
    }, 800);
  }

  protected goBack(): void {
    void this.router.navigate(['/platform/talentflow/hm-provisioning']);
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  typeIcon(type: ProvisioningRequirementType): string {
    const map: Record<ProvisioningRequirementType, string> = {
      HARDWARE:   'pi-desktop',
      ACCESS:     'pi-envelope',
      SOFTWARE:   'pi-th-large',
      FACILITIES: 'pi-id-card',
    };
    return map[type] ?? 'pi-box';
  }

  typeColour(type: ProvisioningRequirementType): string {
    const map: Record<ProvisioningRequirementType, string> = {
      HARDWARE:   '#6366f1',
      ACCESS:     '#06b6d4',
      SOFTWARE:   '#10b981',
      FACILITIES: '#f59e0b',
    };
    return map[type] ?? '#94a3b8';
  }

  startDateFormatted(iso: string): string {
    return new Date(iso).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  avatarInitials(name: string): string {
    const parts = name.split(' ');
    return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase();
  }

  avatarColour(name: string): string {
    const colours = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6'];
    let hash = 0;
    for (const ch of name) hash = ch.charCodeAt(0) + (hash << 5) - hash;
    return colours[Math.abs(hash) % colours.length];
  }
}
