import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
  computed,
  signal,
  OnChanges,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DrawerModule } from 'primeng/drawer';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';
import { TextareaModule } from 'primeng/textarea';
import { NotifTemplate, UpdateNotifTemplateRequest } from '../../../../../models/admin.models';

@Component({
  selector: 'tf-template-edit-drawer',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonModule, DrawerModule, TagModule, TooltipModule, TextareaModule],
  templateUrl: './template-edit-drawer.component.html',
  styleUrl:    './template-edit-drawer.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TemplateEditDrawerComponent implements OnChanges {
  readonly template = input.required<NotifTemplate>();
  readonly visible  = input<boolean>(false);
  readonly saving   = input<boolean>(false);
  readonly saved    = output<UpdateNotifTemplateRequest>();
  readonly closed   = output<void>();

  editBody = signal('');

  /** HTML string for the live preview with {{vars}} highlighted */
  readonly previewHtml = computed(() => this.highlightVars(this.editBody()));

  ngOnChanges(): void {
    this.editBody.set(this.template().body);
  }

  onBodyChange(val: string): void {
    this.editBody.set(val);
  }

  save(): void {
    this.saved.emit({
      templateId: this.template().templateId,
      body:       this.editBody(),
    });
  }

  close(): void {
    this.closed.emit();
  }

  highlightVars(text: string): string {
    return text.replace(
      /\{\{([^}]+)\}\}/g,
      '<span class="tf-template-drawer__var">{{$1}}</span>',
    );
  }

  insertVar(varName: string): void {
    this.editBody.set(this.editBody() + `{{${varName}}}`);
  }
}
