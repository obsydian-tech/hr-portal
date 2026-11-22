import { Injectable, signal } from '@angular/core';

/**
 * What the HR person is looking at, for the assistant panel ("Looking at Kagiso Molefe"). A page that is about one person
 * says who once it has read them, and clears it when it goes. The panel never reads the page's text.
 */
@Injectable({ providedIn: 'root' })
export class ScreenContext {
  readonly person = signal<{ id: string; name: string } | null>(null);
}
