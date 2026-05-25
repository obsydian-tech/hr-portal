import {
  Component,
  ChangeDetectionStrategy,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { TagModule } from 'primeng/tag';
import { Router } from '@angular/router';
import { MessageService } from 'primeng/api';
import { TalentFlowApiService } from '../../../../../services/talent-flow-api.service';
import {
  ConfigResponse,
} from '../../../../../models/talent-flow.models';
import {
  WorkflowTemplatesConfig,
  WorkflowTemplate,
  DEFAULT_WORKFLOW_TEMPLATES,
} from '../../../../../models/admin.models';

/** Card 3 — Workflow Templates (read-only) */
@Component({
  selector: 'tf-workflow-templates-card',
  standalone: true,
  imports: [CommonModule, ButtonModule, DialogModule, TagModule],
  templateUrl: './workflow-templates-card.component.html',
  styleUrl:    './workflow-templates-card.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorkflowTemplatesCardComponent implements OnInit {
  private readonly api            = inject(TalentFlowApiService);
  private readonly router         = inject(Router);
  private readonly messageService = inject(MessageService);

  readonly loading    = signal(true);
  readonly templates  = signal<WorkflowTemplate[]>([...DEFAULT_WORKFLOW_TEMPLATES]);
  readonly viewingTemplate = signal<WorkflowTemplate | null>(null);

  ngOnInit(): void {
    this.api.getConfig('WORKFLOW_TEMPLATES').subscribe({
      next: (cfg: ConfigResponse) => {
        const d = cfg.data as Partial<WorkflowTemplatesConfig>;
        if (d.templates?.length) this.templates.set(d.templates);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  viewStages(tpl: WorkflowTemplate): void {
    this.viewingTemplate.set(tpl);
  }

  closeStagesDialog(): void {
    this.viewingTemplate.set(null);
  }

  editTemplate(tpl: WorkflowTemplate): void {
    // Future page — navigate to workflow-templates editor
    this.router.navigateByUrl(
      `/platform/talentflow/admin/workflow-templates/${tpl.templateId}`,
    ).catch(() => {
      this.messageService.add({
        severity: 'info',
        summary:  'Coming Soon',
        detail:   'Workflow template editor is not yet available.',
        life:      4000,
      });
    });
  }

  statusSeverity(tpl: WorkflowTemplate): 'success' | 'info' | 'secondary' {
    if (tpl.isDefault) return 'success';
    if (tpl.isActive)  return 'info';
    return 'secondary';
  }

  statusLabel(tpl: WorkflowTemplate): string {
    if (tpl.isDefault) return 'Default';
    if (tpl.isActive)  return 'Active';
    return 'Inactive';
  }
}
