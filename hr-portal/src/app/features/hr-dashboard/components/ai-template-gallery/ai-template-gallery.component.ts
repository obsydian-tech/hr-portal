/**
 * NH-57: AiTemplateGalleryComponent — 2-column grid of 7 action cards.
 * Emits `templateSelected` when an HR staff member clicks a card.
 */
import {
  Component,
  ChangeDetectionStrategy,
  output,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { AiTemplate, AI_TEMPLATES } from '../../models/ai-chat.model';
import { AiModeService } from '../../services/ai-mode.service';

@Component({
  selector: 'app-ai-template-gallery',
  standalone: true,
  imports: [CommonModule, ButtonModule, CardModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './ai-template-gallery.component.html',
  styleUrl: './ai-template-gallery.component.scss',
})
export class AiTemplateGalleryComponent {
  readonly aiMode = inject(AiModeService);

  readonly templateSelected = output<AiTemplate>();

  readonly templates = AI_TEMPLATES;

  select(template: AiTemplate): void {
    this.templateSelected.emit(template);
  }
}
