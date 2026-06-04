import { ApplicationConfig, provideZoneChangeDetection, APP_INITIALIZER, inject } from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { providePrimeNG } from 'primeng/config';
import Aura from '@primeng/themes/aura';
import { definePreset } from '@primeuix/styled';

import { routes } from './app.routes';
import { authInterceptor } from './core/interceptors/auth.interceptor';
import { AuthService } from './core/services/auth.service';

// Replace Aura's default emerald palette with Naleko secondary (indigo #4a3f8a)
const NalekoPreset = definePreset(Aura, {
  semantic: {
    primary: {
      50:  '#f2f0ff',
      100: '#e5deff',
      200: '#c8bfff',
      300: '#b7acff',
      400: '#8577cc',
      500: '#6655b0',
      600: '#4a3f8a',
      700: '#3a3070',
      800: '#2a2256',
      900: '#1a153c',
      950: '#0d0a1e',
    },
    colorScheme: {
      light: {
        primary: {
          color: '{primary.600}',
          contrastColor: '#ffffff',
          hoverColor: '{primary.700}',
          activeColor: '{primary.800}',
        },
        highlight: {
          background: '{primary.50}',
          focusBackground: '{primary.100}',
          color: '{primary.600}',
          focusColor: '{primary.700}',
        },
      },
    },
  },
});

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes, withComponentInputBinding()),
    provideAnimationsAsync(),
    provideHttpClient(withInterceptors([authInterceptor])),
    providePrimeNG({
      theme: {
        preset: NalekoPreset,
        options: {
          darkModeSelector: '.dark-mode',
        },
      },
    }),
    // Restore Naleko auth session before routing begins
    {
      provide: APP_INITIALIZER,
      useFactory: () => {
        const auth = inject(AuthService);
        return () => auth.checkSession();
      },
      multi: true,
    },
    // Pool consolidation (Epic 5): single Naleko session covers all modules.
  ],
};
