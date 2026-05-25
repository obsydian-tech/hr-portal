import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  OnInit,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ButtonModule } from 'primeng/button';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';
import { MessageService, ConfirmationService } from 'primeng/api';
import { TalentFlowApiService } from '../../../../services/talent-flow-api.service';
import { ConfigResponse } from '../../../../models/talent-flow.models';
import { ConfigVersionBadgeComponent } from '../../components/config-version-badge/config-version-badge.component';
import { TemplateFormDrawerComponent } from './components/template-form-drawer/template-form-drawer.component';
import { ProvisioningTemplate } from '../it-request.models';

/**
 * AdminProvisioningTemplatesComponent — Admin-S2 / IT Request Config
 *
 * Route: /platform/talentflow/admin/it-request/templates
 *
 * CRUD for provisioning templates that define equipment/access
 * bundles for new hires by role.
 */
@Component({
  selector: 'tf-admin-provisioning-templates',
  standalone: true,
  imports: [CommonModule, ButtonModule, TableModule, TagModule, TooltipModule,
            ConfigVersionBadgeComponent, TemplateFormDrawerComponent],
  templateUrl: './admin-provisioning-templates.component.html',
  styleUrl:    './admin-provisioning-templates.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminProvisioningTemplatesComponent implements OnInit {
  private readonly api            = inject(TalentFlowApiService);
  private readonly messageService = inject(MessageService);
  private readonly confirmService = inject(ConfirmationService);

  readonly loading       = signal(true);
  readonly saving        = signal(false);
  readonly templates     = signal<ProvisioningTemplate[]>([]);
  readonly configVersion = signal<string | null>(null);
  readonly updatedAt     = signal<string | null>(null);

  readonly drawerVisible  = signal(false);
  readonly editingTemplate = signal<ProvisioningTemplate | null>(null);

  ngOnInit(): void {
    this.loadConfig();
  }

  private loadConfig(): void {
    this.loading.set(true);
    this.api.getConfig('PROVISIONING_TEMPLATES').subscribe({
      next: (cfg: ConfigResponse) => {
        const d = cfg.data as { templates?: ProvisioningTemplate[] };
        this.templates.set(Array.isArray(d.templates) ? d.templates : []);
        this.configVersion.set(cfg.version);
        this.updatedAt.set(cfg.updatedAt);
        this.loading.set(false);
      },
      error: () => { this.loading.set(false); },
    });
  }

  openCreateDrawer(): void {
    this.editingTemplate.set(null);
    this.drawerVisible.set(true);
  }

  openEditDrawer(tmpl: ProvisioningTemplate): void {
    this.editingTemplate.set({ ...tmpl, requirements: tmpl.requirements.map((r) => ({ ...r })) });
    this.drawerVisible.set(true);
  }

  closeDrawer(): void {
    this.drawerVisible.set(false);
    this.editingTemplate.set(null);
  }

  saveTemplate(tmpl: ProvisioningTemplate): void {
    const existing = this.templates();
    const idx      = existing.findIndex((t) => t.id === tmpl.id);
    const updated  = idx >= 0
      ? existing.map((t) => (t.id === tmpl.id ? tmpl : t))
      : [...existing, tmpl];

    this.persistTemplates(updated, () => {
      this.closeDrawer();
      this.messageService.add({ severity: 'success', summary: 'Saved', detail: `Template "${tmpl.name}" saved.`, life: 4000 });
    });
  }

  confirmDelete(tmpl: ProvisioningTemplate): void {
    this.confirmService.confirm({
      message: `Delete template "${tmpl.name}"? This cannot be undone.`,
      header:  'Delete Template',
      icon:    'pi pi-trash',
      accept:  () => {
        const updated = this.templates().filter((t) => t.id !== tmpl.id);
        this.persistTemplates(updated, () => {
          this.messageService.add({ severity: 'success', summary: 'Deleted', detail: `Template "${tmpl.name}" deleted.`, life: 4000 });
        });
      },
    });
  }

  toggleActive(tmpl: ProvisioningTemplate): void {
    const updated = this.templates().map((t) =>
      t.id === tmpl.id ? { ...t, active: !t.active } : t,
    );
    this.persistTemplates(updated);
  }

  private persistTemplates(templates: ProvisioningTemplate[], onSuccess?: () => void): void {
    this.saving.set(true);
    this.api.updateConfig('PROVISIONING_TEMPLATES', { templates }).subscribe({
      next: (cfg: ConfigResponse) => {
        this.templates.set(templates);
        this.configVersion.set(cfg.version);
        this.updatedAt.set(cfg.updatedAt);
        this.saving.set(false);
        onSuccess?.();
      },
      error: (err: { userMessage?: string }) => {
        this.saving.set(false);
        this.messageService.add({ severity: 'error', summary: 'Error', detail: err.userMessage ?? 'Save failed.', life: 5000 });
      },
    });
  }
}
