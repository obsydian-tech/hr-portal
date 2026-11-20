import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { PpButton, PpModalDialog, PpModalFooter, PpSectionMessage } from '../../ds';
import { ChatService } from './chat.service';

/**
 * The two "are you sure" dialogs of the Ask Batsi page: delete the open chat, and delete all of the person's chats.
 * Words as approved (P36 to P39, W14-1). Focus starts on Cancel; Escape, Close and Cancel send nothing.
 */
@Component({
  selector: 'app-chat-dialogs',
  imports: [PpButton, PpModalDialog, PpModalFooter, PpSectionMessage],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <pp-modal-dialog [(open)]="chat.confirmOne" heading="Delete this chat?" tone="danger" [closable]="true" (closed)="chat.deleteFailed.set(false)">
      This removes the chat for good. The audit log keeps that a chat was deleted, not what it said.
      @if (chat.deleteFailed()) { <pp-section-message tone="danger" heading="It did not go through. Nothing was changed." /> }
      <pp-modal-footer>
        <button ppButton cdkFocusInitial type="button" (click)="chat.confirmOne.set(false)">Cancel</button>
        <button ppButton appearance="danger" type="button" [busy]="chat.deleting()" (click)="chat.deleteOpen()">Delete chat</button>
      </pp-modal-footer>
    </pp-modal-dialog>
    <pp-modal-dialog [(open)]="chat.confirmAll" heading="Delete all your chats?" tone="danger" [closable]="true" (closed)="chat.deleteFailed.set(false)">
      {{ allText() }}
      @if (chat.deleteFailed()) { <pp-section-message tone="danger" heading="It did not go through. Nothing was changed." /> }
      <pp-modal-footer>
        <button ppButton cdkFocusInitial type="button" (click)="chat.confirmAll.set(false)">Cancel</button>
        <button ppButton appearance="danger" type="button" [busy]="chat.deleting()" (click)="chat.deleteEvery()">Delete all my chats</button>
      </pp-modal-footer>
    </pp-modal-dialog>
  `,
})
export class ChatDialogs {
  protected readonly chat = inject(ChatService);
  /** The number is said only when every page was read and it is 2 or more; otherwise the sentence has no number. */
  protected readonly allText = computed(() => {
    const n = this.chat.chats().length;
    return this.chat.listState() === 'ok' && this.chat.listComplete() && n >= 2
      ? `This removes all ${n} of your chats for good. The audit log keeps that you deleted them, not what they said.`
      : 'This removes all of your chats for good. The audit log keeps that you deleted them, not what they said.';
  });
}
