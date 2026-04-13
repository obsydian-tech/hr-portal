import {
  Component,
  ChangeDetectionStrategy,
  inject,
  input,
  signal,
  effect,
  ElementRef,
  viewChild,
  AfterViewChecked,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { trigger, transition, style, animate } from '@angular/animations';
import { OnboardingChatService } from '../../../core/services/onboarding-chat.service';
import { ChatMessage } from '../../models/chat.model';
import { ChatMarkdownPipe } from '../../pipes/chat-markdown.pipe';

@Component({
  selector: 'app-chat-widget',
  standalone: true,
  imports: [FormsModule, DatePipe, ChatMarkdownPipe],
  providers: [OnboardingChatService],
  templateUrl: './chat-widget.component.html',
  styleUrl: './chat-widget.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  animations: [
    trigger('slideUp', [
      transition(':enter', [
        style({ opacity: 0, transform: 'translateY(20px) scale(0.95)' }),
        animate('250ms ease-out', style({ opacity: 1, transform: 'translateY(0) scale(1)' })),
      ]),
      transition(':leave', [
        animate('200ms ease-in', style({ opacity: 0, transform: 'translateY(20px) scale(0.95)' })),
      ]),
    ]),
  ],
})
export class ChatWidgetComponent implements AfterViewChecked {
  readonly chatService = inject(OnboardingChatService);

  /** Inputs from parent — wired from employee-dashboard */
  readonly employeeId = input.required<string>();
  readonly employeeName = input<string>('');
  readonly hrPartnerName = input<string>('');
  readonly startDate = input<string>('');

  /** Widget open/closed state */
  readonly isOpen = signal(false);

  /** Input field model */
  inputText = '';

  /** Auto-scroll anchor */
  private readonly messagesEnd = viewChild<ElementRef>('messagesEnd');
  private shouldScroll = false;

  constructor() {
    // Initialize service when inputs are ready
    effect(() => {
      const id = this.employeeId();
      if (id) {
        this.chatService.initialize(
          id,
          this.employeeName(),
          this.hrPartnerName(),
          this.startDate(),
        );
      }
    });
  }

  ngAfterViewChecked(): void {
    if (this.shouldScroll) {
      this.scrollToBottom();
      this.shouldScroll = false;
    }
  }

  toggleWidget(): void {
    this.isOpen.update((v) => !v);
    if (this.isOpen()) {
      this.shouldScroll = true;
    }
  }

  sendMessage(): void {
    const text = this.inputText.trim();
    if (!text) return;
    this.inputText = '';
    this.chatService.sendMessage(text);
    this.shouldScroll = true;
  }

  onChipClick(value: string): void {
    this.chatService.sendMessage(value);
    this.shouldScroll = true;
  }

  onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.sendMessage();
    }
  }

  clearChat(): void {
    this.chatService.clearChat();
    this.shouldScroll = true;
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
