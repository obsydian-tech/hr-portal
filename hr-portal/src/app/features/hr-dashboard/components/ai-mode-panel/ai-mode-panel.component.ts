/**
 * NH-57: AiModePanelComponent — right-side drawer panel for AI Mode.
 * Contains: template gallery → slot form → conversation thread → HITL gate.
 */
import {
  Component,
  ChangeDetectionStrategy,
  inject,
  effect,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DrawerModule } from 'primeng/drawer';
import { ButtonModule } from 'primeng/button';
import { BadgeModule } from 'primeng/badge';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { InputTextModule } from 'primeng/inputtext';
import { DropdownModule } from 'primeng/dropdown';
import { SelectButtonModule } from 'primeng/selectbutton';
import { TextareaModule } from 'primeng/textarea';
import { AiModeService } from '../../services/ai-mode.service';
import { AiTemplateGalleryComponent } from '../ai-template-gallery/ai-template-gallery.component';
import { AiHitlConfirmComponent } from '../ai-hitl-confirm/ai-hitl-confirm.component';
import { AiTemplate } from '../../models/ai-chat.model';

@Component({
  selector: 'app-ai-mode-panel',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    DrawerModule,
    ButtonModule,
    BadgeModule,
    ProgressSpinnerModule,
    InputTextModule,
    DropdownModule,
    SelectButtonModule,
    TextareaModule,
    AiTemplateGalleryComponent,
    AiHitlConfirmComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './ai-mode-panel.component.html',
  styleUrl: './ai-mode-panel.component.scss',
})
export class AiModePanelComponent {
  readonly aiMode = inject(AiModeService);

  // ── Slot binding helper: two-way proxy via service ───────────────────────
  getSlot(key: string): string {
    return this.aiMode.slotValues()[key] ?? '';
  }

  setSlot(key: string, value: string): void {
    this.aiMode.updateSlot(key, value);
  }

  // ── Slot options helper (for p-dropdown / p-selectButton) ────────────────
  slotOptions(options: string[] = []): { label: string; value: string }[] {
    return options.map((o) => ({ label: o, value: o }));
  }

  // ── Template selection ────────────────────────────────────────────────────
  onTemplateSelected(template: AiTemplate): void {
    this.aiMode.selectTemplate(template);

    // Pre-fill employee slot from screen context if available
    const ctx = this.aiMode.getScreenContext();
    if (ctx.view === 'EMPLOYEE_DETAIL' && ctx.employeeId) {
      this.aiMode.updateSlot('employeeId', ctx.employeeId);
    }
  }

  // ── Slot form submit ──────────────────────────────────────────────────────
  canSubmit(): boolean {
    const template = this.aiMode.activeTemplate();
    if (!template) return false;
    return template.slots.every((slot) => {
      if (!slot.required) return true;
      return !!this.aiMode.slotValues()[slot.key];
    });
  }

  submitTemplate(): void {
    if (!this.canSubmit()) return;
    this.aiMode.runTemplate();
  }

  // ── Follow-up ────────────────────────────────────────────────────────────
  onFollowUpKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.aiMode.runFollowUp();
    }
  }

  // ── HITL ──────────────────────────────────────────────────────────────────
  onHitlApprove(): void {
    this.aiMode.confirmHitlAction();
  }

  onHitlCancel(): void {
    this.aiMode.cancelHitlAction();
  }

  // ── Panel close ───────────────────────────────────────────────────────────
  onPanelHide(): void {
    this.aiMode.closePanel();
  }
}
