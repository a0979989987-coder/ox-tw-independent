// Split a stylesheet into rules that can only match the light theme and the
// rest, without changing which declaration wins anywhere.
//
// A style rule is "light only" when every selector in its list carries a
// light marker outside any parentheses (so :not(.theme-light), :is(...) and
// :where(...) stay with the base). The light rules are emitted into a
// companion sheet placed immediately after the base sheet, i.e. after the base
// rules that originally followed them. That reordering can only change the
// cascade where a later base rule sets the same property with the same
// specificity and importance; such light rules are kept in place.
// Conditional group rules (@media, @supports, @container, @layer blocks) are
// split recursively; other at-rules stay in the base in their original order.
const LIGHT = /\.theme-light(?![\w-])|\[data-ox-theme=(?:"light"|'light'|light)\]/;
const GROUP = /^@(?:media|supports|container|layer|document)\b/i;

function skipComment(css, i) { const end = css.indexOf('*/', i + 2); return end < 0 ? css.length : end + 2; }
function skipString(css, i) { const q = css[i]; i++; while (i < css.length && css[i] !== q) { if (css[i] === '\\') i++; i++; } return i + 1; }
function parse(css) {
  const items = []; let i = 0, start = 0;
  while (i < css.length) {
    const c = css[i];
    if (c === '/' && css[i + 1] === '*') { i = skipComment(css, i); continue; }
    if (c === '"' || c === "'") { i = skipString(css, i); continue; }
    if (c === ';') { items.push({ text: css.slice(start, i + 1) }); start = ++i; continue; }
    if (c === '{') {
      const prelude = css.slice(start, i); let depth = 1, j = i + 1;
      while (j < css.length && depth) {
        const d = css[j];
        if (d === '/' && css[j + 1] === '*') { j = skipComment(css, j); continue; }
        if (d === '"' || d === "'") { j = skipString(css, j); continue; }
        if (d === '{') depth++; else if (d === '}') depth--;
        j++;
      }
      const body = css.slice(i + 1, j - 1), head = prelude.trim();
      const node = { prelude, body };
      if (head.startsWith('@') && GROUP.test(head)) node.children = parse(body);
      items.push(node);
      start = i = j; continue;
    }
    if (c === '}') { i++; start = i; continue; }
    i++;
  }
  const rest = css.slice(start);
  if (rest.trim()) items.push({ text: rest });
  return items;
}

const stripComments = text => text.replace(/\/\*[\s\S]*?\*\//g, '');
function splitTop(text, separator) {
  const parts = []; let depth = 0, last = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'") { i = skipString(text, i) - 1; continue; }
    if (c === '(' || c === '[') depth++; else if (c === ')' || c === ']') depth--;
    else if (c === separator && depth === 0) { parts.push(text.slice(last, i)); last = i + 1; }
  }
  parts.push(text.slice(last));
  return parts.map(part => part.trim()).filter(Boolean);
}
function outsideParens(selector) {
  let depth = 0, out = '';
  for (const c of selector) { if (c === '(') depth++; else if (c === ')') depth--; else if (!depth) out += c; }
  return out;
}
export function lightOnlySelector(prelude) {
  const parts = splitTop(stripComments(prelude), ',');
  return parts.length > 0 && parts.every(part => LIGHT.test(outsideParens(part)));
}

