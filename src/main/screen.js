'use strict';
// A terminal screen, cell by cell, for reading what a program in a
// pseudo-console (pty.js) shows. Windows' pseudo-console only sends what
// changed on its own screen: a cell that already holds the right character is
// skipped with a cursor move ("Press En␛[1Cer to continue" when a "t" was
// already there). So its output can't be read as text; it has to be played
// onto a screen, as a terminal does, and read from there.
//
// It follows what the pseudo-console sends: printing (with line wrap), cursor
// moves, erasing and inserting, scrolling and scroll regions, the alternate
// screen, saving the cursor, and hyperlinks (OSC 8), which each cell keeps.
// Colours and other styles are ignored. Lines that scroll off the top of the
// main screen are kept (`history`), so text printed a moment ago can still be
// found.

const MAX_HISTORY = 2000;
const MAX_PENDING = 8192; // an unfinished escape sequence longer than this is dropped
const MAX_STRING = 4096; // what is kept of a string sequence (a hyperlink, a title); the rest is skipped

// How many cells a character takes, as Windows' console counts them (the
// pseudo-console's cursor moves follow that): two for East Asian wide
// characters and emoji shown as emoji, one for the rest. Each code point takes
// its own cells there, combining marks and variation selectors too (measured
// on Windows 11 build 26200's console).
const WIDE_RE = /[\u1100-\u115F\u2E80-\u303E\u3041-\u33FF\u3400-\u4DBF\u4E00-\u9FFF\uA000-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6\u{20000}-\u{3FFFD}]|\p{Emoji_Presentation}/u;
const STRING_END_RE = /[\x07\x1b\x18\x1a]/g; // what can end a string sequence: BEL, ESC (\), CAN, SUB

function blankRow(cols) {
  return { ch: new Array(cols).fill(' '), link: new Array(cols).fill(0), wrapped: false };
}

class Screen {
  constructor(cols = 200, rows = 50) {
    this.cols = cols;
    this.rows = rows;
    this.main = Array.from({ length: rows }, () => blankRow(cols));
    this.alt = null; // the alternate screen, while it is on
    this.history = []; // lines scrolled off the top of the main screen, oldest first
    this.x = 0;
    this.y = 0;
    this.saved = { x: 0, y: 0 };
    this.top = 0; // scroll region, inclusive
    this.bottom = rows - 1;
    this.urls = ['']; // hyperlink id -> url (0: none)
    this.linkId = 0; // the hyperlink being printed
    this.pending = ''; // an escape sequence cut off at the end of the last chunk
    this.str = null; // a string sequence (OSC, DCS…) still being read: { kind, body }
    this.version = 0; // goes up with every write
  }

  get grid() {
    return this.alt || this.main;
  }

  // ── Input ─────────────────────────────────────────────────────────────────

  write(chunk) {
    const s = this.pending + chunk;
    this.pending = '';
    this.version++;
    let i = 0;
    while (i < s.length) {
      if (this.str) {
        i = this.string(s, i);
        continue;
      }
      const c = s[i];
      if (c === '\x1b') {
        if (i + 1 < s.length && ']PX^_'.includes(s[i + 1])) {
          // A string: read on (across chunks too) until it ends.
          this.str = { kind: s[i + 1], body: '' };
          i += 2;
          continue;
        }
        const n = this.escape(s, i);
        if (n === 0) {
          // Unfinished: keep it for the next chunk, unless it's hopeless.
          if (s.length - i < MAX_PENDING) this.pending = s.slice(i);
          break;
        }
        i += n;
        continue;
      }
      const code = s.codePointAt(i);
      const len = code > 0xffff ? 2 : 1;
      if (code < 0x20 || code === 0x7f) this.control(c);
      else if (code >= 0x80 && code < 0xa0) { /* C1 controls: ignored */ } else this.print(s.slice(i, i + len));
      i += len;
    }
  }

