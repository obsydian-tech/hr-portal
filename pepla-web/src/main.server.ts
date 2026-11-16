import { BootstrapContext, bootstrapApplication } from '@angular/platform-browser';
import { App } from './app/app';
import { config } from './app/app.config.server';

/** Build-time only: prerenders the public routes (SITE-01). Production output stays static files. */
const bootstrap = (context: BootstrapContext) => bootstrapApplication(App, config, context);
export default bootstrap;
