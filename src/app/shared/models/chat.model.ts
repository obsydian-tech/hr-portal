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
