import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, input, model, output } from '@angular/core';
import { PpIcon } from '../core/icon';
import { IconName } from '../core/icon.registry';
import { PpButton } from '../actions/button';
import { PpLozenge } from '../status/lozenge';
import { PpField } from './field';
import { uid } from '../util';

/**
 * Where people add a file: drag it in, or choose one. Inside `<pp-field label="Copy of ID" group="list">`,
 * whose label names it. `(files)` gives what was chosen; check type and size and show any problem as
 * the field's error. Spec: forms/file-upload.md
 */
@Component({
  selector: 'pp-file-upload',
  imports: [PpIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="pp-file-upload__icon"><svg [ppIcon]="icon()" /></span>
    @if (compact()) {
      <div class="pp-file-upload__text">
        <div class="pp-file-upload__title" [id]="id + '-title'">{{ title() }}</div>
        @if (hint()) { <div class="pp-file-upload__hint" [id]="id + '-hint'">{{ hint() }}</div> }
      </div>
    } @else {
      <div class="pp-file-upload__title">@if (dragging()) { Drop to upload } @else { @if (dropText()) {<span class="pp-file-upload__drop-text">{{ dropText() }}</span>}choose a file }</div>
      @if (hint()) { <div class="pp-file-upload__hint" [id]="id + '-hint'">{{ hint() }}</div> }
    }
    <!-- While a file is over the zone, the zone itself is the target: the browse button steps aside. -->
    @if (!dragging()) {
    <input class="pp-file-upload__input" type="file" [id]="id" [attr.accept]="accept() ?? null" [multiple]="multiple()"
           [attr.aria-labelledby]="labelledBy()" [attr.aria-describedby]="describedBy()" [required]="field?.required() ?? false"
           [attr.aria-invalid]="field?.invalid() || null" (change)="picked($event)" />
    <label class="pp-button pp-button--default pp-file-upload__browse" [class.pp-button--small]="compact()" [attr.for]="id"><svg ppIcon="upload" /><span>{{ button() }}</span></label>
    }
  `,
  host: {
    '[class]': '"pp-file-upload" + (compact() ? " pp-file-upload--compact" : "") + (dragging() ? " pp-file-upload--dragover" : "") + (field?.invalid() ? " pp-file-upload--invalid" : "")',
    '[attr.title]': 'null', // the input, not a hover tooltip
    '(dragenter)': 'over($event)', '(dragover)': 'over($event)', '(dragleave)': 'left($event)', '(drop)': 'dropped($event)',
  },
})
export class PpFileUpload {
  /** The words before "choose a file": "Drag Sipho's ID here, or ". Left out on phones by the CSS. */
  readonly dropText = input<string>();
  /** Compact (in a checklist row): the title says what is wanted. */
  readonly title = input('');
  readonly hint = input<string>();
  readonly accept = input<string>();
  readonly multiple = input(false);
  readonly compact = input(false);
  readonly icon = input<IconName>('upload');
  readonly button = input('Choose file');
  /** A file is being dragged over. Set by the component; the gallery sets it to show the state. */
  readonly dragging = model(false);
  readonly files = output<File[]>();
  protected readonly field = inject(PpField, { optional: true });
  protected readonly id = this.field?.controlId ?? uid('pp-file');
  protected readonly labelledBy = computed(() => (this.compact() ? this.id + '-title' : this.field ? this.field.controlId + '-label' : null));
  protected readonly describedBy = computed(() => [this.field?.error() && this.field.controlId + '-error', this.hint() && this.id + '-hint'].filter(Boolean).join(' ') || null);
  protected over(e: DragEvent) { e.preventDefault(); this.dragging.set(true); }
  private readonly host = inject(ElementRef<HTMLElement>).nativeElement;
  /** Moving onto a child (the icon, the title) fires dragleave too: only leaving the zone counts. */
  protected left(e: DragEvent) { if (!this.host.contains(e.relatedTarget as Node | null)) this.dragging.set(false); }
  protected dropped(e: DragEvent) { e.preventDefault(); this.dragging.set(false); this.files.emit([...(e.dataTransfer?.files ?? [])]); }
  protected picked(e: Event) { const el = e.target as HTMLInputElement; this.files.emit([...(el.files ?? [])]); el.value = ''; }
}

/** Files someone added: `<pp-file-list label="Lerato's documents"><pp-file …/></pp-file-list>` */
@Component({
  selector: 'pp-file-list', template: '<ng-content />', changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'pp-file-list', role: 'list', '[attr.aria-label]': 'label()' },
})
export class PpFileList { readonly label = input.required<string>(); }

export type FileState = 'uploading' | 'done' | 'agent' | 'error';

/** One file: uploading with progress, uploaded, checked by Batsi, or failed with the reason. */
@Component({
  selector: 'pp-file',
  imports: [PpIcon, PpButton, PpLozenge],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="pp-file__icon"><svg [ppIcon]="icon()" /></span>
    <div class="pp-file__body">
      <span class="pp-file__name">{{ name() }}</span>
      <span class="pp-file__meta"><span>{{ size() }}</span>
        @switch (state()) {
          @case ('uploading') { <span>Uploading, {{ progress() }}%</span> }
          @case ('done') { <span class="pp-file__status pp-file__status--success"><svg ppIcon="circle-check" />Uploaded</span> }
          @case ('agent') { <pp-lozenge status="agent">Checked by Batsi</pp-lozenge> }
          @case ('error') { <span class="pp-file__status pp-file__status--danger"><svg ppIcon="octagon-alert" />{{ error() }}</span> }
        }
      </span>
    </div>
    <div class="pp-file__actions">
      @if (state() === 'error') { <button ppButton size="small" (click)="retry.emit()">Try again</button> }
      @if (state() === 'uploading') {
        <button ppButton appearance="subtle" size="small" icon="x" [iconOnly]="true" [attr.aria-label]="'Cancel upload of ' + name()" (click)="cancel.emit()"></button>
      } @else {
        <button ppButton appearance="subtle" size="small" [icon]="state() === 'error' ? 'x' : 'trash-2'" [iconOnly]="true" [attr.aria-label]="'Remove ' + name()" (click)="remove.emit()"></button>
      }
    </div>
    @if (state() === 'uploading') {
      <div class="pp-progress-bar pp-file__progress"><progress class="pp-progress-bar__track pp-progress-bar__track--small" [value]="progress()" max="100" [attr.aria-label]="'Uploading ' + name()">{{ progress() }}%</progress></div>
    }
  `,
  host: { class: 'pp-file', role: 'listitem', '[class.pp-file--error]': 'state() === "error"' },
})
export class PpFile {
  readonly name = input.required<string>();
  /** "1.2 MB" */
  readonly size = input.required<string>();
  readonly state = input<FileState>('done');
  readonly progress = input(0);
  readonly error = input<string>();
  readonly icon = input<IconName>('file-text');
  readonly cancel = output<void>();
  readonly remove = output<void>();
  readonly retry = output<void>();
}
