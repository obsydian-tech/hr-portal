# Pepla design system, in Angular

Every piece of UI in Pepla comes from this folder. Screens (`src/app/features/**`) put `pp-*` components together inside Layout classes. They style nothing themselves. `npm run verify:design` enforces this on every build, and nothing can switch it off.

- **The look** comes from the design system repo ([obsydian-tech/pepla-design-system](https://github.com/obsydian-tech/pepla-design-system)). `npm run design-system:sync -- <tag>` copies its tokens, `components.css` and the icon vocabulary into `src/styles/design-system/` and regenerates `core/icon.registry.ts`. Never edit those files by hand: the check compares them against the hashes in `sync.json`.
- **The behaviour** is built here, on Angular 22 signals, plus [Angular Aria](https://angular.dev/guide/aria/overview) for the hard keyboard and screen reader patterns (combobox, listbox) and the Angular CDK for overlays, focus trapping and virtual scroll. No PrimeNG and no other UI kit.
- **The gallery** at `/dev/design-system` shows every component in its states. Check it after a sync or a change here.

## The rules for a screen

1. Use a `pp-*` component, or a native element with its directive (`button[ppButton]`, `a[ppLink]`, `input[ppTextField]`, `textarea[ppTextarea]`, `table[ppTable]`).
2. For layout, use the Layout and text classes only: `pp-stack`, `pp-inline`, `pp-columns`, `pp-grid`, `pp-gap-*`, `pp-grow`, `pp-fixed`, `pp-push`, `pp-shrink`, `pp-measure-*`, `pp-width-field-*`, `pp-scroll`, `pp-text*`, `pp-heading*` and `pp-visually-hidden`.
3. No `style=""` and no `[style]` or `[ngStyle]`. The one exception is a component input named `--_*`, for example `[style.--_width]`.
4. Icons are `<svg ppIcon="name" />` with a name from the vocabulary. Never write a hand-made `<svg>`, a glyph or an emoji.
5. If the component you need doesn't exist, add it here, following its spec in the design system repo. Don't build it inside a screen.

```html
<pp-page-header heading="Candidates" [breadcrumbs]="crumbs" />
<div class="pp-columns">
  <pp-card heading="Pipeline, most urgent first">
    <table ppTable> … </table>
  </pp-card>
  <pp-proposal-list>
    <pp-proposal-row [proposal]="next" (approve)="approve(next)" (review)="open(next)" />
  </pp-proposal-list>
</div>
```

## What's here

| Group | Components and directives |
| --- | --- |
| core | `svg[ppIcon]`, `svg[ppMark]`, `pp-logo`, `pp-app-icon`, `pp-icon-tile`, `pp-avatar`, `pp-avatar-group`, `pp-person` |
| actions | `button[ppButton]`, `a[ppButton]`, `pp-button-group`, `pp-split-button`, `a[ppLink]` |
| status | `pp-lozenge`, `pp-badge`, `pp-badge-anchor`, `pp-tag`, `pp-tag-group`, `pp-spinner`, `pp-progress-bar`, `pp-progress-tracker`, `pp-skeleton*` |
| messages | `pp-section-message`, `pp-inline-message`, `pp-banner`, `pp-empty-state`, `pp-flag-group` with the `PpFlags` service, `pp-notifications-panel` with `li[ppNotification]` |
| overlays | `pp-modal-dialog`, `pp-drawer`, `pp-dropdown-menu` with `button[ppMenuItem]` and `pp-menu-section`, `pp-popup`, `pp-inline-dialog`, `pp-tooltip` |
| navigation | `pp-app-shell`, `pp-side-navigation`, `pp-top-navigation`, `pp-page-header`, `pp-breadcrumbs`, `pp-tabs`, `pp-pagination` |
| forms | `pp-field`, `input[ppTextField]`, `textarea[ppTextarea]`, `pp-select` (native), `pp-rich-select` (groups, second lines, icons, a filter), `pp-checkbox`, `pp-toggle`, `pp-radio-group`, `pp-search`, `pp-date-picker`, `pp-autocomplete`, `pp-multi-select`, `pp-password`, `pp-slider`, `pp-file-upload`, `form[ppForm]` with `pp-form-section`, `pp-form-row`, `pp-form-footer` and `pp-error-summary`, `div[ppScroll]` |
| data | `pp-card` (with `[ppCardBody]`, `pp-card-aside`, `pp-card-footer`), `pp-card-grid`, `pp-stat`, `pp-stat-row`, `pp-description-list`, `table[ppTable]` in `pp-table-wrap`, with `td[ppCell]`, `th[ppSortHeader]` and `pp-restricted-cell`, `pp-table` (long lists), `pp-accordion` with `[ppAccordionItem]`, `pp-timeline` |
| agent | `pp-agent-mark`, `pp-confidence`, `pp-proposal-card`, `pp-proposal-row`, `pp-proposal-list`, `pp-agent-panel`, `pp-agent-log` (around a `pp-timeline` whose events carry an `outcome`) |
| records | `pp-person-header`, `time[ppDeadline]` (or `span[ppDeadline]` when paused), `pp-role`, `pp-masked-field` with the `PpRevealLog` service, `pp-document-checklist` with `li[ppDocumentRow]`, `pp-checklist` with `li[ppChecklistRow]`, `ul[ppAuditLog]` with `li[ppAuditEvent]`, `dl[ppDl]` for rich values, `pp-restricted`, `pp-role-group`, `pp-config-version`, `pp-verification` with `pp-verification-by`, `ol[ppApprovalChain]`, `pp-offer`, `ul[ppPersonProgressList]` with `li[ppPersonProgress]`, `pp-scorecard`, `form[ppConsent]` and `pp-consent-record`, `pp-bundle`, `pp-pipeline-board`, `pp-brand-preview` |

Each component's doc comment shows how to use it and names its spec in the design system repo.

## Decisions built into the components

- **One-tap Approve.** `pp-proposal-row` shows Approve only when confidence is high and nothing goes to another company. Otherwise it shows Review.
- **Masked values.** `pp-masked-field` logs every Show through `PpRevealLog`. By default the log stays in memory; the app will replace it with one that sends each reveal to the backend, once that backend ticket is done. The value hides again after 2 minutes or when you leave the page.
- **Dates.** Dates show as "3 Nov" or "17 Nov 2026" (`format.ts`). Deadlines are written in words inside a `<time>`. The date picker starts weeks on Monday, and also accepts typed "23/11/2026" or "2026-11-23".
- **Flags.** Success and information flags disappear after 8 seconds unless they have an action. Warnings and errors stay until they are dismissed. Each flag is a status (or an alert), not a list item.
- **Menus.** Every button that opens a menu says so (`aria-haspopup`, `aria-expanded`), and points at the menu with `aria-controls` only while it is open. Escape and a choice put focus back on the button.
- **Brand colour.** `pp-brand-preview` accepts every colour. One that is under 4.5 to 1 on white, or close to Pepla's mint or the error red, stays on the header, logo area and sign-in page; buttons and links stay violet. The maths is in `records/colour.ts`, and the API must run the same check.
- **Agent panel.** One panel for Pepla. It is a dialog: focus goes to the composer and comes back to the opener. Send waits while Pepla works. Proposals in it follow the one-tap rule above.
- **Long tables on a phone.** Rows stack as cards of different heights, so `pp-table` renders every loaded row on a phone and loads the next page as the end comes near. Desktop keeps virtual scroll. A table that scrolls sideways becomes a named region a keyboard can reach.

## Forms

Controls with a value (`pp-select`, `pp-rich-select`, `pp-checkbox`, `pp-toggle`, `pp-radio-group`, `pp-search`, `pp-date-picker`, `pp-autocomplete` and `pp-multi-select`) support two-way binding with `[(value)]`, and also work with Angular forms (`ngModel` or reactive forms). Put each one inside a `pp-field`. The field supplies the label, help, error, `aria-describedby`, `aria-invalid` and `required`. Give a control an `id` when something links to it (the error summary does); the label follows it.
