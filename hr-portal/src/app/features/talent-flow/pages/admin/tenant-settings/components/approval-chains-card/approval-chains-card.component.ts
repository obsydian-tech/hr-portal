import {
  Component,
  ChangeDetectionStrategy,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { DrawerModule } from 'primeng/drawer';
import { MessageService, ConfirmationService } from 'primeng/api';
import { TalentFlowApiService } from '../../../../../services/talent-flow-api.service';
import { ConfigResponse } from '../../../../../models/talent-flow.models';
import {
  ApprovalChainsConfig,
  ApprovalChain,
  DEFAULT_APPROVAL_CHAINS,
  APPROVAL_ROLE_LABELS,
  APPROVAL_ROLE_COLOURS,
} from '../../../../../models/admin.models';
import { ConfigVersionBadgeComponent } from '../../../components/config-version-badge/config-version-badge.component';
import { ApprovalChainDrawerComponent } from '../approval-chain-drawer/approval-chain-drawer.component';

const SENIORITY_COLOURS: Record<string, string> = {
  JUNIOR: '#2e7d32',
  MID:    '#1565c0',
  SENIOR: '#4a3f8a',
};

/** Card 4 — Default Approval Chains */
@Component({
  selector: 'tf-approval-chains-card',
  standalone: true,
  imports: [
    CommonModule,
    ButtonModule,
    TagModule,
    DrawerModule,
    ConfigVersionBadgeComponent,
    ApprovalChainDrawerComponent,
  ],
  templateUrl: './approval-chains-card.component.html',
  styleUrl:    './approval-chains-card.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ApprovalChainsCardComponent implements OnInit {
  private readonly api            = inject(TalentFlowApiService);
  private readonly messageService = inject(MessageService);
  private readonly confirmService = inject(ConfirmationService);

  readonly loading        = signal(true);
  readonly saving         = signal(false);
  readonly configVersion  = signal<string | null>(null);
  readonly updatedAt      = signal<string | null>(null);
  readonly chains         = signal<ApprovalChain[]>(
    structuredClone(DEFAULT_APPROVAL_CHAINS),
  );

  readonly drawerVisible  = signal(false);
  readonly editingChain   = signal<ApprovalChain | null>(null);

  readonly roleLabels   = APPROVAL_ROLE_LABELS;
  readonly roleColours  = APPROVAL_ROLE_COLOURS;
  readonly tierColours  = SENIORITY_COLOURS;

  ngOnInit(): void {
    this.api.getConfig('APPROVAL_CHAINS').subscribe({
      next: (cfg: ConfigResponse) => {
        const d = cfg.data as Partial<ApprovalChainsConfig>;
        if (d.chains?.length) this.chains.set(structuredClone(d.chains));
        this.configVersion.set(cfg.version);
        this.updatedAt.set(cfg.updatedAt);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  openDrawer(chain: ApprovalChain): void {
    this.editingChain.set(structuredClone(chain));
    this.drawerVisible.set(true);
  }

  closeDrawer(): void {
    this.drawerVisible.set(false);
    this.editingChain.set(null);
  }

  onDrawerSaved(updatedChain: ApprovalChain): void {
    this.chains.update((chains) =>
      chains.map((c) =>
        c.seniority === updatedChain.seniority ? updatedChain : c,
      ),
    );
    this.closeDrawer();
  }

  confirmSave(): void {
    if (this.saving()) return;
    this.confirmService.confirm({
      message:
        'Save all approval chains? New offers and IT provisioning requests will use these chains immediately.',
      header: 'Save Approval Chains',
      icon:   'pi pi-exclamation-triangle',
      accept: () => this.doSave(),
    });
  }

  private doSave(): void {
    this.saving.set(true);
    const payload: ApprovalChainsConfig = { chains: this.chains() };
    this.api
      .updateConfig('APPROVAL_CHAINS', payload as unknown as Record<string, unknown>)
      .subscribe({
        next: (cfg: ConfigResponse) => {
          this.configVersion.set(cfg.version);
          this.updatedAt.set(cfg.updatedAt);
          this.saving.set(false);
          this.messageService.add({
            severity: 'success',
            summary:  'Saved',
            detail:   'Approval chains updated.',
            life:      4000,
          });
        },
        error: () => {
          this.saving.set(false);
          this.messageService.add({
            severity: 'error',
            summary:  'Save failed',
            detail:   'Could not save approval chains. Please try again.',
            life:      4000,
          });
        },
      });
  }

  tagColour(role: string): 'secondary' | 'info' | 'primary' | 'warn' {
    return (this.roleColours[role] as 'secondary' | 'info' | 'primary' | 'warn') ?? 'secondary';
  }
}
