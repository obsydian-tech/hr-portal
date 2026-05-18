import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
  signal,
  computed,
  inject,
  ElementRef,
  viewChild,
  effect,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DrawerModule } from 'primeng/drawer';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { TalentFlowAgentApiService } from '../../services/talent-flow-agent-api.service';
import {
  Candidate,
  ChatContext,
  ChatResponse,
  PendingAction,
} from '../../models/talent-flow.models';

/**
 * AiChatPanel — FE-006 / NH-139
 *
 * Design source: naleko-design-handoff/preview/23-chat-bubble.html
 * Tokens: .ch-h gradient, .msg.ai / .msg.user bubbles, .chip intent chips
 *
 * A slide-in PrimeNG Sidebar (right, 420 px) providing a single-view
 * AI conversation scoped to a candidate. 7 intent chips from
 * TALENT-FLOW-PLAN-REVISED §3.3 pre-fill context messages.
 *
 * HITL: only `config_recommendation` intent returns a PendingAction.
 * When present, an inline approval banner appears inside the AI message
 * bubble — approve calls agentApi.approveAction(), reject calls rejectAction().
 *
 * Non-streaming: uses chat() Observable (POST /agent/v1/chat).
 */

// ─── Intent template definitions (plan §3.3) ─────────────────────────────────
export interface IntentTemplate {
  intent: string;
  label: string;
  icon: string;
  /** When true uses Claude Haiku (SIMPLE path); false = Sonnet (TOOL_REQUIRED) */
  fast: boolean;
  /** Only config_recommendation has a write tool requiring HITL */
  requiresHitl: boolean;
  /** Starter message pre-filled when the chip is clicked */
  starterPrompt: (candidate: Candidate) => string;
}

export const INTENT_TEMPLATES: IntentTemplate[] = [
  {
    intent: 'candidate_status',
    label: 'Candidate Status',
    icon: 'pi-user',
    fast: true,
    requiresHitl: false,
    starterPrompt: (c) =>
      `What is the current status of candidate ${c.firstName} ${c.lastName} (${c.role})?`,
  },
  {
    intent: 'pipeline_overview',
    label: 'Pipeline Overview',
    icon: 'pi-sitemap',
    fast: true,
    requiresHitl: false,
    starterPrompt: () => 'Give me an overview of the current hiring pipeline.',
  },
  {
    intent: 'vote_summary',
    label: 'Vote Summary',
    icon: 'pi-users',
    fast: true,
    requiresHitl: false,
    starterPrompt: (c) =>
      `Summarise the panel votes for ${c.firstName} ${c.lastName}.`,
  },
  {
    intent: 'sla_status',
    label: 'SLA Status',
    icon: 'pi-clock',
    fast: true,
    requiresHitl: false,
    starterPrompt: (c) =>
      `What is the SLA status for ${c.firstName} ${c.lastName}?`,
  },
  {
    intent: 'evaluation_risk',
    label: 'Evaluation Risk',
    icon: 'pi-exclamation-triangle',
    fast: false,
    requiresHitl: false,
    starterPrompt: (c) =>
      `Assess the evaluation risk for ${c.firstName} ${c.lastName}.`,
  },
  {
    intent: 'sla_prediction',
    label: 'SLA Prediction',
    icon: 'pi-chart-line',
    fast: false,
    requiresHitl: false,
    starterPrompt: (c) =>
      `Predict whether ${c.firstName} ${c.lastName} will breach any upcoming SLA thresholds.`,
  },
  {
    intent: 'config_recommendation',
    label: 'Config Recommendation',
    icon: 'pi-cog',
    fast: false,
    requiresHitl: true,
    starterPrompt: () =>
      'Based on recent pipeline performance, recommend config changes for scoring weights or SLA thresholds.',
  },
];

// ─── Chat message model ───────────────────────────────────────────────────────
export interface ChatMessage {
  id: string;
  role: 'user' | 'ai';
  text: string;
  timestamp: Date;
  /** Set on AI messages when HITL approval is required */
  pendingAction?: PendingAction;
  pendingActionStatus?: 'pending' | 'approved' | 'rejected';
}

