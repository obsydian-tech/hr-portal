# Help pictures and walkthrough videos

Made by the journey tests in `e2e/journeys`, run in help mode:

    npm run e2e:help

- `media/desktop/` (1440 by 900) and `media/phone/` (390 by 844).
- Only the fake company in `e2e/fixtures/help-company.ts` ever appears.
- Captions are written in the tests beside each step (`help.tap`, `help.fill`,
  `help.step`) and use the button or field's real name.
- Never edit a picture by hand: change the journey and retake. A retake that
  changes pictures opens a before/after PR for review.
