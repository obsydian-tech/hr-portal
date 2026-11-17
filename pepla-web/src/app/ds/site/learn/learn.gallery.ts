import { ChangeDetectionStrategy, Component } from '@angular/core';
import { PpSiteFooter } from '../footer';
import { PpSiteStage } from '../frame';
import { PpSiteLearnAsk } from './learn.ask';
import { PpSiteLearnDemo } from './learn.demo';
import { PpSiteLearnFaq, PpSiteLearnRelated, PpSiteLearnStrip } from './learn.ending';
import { GALLERY_DEMOS, GALLERY_QUESTIONS } from './learn.gallery.data';
import { PpSiteLearnPage } from './learn.page';
import { PpSiteLearnApprovalLog, PpSiteLearnChoices, PpSiteLearnDocRead, PpSiteLearnLiveStatus, PpSiteLearnRows, PpSiteLearnSuggestion, PpSiteLearnTimeline } from './learn.panels';
import { PpSiteLearnTop } from './learn.top';
import type { LearnEnding, LearnTop } from './learn.types';
import { COMPLIANCE_ENDING, COMPLIANCE_TOP, LEAVE_ENDING, LEAVE_TOP, ONBOARDING_ENDING, ONBOARDING_TOP, PLATFORM_ENDING, PLATFORM_TOP, RECRUITMENT_ENDING, RECRUITMENT_TOP, SECURITY_ENDING, SECURITY_TOP } from './content';

type Device = 'desktop' | 'phone';
interface Page { name: string; top: LearnTop; ending: LearnEnding }

/**
 * /dev/site-learn: every part of a Learn more page on its own, at desktop and phone width, as the kit shows it ("Site demos, questions and
 * Ask Batsi", "Learn more top", "Learn more ending", "Site pages"), so the tests, the parity check and a reviewer can compare it with the kit:
 * the demo section, the questions, Ask Batsi in its three states, the six page tops and endings, the six shared demo pieces, and a whole
 * sample page that the page helper (`e2e/acceptance/support/site-08/learn-page.ts`) runs on. Dev only: not linked, not prerendered.
 * Each is a `section[data-example]` with an `h2` and one `[data-example-body]` that holds exactly what the kit example holds.
 * The page has no `h1` of its own: the sample page's top has the page's one. Spec: SITE-08 (NH-213), cards/site-08.md.
 */
