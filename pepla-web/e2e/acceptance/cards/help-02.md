# HELP-02

Card: HELP-02 Help pictures: HR sees who is starting (NH-159)

Test files: `help-02.spec.ts`, `support/help-02.ts`

Spec: [NH-159](https://obsydian.atlassian.net/browse/NH-159)

Locks: acceptance-lock/help-02, acceptance-lock/help-02.2

`help-02.spec.ts` adds a `watcher` to the recorder (`support/help-02.ts`): it
sees the scroll position, a shown masked value, the full made-up ID number in
the page text, and every email and phone number the page shows.
