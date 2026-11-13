/**
 * A small YAML reader for GitHub workflow files: block mappings and
 * sequences, `|` and `>` block scalars, quoted and plain scalars, flow `[...]`
 * and `{...}`, comments. Scalars stay strings. No anchors, tags or documents:
 * workflows here do not use them, and this throws if it meets something it
 * does not understand rather than guess.
 *
 * Written for the OPS-05 checks because pepla-web has no YAML package.
 */

export type Yaml = string | null | Yaml[] | { [k: string]: Yaml };

type Line = { n: number; indent: number; text: string };

function stripComment(s: string): string {
  let q: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === q) {
        if (q === "'" && s[i + 1] === "'") i++;
        else q = null;
      } else if (c === '\\' && q === '"') i++;
    } else if (c === '"' || c === "'") {
      if (i === 0 || /[\s:[{,-]/.test(s[i - 1])) q = c;
    } else if (c === '#' && (i === 0 || /\s/.test(s[i - 1]))) return s.slice(0, i).trimEnd();
  }
  return s.trimEnd();
}

export function parseYaml(src: string): Yaml {
  const raw = src.replace(/\r\n/g, '\n').split('\n');
  let pos = 0;

  const peek = (): Line | undefined => {
    while (pos < raw.length) {
      const t = stripComment(raw[pos]);
      if (t.trim() === '' || t.trim() === '---') {
        pos++;
        continue;
      }
      return { n: pos, indent: t.length - t.trimStart().length, text: t.trimStart() };
    }
    return undefined;
  };

  function blockScalar(indicator: string, parentIndent: number): string {
    const keep = indicator.includes('+');
    const strip = indicator.includes('-');
    const folded = indicator.startsWith('>');
    const body: string[] = [];
    let indent = -1;
    while (pos < raw.length) {
      const l = raw[pos];
      if (l.trim() === '') {
        body.push('');
        pos++;
        continue;
      }
      const ind = l.length - l.trimStart().length;
      if (ind <= parentIndent) break;
      if (indent < 0) indent = ind;
      if (ind < indent) break;
      body.push(l.slice(indent));
      pos++;
    }
    while (body.length && body[body.length - 1] === '' && !keep) body.pop();
    let text = folded ? body.join('\n').replace(/([^\n])\n(?=[^\n ])/g, '$1 ') : body.join('\n');
    if (!strip) text += '\n';
    return text;
  }

  function scalar(s: string): Yaml {
    const t = s.trim();
    if (t === '' || t === '~' || t === 'null') return null;
    if (t.startsWith('"')) return JSON.parse(t.replace(/\\\//g, '/')) as string;
    if (t.startsWith("'")) {
      if (!t.endsWith("'")) throw new Error(`yaml-lite: unclosed quote: ${t}`);
      return t.slice(1, -1).replace(/''/g, "'");
    }
    if (t.startsWith('[') || t.startsWith('{')) return flow(t);
    if (/^[&*!]/.test(t)) throw new Error(`yaml-lite: anchors and tags are not supported: ${t}`);
    return t;
  }

  function flow(t: string): Yaml {
    let i = 0;
    const ws = () => {
      while (i < t.length && /\s/.test(t[i])) i++;
    };
    const item = (stops: string): Yaml => {
      ws();
      if (t[i] === '[') {
        i++;
        const arr: Yaml[] = [];
        ws();
        if (t[i] === ']') {
          i++;
          return arr;
        }
        for (;;) {
          arr.push(item(',]'));
          ws();
          if (t[i] === ',') {
            i++;
            continue;
          }
          if (t[i] === ']') {
            i++;
            return arr;
          }
          throw new Error(`yaml-lite: bad flow sequence: ${t}`);
        }
      }
      if (t[i] === '{') {
        i++;
        const obj: { [k: string]: Yaml } = {};
        ws();
        if (t[i] === '}') {
          i++;
          return obj;
        }
        for (;;) {
          const k = item(':,}');
          ws();
          let v: Yaml = null;
          if (t[i] === ':') {
            i++;
            v = item(',}');
          }
          obj[String(k)] = v;
          ws();
          if (t[i] === ',') {
            i++;
            continue;
          }
          if (t[i] === '}') {
            i++;
            return obj;
          }
          throw new Error(`yaml-lite: bad flow mapping: ${t}`);
        }
      }
      if (t[i] === '"' || t[i] === "'") {
        const q = t[i];
        let j = i + 1;
        while (j < t.length && t[j] !== q) j += t[j] === '\\' && q === '"' ? 2 : 1;
        const s = t.slice(i, j + 1);
        i = j + 1;
        return scalar(s);
      }
      let j = i;
      while (j < t.length && !stops.includes(t[j])) j++;
      const s = t.slice(i, j);
      i = j;
      return scalar(s);
    };
    const v = item('');
    return v;
  }

  /** Splits `key: rest` at the first `: ` (or trailing `:`) outside quotes and brackets. */
  function splitKey(text: string): [string, string] | undefined {
    let q: string | null = null;
    let depth = 0;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === q) q = null;
        continue;
      }
      if ((c === '"' || c === "'") && i === 0) q = c;
      else if ('[{'.includes(c)) depth++;
      else if (']}'.includes(c)) depth--;
      else if (c === ':' && depth === 0 && (i === text.length - 1 || text[i + 1] === ' ')) {
        let k = text.slice(0, i).trim();
        if (/^".*"$|^'.*'$/.test(k)) k = String(scalar(k));
        return [k, text.slice(i + 1).trim()];
      }
    }
    return undefined;
  }

  /** The value after `key:` or `- `: inline, block scalar, multi-line flow, or a nested block. */
  function valueAfter(rest: string, ownerIndent: number): Yaml {
    if (/^[|>][-+]?\d*$/.test(rest)) {
      pos++;
      return blockScalar(rest, ownerIndent);
    }
    if (rest === '') {
      pos++;
      const next = peek();
      if (!next) return null;
      if (next.indent > ownerIndent || (next.indent === ownerIndent && next.text.startsWith('- ') && ownerIndent >= 0)) {
        return block(next.indent);
      }
      return null;
    }
    if (rest.startsWith('[') || rest.startsWith('{')) {
      let text = rest;
      const balanced = (s: string) => {
        let d = 0;
        let q: string | null = null;
        for (const c of s) {
          if (q) {
            if (c === q) q = null;
          } else if (c === '"' || c === "'") q = c;
          else if ('[{'.includes(c)) d++;
          else if (']}'.includes(c)) d--;
        }
        return d === 0;
      };
      pos++;
      while (!balanced(text) && pos < raw.length) text += ' ' + stripComment(raw[pos++]).trim();
      return flow(text);
    }
    pos++;
    if (rest.startsWith('"') || rest.startsWith("'")) return scalar(rest);
    // Plain scalar, possibly folded over more-indented lines.
    let text = rest;
    for (let next = peek(); next && next.indent > ownerIndent && !splitKey(next.text) && !next.text.startsWith('- '); next = peek()) {
      text += ' ' + next.text;
      pos++;
    }
    return scalar(text);
  }

  function block(indent: number): Yaml {
    const first = peek();
    if (!first || first.indent < indent) return null;
    if (first.text === '-' || first.text.startsWith('- ')) {
      const arr: Yaml[] = [];
      for (let l = peek(); l && l.indent === indent && (l.text === '-' || l.text.startsWith('- ')); l = peek()) {
        const rest = l.text === '-' ? '' : l.text.slice(2);
        const inner = indent + 2 + (rest.length - rest.trimStart().length);
        if (rest.trim() !== '' && splitKey(rest.trim()) && !/^["'[{]/.test(rest.trim())) {
          // "- key: value": a mapping whose first key sits on the dash line.
          raw[l.n] = ' '.repeat(inner) + rest.trim();
          arr.push(block(inner));
        } else {
          arr.push(valueAfter(rest.trim(), indent));
        }
      }
      return arr;
    }
    const obj: { [k: string]: Yaml } = {};
    for (let l = peek(); l && l.indent === indent; l = peek()) {
      if (l.text.startsWith('- ')) break;
      const kv = splitKey(l.text);
      if (!kv) throw new Error(`yaml-lite: line ${l.n + 1} is not "key: value": ${l.text}`);
      obj[kv[0]] = valueAfter(kv[1], indent);
    }
    const after = peek();
    if (after && after.indent > indent) throw new Error(`yaml-lite: unexpected indent on line ${after.n + 1}`);
    return obj;
  }

  const first = peek();
  return first ? block(first.indent) : null;
}

export const isMap = (v: Yaml | undefined): v is { [k: string]: Yaml } => !!v && typeof v === 'object' && !Array.isArray(v);
export const asList = (v: Yaml | undefined): Yaml[] => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]);
export const str = (v: Yaml | undefined): string => (typeof v === 'string' ? v : v === null || v === undefined ? '' : JSON.stringify(v));
