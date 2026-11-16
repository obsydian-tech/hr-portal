// marshall / unmarshall for plain values (strings, numbers, booleans, null, lists, maps).
export function marshallValue(v) {
  if (v === null || v === undefined) return { NULL: true };
  if (typeof v === 'string') return { S: v };
  if (typeof v === 'number' || typeof v === 'bigint') return { N: String(v) };
  if (typeof v === 'boolean') return { BOOL: v };
  if (Array.isArray(v)) return { L: v.map(marshallValue) };
  if (typeof v === 'object') return { M: marshall(v) };
  throw new Error('fake marshall: ' + typeof v);
}
export function marshall(o) {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined).map(([k, v]) => [k, marshallValue(v)]));
}
export function unmarshallValue(a) {
  if ('S' in a) return a.S;
  if ('N' in a) return Number(a.N);
  if ('BOOL' in a) return a.BOOL;
  if ('NULL' in a) return null;
  if ('L' in a) return a.L.map(unmarshallValue);
  if ('M' in a) return unmarshall(a.M);
  throw new Error('fake unmarshall: ' + JSON.stringify(a));
}
export function unmarshall(o) {
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, unmarshallValue(v)]));
}
