/**
 * NH-57: AiModeService — handles all communication with POST /agent/v1/ai-chat
 * Auth interceptor auto-attaches Cognito Bearer token on every HTTP call.
 */
import { Injectable, inject, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { AuthService } from '../../../core/services/auth.service';
import {
  AiChatRequest,
  AiChatResponse,
  AiScreenContext,
  AiTemplate,
  AiTemplateId,
  ConversationTurn,
  PendingAction,
  AI_TEMPLATES,
} from '../models/ai-chat.model';

@Injectable({ providedIn: 'root' })
export class AiModeService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly authService = inject(AuthService);

  private readonly baseUrl = environment.agentApiUrl;

  // ── AI Mode panel visibility ──────────────────────────────────────────────
  readonly panelVisible = signal(false);

  // ── Active template & slots ───────────────────────────────────────────────
  readonly activeTemplate = signal<AiTemplate | null>(null);
  readonly slotValues = signal<Record<string, string>>({});

  // ── Conversation state ────────────────────────────────────────────────────
  readonly conversationHistory = signal<ConversationTurn[]>([]);
  readonly isLoading = signal(false);
  readonly pendingAction = signal<PendingAction | null>(null);
  readonly canFollowUp = signal(false);
  readonly followUpText = signal('');

  // ── Error state ───────────────────────────────────────────────────────────
  readonly errorMessage = signal<string | null>(null);

  // ── Computed ──────────────────────────────────────────────────────────────
  readonly templates = computed(() => AI_TEMPLATES);
  readonly hasActiveConversation = computed(() => this.activeTemplate() !== null);

  // ─────────────────────────────────────────────────────────────────────────
  // Panel control
  // ─────────────────────────────────────────────────────────────────────────

  openPanel(): void {
    this.panelVisible.set(true);
  }

  closePanel(): void {
    this.panelVisible.set(false);
  }

  selectTemplate(template: AiTemplate): void {
    this.activeTemplate.set(template);
    this.slotValues.set({});
    this.conversationHistory.set([]);
    this.pendingAction.set(null);
    this.canFollowUp.set(false);
    this.followUpText.set('');
    this.errorMessage.set(null);
  }

  resetToGallery(): void {
    this.activeTemplate.set(null);
    this.slotValues.set({});
    this.conversationHistory.set([]);
    this.pendingAction.set(null);
    this.canFollowUp.set(false);
    this.followUpText.set('');
    this.errorMessage.set(null);
  }

  updateSlot(key: string, value: string): void {
    this.slotValues.update((prev) => ({ ...prev, [key]: value }));
  }

  // ─────────────────────────────────────────────────────────────────────────
  // AI calls
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Send the selected template + filled slots to the Lambda.
   * Automatically appends the current screen context.
   */
  runTemplate(): void {
    const template = this.activeTemplate();
    if (!template) return;

    this.isLoading.set(true);
    this.errorMessage.set(null);
    this.pendingAction.set(null);

    const request: AiChatRequest = {
      templateId: template.id,
      slots: this.slotValues(),
      conversationHistory: this.conversationHistory(),
      screenContext: this.getScreenContext(),
    };

    this._post(request).subscribe({
      next: (res) => this._handleResponse(res, request.slots),
      error: () => {
        this.isLoading.set(false);
        this.errorMessage.set('Something went wrong. Please try again.');
      },
    });
  }

  /**
   * Send a follow-up free-text question (after a completed result).
   * Max 200 chars enforced at the template level.
   */
  runFollowUp(): void {
    const text = this.followUpText().trim();
    if (!text || !this.activeTemplate()) return;

    this.isLoading.set(true);
    this.errorMessage.set(null);
    this.canFollowUp.set(false);

    const request: AiChatRequest = {
      templateId: 'follow_up',
      slots: {},
      conversationHistory: this.conversationHistory(),
      screenContext: this.getScreenContext(),
      followUpText: text,
    };

    this._post(request).subscribe({
      next: (res) => this._handleResponse(res, {}),
      error: () => {
        this.isLoading.set(false);
        this.errorMessage.set('Something went wrong. Please try again.');
      },
    });
  }

  /**
   * NH-58: Called when HR staff click "Approve & Create" on the HITL modal.
   * 1. POSTs draft to confirmEndpoint (/agent/v1/employees)
   * 2. Parses employeeId from the created record
   * 3. Automatically runs the risk_assessment template for the new employee
   */
  confirmHitlAction(): void {
    const action = this.pendingAction();
    if (!action) return;

    this.isLoading.set(true);
    this.pendingAction.set(null);

    this.http
      .post<{ employee: { employee_id: string } }>(
        `${this.baseUrl}${action.confirmEndpoint}`,
        action.draft,
      )
      .subscribe({
        next: (createRes) => {
          const employeeId = createRes?.employee?.employee_id ?? '';

          // Show creation confirmation in the thread
          this.conversationHistory.update((h) => [
            ...h,
            {
              role: 'assistant',
              content: `✅ Employee created successfully${employeeId ? ` — ID: \`${employeeId}\`` : ''}. Running risk assessment…`,
            },
          ]);

          if (!employeeId) {
            // No ID returned — skip risk assessment
            this.isLoading.set(false);
            this.canFollowUp.set(true);
            return;
          }

          // Auto-trigger risk_assessment for the newly created employee
          const riskRequest: AiChatRequest = {
            templateId: 'risk_assessment',
            slots: { employeeId },
            conversationHistory: this.conversationHistory(),
            screenContext: this.getScreenContext(),
          };

          this._post(riskRequest).subscribe({
            next: (riskRes) => this._handleResponse(riskRes, riskRequest.slots),
            error: () => {
              this.isLoading.set(false);
              this.errorMessage.set('Employee created, but risk assessment failed. Please run it manually.');
              this.canFollowUp.set(true);
            },
          });
        },
        error: () => {
          this.isLoading.set(false);
          this.errorMessage.set('Failed to create the employee. Please try again.');
        },
      });
  }

  cancelHitlAction(): void {
    this.pendingAction.set(null);
    this.conversationHistory.update((h) => [
      ...h,
      { role: 'assistant', content: 'Action cancelled. No changes were made.' },
    ]);
    this.canFollowUp.set(true);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Screen context
  // ─────────────────────────────────────────────────────────────────────────

  getScreenContext(): AiScreenContext {
    const url = this.router.url;

    // Match /hr/<staffId>/employee/<employeeId>
    const employeeMatch = url.match(/\/employee\/([^/?]+)/);
    if (employeeMatch) {
      return {
        view: 'EMPLOYEE_DETAIL',
        employeeId: employeeMatch[1],
      };
    }
    if (url.includes('/verifications')) {
      return { view: 'VERIFICATIONS_LIST' };
    }
    return { view: 'HR_DASHBOARD' };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private helpers
  // ─────────────────────────────────────────────────────────────────────────

  private _post(request: AiChatRequest): Observable<AiChatResponse> {
    return this.http.post<AiChatResponse>(
      `${this.baseUrl}/agent/v1/ai-chat`,
      request,
    );
  }

  private _handleResponse(res: AiChatResponse, _slots: Record<string, string>): void {
    this.isLoading.set(false);

    // Append assistant message to conversation history
    this.conversationHistory.update((h) => [
      ...h,
      { role: 'assistant', content: res.message },
    ]);

    if (res.status === 'PENDING_APPROVAL' && res.pendingAction) {
      this.pendingAction.set(res.pendingAction);
      this.canFollowUp.set(false);
    } else {
      this.canFollowUp.set(true);
    }
  }
}
