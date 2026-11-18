// Copied from ../../onb-13/fake-aws (ONB-13 lock) so this card's fake stands on its own.
// marshall / unmarshall for the types the tables hold.
export function unmarshall(item) { const o = {}; for (const [k, v] of Object.entries(item ?? {})) o[k] = fromAttr(v); return o; }
export function marshall(obj, opts = {}) { const o = {}; for (const [k, v] of Object.entries(obj ?? {})) { if (v === undefined && opts.removeUndefinedValues) continue; o[k] = toAttr(v); } return o; }
export function convertToAttr(v) { return toAttr(v); }
export function convertToNative(v) { return fromAttr(v); }
function fromAttr(a) {
  if ('S' in a) return a.S; if ('N' in a) return Number(a.N); if ('BOOL' in a) return a.BOOL; if ('NULL' in a) return null;
  if ('M' in a) return unmarshall(a.M); if ('L' in a) return a.L.map(fromAttr);
  if ('SS' in a) return new Set(a.SS); if ('NS' in a) return new Set(a.NS.map(Number));
  throw new Error('unmarshall: unknown attribute ' + JSON.stringify(a));
}
function toAttr(v) {
  if (v === null || v === undefined) return { NULL: true };
  if (typeof v === 'string') return { S: v }; if (typeof v === 'number') return { N: String(v) }; if (typeof v === 'boolean') return { BOOL: v };
  if (Array.isArray(v)) return { L: v.map(toAttr) }; if (v instanceof Set) return { SS: [...v] };
  return { M: marshall(v) };
}