// ─── Component ────────────────────────────────────────────────────────────────
@Component({
  selector: 'tf-ai-chat-panel',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    DrawerModule,
    ButtonModule,
    InputTextModule,
  ],
  templateUrl: './ai-chat-panel.component.html',
  styleUrl: './ai-chat-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AiChatPanelComponent {
  // ── Inputs / outputs ───────────────────────────────────────────────────────
  readonly candidate   = input.required<Candidate>();
  readonly candidateId = input.required<string>();
  readonly visible     = input<boolean>(false);

  /** Emits when the panel requests to be closed (parent toggles visible) */
  readonly closePanel = output<void>();

  // ── Services ───────────────────────────────────────────────────────────────
  private readonly agentApi = inject(TalentFlowAgentApiService);

  // ── View reference for scroll-to-bottom ───────────────────────────────────
  readonly bodyRef = viewChild<ElementRef<HTMLElement>>('chatBody');

  // ── State ──────────────────────────────────────────────────────────────────
  readonly messages  = signal<ChatMessage[]>([]);
  readonly inputText = signal<string>('');
  readonly isLoading = signal<boolean>(false);
  readonly sessionId = signal<string | undefined>(undefined);

  // ── Intent templates exposed to template ──────────────────────────────────
  readonly intentTemplates = INTENT_TEMPLATES;

  // ── Computed ───────────────────────────────────────────────────────────────
  readonly canSend = computed(
    () => this.inputText().trim().length > 0 && !this.isLoading(),
  );

  readonly hasMessages = computed(() => this.messages().length > 0);

  // Auto-scroll when messages change
  constructor() {
    effect(() => {
      const _ = this.messages(); // track
      setTimeout(() => {
        const el = this.bodyRef()?.nativeElement;
        if (el) el.scrollTop = el.scrollHeight;
      }, 50);
    });
  }

  // ── Intent chip clicked ────────────────────────────────────────────────────
  selectIntent(template: IntentTemplate): void {
    const c = this.candidate();
    this.inputText.set(template.starterPrompt(c));
  }

  // ── Send message ──────────────────────────────────────────────────────────
  send(): void {
    const text = this.inputText().trim();
    if (!text || this.isLoading()) return;

    // Add user bubble
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      text,
      timestamp: new Date(),
    };
    this.messages.update((msgs) => [...msgs, userMsg]);
    this.inputText.set('');
    this.isLoading.set(true);

    const context: ChatContext = {
      candidateId: this.candidateId(),
      sessionId: this.sessionId(),
    };

    this.agentApi.chat(text, context).subscribe({
      next: (res: ChatResponse) => {
        if (res.sessionId) this.sessionId.set(res.sessionId);

        const aiMsg: ChatMessage = {
          id: crypto.randomUUID(),
          role: 'ai',
          text: res.message,
          timestamp: new Date(),
        };

        this.messages.update((msgs) => [...msgs, aiMsg]);
        this.isLoading.set(false);
      },
      error: () => {
        const errMsg: ChatMessage = {
          id: crypto.randomUUID(),
          role: 'ai',
          text: 'Sorry, something went wrong. Please try again.',
          timestamp: new Date(),
        };
        this.messages.update((msgs) => [...msgs, errMsg]);
        this.isLoading.set(false);
      },
    });
  }

  // ── HITL: approve action ───────────────────────────────────────────────────
  approveAction(msg: ChatMessage): void {
    if (!msg.pendingAction) return;
    this.agentApi.approveAction(msg.pendingAction.actionId).subscribe({
      next: () => {
        this.messages.update((msgs) =>
          msgs.map((m) =>
            m.id === msg.id ? { ...m, pendingActionStatus: 'approved' } : m,
          ),
        );
      },
    });
  }

  // ── HITL: reject action ────────────────────────────────────────────────────
  rejectAction(msg: ChatMessage): void {
    if (!msg.pendingAction) return;
    this.agentApi
      .rejectAction(msg.pendingAction.actionId, 'Rejected by hiring manager.')
      .subscribe({
        next: () => {
          this.messages.update((msgs) =>
            msgs.map((m) =>
              m.id === msg.id ? { ...m, pendingActionStatus: 'rejected' } : m,
            ),
          );
        },
      });
  }

  // ── Keyboard: Enter to send ────────────────────────────────────────────────
  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.send();
    }
  }

  close(): void {
    this.closePanel.emit();
  }
}
