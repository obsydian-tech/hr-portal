import { ChangeDetectionStrategy, Component } from '@angular/core';
import { HrChat } from './assistant-panel';

/** The full page chat: the same conversation as the side panel, in a reading column. Route /hr/ask-batsi. */
@Component({ selector: 'app-assistant-page', imports: [HrChat], changeDetection: ChangeDetectionStrategy.OnPush, template: `<app-hr-chat [page]="true" />` })
export class AssistantPage {}
