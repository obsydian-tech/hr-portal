// Polyfill `global` for libraries that expect a Node.js environment (e.g., amazon-cognito-identity-js)
// This file is referenced in the test polyfills in angular.json
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any)['global'] = window;
