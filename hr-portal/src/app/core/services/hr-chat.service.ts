import { Injectable, inject, signal, computed } from '@angular/core';
import {
  ChatMessage,
  ChatConversation,
  ConversationStatus,
  ConversationPriority,
  MessageSender,
} from '../../shared/models/chat.model';
import { HrChatBackend } from '../backends/chat-backend.interface';

// ═══════════════════════════════════════════════════════════
//  HR CHAT SERVICE
//  Owns all UI state (signals, computed, filtering, search).
//  Delegates data fetching, replies, and status updates to the
//  injected HrChatBackend.
//
//  To swap the backend, change the provider at the component level:
//    providers: [
//      { provide: HrChatBackend, useClass: ApiHrChatBackend },
//      HrChatService,
//    ]
// ═══════════════════════════════════════════════════════════

@Injectable()
export class HrChatService {
  private readonly backend = inject(HrChatBackend);

  private readonly _conversations = signal<ChatConversation[]>([]);
  private readonly _selectedId = signal<string | null>(null);
  private readonly _loading = signal(true);
  private readonly _filter = signal<ConversationStatus | 'all'>('all');
  private readonly _searchTerm = signal('');
  private _hrStaffId = '';

  // ─── Public Signals ─────────────────────────────
  readonly loading = this._loading.asReadonly();
  readonly selectedId = this._selectedId.asReadonly();
  readonly filter = this._filter.asReadonly();
  readonly searchTerm = this._searchTerm.asReadonly();

  /** All conversations */
  readonly conversations = this._conversations.asReadonly();

  /** Filtered conversations based on status filter + search */
  readonly filteredConversations = computed(() => {
    let list = this._conversations();
    const f = this._filter();
    const term = this._searchTerm().toLowerCase().trim();

    if (f !== 'all') {
      list = list.filter((c) => c.status === f);
    }
    if (term) {
      list = list.filter(
        (c) =>
          c.employeeName.toLowerCase().includes(term) ||
          c.employeeId.toLowerCase().includes(term) ||
          c.department.toLowerCase().includes(term),
      );
    }

    // Sort: high priority first, then by lastActivity (most recent first)
    return [...list].sort((a, b) => {
      const priorityOrder: Record<ConversationPriority, number> = { high: 0, medium: 1, low: 2 };
      const pDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
      if (pDiff !== 0) return pDiff;
      return b.lastActivity - a.lastActivity;
    });
  });

  /** Currently selected conversation */
  readonly selectedConversation = computed(() => {
    const id = this._selectedId();
    if (!id) return null;
    return this._conversations().find((c) => c.employeeId === id) ?? null;
  });

  /** Stat counts */
  readonly totalCount = computed(() => this._conversations().length);
  readonly activeCount = computed(() => this._conversations().filter((c) => c.status === 'active').length);
  readonly waitingCount = computed(() => this._conversations().filter((c) => c.status === 'waiting').length);
  readonly resolvedCount = computed(() => this._conversations().filter((c) => c.status === 'resolved').length);
  readonly totalUnread = computed(() =>
    this._conversations().reduce((sum, c) => sum + c.unreadCount, 0),
  );

  // ─── Initialization ─────────────────────────────
  initialize(hrStaffId: string): void {
    this._hrStaffId = hrStaffId;
    this._loading.set(true);

    // Simulate fetch delay for smooth UX, then load from backend
    setTimeout(() => {
      this.backend.getConversations(hrStaffId).then((convos) => {
        this._conversations.set(convos);
        this._loading.set(false);
      });
    }, 600);
  }

  // ─── Actions ────────────────────────────────────
  selectConversation(employeeId: string): void {
    this._selectedId.set(employeeId);

    // Mark as read
    this._conversations.update((convos) =>
      convos.map((c) =>
        c.employeeId === employeeId ? { ...c, unreadCount: 0 } : c,
      ),
    );
  }

  deselectConversation(): void {
    this._selectedId.set(null);
  }

  setFilter(filter: ConversationStatus | 'all'): void {
    this._filter.set(filter);
  }

  setSearch(term: string): void {
    this._searchTerm.set(term);
  }

  /** HR staff sends a reply to the selected conversation */
  sendReply(text: string): void {
    if (!text.trim()) return;
    const id = this._selectedId();
    if (!id) return;

    this.backend.sendReply(id, text, this._hrStaffId).then((message) => {
      this._conversations.update((convos) =>
        convos.map((c) => {
          if (c.employeeId !== id) return c;
          return {
            ...c,
            messages: [...c.messages, message],
            lastActivity: Date.now(),
            status: 'active' as ConversationStatus,
          };
        }),
      );
    });
  }

  /** Update conversation status (resolve, re-open, etc.) */
  updateStatus(employeeId: string, status: ConversationStatus): void {
    this.backend.updateStatus(employeeId, status).then(() => {
      this._conversations.update((convos) =>
        convos.map((c) =>
          c.employeeId === employeeId ? { ...c, status } : c,
        ),
      );
    });
  }
}
