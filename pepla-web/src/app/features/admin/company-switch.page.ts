import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { PpButton, PpCard, PpCell, PpPageHeader, PpSectionMessage, PpSectionMessageActions, PpTableDirective, PpTableWrap, PpToggle, type Crumb } from '../../ds';
import { CompanySwitchService } from '../../core/admin/company-switch.service';
import { ModulesService } from '../../core/modules.service';

/** The module key the switch is (CHAT-02). Read from the company's modules, never kept in the browser. */
const MODULE = 'ask_batsi';

/** Every sentence on this page is an approved one: words.json P28 to P35, and W-A1 to W-A4 of the CHAT-03 card. */
const WORDS = {
  title: 'Ask Batsi',
  description: 'Turn Ask Batsi on or off for your company.',
  label: 'Use Ask Batsi',
  off: 'Off. HR staff do not see the Ask Batsi button.',
  on: 'On. HR staff see the Ask Batsi button.',
  who: 'Who can use it',
  whoValue: 'HR staff',
  past: 'Past chats',
  pastValue: 'Kept until the person deletes them.',
  loadFail: 'We could not load this setting. Try again.',
  saveFail: 'We could not save your change. Try again.',
  saved: 'Saved.',
} as const;

/**
 * CHAT-03: the screen where a company admin turns Ask Batsi on or off.
 * The state comes from the server on every open (fails closed: until the answer comes, and after a failed read, the switch
 * is disabled and nothing says on or off). Save sends { enabled } and nothing else; one save at a time; a failed save puts
 * the switch back to the saved state. No browser storage.
 */
@Component({
  selector: 'app-company-switch',
  imports: [PpButton, PpCard, PpCell, PpPageHeader, PpSectionMessage, PpSectionMessageActions, PpTableDirective, PpTableWrap, PpToggle],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pp-stack pp-gap-300">
      <pp-page-header [heading]="words.title" [description]="words.description" [breadcrumbs]="crumbs" />

      @if (read() === 'failed') {
        <pp-section-message tone="danger">
          {{ words.loadFail }}
          <pp-section-message-actions>
            <button ppButton type="button" (click)="load()">Try again</button>
          </pp-section-message-actions>
        </pp-section-message>
      }

      <pp-card [heading]="words.title" [level]="2">
        <div class="pp-stack pp-gap-200">
          <pp-toggle [label]="words.label" [description]="sentence()" [end]="false" [value]="draft()" (valueChange)="draft.set($event)" [disabled]="!ready() || saving()" />
          <pp-table-wrap>
            <table ppTable [stack]="true">
              <caption class="pp-visually-hidden">What Ask Batsi does for your company</caption>
              <thead><tr><th scope="col">Setting</th><th scope="col">Value</th></tr></thead>
              <tbody>
                <tr><td ppCell label="Setting">{{ words.who }}</td><td ppCell label="Value">{{ words.whoValue }}</td></tr>
                <tr><td ppCell label="Setting">{{ words.past }}</td><td ppCell label="Value">{{ words.pastValue }}</td></tr>
              </tbody>
            </table>
          </pp-table-wrap>
          @if (saveFailed()) {
            <pp-section-message tone="danger">{{ words.saveFail }}</pp-section-message>
          }
          <div class="pp-inline pp-gap-150">
            <button ppButton appearance="primary" type="button" [busy]="saving()" [disabled]="!changed() || saving()" (click)="save()">Save changes</button>
            <div role="status">@if (justSaved()) { <span>{{ words.saved }}</span> }</div>
          </div>
        </div>
      </pp-card>
    </div>
  `,
})
export class CompanySwitchPage implements OnInit {
  private readonly modules = inject(ModulesService);
  private readonly api = inject(CompanySwitchService);

  protected readonly words = WORDS;
  protected readonly crumbs: Crumb[] = [
    { label: 'Workspace', link: '/admin/ask-batsi' },
    { label: WORDS.title, link: '/admin/ask-batsi' },
  ];

  protected readonly read = signal<'loading' | 'ready' | 'failed'>('loading');
  /** What the server last said about the company. */
  private readonly serverOn = signal(false);
  /** What the switch shows; it differs from the server's state only while the admin has moved it and not saved. */
  protected readonly draft = signal(false);
  protected readonly saving = signal(false);
  protected readonly saveFailed = signal(false);
  protected readonly justSaved = signal(false);

  protected readonly ready = computed(() => this.read() === 'ready');
  protected readonly changed = computed(() => this.ready() && this.draft() !== this.serverOn());
  /** The sentence states a fact about the company, so it follows the saved state, not the unsaved switch. Nothing until it is read. */
  protected readonly sentence = computed(() => (this.ready() ? (this.serverOn() ? WORDS.on : WORDS.off) : undefined));

  ngOnInit(): void {
    void this.load();
  }

  protected async load(): Promise<void> {
    this.read.set('loading');
    this.saveFailed.set(false);
    this.justSaved.set(false);
    const ok = await this.modules.refresh();
    if (!ok) return this.read.set('failed');
    const on = this.modules.modules().has(MODULE);
    this.serverOn.set(on);
    this.draft.set(on);
    this.read.set('ready');
  }

  protected async save(): Promise<void> {
    if (this.saving() || !this.changed()) return;
    this.saving.set(true);
    this.saveFailed.set(false);
    this.justSaved.set(false);
    const saved = await this.api.save(this.draft());
    if (saved === null) {
      this.draft.set(this.serverOn());
      this.saveFailed.set(true);
    } else {
      this.serverOn.set(saved);
      this.draft.set(saved);
      this.justSaved.set(true);
      // The app's own list follows at once: this admin's navigation and the top bar button read it. A failed read leaves the list empty (fails closed).
      void this.modules.refresh();
    }
    this.saving.set(false);
  }
}
