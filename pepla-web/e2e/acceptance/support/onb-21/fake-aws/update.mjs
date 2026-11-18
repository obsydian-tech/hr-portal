// A DynamoDB UpdateExpression applier: SET (a = :v, a = b + :n, a = b - :n, if_not_exists(path, :v),
// list_append(x, y)), REMOVE, ADD (numbers and sets) and DELETE (sets). Names may be #aliases, values
// stay in AttributeValue form. Nested paths (a.b) are supported on maps.

const CLAUSE = /\b(SET|REMOVE|ADD|DELETE)\b/gi;

/** Splits on commas that are not inside parentheses. */
function splitTop(src) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const c of src) {
    if (c === '(') depth++;
    if (c === ')') depth--;
    if (c === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
    } else cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

export function applyUpdate(item, expr, names = {}, values = {}) {
  const row = JSON.parse(JSON.stringify(item ?? {}));
  const path = (tok) => tok.trim().split('.').map((p) => (p.startsWith('#') ? (names[p] ?? (() => { throw new Error(`fake DynamoDB: no name for ${p}`); })()) : p));
  const get = (parts) => {
    let v = row[parts[0]];
    for (const p of parts.slice(1)) v = v && v.M ? v.M[p] : undefined;
    return v;
  };
  const put = (parts, v) => {
    if (parts.length === 1) { row[parts[0]] = v; return; }
    let m = row[parts[0]];
    if (!m || !m.M) throw new Error(`fake DynamoDB: ${parts[0]} is not a map`);
    for (const p of parts.slice(1, -1)) { m = m.M[p]; if (!m || !m.M) throw new Error(`fake DynamoDB: ${p} is not a map`); }
    m.M[parts[parts.length - 1]] = v;
  };
  const drop = (parts) => {
    if (parts.length === 1) { delete row[parts[0]]; return; }
    let m = row[parts[0]];
    for (const p of parts.slice(1, -1)) m = m?.M?.[p];
    if (m?.M) delete m.M[parts[parts.length - 1]];
  };
  const value = (tok) => {
    tok = tok.trim();
    if (tok.startsWith(':')) {
      if (!(tok in values)) throw new Error(`fake DynamoDB: no value for ${tok}`);
      return values[tok];
    }
    const fn = /^(if_not_exists|list_append)\s*\(([\s\S]*)\)$/i.exec(tok);
    if (fn) {
      const [a, b] = splitTop(fn[2]);
      if (fn[1].toLowerCase() === 'if_not_exists') return get(path(a)) ?? value(b);
      const x = value(a), y = value(b);
      return { L: [...(x?.L ?? []), ...(y?.L ?? [])] };
    }
    return get(path(tok));
  };
  const arith = (src) => {
    // a + b or a - b at the top level (outside parentheses)
    let depth = 0;
    for (let i = src.length - 1; i > 0; i--) {
      const c = src[i];
      if (c === ')') depth++;
      if (c === '(') depth--;
      if (depth === 0 && (c === '+' || c === '-') && /\s/.test(src[i - 1] ?? '') ) {
        const l = value(src.slice(0, i)), r = value(src.slice(i + 1));
        if (!l || !r || !('N' in l) || !('N' in r)) throw new Error(`fake DynamoDB: ${src} needs two numbers`);
        return { N: String(c === '+' ? Number(l.N) + Number(r.N) : Number(l.N) - Number(r.N)) };
      }
    }
    return value(src);
  };

  const marks = [...String(expr ?? '').matchAll(CLAUSE)];
  if (!marks.length) throw new Error(`fake DynamoDB: cannot read UpdateExpression "${expr}"`);
  marks.forEach((m, n) => {
    const body = expr.slice(m.index + m[0].length, n + 1 < marks.length ? marks[n + 1].index : expr.length);
    const kind = m[1].toUpperCase();
    for (const part of splitTop(body)) {
      if (kind === 'SET') {
        const eq = part.indexOf('=');
        if (eq < 0) throw new Error(`fake DynamoDB: SET needs "=" in "${part}"`);
        const v = arith(part.slice(eq + 1).trim());
        if (v === undefined) throw new Error(`fake DynamoDB: SET ${part}: the value does not exist`);
        put(path(part.slice(0, eq)), v);
      } else if (kind === 'REMOVE') {
        drop(path(part));
      } else {
        const [p, vTok] = part.split(/\s+/);
        const parts = path(p);
        const v = value(vTok);
        const cur = get(parts);
        if (kind === 'ADD') {
          if ('N' in v) put(parts, { N: String(Number(cur?.N ?? 0) + Number(v.N)) });
          else if ('SS' in v) put(parts, { SS: [...new Set([...(cur?.SS ?? []), ...v.SS])] });
          else throw new Error('fake DynamoDB: ADD takes a number or a string set');
        } else {
          if (cur && 'SS' in cur) put(parts, { SS: cur.SS.filter((s) => !v.SS.includes(s)) });
        }
      }
    }
  });
  return row;
}