  /** Handles the escape sequence at s[i]; returns its length, or 0 if it isn't complete yet. */
  escape(s, i) {
    if (i + 1 >= s.length) return 0;
    const k = s[i + 1];
    if (k === '[') {
      let j = i + 2;
      while (j < s.length && s.charCodeAt(j) >= 0x30 && s.charCodeAt(j) <= 0x3f) j++; // parameters
      while (j < s.length && s.charCodeAt(j) >= 0x20 && s.charCodeAt(j) <= 0x2f) j++; // intermediates
      if (j >= s.length) return 0;
      const final = s[j];
      if (final.charCodeAt(0) < 0x40 || final.charCodeAt(0) > 0x7e) return j - i; // malformed: drop it
      this.csi(s.slice(i + 2, j), final);
      return j + 1 - i;
    }
    if ('()*+-./'.includes(k)) return i + 2 < s.length ? 3 : 0; // character set: ignored
    if (k === '#' || k === '%' || k === ' ') return i + 2 < s.length ? 3 : 0;
    switch (k) {
      case '7': this.saved = { x: this.x, y: this.y }; break;
      case '8': this.x = this.saved.x; this.y = this.saved.y; break;
      case 'D': this.lineFeed(); break;
      case 'E': this.x = 0; this.lineFeed(); break;
      case 'M': this.reverseIndex(); break;
      case 'c': this.reset(); break;
      default: break; // keypad modes, ST on its own and the like
    }
    return 2;
  }

  /**
   * Reads on in the string sequence begun earlier, from s[i]; returns where
   * reading goes on. It ends at ST (ESC \), BEL (OSC), or CAN/SUB; an ESC
   * followed by anything else ends it too and starts a sequence of its own.
   * Only the first MAX_STRING characters are kept: a long one (the clipboard,
   * OSC 52) is skipped, never shown.
   */
  string(s, i) {
    const st = this.str;
    STRING_END_RE.lastIndex = i;
    const m = STRING_END_RE.exec(s);
    const j = m ? m.index : s.length;
    if (st.body.length < MAX_STRING) st.body += s.slice(i, Math.min(j, i + MAX_STRING - st.body.length));
    if (!m) return s.length;
    const c = s[j];
    if (c === '\x1b') {
      if (j + 1 >= s.length) {
        this.pending = '\x1b'; // ST or not: the next chunk says
        return s.length;
      }
      this.str = null;
      if (s[j + 1] !== '\\') return j; // aborted: the ESC begins something else
      if (st.kind === ']') this.osc(st.body);
      return j + 2;
    }
    if (c === '\x07' && st.kind !== ']') return j + 1; // BEL ends only an OSC
    this.str = null;
    if (c === '\x07') this.osc(st.body);
    return j + 1;
  }

  control(c) {
    switch (c) {
      case '\r': this.x = 0; break;
      case '\n': case '\x0b': case '\x0c': this.lineFeed(); break;
      case '\b': this.x = Math.max(0, Math.min(this.x, this.cols - 1) - 1); break;
      case '\t': this.x = Math.min(this.cols - 1, (Math.floor(this.x / 8) + 1) * 8); break;
      default: break;
    }
  }

  print(ch) {
    const wide = WIDE_RE.test(ch) ? 2 : 1;
    if (this.x + wide > this.cols) {
      // Past the right edge: carry on at the start of the next line.
      this.grid[this.y].wrapped = true;
      this.x = 0;
      this.lineFeed();
    }
    const row = this.grid[this.y];
    row.ch[this.x] = ch;
    row.link[this.x] = this.linkId;
    if (wide === 2) {
      row.ch[this.x + 1] = '';
      row.link[this.x + 1] = this.linkId;
    }
    this.x += wide; // may equal cols: the next character wraps first
  }

