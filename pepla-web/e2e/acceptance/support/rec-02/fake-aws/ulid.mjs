// TEN-03: new. The `ulid` package, made predictable: 26 upper-case characters, counting up.
// REC-12: the count starts from the clock, so two handler runs (each a fresh process) never make the same id.
let n = Date.now() % 1e9;
export function ulid() { n += 1; return ('01REC12FAKEULID' + String(n).padStart(11, '0')).slice(0, 26); }
export default { ulid };
