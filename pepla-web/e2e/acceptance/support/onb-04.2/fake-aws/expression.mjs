// Copied from ../../onb-13/fake-aws (ONB-13 lock) so this card's fake stands on its own.
// A small DynamoDB condition-expression reader for FilterExpression and KeyConditionExpression:
// comparisons (= <> < <= > >=), BETWEEN, IN, AND, OR, NOT, parentheses, attribute_exists,
// attribute_not_exists, attribute_type, begins_with, contains and size. Names may be #aliases.
// Values stay in AttributeValue form ({ S }, { N }, ...).

function tokenize(src) {
  const out = [];
  const re = /\s*(<>|<=|>=|=|<|>|\(|\)|,|[#:]?[A-Za-z_][\w.-]*|\S)/gy;
  let m;
  while (re.lastIndex < src.length && (m = re.exec(src))) if (m[1]) out.push(m[1]);
  return out;
}

const plain = (a) => {
  if (a == null) return undefined;
  if ('S' in a) return a.S;
  if ('N' in a) return Number(a.N);
  if ('BOOL' in a) return a.BOOL;
  if ('NULL' in a) return null;
  return JSON.stringify(a);
};
const same = (a, b) => a !== undefined && b !== undefined && JSON.stringify(a) === JSON.stringify(b);

export function compile(expr, names = {}, values = {}) {
  const t = tokenize(expr ?? '');
  let i = 0;
  const peek = () => t[i];
  const take = (want) => {
    const x = t[i++];
    if (want && (x ?? '').toUpperCase() !== want) throw new Error(`fake DynamoDB: expected ${want} in "${expr}", got ${x}`);
    return x;
  };
  const path = (tok) => tok.split('.').map((p) => (p.startsWith('#') ? (names[p] ?? (() => { throw new Error(`fake DynamoDB: no name for ${p}`); })()) : p));
  const get = (row, parts) => {
    let v = row[parts[0]];
    for (const p of parts.slice(1)) v = v && v.M ? v.M[p] : undefined;
    return v;
  };
  const operand = () => {
    const tok = take();
    if (tok.startsWith(':')) {
      if (!(tok in values)) throw new Error(`fake DynamoDB: no value for ${tok}`);
      return () => values[tok];
    }
    if (tok.toLowerCase() === 'size') {
      take('(');
      const p = path(take());
      take(')');
      return (row) => {
        const v = get(row, p);
        if (!v) return undefined;
        const n = 'S' in v ? v.S.length : 'L' in v ? v.L.length : 'M' in v ? Object.keys(v.M).length : 'SS' in v ? v.SS.length : undefined;
        return n === undefined ? undefined : { N: String(n) };
      };
    }
    const p = path(tok);
    return (row) => get(row, p);
  };
  const fn = (name) => {
    take('(');
    const p = path(take());
    let arg;
    if (peek() === ',') { take(','); arg = operand(); }
    take(')');
    const n = name.toLowerCase();
    if (n === 'attribute_exists') return (row) => get(row, p) !== undefined;
    if (n === 'attribute_not_exists') return (row) => get(row, p) === undefined;
    if (n === 'attribute_type') return (row) => { const v = get(row, p); return !!v && Object.keys(v)[0] === plain(arg(row)); };
    if (n === 'begins_with') return (row) => { const v = plain(get(row, p)); return typeof v === 'string' && v.startsWith(plain(arg(row))); };
    if (n === 'contains') return (row) => {
      const v = get(row, p); const w = plain(arg(row));
      if (!v) return false;
      if ('S' in v) return v.S.includes(w);
      if ('SS' in v) return v.SS.includes(w);
      if ('L' in v) return v.L.some((x) => plain(x) === w);
      return false;
    };
    throw new Error(`fake DynamoDB: function ${name} is not supported`);
  };
  const primary = () => {
    const tok = peek();
    if (tok === '(') { take('('); const e = or(); take(')'); return e; }
    if ((tok ?? '').toUpperCase() === 'NOT') { take(); const e = primary(); return (row) => !e(row); }
    if (/^(attribute_exists|attribute_not_exists|attribute_type|begins_with|contains)$/i.test(tok ?? '') && t[i + 1] === '(') { take(); return fn(tok); }
    const left = operand();
    const op = (take() ?? '').toUpperCase();
    if (op === 'BETWEEN') {
      const lo = operand(); take('AND'); const hi = operand();
      return (row) => { const v = plain(left(row)); return v !== undefined && v >= plain(lo(row)) && v <= plain(hi(row)); };
    }
    if (op === 'IN') {
      take('(');
      const list = [operand()];
      while (peek() === ',') { take(','); list.push(operand()); }
      take(')');
      return (row) => list.some((o) => same(left(row), o(row)));
    }
    const right = operand();
    const cmp = {
      '=': (a, b) => same(a, b),
      '<>': (a, b) => a !== undefined && !same(a, b),
      '<': (a, b) => a !== undefined && plain(a) < plain(b),
      '<=': (a, b) => a !== undefined && plain(a) <= plain(b),
      '>': (a, b) => a !== undefined && plain(a) > plain(b),
      '>=': (a, b) => a !== undefined && plain(a) >= plain(b),
    }[op];
    if (!cmp) throw new Error(`fake DynamoDB: operator ${op} in "${expr}" is not supported`);
    return (row) => cmp(left(row), right(row));
  };
  const and = () => { let e = primary(); while ((peek() ?? '').toUpperCase() === 'AND') { take(); const l = e, r = primary(); e = (row) => l(row) && r(row); } return e; };
  const or = () => { let e = and(); while ((peek() ?? '').toUpperCase() === 'OR') { take(); const l = e, r = and(); e = (row) => l(row) || r(row); } return e; };
  if (!t.length) return () => true;
  const e = or();
  if (i !== t.length) throw new Error(`fake DynamoDB: could not read "${expr}" past "${t[i]}"`);
  return e;
}