  csi(params, final) {
    const priv = /^[?<=>]/.test(params) ? params[0] : '';
    const nums = (priv ? params.slice(1) : params).split(';').map((p) => (p === '' ? null : Number.parseInt(p, 10)));
    const n = (i, d = 1) => (nums[i] == null || Number.isNaN(nums[i]) || nums[i] === 0 ? d : nums[i]);
    const arg = (i) => (nums[i] == null || Number.isNaN(nums[i]) ? 0 : nums[i]);
    if (priv === '?') {
      if (final === 'h' || final === 'l') for (const m of nums) this.mode(m, final === 'h');
      return;
    }
    if (priv) return; // queries and keyboard modes: nothing on screen
    const clampX = () => { this.x = Math.max(0, Math.min(this.cols - 1, this.x)); };
    switch (final) {
      case 'A': this.y = Math.max(this.y >= this.top ? this.top : 0, this.y - n(0)); clampX(); break;
      case 'B': this.y = Math.min(this.y <= this.bottom ? this.bottom : this.rows - 1, this.y + n(0)); clampX(); break;
      case 'C': case 'a': this.x = Math.min(this.cols - 1, this.x + n(0)); break;
      case 'D': this.x = Math.max(0, Math.min(this.x, this.cols - 1) - n(0)); break;
      case 'E': this.y = Math.min(this.rows - 1, this.y + n(0)); this.x = 0; break;
      case 'F': this.y = Math.max(0, this.y - n(0)); this.x = 0; break;
      case 'G': case '`': this.x = Math.min(this.cols - 1, n(0) - 1); break;
      case 'H': case 'f': this.y = Math.min(this.rows - 1, n(0) - 1); this.x = Math.min(this.cols - 1, n(1) - 1); break;
      case 'd': this.y = Math.min(this.rows - 1, n(0) - 1); clampX(); break;
      case 'e': this.y = Math.min(this.rows - 1, this.y + n(0)); clampX(); break;
      case 'J': this.eraseDisplay(arg(0)); break;
      case 'K': this.eraseLine(arg(0)); break;
      case 'X': { clampX(); this.blank(this.y, this.x, Math.min(this.cols, this.x + n(0))); break; }
      case 'P': this.deleteChars(n(0)); break;
      case '@': this.insertChars(n(0)); break;
      case 'L': this.insertLines(n(0)); break;
      case 'M': this.deleteLines(n(0)); break;
      case 'S': this.scrollUp(n(0)); break;
      case 'T': this.scrollDown(n(0)); break;
      case 'r': {
        const top = n(0) - 1;
        const bottom = Math.min(this.rows, n(1, this.rows)) - 1;
        if (top < bottom) { this.top = top; this.bottom = bottom; }
        this.x = 0;
        this.y = 0;
        break;
      }
      case 's': this.saved = { x: this.x, y: this.y }; break;
      case 'u': this.x = this.saved.x; this.y = this.saved.y; break;
      default: break; // styles (m) and reports: nothing to draw
    }
  }

  mode(m, on) {
    if (m === 1049 || m === 1047 || m === 47) {
      if (on && !this.alt) {
        if (m === 1049) this.saved = { x: this.x, y: this.y };
        this.alt = Array.from({ length: this.rows }, () => blankRow(this.cols));
      } else if (!on && this.alt) {
        this.alt = null;
        if (m === 1049) { this.x = this.saved.x; this.y = this.saved.y; }
      }
    }
  }

  osc(body) {
    const semi = body.indexOf(';');
    const cmd = semi === -1 ? body : body.slice(0, semi);
    if (cmd !== '8') return; // window titles and the like
    // 8;params;url starts a hyperlink, 8;; ends it.
    const rest = body.slice(semi + 1);
    const url = rest.slice(rest.indexOf(';') + 1);
    if (!url) { this.linkId = 0; return; }
    let id = this.urls.indexOf(url);
    if (id === -1) {
      id = this.urls.length;
      this.urls.push(url);
    }
    this.linkId = id;
  }

  reset() {
    const { cols, rows } = this;
    Object.assign(this, new Screen(cols, rows), { history: this.history, version: this.version });
  }

  // ── Editing ───────────────────────────────────────────────────────────────

  blank(y, from, to) {
    const row = this.grid[y];
    for (let x = Math.max(0, from); x < Math.min(this.cols, to); x++) {
      row.ch[x] = ' ';
      row.link[x] = 0;
    }
    if (to >= this.cols) row.wrapped = false;
  }

