import { ChangeDetectionStrategy, Component, computed, effect, input, output, signal, untracked } from '@angular/core';
import { PpButton, PpField, PpModalDialog, PpModalFooter, PpSectionMessage, PpTextarea } from '../../ds';
import { SAVE_FAIL } from './not-hired-dialog';

/** REC-UI-02 step 9: "Reopen this candidate" with one reason. It sends nothing: it reports `confirmed` with the trimmed reason, or `dismissed`. */
@Component({
  selector: 'app-reopen-dialog',
  imports: [PpButton, PpField, PpModalDialog, PpModalFooter, PpSectionMessage, PpTextarea],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <pp-modal-dialog [open]="open()" [closable]="true" heading="Reopen this candidate" (closed)="dismissed.emit()">
      <div class="pp-stack pp-gap-150">
        <pp-field label="Reason">
          <textarea ppTextarea rows="3" maxlength="1000" required [value]="reason()" (input)="reason.set($any($event.target).value)"></textarea>
        </pp-field>
        @if (failed()) { <pp-section-message tone="danger" [heading]="saveFail" /> }
      </div>
      <pp-modal-footer>
        <button ppButton type="button" (click)="dismissed.emit()">Cancel</button>
        <button ppButton appearance="primary" type="button" [disabled]="!canReopen()" (click)="confirm()">Reopen</button>
      </pp-modal-footer>
    </pp-modal-dialog>`,
})
export class ReopenDialog {
  readonly open = input(false);
  readonly failed = input(false);
  readonly busy = input(false);
  readonly confirmed = output<string>();
  readonly dismissed = output<void>();
  protected readonly saveFail = SAVE_FAIL;
  protected readonly reason = signal('');
  protected readonly canReopen = computed(() => !this.busy() && this.reason().trim() !== '');
  constructor() {
    effect(() => { const o = this.open(); untracked(() => { if (!o) this.reason.set(''); }); });
  }
  protected confirm() { if (this.canReopen()) this.confirmed.emit(this.reason().trim()); }
}
