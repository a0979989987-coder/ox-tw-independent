// Incremental reader for a pattern chunk {"date",…,"entries":[{"key":…},…]}.
// Each stock is parsed as soon as the next one begins, so the first stocks are
// classified while the rest of the chunk (≈6 MB of JSON) is still downloading.
// Stock boundaries are found with a native search for `},{"key":`, never by
// reading every character in script; a boundary inside a string fails to
// parse and is skipped. Anything else (another layout, keys after "entries")
// is parsed once at the end, so the result always equals JSON.parse.
// The header (keys before "entries") is reported before the first stock; when
// it lacks "date", stocks are held until the end.
const QUOTE = 34, BACKSLASH = 92, OPEN_OBJECT = 123, CLOSE_OBJECT = 125, OPEN_ARRAY = 91, CLOSE_ARRAY = 93, COLON = 58;
const BOUNDARY = '},{"key":';
export function createEntryParser({ onHeader = () => {}, onEntry = () => {} } = {}) {
  let stage = 'head', depth = 0, inString = false, escaped = false;
  let head = '', at = 0, keyStart = -1, keyEnd = -1, lastKey = '', entriesKey = -1;
  let parts = [], length = 0, carry = '', prefix = null, reported = false;
  const held = [];
  const deliver = entry => { if (reported) onEntry(entry); else held.push(entry); };
  // The header is small: read it character by character up to `"entries":[`.
  function readHead(block) {
    head += block;
    for (; at < head.length; at++) {
      const code = head.charCodeAt(at);
      if (inString) {
        if (escaped) escaped = false; else if (code === BACKSLASH) escaped = true;
        else if (code === QUOTE) { inString = false; if (depth === 1) keyEnd = at; }
        continue;
      }
      if (code === QUOTE) { inString = true; if (depth === 1) keyStart = at; continue; }
      if (code === COLON && depth === 1 && keyEnd > keyStart) { lastKey = head.slice(keyStart + 1, keyEnd); if (lastKey === 'entries') entriesKey = keyStart; continue; }
      if (code === OPEN_ARRAY && depth === 1 && lastKey === 'entries') {
        prefix = JSON.parse(head.slice(0, entriesKey).replace(/,\s*$/, '') + '}');
        if (prefix.date !== undefined) { reported = true; onHeader(prefix); }
        stage = 'entries'; const rest = head.slice(at + 1); head = ''; readEntries(rest); return;
      }
      if (depth === 1 && lastKey === 'entries' && code > 32) lastKey = '';
      if (code === OPEN_OBJECT || code === OPEN_ARRAY) depth++;
      else if (code === CLOSE_OBJECT || code === CLOSE_ARRAY) depth--;
    }
  }
  // Blocks are kept as parts and joined only when a stock is complete, so tiny
  // network blocks never make the search quadratic.
  function readEntries(block) {
    let window = carry + block, offset = length - carry.length, from = 0;
    parts.push(block); length += block.length;
    for (;;) {
      const found = window.indexOf(BOUNDARY, from);
      if (found < 0) break;
      const body = parts.join(''), cut = offset + found + 1;
      let entry;
      try { entry = JSON.parse(body.slice(0, cut)); } catch { parts = [body]; from = found + 1; continue; }
      const rest = body.slice(cut + 1); parts = [rest]; length = rest.length;
      window = window.slice(found + 2); offset = length - window.length; from = 0;
      deliver(entry);
    }
    carry = window.slice(-(BOUNDARY.length - 1));
  }
  function push(block) {
    if (!block) return;
    if (stage === 'head') readHead(block); else readEntries(block);
  }
  function end() {
    if (stage === 'head') throw Error('分類資料格式異常');
    // The remaining stock(s), the closing `]` and any keys after "entries".
    const body = parts.join('');
    let close = body.lastIndexOf(']'), rest = null, extra = {};
    while (close >= 0) {
      try { rest = JSON.parse('[' + body.slice(0, close) + ']'); const tail = body.slice(close + 1).trim().replace(/}$/, '').replace(/^,/, '').trim(); extra = tail ? JSON.parse('{' + tail + '}') : {}; break; }
      catch { rest = null; close = body.lastIndexOf(']', close - 1); }
    }
    if (!rest) throw Error('分類資料不完整');
    for (const entry of rest) deliver(entry);
    parts = []; length = 0; carry = '';
    const header = { ...prefix, ...extra };
    if (!reported) { reported = true; onHeader(header); for (const entry of held.splice(0)) onEntry(entry); }
    return header;
  }
  return { push, end };
}