  eraseDisplay(how) {
    const y = Math.min(this.y, this.rows - 1);
    const x = Math.min(this.x, this.cols);
    if (how === 0) {
      this.blank(y, x, this.cols);
      for (let r = y + 1; r < this.rows; r++) this.grid[r] = blankRow(this.cols);
    } else if (how === 1) {
      for (let r = 0; r < y; r++) this.grid[r] = blankRow(this.cols);
      this.blank(y, 0, x + 1);
    } else if (how === 3) {
      this.history = []; // the lines scrolled off; the screen stays
    } else {
      for (let r = 0; r < this.rows; r++) this.grid[r] = blankRow(this.cols);
    }
  }

  eraseLine(how) {
    const x = Math.min(this.x, this.cols);
    if (how === 0) this.blank(this.y, x, this.cols);
    else if (how === 1) this.blank(this.y, 0, x + 1);
    else this.blank(this.y, 0, this.cols);
  }

  deleteChars(n) {
    const row = this.grid[this.y];
    const x = Math.min(this.x, this.cols - 1);
    const k = Math.min(n, this.cols - x);
    row.ch.splice(x, k);
    row.link.splice(x, k);
    for (let i = 0; i < k; i++) { row.ch.push(' '); row.link.push(0); }
  }

  insertChars(n) {
    const row = this.grid[this.y];
    const x = Math.min(this.x, this.cols - 1);
    const k = Math.min(n, this.cols - x);
    row.ch.splice(x, 0, ...new Array(k).fill(' '));
    row.link.splice(x, 0, ...new Array(k).fill(0));
    row.ch.length = this.cols;
    row.link.length = this.cols;
  }

  insertLines(n) {
    if (this.y < this.top || this.y > this.bottom) return;
    const g = this.grid;
    for (let i = 0; i < n; i++) {
      g.splice(this.bottom, 1);
      g.splice(this.y, 0, blankRow(this.cols));
    }
    this.x = 0;
  }

  deleteLines(n) {
    if (this.y < this.top || this.y > this.bottom) return;
    const g = this.grid;
    for (let i = 0; i < n; i++) {
      g.splice(this.y, 1);
      g.splice(this.bottom, 0, blankRow(this.cols));
    }
    this.x = 0;
  }

  scrollUp(n) {
    const g = this.grid;
    for (let i = 0; i < n; i++) {
      const [gone] = g.splice(this.top, 1);
      g.splice(this.bottom, 0, blankRow(this.cols));
      if (!this.alt && this.top === 0) {
        this.history.push(gone);
        if (this.history.length > MAX_HISTORY) this.history.shift();
      }
    }
  }

  scrollDown(n) {
    const g = this.grid;
    for (let i = 0; i < n; i++) {
      g.splice(this.bottom, 1);
      g.splice(this.top, 0, blankRow(this.cols));
    }
  }

  lineFeed() {
    if (this.y === this.bottom) this.scrollUp(1);
    else if (this.y < this.rows - 1) this.y++;
  }

  reverseIndex() {
    if (this.y === this.top) this.scrollDown(1);
    else if (this.y > 0) this.y--;
  }

  // ── Reading ───────────────────────────────────────────────────────────────

  /** The screen's rows as text, without trailing spaces. */
  lines() {
    return this.grid.map(rowText);
  }

  /**
   * The screen as lines the program wrote: rows it wrapped are joined again.
   * With `history`, lines that scrolled off the top come first.
   */
  text({ history = false } = {}) {
    const rows = history && !this.alt ? [...this.history, ...this.grid] : this.grid;
    const out = [];
    let cur = '';
    for (const r of rows) {
      cur += rowText(r, !r.wrapped);
      if (!r.wrapped) {
        out.push(cur);
        cur = '';
      }
    }
    if (cur) out.push(cur);
    return out.join('\n');
  }

  /** The hyperlinks on the screen: { url, text }, in reading order. */
  links() {
    const out = [];
    for (const row of this.grid) {
      let x = 0;
      while (x < this.cols) {
        const id = row.link[x];
        if (!id) { x++; continue; }
        let end = x;
        while (end < this.cols && row.link[end] === id) end++;
        out.push({ url: this.urls[id], text: row.ch.slice(x, end).join('').trim() });
        x = end;
      }
    }
    return out;
  }
}

function rowText(row, trim = true) {
  const s = row.ch.join('');
  return trim ? s.replace(/\s+$/, '') : s;
}

module.exports = { Screen };
