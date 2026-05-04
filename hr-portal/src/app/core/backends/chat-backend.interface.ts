import { Observable } from 'rxjs';
import {
  ChatMessage,
  ChatState,
  SuggestedChip,
  ChatConversation,
  ConversationStatus,
} from '../../shared/models/chat.model';

// ═══════════════════════════════════════════════════════════
//  CHAT BACKEND — Abstract interface for swappable backends
// ═══════════════════════════════════════════════════════════
//
//  Implementations:
//    • LocalChatBackend   — FAQ matcher + localStorage  (current)
//    • ApiChatBackend     — AWS Bedrock/OpenAI + DynamoDB (future)
//
//  To swap: change the provider in the component or module:
//    providers: [{ provide: EMPLOYEE_CHAT_BACKEND, useClass: ApiChatBackend }]
//
// ═══════════════════════════════════════════════════════════

/** Context passed to the employee chat backend on init */
export interface ChatBackendContext {
  employeeId: string;
  employeeName: string;
  hrPartnerName: string;
  startDate: string;
}

/** Result from the AI response engine */
export interface AiResponse {
  text: string;
  intent?: string;
  /** Suggested follow-up chips for this response */
  followUpChips?: SuggestedChip[];
  /** Whether this response should trigger HR escalation */
  shouldEscalate?: boolean;
}

/** Result from the HR response engine (mock or real) */
export interface HrResponse {
  text: string;
}

// ─── Employee-Side Chat Backend ───────────────────────────

/**
 * Abstract backend for the employee chat widget.
 *
 * The service layer (OnboardingChatService) delegates AI matching,
 * HR simulation, and state persistence to this backend.
 * Swap the implementation to move from local FAQ → LLM API.
 */
export abstract class EmployeeChatBackend {
  /**
   * Get an AI response for the user's message.
   * Local impl: weighted FAQ matching.
   * Future impl: AWS Bedrock / OpenAI API call.
   */
  abstract getAiResponse(
    userText: string,
    context: ChatBackendContext,
  ): Promise<AiResponse>;

  /**
   * Get a simulated (or real) HR response.
   * Local impl: keyword-matched mock templates.
   * Future impl: pass-through (real HR staff responds via WebSocket).
   */
  abstract getHrResponse(
    userText: string,
    context: ChatBackendContext,
  ): Promise<HrResponse>;

  /**
   * Persist chat state.
   * Local impl: localStorage.
   * Future impl: DynamoDB PUT via API Gateway.
   */
  abstract saveState(state: ChatState): Promise<void>;

  /**
   * Load persisted chat state.
   * Local impl: localStorage.
   * Future impl: DynamoDB GET via API Gateway.
   */
  abstract loadState(employeeId: string): Promise<ChatState | null>;

  /**
   * Clear persisted chat state.
   * Local impl: localStorage.removeItem.
   * Future impl: DynamoDB DELETE.
   */
  abstract clearState(employeeId: string): Promise<void>;

  /**
   * Get the default suggested chips for AI mode.
   */
  abstract getDefaultAiChips(): SuggestedChip[];

  /**
   * Get the suggested chips for HR escalation mode.
   */
  abstract getHrChips(): SuggestedChip[];

  /**
   * Reset any conversational context (fallback counters, etc.).
   * Called when switching modes or clearing chat.
   * Local impl: resets consecutive-fallback counter.
   * Future impl: may clear LLM conversation history.
   */
  abstract resetConversation(): void;
}

// ─── HR-Side Chat Backend ─────────────────────────────────

/**
 * Abstract backend for the HR Support Inbox.
 *
 * The service layer (HrChatService) delegates conversation fetching,
 * reply sending, and status updates to this backend.
 * Swap the implementation to move from mock data → real API.
 */
export abstract class HrChatBackend {
  /**
   * Fetch all conversations for an HR staff member.
   * Local impl: mock data generator.
   * Future impl: GET /api/conversations?hrStaffId=...
   */
  abstract getConversations(hrStaffId: string): Promise<ChatConversation[]>;

  /**
   * Send an HR reply to a conversation.
   * Local impl: in-memory append.
   * Future impl: POST /api/conversations/:employeeId/messages
   */
  abstract sendReply(
    employeeId: string,
    text: string,
    hrStaffId: string,
  ): Promise<ChatMessage>;

  /**
   * Update conversation status.
   * Local impl: in-memory update.
   * Future impl: PATCH /api/conversations/:employeeId
   */
  abstract updateStatus(
    employeeId: string,
    status: ConversationStatus,
  ): Promise<void>;

  /**
   * Subscribe to real-time message updates (optional).
   * Local impl: returns EMPTY (no real-time in local mode).
   * Future impl: WebSocket subscription via API Gateway.
   */
  abstract onNewMessage$(hrStaffId: string): Observable<{
    employeeId: string;
    message: ChatMessage;
  }>;
}
