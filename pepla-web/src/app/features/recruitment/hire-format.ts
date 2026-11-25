/** "21 Nov 2026", in South African time, as the rest of the app writes dates. */
export const shortDate = (iso: string): string =>
  new Intl.DateTimeFormat('en-ZA', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Johannesburg' }).format(new Date(iso)).replace(/\./g, '').replace(/^0/, '');