@Component({
  selector: 'app-site-learn-gallery',
  imports: [PpSiteStage, PpSiteFooter, PpSiteLearnDemo, PpSiteLearnRows, PpSiteLearnTimeline, PpSiteLearnDocRead, PpSiteLearnSuggestion, PpSiteLearnLiveStatus, PpSiteLearnApprovalLog, PpSiteLearnChoices, PpSiteLearnAsk, PpSiteLearnFaq, PpSiteLearnStrip, PpSiteLearnRelated, PpSiteLearnTop, PpSiteLearnPage],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="pp-stack pp-gap-600" aria-label="Learn more page parts">
      @for (d of devices; track d) {
        <!-- the demo section -->
        @if (d === 'desktop') {
          <section class="pp-stack pp-gap-200" [id]="'learn-demo-section-white-' + d" [attr.data-example]="'Demo section, white (' + d + ')'"><h2 class="pp-text-heading-small">Demo section, white ({{ d }})</h2>
            <div data-example-body><div ppSiteStage [device]="d"><section ppSiteLearnDemo [uid]="'white-' + d" [text]="demos.types.text" engine="steps" live><div ppSiteLearnRows></div></section></div></div></section>
          <section class="pp-stack pp-gap-200" [id]="'learn-demo-section-cream-and-flipped-' + d" [attr.data-example]="'Demo section, cream and flipped (' + d + ')'"><h2 class="pp-text-heading-small">Demo section, cream and flipped ({{ d }})</h2>
            <div data-example-body><div ppSiteStage [device]="d"><section ppSiteLearnDemo [uid]="'cream-' + d" [text]="demos.types.text" engine="steps" cream flip><div ppSiteLearnRows></div></section></div></div></section>
        } @else {
          <section class="pp-stack pp-gap-200" [id]="'learn-demo-section-' + d" [attr.data-example]="'Demo section (' + d + ')'"><h2 class="pp-text-heading-small">Demo section ({{ d }})</h2>
            <div data-example-body><div ppSiteStage [device]="d"><section ppSiteLearnDemo [uid]="'white-' + d" [text]="demos.types.text" engine="steps"><div ppSiteLearnRows></div></section></div></div></section>
        }
        <section class="pp-stack pp-gap-200" [id]="'learn-questions-' + d" [attr.data-example]="'Questions (' + d + ')'"><h2 class="pp-text-heading-small">Questions ({{ d }})</h2>
          <div data-example-body><div ppSiteStage [device]="d"><section ppSiteLearnFaq [uid]="'questions-' + d" [faq]="questions.faq" [open]="d === 'desktop' ? questions.openDesktop : questions.openPhone"></section></div></div></section>
        <section class="pp-stack pp-gap-200" [id]="'learn-ask-batsi-first-question-answered-' + d" [attr.data-example]="'Ask Batsi, first question answered (' + d + ')'"><h2 class="pp-text-heading-small">Ask Batsi, first question answered ({{ d }})</h2>
          <div data-example-body><div ppSiteStage [device]="d"><section ppSiteLearnAsk [uid]="'ask1-' + d" [ask]="leave.ending.ask" [live]="d === 'desktop'"></section></div></div></section>
        <section class="pp-stack pp-gap-200" [id]="'learn-ask-batsi-waiting-for-a-person-' + d" [attr.data-example]="'Ask Batsi, waiting for a person (' + d + ')'"><h2 class="pp-text-heading-small">Ask Batsi, waiting for a person ({{ d }})</h2>
          <div data-example-body><div ppSiteStage [device]="d"><section ppSiteLearnAsk [uid]="'ask2-' + d" [ask]="leave.ending.ask" [question]="1" phase="waiting"></section></div></div></section>
        <section class="pp-stack pp-gap-200" [id]="'learn-ask-batsi-approved-and-logged-' + d" [attr.data-example]="'Ask Batsi, approved and logged (' + d + ')'"><h2 class="pp-text-heading-small">Ask Batsi, approved and logged ({{ d }})</h2>
          <div data-example-body><div ppSiteStage [device]="d"><section ppSiteLearnAsk [uid]="'ask3-' + d" [ask]="leave.ending.ask" [question]="1" phase="approved"></section></div></div></section>

        <!-- the six page tops -->
        @for (p of pages; track p.name) {
          <section class="pp-stack pp-gap-200" [id]="'learn-more-top-' + p.key + '-' + d" [attr.data-example]="'Learn more top: ' + p.name + ' (' + d + ')'"><h2 class="pp-text-heading-small">Learn more top: {{ p.name }} ({{ d }})</h2>
            <div data-example-body><div ppSiteStage [device]="d"><section ppSiteLearnTop [uid]="p.key + '-' + d" [top]="p.top"></section></div></div></section>
        }

        <!-- the six page endings -->
        @for (p of pages; track p.name) {
          <section class="pp-stack pp-gap-200" [id]="'learn-more-ending-' + p.key + '-' + d" [attr.data-example]="'Learn more ending: ' + p.name + ' (' + d + ')'"><h2 class="pp-text-heading-small">Learn more ending: {{ p.name }} ({{ d }})</h2>
            <div data-example-body><div ppSiteStage [device]="d">
              <section ppSiteLearnAsk [uid]="'end-' + p.key + '-' + d" [ask]="p.ending.ask" live></section>
              <section ppSiteLearnStrip [strip]="p.ending.strip"></section>
              <section ppSiteLearnRelated [uid]="'end-' + p.key + '-' + d" [tiles]="p.ending.related"></section>
              <section ppSiteLearnFaq [uid]="'end-' + p.key + '-' + d" [faq]="p.ending.faq"></section>
            </div></div></section>
        }
      }

      <!-- the six shared pieces, each in the demo section the kit shows it in -->
      @for (d of devices; track d) {
        <section class="pp-stack pp-gap-200" [id]="'learn-piece-timeline-' + d" [attr.data-example]="'Piece: timeline (' + d + ')'"><h2 class="pp-text-heading-small">Piece: timeline ({{ d }})</h2>
          <div data-example-body><div ppSiteStage [device]="d"><section ppSiteLearnDemo [uid]="'timeline-' + d" [text]="demos.timeline.text" engine="timeline" live><div ppSiteLearnTimeline></div></section></div></div></section>
        <section class="pp-stack pp-gap-200" [id]="'learn-piece-document-read-' + d" [attr.data-example]="'Piece: document read (' + d + ')'"><h2 class="pp-text-heading-small">Piece: document read ({{ d }})</h2>
          <div data-example-body><div ppSiteStage [device]="d"><section ppSiteLearnDemo [uid]="'docread-' + d" [text]="demos.docRead.text" engine="doc-read" live cream flip><div ppSiteLearnDocRead></div></section></div></div></section>
        <section class="pp-stack pp-gap-200" [id]="'learn-piece-suggestion-' + d" [attr.data-example]="'Piece: suggestion (' + d + ')'"><h2 class="pp-text-heading-small">Piece: suggestion ({{ d }})</h2>
          <div data-example-body><div ppSiteStage [device]="d"><section ppSiteLearnDemo [uid]="'suggestion-' + d" [text]="demos.suggestion.text" engine="suggestion" live><div ppSiteLearnSuggestion></div></section></div></div></section>
        <section class="pp-stack pp-gap-200" [id]="'learn-piece-live-status-' + d" [attr.data-example]="'Piece: live status (' + d + ')'"><h2 class="pp-text-heading-small">Piece: live status ({{ d }})</h2>
          <div data-example-body><div ppSiteStage [device]="d"><section ppSiteLearnDemo [uid]="'status-' + d" [text]="demos.liveStatus.text" engine="live-status" live><div ppSiteLearnLiveStatus></div></section></div></div></section>
        <section class="pp-stack pp-gap-200" [id]="'learn-piece-approval-decision-and-log-line-' + d" [attr.data-example]="'Piece: approval decision and log line (' + d + ')'"><h2 class="pp-text-heading-small">Piece: approval decision and log line ({{ d }})</h2>
          <div data-example-body><div ppSiteStage [device]="d"><section ppSiteLearnDemo [uid]="'approval-' + d" [text]="demos.approvalLog.text" engine="approval-log" live><div ppSiteLearnApprovalLog></div></section></div></div></section>
        <section class="pp-stack pp-gap-200" [id]="'learn-piece-choices-and-slots-' + d" [attr.data-example]="'Piece: choices and slots (' + d + ')'"><h2 class="pp-text-heading-small">Piece: choices and slots ({{ d }})</h2>
          <div data-example-body><div ppSiteStage [device]="d"><section ppSiteLearnDemo [uid]="'choices-' + d" [text]="demos.choices.text" engine="choices" live cream flip><div ppSiteLearnChoices></div></section></div></div></section>
      }

      <!-- a whole page, cut down from the kit's Leave page: one demo, the Leave page's top and ending, no hero card, no closing band -->
      @for (d of devices; track d) {
        <section class="pp-stack pp-gap-200" [id]="'learn-sample-' + d" [attr.data-example]="'Sample (' + d + ')'"><h2 class="pp-text-heading-small">Sample ({{ d }})</h2>
          <div data-example-body><div ppSiteStage [device]="d">
            <div ppSiteLearnPage [uid]="'sample-' + d" [top]="leave.top" [tabs]="sampleTabs" [ending]="leave.ending">
              <section ppSiteLearnDemo id="types" [uid]="'sample-' + d" [text]="demos.types.text" engine="steps" live><div ppSiteLearnRows></div></section>
              <footer ppSiteFooter></footer>
            </div>
          </div></div></section>
      }
    </main>
  `,
})
export class SiteLearnGalleryPage {
  protected readonly devices: readonly Device[] = ['desktop', 'phone'];
  protected readonly demos = GALLERY_DEMOS;
  protected readonly questions = GALLERY_QUESTIONS;
  protected readonly leave = { top: LEAVE_TOP, ending: LEAVE_ENDING };
  protected readonly sampleTabs = [{ id: 'types', label: 'Leave types' }, { id: 'questions', label: 'Questions' }];
  protected readonly pages: readonly (Page & { key: string })[] = [
    { key: 'recruitment', name: 'Recruitment', top: RECRUITMENT_TOP, ending: RECRUITMENT_ENDING },
    { key: 'onboarding', name: 'Onboarding', top: ONBOARDING_TOP, ending: ONBOARDING_ENDING },
    { key: 'compliance', name: 'Compliance', top: COMPLIANCE_TOP, ending: COMPLIANCE_ENDING },
    { key: 'leave', name: 'Leave', top: LEAVE_TOP, ending: LEAVE_ENDING },
    { key: 'security', name: 'Security', top: SECURITY_TOP, ending: SECURITY_ENDING },
    { key: 'platform', name: 'Platform', top: PLATFORM_TOP, ending: PLATFORM_ENDING },
  ];
}
