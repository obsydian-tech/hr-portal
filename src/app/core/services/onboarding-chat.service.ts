import { Injectable, inject, signal, computed } from '@angular/core';
import {
  ChatMessage,
  ChatMode,
  ChatState,
  SuggestedChip,
  MessageSender,
} from '../../shared/models/chat.model';
import {
  EmployeeChatBackend,
  ChatBackendContext,
} from '../backends/chat-backend.interface';

// ═══════════════════════════════════════════════════════════
//  ONBOARDING CHAT SERVICE
//  Owns all UI state (signals, computed). Delegates AI matching,
//  HR responses, and persistence to the injected EmployeeChatBackend.
//
//  To swap the backend, change the provider at the component level:
//    providers: [
//      { provide: EmployeeChatBackend, useClass: ApiChatBackend },
//      OnboardingChatService,
//    ]
// ═══════════════════════════════════════════════════════════

@Injectable()
export class OnboardingChatService {
  private readonly backend = inject(EmployeeChatBackend);

  // ─── State Signals ──────────────────────────────
  private readonly _messages = signal<ChatMessage[]>([]);
  private readonly _mode = signal<ChatMode>('ai');
  private readonly _escalated = signal(false);
  private readonly _isTyping = signal(false);
  private readonly _employeeId = signal('');
  private readonly _hrPartnerName = signal('');
  private readonly _employeeName = signal('');
  private readonly _startDate = signal('');
  /** Follow-up chips returned by the last AI response */
  private readonly _lastFollowUpChips = signal<SuggestedChip[] | null>(null);

  /** Public read-only signals */
  readonly messages = this._messages.asReadonly();
  readonly mode = this._mode.asReadonly();
  readonly escalated = this._escalated.asReadonly();
  readonly isTyping = this._isTyping.asReadonly();

  /** Context-aware suggested chips based on mode + last AI response */
  readonly suggestedChips = computed<SuggestedChip[]>(() => {
    if (this._mode() === 'hr') return this.backend.getHrChips();

    const chips = this._lastFollowUpChips();
    if (chips?.length) return chips;

    return this.backend.getDefaultAiChips();
  });

  /** Chat header title */
  readonly headerTitle = computed(() =>
    this._mode() === 'hr'
      ? this._hrPartnerName() || 'HR Partner'
      : 'Naleko Assistant',
  );

  /** Chat header subtitle */
  readonly headerSubtitle = computed(() =>
    this._mode() === 'hr'
      ? 'HR Support • Connected'
      : 'Onboarding Support',
  );

  readonly messageCount = computed(() => this._messages().length);

  // ─── Initialization ─────────────────────────────
  initialize(
    employeeId: string,
    employeeName: string,
    hrPartnerName: string,
    startDate: string,
  ): void {
    this._employeeId.set(employeeId);
    this._employeeName.set(employeeName);
    this._hrPartnerName.set(hrPartnerName);
    this._startDate.set(startDate);

    // Restore from backend persistence
    this.backend.loadState(employeeId).then((saved) => {
      if (saved && saved.messages.length > 0) {
        this._messages.set(saved.messages);
        this._mode.set(saved.mode);
        this._escalated.set(saved.escalated);

        // Restore follow-up chips from last AI message's intent
        const lastAiMsg = [...saved.messages]
          .reverse()
          .find((m) => m.sender === 'ai' && m.intent);
        if (lastAiMsg?.intent) {
          // Re-derive follow-up chips by asking the backend
          this.backend.getAiResponse(lastAiMsg.intent, this.buildContext()).then((result) => {
            this._lastFollowUpChips.set(result.followUpChips ?? null);
          });
        }
      } else {
        // Send welcome message
        this.addSystemMessage(
          `Hi ${employeeName}! 👋 I'm the Naleko Onboarding Assistant. I can help with document uploads, verification status, and more. What can I help you with?`,
        );
      }
    });
  }

