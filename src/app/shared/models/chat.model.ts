/** Sender of a chat message */
export type MessageSender = 'user' | 'ai' | 'hr' | 'system';

/** Chat mode — AI assistant or live HR escalation */
export type ChatMode = 'ai' | 'hr';

/** A single chat message */
export interface ChatMessage {
  id: string;
  sender: MessageSender;
  text: string;
  timestamp: number;
  /** If sender is 'ai', optionally tag the matched intent */
  intent?: string;
}

/** Suggested quick-reply chip */
export interface SuggestedChip {
  label: string;
  /** The text sent as the user message when the chip is clicked */
  value: string;
}

/** Persisted chat state per employee */
export interface ChatState {
  employeeId: string;
  mode: ChatMode;
  messages: ChatMessage[];
  /** Whether an HR escalation is active */
  escalated: boolean;
  /** Timestamp of last activity — used for localStorage cleanup */
  lastActivity: number;
}

// ─── HR Support Inbox Models ──────────────────────────────

/** Priority level of a support conversation */
export type ConversationPriority = 'low' | 'medium' | 'high';

/** Status of an HR conversation */
export type ConversationStatus = 'active' | 'waiting' | 'resolved';

/** A chat conversation as seen from the HR Support Inbox */
export interface ChatConversation {
  /** Employee ID this chat belongs to */
  employeeId: string;
  /** Employee display name */
  employeeName: string;
  /** Employee email */
  employeeEmail: string;
  /** Employee department */
  department: string;
  /** Onboarding stage */
  stage: string;
  /** Full message thread */
  messages: ChatMessage[];
  /** Whether the employee has escalated to HR */
  escalated: boolean;
  /** Timestamp of the last message */
  lastActivity: number;
  /** Current conversation status */
  status: ConversationStatus;
  /** Auto-detected priority */
  priority: ConversationPriority;
  /** Number of unread messages from employee */
  unreadCount: number;
}
