import { SiteLight } from '../lights';

/** The three lights behind the closing band (desktop), as the kit's landing page places them. */
export const BAND_LIGHTS: readonly SiteLight[] = [
  { tone: 'violet', x: '25%', y: '20%', size: '40cqw', index: 0 },
  { tone: 'mint', x: '80%', y: '70%', size: '36cqw', index: 1 },
  { tone: 'coral', x: '60%', y: '10%', size: '26cqw', index: 2 },
];
/** The same, placed for a phone (two lights, as the kit places them at 390px). */
export const BAND_LIGHTS_PHONE: readonly SiteLight[] = [
  { tone: 'violet', x: '25%', y: '20%', size: '70cqw', index: 0 },
  { tone: 'mint', x: '85%', y: '80%', size: '60cqw', index: 1 },
];
