import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  OnInit,
  ElementRef,
  viewChild,
  AfterViewChecked,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { TagModule } from 'primeng/tag';
import { SkeletonModule } from 'primeng/skeleton';
import { TooltipModule } from 'primeng/tooltip';
import { BadgeModule } from 'primeng/badge';
import { HrChatService } from '../../../../core/services/hr-chat.service';
import { HrChatBackend } from '../../../../core/backends/chat-backend.interface';
import { LocalHrChatBackend } from '../../../../core/backends/local-hr-chat.backend';
import { ChatMarkdownPipe } from '../../../../shared/pipes/chat-markdown.pipe';
import {
  ChatConversation,
  ChatMessage,
  ConversationStatus,
} from '../../../../shared/models/chat.model';

@Component({
  selector: 'app-support-inbox',
  standalone: true,
  imports: [
    DatePipe,
    FormsModule,
    ButtonModule,
    InputTextModule,
    TagModule,
    SkeletonModule,
    TooltipModule,
    BadgeModule,
    ChatMarkdownPipe,
  ],
  providers: [
    { provide: HrChatBackend, useClass: LocalHrChatBackend },
    HrChatService,
  ],
  templateUrl: './support-inbox.component.html',
  styleUrl: './support-inbox.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SupportInboxComponent implements OnInit, AfterViewChecked {
  readonly chatService = inject(HrChatService);
  private readonly route = inject(ActivatedRoute);

  replyText = '';
  private shouldScroll = false;
  readonly mobileDetailOpen = signal(false);

  private readonly messagesEnd = viewChild<ElementRef>('messagesEnd');

  ngOnInit(): void {
    const staffId = this.route.parent?.snapshot.params['staffId'] ?? '';
    this.chatService.initialize(staffId);
  }

  ngAfterViewChecked(): void {
    if (this.shouldScroll) {
      this.scrollToBottom();
      this.shouldScroll = false;
    }
  }

  // ─── Conversation List ──────────────────────────
  onSearchInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.chatService.setSearch(value);
  }

  selectConversation(convo: ChatConversation): void {
    this.chatService.selectConversation(convo.employeeId);
    this.mobileDetailOpen.set(true);
    this.shouldScroll = true;
  }

  backToList(): void {
    this.chatService.deselectConversation();
    this.mobileDetailOpen.set(false);
  }

  // ─── Chat Detail ────────────────────────────────
  sendReply(): void {
    const text = this.replyText.trim();
    if (!text) return;
    this.replyText = '';
    this.chatService.sendReply(text);
    this.shouldScroll = true;
  }

  onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.sendReply();
    }
  }

  resolveConversation(): void {
    const selected = this.chatService.selectedConversation();
    if (selected) {
      this.chatService.updateStatus(selected.employeeId, 'resolved');
    }
  }

  reopenConversation(): void {
    const selected = this.chatService.selectedConversation();
    if (selected) {
      this.chatService.updateStatus(selected.employeeId, 'active');
    }
  }

  // ─── Helpers ────────────────────────────────────
  getStatusSeverity(status: ConversationStatus): 'danger' | 'warn' | 'success' | 'info' {
    switch (status) {
      case 'active': return 'danger';
      case 'waiting': return 'warn';
      case 'resolved': return 'success';
      default: return 'info';
    }
  }

  getStatusLabel(status: ConversationStatus): string {
    switch (status) {
      case 'active': return 'Active';
      case 'waiting': return 'Awaiting Reply';
      case 'resolved': return 'Resolved';
      default: return status;
    }
  }

  getPriorityIcon(priority: string): string {
    switch (priority) {
      case 'high': return 'pi pi-exclamation-triangle';
      case 'medium': return 'pi pi-info-circle';
      default: return 'pi pi-minus';
    }
  }

  getPriorityColor(priority: string): string {
    switch (priority) {
      case 'high': return '#e74c3c';
      case 'medium': return '#e2a03f';
      default: return '#95a5a6';
    }
  }

  getSenderLabel(sender: string): string {
    switch (sender) {
      case 'user': return 'Employee';
      case 'ai': return 'AI Assistant';
      case 'hr': return 'You';
      case 'system': return 'System';
      default: return sender;
    }
  }

  getInitials(name: string): string {
    return name
      .split(' ')
      .map((word) => word[0])
      .join('')
      .toUpperCase()
      .substring(0, 2);
  }

  formatTimestamp(timestamp: number): string {
    const now = Date.now();
    const diff = now - timestamp;
    const mins = Math.floor(diff / 60_000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  getLastMessage(convo: ChatConversation): string {
    const last = convo.messages[convo.messages.length - 1];
    if (!last) return 'No messages';
    const prefix = last.sender === 'hr' ? 'You: ' : '';
    const text = last.text.replace(/\*\*/g, '').replace(/\n/g, ' ');
    return prefix + (text.length > 60 ? text.substring(0, 60) + '...' : text);
  }

  trackByConvo(_index: number, convo: ChatConversation): string {
    return convo.employeeId;
  }

  trackByMessage(_index: number, msg: ChatMessage): string {
    return msg.id;
  }

  private scrollToBottom(): void {
    const el = this.messagesEnd()?.nativeElement;
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' });
    }
  }
}