  // ─── Message Handling ───────────────────────────
  sendMessage(text: string): void {
    if (!text.trim()) return;

    // Special chip actions
    if (text === '__BACK_TO_AI__') {
      this.switchToAI();
      return;
    }

    // Add user message
    this.addMessage('user', text);

    if (this._mode() === 'hr') {
      this.processHRResponse(text);
    } else {
      this.processAIResponse(text);
    }
  }

  escalateToHR(): void {
    this._escalated.set(true);
    this._mode.set('hr');
    this._lastFollowUpChips.set(null);

    const hrName = this._hrPartnerName() || 'your HR partner';

    this.addMessage('system', `Connecting you to **${hrName}**...`);

    // Simulate connection delay with a staged sequence
    this._isTyping.set(true);
    setTimeout(() => {
      this._isTyping.set(false);
      this.addMessage(
        'hr',
        `Hi ${this._employeeName()}! 👋 This is ${hrName}. I can see you're going through your onboarding process. How can I assist you today?`,
      );
      this.persistState();
    }, 2500);
  }

  clearChat(): void {
    this._messages.set([]);
    this._mode.set('ai');
    this._escalated.set(false);
    this._isTyping.set(false);
    this._lastFollowUpChips.set(null);
    this.backend.resetConversation();
    this.backend.clearState(this._employeeId());

    const name = this._employeeName();
    this.addSystemMessage(
      `Hi ${name}! 👋 I'm the Naleko Onboarding Assistant. I can help with document uploads, verification status, and more. What can I help you with?`,
    );
  }

  // ─── Private Helpers ────────────────────────────
  private switchToAI(): void {
    this._mode.set('ai');
    this.backend.resetConversation();
    this.addMessage(
      'system',
      'You\'re now chatting with the **Naleko Assistant** again. How can I help?',
    );
    this._lastFollowUpChips.set(null);
    this.persistState();
  }

  private processAIResponse(userText: string): void {
    this._isTyping.set(true);
    const ctx = this.buildContext();

    // Variable typing delay for natural feel
    const delay = 400 + Math.random() * 500;

    this.backend.getAiResponse(userText, ctx).then((result) => {
      setTimeout(() => {
        this._isTyping.set(false);

        // Handle escalation trigger
        if (result.shouldEscalate) {
          this.addMessage('ai', result.text, result.intent);
          setTimeout(() => this.escalateToHR(), 800);
          return;
        }

        this._lastFollowUpChips.set(result.followUpChips ?? null);
        this.addMessage('ai', result.text, result.intent);
        this.persistState();
      }, delay);
    });
  }

  private processHRResponse(userText: string): void {
    this._isTyping.set(true);
    const ctx = this.buildContext();

    // Simulate longer HR response time (1.5-3.5s)
    const delay = 1500 + Math.random() * 2000;

    this.backend.getHrResponse(userText, ctx).then((result) => {
      setTimeout(() => {
        this._isTyping.set(false);
        this.addMessage('hr', result.text);
        this.persistState();
      }, delay);
    });
  }

  private addMessage(sender: MessageSender, text: string, intent?: string): void {
    const message: ChatMessage = {
      id: this.generateId(),
      sender,
      text,
      timestamp: Date.now(),
      intent,
    };
    this._messages.update((msgs) => [...msgs, message]);
    this.persistState();
  }

  private addSystemMessage(text: string): void {
    this.addMessage('system', text);
  }

  private generateId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  }

  // ─── Persistence Delegation ─────────────────────
  private persistState(): void {
    const state: ChatState = {
      employeeId: this._employeeId(),
      mode: this._mode(),
      messages: this._messages(),
      escalated: this._escalated(),
      lastActivity: Date.now(),
    };
    this.backend.saveState(state);
  }

  private buildContext(): ChatBackendContext {
    return {
      employeeId: this._employeeId(),
      employeeName: this._employeeName(),
      hrPartnerName: this._hrPartnerName(),
      startDate: this._startDate(),
    };
  }
}