// Selector specificity [ids, classes, types] (Selectors Level 4 rules for
// :is/:not/:has = most specific argument, :where = 0).
export function specificity(selector) {
  let a = 0, b = 0, c = 0, i = 0; const s = selector.trim();
  const add = ([x, y, z]) => { a += x; b += y; c += z; };
  const argument = start => { let depth = 1, j = start; while (j < s.length && depth) { if (s[j] === '(') depth++; else if (s[j] === ')') depth--; j++; } return [s.slice(start, j - 1), j]; };
  const max = list => splitTop(list, ',').map(specificity).reduce((m, v) => compare(v, m) > 0 ? v : m, [0, 0, 0]);
  while (i < s.length) {
    const ch = s[i];
    if (ch === '#') { a++; i++; while (/[\w-]/.test(s[i] || '')) i++; continue; }
    if (ch === '.') { b++; i++; while (/[\w-]/.test(s[i] || '')) i++; continue; }
    if (ch === '[') { b++; while (i < s.length && s[i] !== ']') { if (s[i] === '"' || s[i] === "'") i = skipString(s, i); else i++; } i++; continue; }
    if (ch === ':') {
      const element = s[i + 1] === ':'; i += element ? 2 : 1;
      const start = i; while (/[\w-]/.test(s[i] || '')) i++;
      const name = s.slice(start, i).toLowerCase();
      if (s[i] === '(') {
        const [arg, next] = argument(i + 1); i = next;
        if (name === 'where') continue;
        if (['is', 'not', 'has', 'matches', '-webkit-any', 'any'].includes(name)) { add(max(arg)); continue; }
        if (['nth-child', 'nth-last-child'].includes(name)) { b++; const of = arg.split(/\s+of\s+/i)[1]; if (of) add(max(of)); continue; }
        if (element) c++; else b++;
        continue;
      }
      if (element || ['before', 'after', 'first-line', 'first-letter'].includes(name)) c++; else b++;
      continue;
    }
    if (/[a-zA-Z]/.test(ch)) { c++; while (/[\w-]/.test(s[i] || '')) i++; continue; }
    if (ch === '*') { i++; continue; }
    i++;
  }
  return [a, b, c];
}
const compare = (x, y) => x[0] - y[0] || x[1] - y[1] || x[2] - y[2];

// Coarse property families: a shorthand and its longhands share a family.
function family(property) {
  const p = property.trim().toLowerCase().replace(/^-(?:webkit|moz|ms|o)-/, '');
  if (p.startsWith('--')) return p;
  if (/^(?:top|right|bottom|left|inset)/.test(p)) return 'inset';
  if (/^(?:row-gap|column-gap|gap|grid-gap|grid-row-gap|grid-column-gap)$/.test(p)) return 'gap';
  if (/^(?:place|align|justify)-/.test(p)) return 'alignment';
  if (/^(?:overflow|text-overflow)/.test(p)) return p.split('-')[0];
  return p.split('-')[0];
}
function declarations(body) {
  const out = [];
  for (const part of splitTop(stripComments(body), ';')) {
    const colon = part.indexOf(':'); if (colon < 1) continue;
    out.push({ family: family(part.slice(0, colon)), important: /!\s*important\s*$/i.test(part) });
  }
  return out;
}

function flatten(items, list = []) {
  for (const item of items) {
    if (item.children) { flatten(item.children, list); continue; }
    if (!('body' in item) || item.prelude.trim().startsWith('@')) continue;
    const selectors = splitTop(stripComments(item.prelude), ',');
    item.rule = { light: lightOnlySelector(item.prelude), specificities: selectors.map(specificity), decls: declarations(item.body) };
    list.push(item);
  }
  return list;
}

function markMovable(items) {
  const rules = flatten(items);
  // For every later base rule: families → set of "important:specificity" keys.
  const later = new Map(); let moved = 0, kept = 0;
  for (let index = rules.length - 1; index >= 0; index--) {
    const node = rules[index], rule = node.rule;
    if (rule.light) {
      const clash = rule.decls.some(d => {
        const seen = later.get(d.family); if (!seen) return false;
        return rule.specificities.some(spec => seen.has(`${d.important}:${spec.join(',')}`));
      });
      if (clash) kept++; else { node.moved = true; moved++; }
    }
    if (!node.moved) for (const d of rule.decls) {
      if (!later.has(d.family)) later.set(d.family, new Set());
      for (const spec of rule.specificities) later.get(d.family).add(`${d.important}:${spec.join(',')}`);
    }
  }
  return { moved, kept };
}

function emit(items) {
  let base = '', light = '';
  for (const item of items) {
    if (!('body' in item)) { base += item.text; continue; }
    if (item.children) {
      const inner = emit(item.children);
      if (inner.base.trim()) base += `${item.prelude}{${inner.base}}`;
      if (inner.light.trim()) light += `${item.prelude.trim()}{${inner.light}}`;
      continue;
    }
    if (item.moved) light += `${item.prelude.trim()}{${item.body}}\n`;
    else base += `${item.prelude}{${item.body}}`;
  }
  return { base, light };
}

export function splitThemeCSS(css) {
  const items = parse(css);
  const stats = markMovable(items);
  return { ...emit(items), stats };
}
