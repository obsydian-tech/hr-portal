// First: the `global` shim amazon-cognito-identity-js needs. Imported here, not as an angular.json polyfill,
// because a polyfill file makes the prerender step expect zone.js, which this zoneless app does not use.
import './polyfills';
import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';

bootstrapApplication(App, appConfig).catch((err) => console.error(err));
