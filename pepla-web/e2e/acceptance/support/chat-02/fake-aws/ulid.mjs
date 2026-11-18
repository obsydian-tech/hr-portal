// TEN-03: new. The `ulid` package, made predictable: 26 upper-case characters, counting up.
let n = 0;
export function ulid() { n += 1; return ('01TEN03FAKEULID' + String(n).padStart(11, '0')).slice(0, 26); }
export default { ulid };
