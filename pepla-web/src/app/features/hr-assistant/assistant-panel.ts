import { ChangeDetectionStrategy, Component, Injector, computed, effect, inject, input, model, output, untracked, viewChild } from '@angular/core';
import { BreakpointObserver } from '@angular/cdk/layout';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import { PpAgentPanel, type PanelMessage, type PanelSuggestion } from '../../ds';
import { ChatService, OPEN_RETRY, SAID } from './chat.service';

/**
 * The HR person's chat with Batsi, as the side panel (opened from the top bar) or, with `page`, the full page.
 * Both draw the one conversation held by ChatService. The file and class are named for the assistant, not for Batsi:
 * a dev server puts the component's path in its URLs and no signed-in address may name it (ONB-12, 13, 15).
 */
@Component({
  selector: 'app-hr-chat',
  imports: [PpAgentPanel],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <pp-agent-panel
      [open]="page() || open()" (openChange)="open.set($event)" [page]="page()" [level]="page() ? 1 : 2" [expandable]="true" [backLink]="chat.returnTo()"
      [heading]="page() ? chat.heading() : 'Batsi'" [showBack]="!page() || phone()" [actionLabel]="page() && chat.chatId() && chat.openState() === 'idle' ? 'Delete chat' : undefined" (action)="chat.confirmOne.set(true)"
      [context]="chat.contextLine()" [placeholder]="chat.placeholder()" [messages]="messages()" [suggestions]="suggestions()"
      [working]="chat.working() ? words.working : undefined" [disabled]="!chat.online() || chat.notOn()" [notice]="chat.online() ? undefined : words.offline"
      (send)="chat.ask($event)" (stop)="chat.stop()" (retry)="retry($event)" (decide)="chat.decide($event)" (expand)="expand.emit()" />
  `,
})
export class HrChat {
  protected readonly chat = inject(ChatService);
  protected readonly words = SAID;
  /** The full page instead of the side panel. */
  readonly page = input(false);
  readonly open = model(false);
  readonly expand = output<void>();
  private readonly panelRef = viewChild(PpAgentPanel);
  private readonly injector = inject(Injector);
  protected readonly phone = toSignal(inject(BreakpointObserver).observe('(max-width: 767px)').pipe(map((r) => r.matches)), { initialValue: false });

  constructor() {
    effect(() => {
      const f = this.chat.focusRequest();
      if (!f || !this.page()) return;
      untracked(() => setTimeout(() => (f.what === 'heading' ? this.panelRef()?.focusTitle() : this.panelRef()?.focusBox()), 40));
    });
  }
  protected retry(question: string): void { if (question === OPEN_RETRY) this.chat.reopen(); else void this.chat.retry(question); }

  protected readonly messages = computed<PanelMessage[]>(() => [
    ...(this.chat.reopened() ? [] : [{ from: 'pepla' as const, text: SAID.greeting(this.chat.firstName()), day: 'Today' }]),
    ...this.chat.messages(),
  ]);
  /** Three questions to pick from, until the first question is asked. */
  protected readonly suggestions = computed<PanelSuggestion[]>(() => {
    if (this.chat.started()) return [];
    const who = this.chat.looking();
    return [
      ...(who ? [{ icon: 'user-check' as const, label: `Is ${who.name.split(' ')[0]} ready to start on Monday?` }] : []),
      { icon: 'file-text', label: 'Who hasn’t sent their documents?' },
      { icon: 'user-search', label: 'Which candidates are at risk?' },
    ];
  });
}
