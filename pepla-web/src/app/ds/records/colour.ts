/**
 * Contrast and OKLCH helpers for tenant branding. The API runs the same functions and has the last word.
 * Spec: records/tenant-branding-preview.md, "How the app computes contrast".
 */
type Rgb = [number, number, number];

export const isHex = (hex: string) => /^[0-9a-f]{6}$/i.test(hex.replace('#', ''));
const parse = (hex: string): Rgb => { const h = hex.replace('#', ''); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as Rgb; };
const toHex = (c: Rgb) => c.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const gam = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

export function luminance(hex: string) { const [r, g, b] = parse(hex).map(lin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; }
export function contrast(a: string, b: string) { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); }
/** Rounded down to one decimal, so 4.49 never reads as 4.5. */
export const ratioWords = (r: number) => (Math.floor(r * 10) / 10).toFixed(1);

export interface Oklch { l: number; c: number; h: number; }
export function toOklch(hex: string): Oklch {
  const [r, g, b] = parse(hex).map(lin);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { l: L, c: Math.hypot(A, B), h: ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360 };
}
function fromOklch({ l: L, c, h }: Oklch): Rgb {
  const A = c * Math.cos((h * Math.PI) / 180), B = c * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s] as Rgb;
}
/** Back to hex, lowering chroma only if the colour is outside sRGB. */
function inGamut(o: Oklch): string {
  let c = o.c;
  for (;;) {
    const rgb = fromOklch({ ...o, c });
    if (rgb.every((v) => v >= -0.0001 && v <= 1.0001) || c <= 0) return toHex(rgb.map(gam) as Rgb);
    c = Math.max(0, c - 0.005);
  }
}
/** Keep the hue; step lightness (down for white, up for a dark surface) until the ratio reaches `min`. */
export function nearestPassing(hex: string, against: string, min = 4.5): string {
  const o = toOklch(hex), dir = luminance(against) > 0.5 ? -0.01 : 0.01;
  for (let l = o.l; l >= 0 && l <= 1; l += dir) { const out = inGamut({ ...o, l }); if (contrast(out, against) >= min) return out; }
  return dir < 0 ? '000000' : 'FFFFFF';
}
/** Chroma above 0.06 and hue within 25 degrees of `other`'s. */
export function looksLike(hex: string, other: string) {
  const a = toOklch(hex), b = toOklch(other), d = Math.abs(a.h - b.h);
  return a.c > 0.06 && Math.min(d, 360 - d) < 25;
}
/** A plain name for a hue, for "a darker amber". */
export function hueName(hex: string) {
  const { c, h } = toOklch(hex);
  if (c < 0.03) return 'grey';
  const names: [number, string][] = [[20, 'pink'], [40, 'red'], [60, 'orange'], [90, 'amber'], [110, 'yellow'], [150, 'green'], [190, 'teal'], [240, 'blue'], [280, 'indigo'], [320, 'violet'], [360, 'pink']];
  return names.find(([max]) => h < max)![1];
}
