import { ChangeDetectionStrategy, Component, computed, effect, input, output, signal, untracked } from '@angular/core';
import { PpButton, PpField, PpModalDialog, PpModalFooter, PpRadioGroup, PpSectionMessage } from '../../ds';

/** The line the Move and Not hired pages show when a save fails (REC-UI-01). */
export const SAVE_FAIL = 'Your change could not be saved. Try again.';

/** The eight approved reasons, in the approved order (REC-UI-01 rule 7). */
export const REASONS: ReadonlyArray<readonly [string, string]> = [
  ['NOT_RIGHT_SKILLS', 'Not the right skills'], ['NOT_RIGHT_EXPERIENCE', 'Not the right experience'], ['CHOSE_ANOTHER', 'Chose another candidate'], ['WITHDREW', 'Candidate withdrew'],
  ['SALARY_MISMATCH', 'Salary did not match'], ['DID_NOT_ATTEND', 'Did not attend'], ['ROLE_CLOSED', 'Role closed'], ['OTHER', 'Other'],
];

/** Who is being recorded as not hired. `line` is the "must confirm before this is final" line, when a confirmation is waiting. */
export interface NotHiredFor { name: string; waiting: boolean; line: string | null; }

/**
 * REC-UI-01's "{first name} not hired" dialog: one of the eight reasons, then Record not hired. One dialog for the board and the
 * candidate record. It sends nothing: it reports `record` with the reason, or `dismissed`.
 */
@Component({
  selector: 'app-not-hired-dialog',
  imports: [PpButton, PpField, PpModalDialog, PpModalFooter, PpRadioGroup, PpSectionMessage],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <pp-modal-dialog [open]="!!who()" [closable]="true" [heading]="first() + ' not hired'" (closed)="dismissed.emit()">
      <div class="pp-stack pp-gap-150">
        <pp-field label="Why? (required)" group="radio" help="Not hired always carries a reason.">
          <pp-radio-group [options]="reasons" [value]="reason()" (valueChange)="reason.set($event)" />
        </pp-field>
        @if (who()?.line; as line) { <p class="pp-text--small">{{ line }}</p> }
        @if (failed()) { <pp-section-message tone="danger" [heading]="saveFail" /> }
      </div>
      <pp-modal-footer>
        <button ppButton type="button" (click)="dismissed.emit()">Cancel</button>
        <button ppButton appearance="primary" type="button" [disabled]="!canRecord()" (click)="record.emit(reason())">Record not hired</button>
      </pp-modal-footer>
    </pp-modal-dialog>`,
})
export class NotHiredDialog {
  readonly who = input<NotHiredFor | null>(null);
  readonly failed = input(false);
  readonly record = output<string | null>();
  readonly dismissed = output<void>();
  protected readonly saveFail = SAVE_FAIL;
  protected readonly reasons = REASONS.map(([value, label]) => ({ value, label }));
  protected readonly reason = signal<string | null>(null);
  /** The name stays in the heading while the dialog closes. */
  private last = '';
  protected readonly first = computed(() => (this.who()?.name ?? this.last).split(' ')[0]);
  protected readonly canRecord = computed(() => !!this.who()?.waiting || !!this.reason());
  constructor() {
    effect(() => {
      const w = this.who();
      untracked(() => { if (!w) this.reason.set(null); else this.last = w.name; });
    });
  }
}
