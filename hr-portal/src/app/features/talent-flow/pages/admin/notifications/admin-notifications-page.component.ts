import {
  Component,
  ChangeDetectionStrategy,
  OnInit,
  inject,
  signal,
  computed,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';
import { InputSwitchModule } from 'primeng/inputswitch';
import { MessageService } from 'primeng/api';
import { AdminApiService } from '../../../services/admin-api.service';
import {
  NotifTrigger,
  EscalationPath,
  NotifTemplate,
  NotifModule,
  NotifRecipientRole,
  NOTIF_MODULE_LABELS,
  NOTIF_ROLE_LABELS,
  UpdateNotifTriggerRequest,
  UpdateEscalationPathRequest,
  UpdateNotifTemplateRequest,
} from '../../../models/admin.models';
import { TriggerEditDrawerComponent } from './components/trigger-edit-drawer/trigger-edit-drawer.component';
import { EscalationEditDrawerComponent } from './components/escalation-edit-drawer/escalation-edit-drawer.component';
import { TemplateEditDrawerComponent } from './components/template-edit-drawer/template-edit-drawer.component';

@Component({
  selector: 'tf-admin-notifications-page',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonModule,
    TagModule,
    TooltipModule,
    InputSwitchModule,
    TriggerEditDrawerComponent,
    EscalationEditDrawerComponent,
    TemplateEditDrawerComponent,
  ],
  templateUrl: './admin-notifications-page.component.html',
  styleUrl:    './admin-notifications-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminNotificationsPageComponent implements OnInit {
  private readonly api            = inject(AdminApiService);
  private readonly messageService = inject(MessageService);

  // ── Data ──────────────────────────────────────────────────────────────────
  readonly loading    = signal(true);
  readonly triggers   = signal<NotifTrigger[]>([]);
  readonly escalations = signal<EscalationPath[]>([]);
  readonly templates  = signal<NotifTemplate[]>([]);

  // ── Saving trackers (id of item being saved, null = not saving) ───────────
  readonly savingTriggerId    = signal<string | null>(null);
  readonly savingEscalationId = signal<string | null>(null);
  readonly savingTemplateId   = signal<string | null>(null);

  // ── Drawer state ──────────────────────────────────────────────────────────
  readonly selectedTrigger       = signal<NotifTrigger | null>(null);
  readonly triggerDrawerVisible  = signal(false);
  readonly selectedEscalation    = signal<EscalationPath | null>(null);
  readonly escalationDrawerVisible = signal(false);
  readonly selectedTemplate      = signal<NotifTemplate | null>(null);
  readonly templateDrawerVisible = signal(false);

  // ── Labels ───────────────────────────────────────────────────────────────
  readonly moduleLabels = NOTIF_MODULE_LABELS;
  readonly roleLabels   = NOTIF_ROLE_LABELS;

  readonly triggerSavingNow  = computed(() => this.savingTriggerId() !== null && this.savingTriggerId() === this.selectedTrigger()?.triggerId);
  readonly escalSavingNow    = computed(() => this.savingEscalationId() !== null && this.savingEscalationId() === this.selectedEscalation()?.slaId);
  readonly templateSavingNow = computed(() => this.savingTemplateId() !== null && this.savingTemplateId() === this.selectedTemplate()?.templateId);

  // ── Group triggers by module for the table ────────────────────────────────
  readonly triggerGroups = computed(() => {
    const modules = ['TalentFlow', 'ITRequest'] as NotifModule[];
    return modules
      .map(mod => ({
        module:   mod,
        label:    NOTIF_MODULE_LABELS[mod],
        triggers: this.triggers().filter(t => t.module === mod),
      }))
      .filter(g => g.triggers.length > 0);
  });

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  ngOnInit(): void {
    this.load();
  }

  private load(): void {
    this.api.getNotifSettings().subscribe({
      next: (res) => {
        this.triggers.set(res.triggers);
        this.escalations.set(res.escalations);
        this.templates.set(res.templates);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.toast('error', 'Load failed', 'Could not load notification settings.');
      },
    });
  }

  // ── Trigger drawer ────────────────────────────────────────────────────────

  editTrigger(trigger: NotifTrigger): void {
    this.selectedTrigger.set(trigger);
    this.triggerDrawerVisible.set(true);
  }

  closeTriggerDrawer(): void {
    this.triggerDrawerVisible.set(false);
    this.selectedTrigger.set(null);
  }

  saveTrigger(req: UpdateNotifTriggerRequest): void {
    this.savingTriggerId.set(req.triggerId);
    this.api.updateNotifTrigger(req).subscribe({
      next: (res) => {
        this.triggers.set(res.triggers);
        this.savingTriggerId.set(null);
        this.triggerDrawerVisible.set(false);
        this.toast('success', 'Saved', 'Notification trigger updated.');
      },
      error: () => {
        this.savingTriggerId.set(null);
        this.toast('error', 'Save failed', 'Could not update notification trigger.');
      },
    });
  }

  // Quick toggle without opening drawer (convenience)
  quickToggleTrigger(trigger: NotifTrigger): void {
    const req: UpdateNotifTriggerRequest = {
      triggerId:  trigger.triggerId,
      recipients: trigger.recipients,
      enabled:    !trigger.enabled,
    };
    this.savingTriggerId.set(trigger.triggerId);
    this.api.updateNotifTrigger(req).subscribe({
      next: (res) => {
        this.triggers.set(res.triggers);
        this.savingTriggerId.set(null);
      },
      error: () => {
        this.savingTriggerId.set(null);
        this.toast('error', 'Save failed', 'Could not toggle notification.');
      },
    });
  }

  // ── Escalation drawer ─────────────────────────────────────────────────────

  editEscalation(esc: EscalationPath): void {
    this.selectedEscalation.set(esc);
    this.escalationDrawerVisible.set(true);
  }

  closeEscalationDrawer(): void {
    this.escalationDrawerVisible.set(false);
    this.selectedEscalation.set(null);
  }

  saveEscalation(req: UpdateEscalationPathRequest): void {
    this.savingEscalationId.set(req.slaId);
    this.api.updateEscalationPath(req).subscribe({
      next: (res) => {
        this.escalations.set(res.escalations);
        this.savingEscalationId.set(null);
        this.escalationDrawerVisible.set(false);
        this.toast('success', 'Saved', 'Escalation path updated.');
      },
      error: () => {
        this.savingEscalationId.set(null);
        this.toast('error', 'Save failed', 'Could not update escalation path.');
      },
    });
  }

  // ── Template drawer ───────────────────────────────────────────────────────

  editTemplate(tmpl: NotifTemplate): void {
    this.selectedTemplate.set(tmpl);
    this.templateDrawerVisible.set(true);
  }

  closeTemplateDrawer(): void {
    this.templateDrawerVisible.set(false);
    this.selectedTemplate.set(null);
  }

  saveTemplate(req: UpdateNotifTemplateRequest): void {
    this.savingTemplateId.set(req.templateId);
    this.api.updateNotifTemplate(req).subscribe({
      next: (res) => {
        this.templates.set(res.templates);
        this.savingTemplateId.set(null);
        this.templateDrawerVisible.set(false);
        this.toast('success', 'Saved', 'Notification template updated.');
      },
      error: () => {
        this.savingTemplateId.set(null);
        this.toast('error', 'Save failed', 'Could not update notification template.');
      },
    });
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  highlightVars(text: string): string {
    return text.replace(
      /\{\{([^}]+)\}\}/g,
      '<span class="tf-notif-var">{{$1}}</span>',
    );
  }

  roleSeverity(role: NotifRecipientRole): 'info' | 'secondary' | 'warn' | 'success' {
    const map: Record<NotifRecipientRole, 'info' | 'secondary' | 'warn' | 'success'> = {
      TA:    'info',
      HM:    'secondary',
      IT:    'warn',
      ADMIN: 'success',
    };
    return map[role] ?? 'secondary';
  }

  isSavingTrigger(triggerId: string): boolean {
    return this.savingTriggerId() === triggerId;
  }

  isSavingEscalation(slaId: string): boolean {
    return this.savingEscalationId() === slaId;
  }

  private toast(severity: string, summary: string, detail: string): void {
    this.messageService.add({ severity, summary, detail, life: 4000 });
  }
}
