// amazon-cognito-identity-js is written for Node and the old webpack build: it reads `global`.
// Browsers call it `globalThis`. This runs before the app, so the library finds it.
(globalThis as { global?: typeof globalThis }).global ??= globalThis;
