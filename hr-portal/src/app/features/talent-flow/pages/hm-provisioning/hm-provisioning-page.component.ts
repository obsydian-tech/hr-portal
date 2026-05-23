import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  computed,
  OnInit,
} from '@angular/core';
import { Router } from '@angular/router';
import { DrawerModule } from 'primeng/drawer';
import { ButtonModule } from 'primeng/button';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { TalentFlowApiService } from '../../services/talent-flow-api.service';
import { TalentFlowAuthService } from '../../services/talent-flow-auth.service';
import { AuthService } from '../../../../core/services/auth.service';
import { ProvisioningBundleCardComponent } from '../../components/provisioning-bundle-card/provisioning-bundle-card.component';
import {
  ProvisioningBundle,
  ProvisioningItem,
  ProvisioningRequirementType,
} from '../../models/talent-flow.models';

/**
 * HM Provisioning Page — IT Request Module Screen 1
 *
 * Answers two HM questions instantly:
 *   1. What bundles need my review right now?
 *   2. What is the fulfilment status of bundles I have already approved?
 *
 * Signal strip → Pending review section → In-fulfilment section (capped at 3, View all toggle).
 * Modify opens an inline drawer (right, 520px) — locked decision.
 */
@Component({
  selector: 'tf-hm-provisioning-page',
  standalone: true,
  imports: [
    DrawerModule,
    ButtonModule,
    ProgressSpinnerModule,
    ProvisioningBundleCardComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './hm-provisioning-page.component.html',
  styleUrl: './hm-provisioning-page.component.scss',
})
export class HmProvisioningPageComponent implements OnInit {
  private readonly api      = inject(TalentFlowApiService);
  protected readonly tfAuth = inject(TalentFlowAuthService);
  private readonly auth     = inject(AuthService);
  private readonly router   = inject(Router);

  // ── State ───────────────────────────────────────────────────────────────

  protected readonly loading   = signal(true);
  protected readonly loadError = signal('');
  private readonly bundles     = signal<ProvisioningBundle[]>([]);
  protected readonly showAllFulfilment = signal(false);
  protected readonly modifyDrawerOpen  = signal(false);
  protected readonly modifyTarget      = signal<ProvisioningBundle | null>(null);

  // ── Derived ─────────────────────────────────────────────────────────────

  protected readonly pendingBundles = computed<ProvisioningBundle[]>(() =>
    this.bundles().filter((b) => b.bundleStatus === 'PENDING_REVIEW'),
  );

  protected readonly fulfilmentBundles = computed<ProvisioningBundle[]>(() =>
    this.bundles().filter((b) => b.bundleStatus === 'IN_FULFILMENT'),
  );

  protected readonly readyBundles = computed<ProvisioningBundle[]>(() =>
    this.bundles().filter((b) => b.bundleStatus === 'READY'),
  );

  /** Capped at 3 unless showAllFulfilment is true */
  protected readonly visibleFulfilment = computed<ProvisioningBundle[]>(() =>
    this.showAllFulfilment()
      ? this.fulfilmentBundles()
      : this.fulfilmentBundles().slice(0, 3),
  );

  protected readonly hiddenFulfilmentCount = computed<number>(() =>
    Math.max(0, this.fulfilmentBundles().length - 3),
  );

  // Signal strip stats
  protected readonly awaitingReviewCount = computed(() => this.pendingBundles().length);
  protected readonly inFulfilmentCount   = computed(() => this.fulfilmentBundles().length);
  protected readonly readyCount          = computed(() => this.readyBundles().length);

  /** True if any in-fulfilment bundle is at risk or breached */
  protected readonly fulfilmentAtRisk = computed<boolean>(() =>
    this.fulfilmentBundles().some((b) => b.slaStatus === 'AT_RISK' || b.slaStatus === 'BREACHED'),
  );

  // Modify drawer — editable copy of the target bundle's items
  protected readonly editItems = signal<ProvisioningItem[]>([]);

  protected readonly currentUser = computed(() =>
    this.tfAuth.currentUser() ?? (this.auth.currentUser() as unknown),
  );

  // ── Lifecycle ────────────────────────────────────────────────────────────

  ngOnInit(): void {
    this.api.getProvisioningBundles().subscribe({
      next: (data) => {
        this.bundles.set(data);
        this.loading.set(false);
      },
      error: (err: { message?: string }) => {
        this.loadError.set(err?.message ?? 'Failed to load provisioning bundles.');
        this.loading.set(false);
      },
    });
  }

  // ── Actions ──────────────────────────────────────────────────────────────

  protected openModify(bundle: ProvisioningBundle): void {
    this.modifyTarget.set(bundle);
    this.editItems.set(bundle.items.map((i) => ({ ...i }))); // shallow copy
    this.modifyDrawerOpen.set(true);
  }

  protected closeModify(): void {
    this.modifyDrawerOpen.set(false);
    this.modifyTarget.set(null);
    this.editItems.set([]);
  }

  protected removeEditItem(id: string): void {
    this.editItems.update((items) => items.filter((i) => i.id !== id));
  }

  protected saveModify(): void {
    const target = this.modifyTarget();
    if (!target) return;
    // Optimistic update — TODO: wire PATCH /v1/provisioning/bundles/:id
    this.bundles.update((list) =>
      list.map((b) =>
        b.id === target.id ? { ...b, items: this.editItems() } : b,
      ),
    );
    this.closeModify();
  }

  protected approveBundle(bundle: ProvisioningBundle): void {
    // Navigate to the full review screen (Screen 2) — approval happens there
    void this.router.navigate(['/platform/talentflow/hm-provisioning', bundle.id, 'review']);
  }

  protected viewDetails(bundle: ProvisioningBundle): void {
    void this.router.navigate(['/platform/talentflow/hm-provisioning', bundle.id, 'progress']);
  }

  protected typeIcon(type: ProvisioningRequirementType): string {
    const map: Record<ProvisioningRequirementType, string> = {
      HARDWARE:   'pi-desktop',
      ACCESS:     'pi-envelope',
      SOFTWARE:   'pi-th-large',
      FACILITIES: 'pi-id-card',
    };
    return map[type] ?? 'pi-box';
  }

  protected typeLabelFor(type: ProvisioningRequirementType): string {
    const map: Record<ProvisioningRequirementType, string> = {
      HARDWARE:   'Hardware',
      ACCESS:     'Access',
      SOFTWARE:   'Software',
      FACILITIES: 'Facilities',
    };
    return map[type] ?? type;
  }
}
