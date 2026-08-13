// Loads functions out of dashboard.html so they can be tested directly.
//
// The app is a single HTML file with one big inline script that touches the
// DOM and Supabase as soon as it runs, so it cannot simply be imported. This
// pulls out individual functions by name and evaluates only those, against the
// small stubs below. Tests therefore cover pure logic — parsing, P&L, dedup
// rules — which is where every calculation bug this suite guards against lived.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
export const SOURCE = readFileSync(join(ROOT, 'dashboard.html'), 'utf8');

// Pull `function name(...) { ... }` out of the source by matching braces. Skips
// occurrences inside the seed-data blob, which never contains a declaration.
export function extractFunction(name) {
  const start = SOURCE.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`function ${name} not found in dashboard.html`);
  let i = SOURCE.indexOf('{', start);
  if (i === -1) throw new Error(`no body for ${name}`);
  // Comments must be skipped, not scanned: an apostrophe in prose ("IBKR's
  // router") would otherwise read as the start of a string literal and throw
  // the brace count off for the rest of the function.
  let depth = 0, inStr = null, escaped = false;
  for (; i < SOURCE.length; i++) {
    const c = SOURCE[i], next = SOURCE[i + 1];
    if (inStr) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === inStr) inStr = null;
      continue;
    }
    if (c === '/' && next === '/') { i = SOURCE.indexOf('\n', i); if (i === -1) break; continue; }
    if (c === '/' && next === '*') { i = SOURCE.indexOf('*/', i) + 1; continue; }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return SOURCE.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced braces reading ${name}`);
}

// Minimal DOMParser covering what flexParseXML asks of it: find every <Trade>
// / <TradeConfirm> element and read its attributes.
class StubElement {
  constructor(attrs) { this._a = attrs; }
  getAttribute(k) { return Object.prototype.hasOwnProperty.call(this._a, k) ? this._a[k] : null; }
}
class StubDocument {
  constructor(xml) { this._xml = xml; }
  querySelectorAll(selector) {
    const tags = selector.split(',').map(s => s.trim());
    const out = [];
    for (const tag of tags) {
      const re = new RegExp(`<${tag}\\s+([^>]*?)/?>`, 'g');
      let m;
      while ((m = re.exec(this._xml))) {
        const attrs = {};
        const ar = /([\w:.-]+)="([^"]*)"/g;
        let a;
        while ((a = ar.exec(m[1]))) attrs[a[1]] = a[2];
        out.push(new StubElement(attrs));
      }
    }
    return out;
  }
}
export class DOMParser {
  parseFromString(xml) { return new StubDocument(xml); }
}

// Evaluate the named functions together (so they can call each other) and hand
// them back. Anything they reference beyond each other must be stubbed here.
export function load(...names) {
  const src = names.map(extractFunction).join('\n');
  const factory = new Function('DOMParser', `${src}\nreturn { ${names.join(', ')} };`);
  return factory(DOMParser);
}
