'use strict';
// Claude Code Remote Control sessions that Flock starts for the phone, run in
// a pseudo-console (pty.js) under one account's Claude Code sign-in. Two kinds:
//   folder   `claude remote-control` in a folder: a server that starts with one
//            session and lets the phone add more there from the Claude app.
//   session  `claude --resume <conversation> --remote-control`: an existing
//            Code session reopened with Remote Control on (or a copy of it, when
//            Claude's window may still be using it), so it carries on from the
//            phone with all its history.
//   new      `claude --remote-control <name>`: a new conversation under the
//            name the phone gave it, with an id of Flock's (`conversation`) so
//            it can be reopened later with --resume. (A server's own session
//            can't be named reliably: a server brings back the folder's last
//            session for a few hours, with that session's name.)
// Claude Code asks what it asks in a terminal: once per sign-in whether to turn
// Remote Control on, and whether to trust a folder it hasn't seen. Flock passes
// those questions to the phone word for word and types only the phone's
// answer; it never answers them itself.
//
// What Claude Code shows is read back from its screen: "Ready · <folder>", the
// link that opens the folder in the Claude app, and each session's link (as a
// terminal hyperlink titled with the session's name, or as plain text).

const path = require('path');
const pty = require('./pty');
const { log } = require('./log');
const { pathKey } = require('./util');

const START_TIMEOUT = 90 * 1000; // neither a question nor "Ready" by then: give up
const ANSWER_TIMEOUT = 15 * 60 * 1000; // a question nobody answers stops it
const STOP_GRACE = 4000; // after Ctrl+C, before it is stopped outright
const KEEP_ENDED = 30 * 60 * 1000; // how long a stopped one stays listed
const MAX_LIVE = 8;
const MAX_TEXT = 64 * 1024;

const ENV_URL_RE = /https:\/\/claude\.ai\/code\?environment=env_[A-Za-z0-9]+/g;
const SESSION_URL_RE = /^https:\/\/claude\.ai\/code\/session_[A-Za-z0-9]+/;
const SESSION_URL_TEXT_RE = /https:\/\/claude\.ai\/code\/session_[A-Za-z0-9]+/g;
const READY_RE = /(?:^|[\s·])(Ready|Connected) · /m;
const RC_ON_RE = /remote-control is active/i;
const RC_FAILED_RE = /Remote Control (?:failed|disconnected)[^\n]*/;
const ERROR_RE = /^\s*(?:Error: .+|Remote Control did not start: .+|You must be logged in.+|No conversation found.+|.*Remote Control (?:requires|isn't enabled|is disabled|is only available).+)$/gm;
const STATUS_WORDS = new Set(['attached', 'detached', 'connecting', 'connected', 'idle', 'running', 'working', 'waiting']);
const KEYS = { up: '\x1b[A', down: '\x1b[B', enter: '\r', esc: '\x1b', ctrlC: '\x03' };

const servers = new Map(); // id -> server
let seq = 0;
let onChange = () => {};

const live = (s) => s.status === 'starting' || s.status === 'asking' || s.status === 'ready';
const interactive = (s) => s.kind !== 'folder'; // one conversation in Claude Code's full-screen view, not a server

// ── Reading the screen ──────────────────────────────────────────────────────

/**
 * Turns terminal output into plain text, collecting its hyperlinks (OSC 8).
 * A jump to another row becomes a line break, a move to the right becomes
 * spaces, and erasing the screen below the cursor or all of it (a redraw)
 * becomes a form feed, so the text after the last one is what the screen
 * shows now.
 */
function feed(s, chunk) {
  const str = s.carry + chunk;
  s.carry = '';
  let out = '';
  let i = 0;
  while (i < str.length) {
    const c = str[i];
    if (c === '\x1b') {
      const rest = str.slice(i, i + 4096);
      if (rest.length < 2) { s.carry = str.slice(i); break; }
      if (rest[1] === ']') {
        const end = rest.search(/\x07|\x1b\\/);
        if (end === -1) {
          if (str.length - i < 4096) { s.carry = str.slice(i); break; }
          i += 2;
          continue;
        }
        const body = rest.slice(2, end);
        if (body.startsWith('8;')) {
          const url = body.slice(body.indexOf(';', 2) + 1);
          if (url) s.link = { url, text: '' };
          else if (s.link) { s.links.push({ url: s.link.url, text: s.link.text.trim(), frame: s.frame }); s.link = null; }
        }
        i += end + (rest[end] === '\x07' ? 1 : 2);
        continue;
      }
      if (rest[1] === '[') {
        const m = /^\x1b\[([0-9;?<=>]*)[ -/]*([@-~])/.exec(rest);
        if (!m) {
          if (str.length - i < 64) { s.carry = str.slice(i); break; }
          i += 2;
          continue;
        }
        if (m[2] === 'H' || m[2] === 'f') out += '\n';
        else if (m[2] === 'J') { out += '\f'; s.frame++; }
        // The pseudo-console sends runs of spaces as cursor moves to the right.
        else if (m[2] === 'C') out += ' '.repeat(Math.min(200, Number(m[1]) || 1));
        else if (m[2] === 'G') out += ' ';
        i += m[0].length;
        continue;
      }
      i += rest[1] === '(' || rest[1] === ')' ? 3 : 2;
      continue;
    }
    if (c === '\n' || c === '\t' || c >= ' ') {
      out += c;
      if (s.link && c !== '\n') s.link.text += c;
    }
    i++;
  }
  const all = s.text + out;
  const over = Math.max(0, all.length - MAX_TEXT);
  s.text = all.slice(over);
  s.base += over; // where s.text starts in everything shown so far
}

function tidy(text) {
  return text.replace(/\f/g, '\n').replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
}

function since(s) {
  return s.text.slice(Math.max(0, s.answered - s.base));
}

/** A typed question (`… [y/N]`) waiting at the end of what was shown since the last answer, or null. */
function question(s) {
  const text = since(s);
  const m = /([^\n]*(?:\[y\/N\]|\(y\/n\)|\[Y\/n\]|\[1\/2\][^\n]*:))\s*$/.exec(text);
  if (!m) return null;
  const ask = m[1].trim();
  const before = tidy(text.slice(0, m.index).split('\f').pop());
  if (/Enable Remote Control\?/.test(ask)) return { kind: 'consent', mode: 'line', ask: 'Enable Remote Control?', text: before };
  const trust = /^Trust (.+)\? \[y\/N\]$/.exec(ask);
  if (trust) return { kind: 'trust', mode: 'line', ask: `Trust ${trust[1]}?`, folder: trust[1], text: before };
  if (/\[1\/2\]/.test(ask)) return { kind: 'choice', mode: 'line', ask, text: before, options: ['1', '2'] };
  return { kind: 'question', mode: 'line', ask: ask.replace(/\s*(\[y\/N\]|\(y\/n\)|\[Y\/n\])$/, ''), text: before.split('\n').slice(-6).join('\n') };
}

/**
 * A pick-list Claude Code's full-screen view is showing (options under a
 * "❯" cursor, "Enter to confirm" below them), or null: { kind, ask, text,
 * options, current }.
 */
function dialog(s) {
  const text = since(s);
  const at = text.lastIndexOf('Enter to confirm');
  if (at === -1) return null;
  const nl = text.indexOf('\n', at);
  if (nl !== -1 && /\S/.test(text.slice(nl + 1).replace(/\f/g, ''))) return null; // not the last thing on screen
  const lines = text.slice(0, at).split('\f').pop().split('\n').map((l) => l.replace(/\s+$/, ''));
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  // The options: the block of lines around the cursor, down to the hint line.
  const cursor = lines.map((l) => l.includes('❯')).lastIndexOf(true);
  if (cursor === -1) return null;
  let first = cursor;
  while (first > 0 && lines[first - 1].trim() && !/[.:?)]$/.test(lines[first - 1].trim())) first--;
  const block = lines.slice(first).map((l, i) => ({ text: l.replace('❯', '').trim().replace(/^\d+\.\s+/, ''), cursor: first + i === cursor }))
    .filter((o) => o.text);
  const opts = block.map((o) => o.text);
  if (opts.length < 2 || opts.length > 9) return null;
  const body = tidy(lines.slice(0, first).join('\n').split(/\n\s*\n\s*\n/).pop()).replace(/[─│╭╮╰╯]+/g, '').trim();
  const current = block.findIndex((o) => o.cursor);
  const yes = opts.findIndex((o) => /^(yes\b|enable)/i.test(o));
  const workspace = /Accessing workspace:\s*\n\s*(\S[^\n]*)/.exec(body);
  if (workspace && yes !== -1) {
    return { kind: 'trust', mode: 'select', ask: `Trust ${workspace[1].trim()}?`, folder: workspace[1].trim(), text: body, options: opts, current, yes };
  }
  if (/Remote Control/i.test(body + opts.join(' ')) && yes !== -1) {
    return { kind: 'consent', mode: 'select', ask: 'Enable Remote Control?', text: body, options: opts, current, yes };
  }
  const lastLine = body.split('\n').filter((l) => l.trim()).pop() || 'Claude Code asks';
  return { kind: 'choice', mode: 'select', ask: lastLine.trim(), text: body, options: opts, current };
}

function look(s) {
  if (!live(s)) return;
  const before = JSON.stringify(snapshot(s));
  const urls = s.text.match(ENV_URL_RE);
  if (urls) s.envUrl = urls[urls.length - 1];
  const errors = s.text.match(ERROR_RE);
  if (errors) s.lastError = errors[errors.length - 1].trim();

  // Its sessions: terminal hyperlinks on the screen as it is now, each keeping
  // the latest name it showed ("Attached" and such are states, not names);
  // a reopened session prints its one link as plain text.
  for (const l of s.links) {
    const m = SESSION_URL_RE.exec(l.url);
    if (m && l.text && !STATUS_WORDS.has(l.text.toLowerCase())) s.titles.set(m[0], l.text);
  }
  const screen = s.text.slice(s.text.lastIndexOf('\f') + 1);
  if (interactive(s)) {
    const found = s.text.match(SESSION_URL_TEXT_RE);
    if (found) s.sessions = [{ url: found[found.length - 1], title: s.title }];
  } else if (READY_RE.test(screen)) {
    const urls2 = new Set();
    for (const l of s.links) {
      const m = l.frame === s.frame && SESSION_URL_RE.exec(l.url);
      if (m) urls2.add(m[0]);
    }
    s.sessions = [...urls2].map((url) => ({ url, title: s.titles.get(url) || null }));
  }
  s.links = s.links.filter((l) => l.frame === s.frame);

  if (!s.prompt && s.status !== 'ready') {
    const failed = interactive(s) && RC_FAILED_RE.exec(since(s));
    if (failed) {
      fail(s, failed[0].trim());
      return;
    }
    const q = question(s) || dialog(s);
    if (q) {
      s.prompt = { id: `q${++s.asked}`, ...q, at: Date.now() };
      s.status = 'asking';
      clearTimeout(s.timer);
      s.timer = setTimeout(() => fail(s, 'Nobody answered Claude Code’s question, so Flock stopped it.'), ANSWER_TIMEOUT);
      log('phone server', s.id, 'asks', q.kind);
    }
  }
  const ready = interactive(s) ? s.sessions.length > 0 || RC_ON_RE.test(s.text) : READY_RE.test(s.text) || s.envUrl;
  if (!s.prompt && s.status !== 'ready' && ready) {
    s.status = 'ready';
    clearTimeout(s.timer);
    log('phone server', s.id, 'ready');
  }
  if (JSON.stringify(snapshot(s)) !== before) onChange(snapshot(s));
}

// ── Servers ─────────────────────────────────────────────────────────────────

function snapshot(s) {
  const p = s.prompt;
  return {
    id: s.id,
    kind: s.kind,
    account: s.account,
    folder: s.folder,
    name: path.basename(s.folder) || s.folder,
    title: s.title || null,
    session: s.session || null,
    fork: Boolean(s.forkId),
    forkId: s.forkId || null,
    conversation: s.conversation || null,
    status: s.status,
    prompt: p ? { id: p.id, kind: p.kind, ask: p.ask, text: p.text, folder: p.folder || null, options: p.mode === 'select' && p.kind === 'choice' ? p.options : null } : null,
    envUrl: s.envUrl || null,
    sessions: s.sessions,
    error: s.status === 'failed' ? s.error : null,
    startedAt: s.startedAt,
    endedAt: s.endedAt || null,
  };
}

function prune() {
  const now = Date.now();
  for (const [id, s] of servers) if (!live(s) && now - (s.endedAt || now) > KEEP_ENDED) servers.delete(id);
}

function end(s, status, error) {
  if (!live(s)) return;
  clearTimeout(s.timer);
  s.status = status;
  s.error = error || null;
  s.prompt = null;
  s.endedAt = Date.now();
  log('phone server', s.id, status, error || '');
  onChange(snapshot(s));
}

function fail(s, error) {
  end(s, 'failed', error);
  if (s.term) s.term.kill();
}

/** A name prefix for a folder's sessions: "Montero-graceful-unicorn" until the first prompt names them. */
function prefix(folder) {
  return (path.basename(folder) || 'flock').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'flock';
}

/** Whether `s` is already what start() was asked for. */
function same(s, { kind, folder, title, session, conversation }) {
  if (kind === 'folder') return pathKey(s.folder) === pathKey(folder);
  if (kind === 'new') return s.conversation === conversation || (pathKey(s.folder) === pathKey(folder) && s.title === title);
  return s.session === session;
}

/**
 * Starts Claude Code with Remote Control for `account` (a profile id), or
 * returns the one already running for the same folder (folder kind), session
 * (session kind) or name in a folder (new kind). `launcher` and `env` say how
 * to run Claude Code for that account's sign-in (see cli.js). The session and
 * new kinds take the arguments that open the conversation (`args`) and its
 * `title`; the session kind also the Code session's id (`session`) and, when
 * it runs as a copy, the copy's id (`forkId`); the new kind the conversation's
 * id (`conversation`).
 */
async function start({ kind = 'folder', account, folder, launcher, env, spawnMode = 'same-dir', permissionMode = 'default', args: sessionArgs, title, session, forkId, conversation }) {
  prune();
  for (const s of servers.values()) {
    if (live(s) && s.account === account && s.kind === kind && same(s, { kind, folder, title, session, conversation })) return snapshot(s);
  }
  if ([...servers.values()].filter(live).length >= MAX_LIVE) {
    throw new Error(`Flock already runs ${MAX_LIVE} sessions for your phone. Stop one first.`);
  }
  let args = sessionArgs;
  if (kind === 'folder') {
    args = ['remote-control', '--spawn', spawnMode, '--remote-control-session-name-prefix', prefix(folder)];
    if (permissionMode && permissionMode !== 'default') args.push('--permission-mode', permissionMode);
  }
  const s = {
    id: `rc${Date.now().toString(36)}${++seq}`,
    kind,
    account,
    folder,
    title: title || null,
    session: session || null,
    forkId: forkId || null,
    conversation: conversation || null,
    status: 'starting',
    startedAt: Date.now(),
    carry: '',
    text: '',
    base: 0,
    frame: 0,
    link: null,
    links: [],
    titles: new Map(),
    sessions: [],
    asked: 0,
    answered: 0,
    declined: null,
    prompt: null,
    envUrl: null,
    lastError: null,
    term: null,
    timer: null,
  };
  servers.set(s.id, s);
  const how = { folder: spawnMode, session: forkId ? 'as a copy' : 'in place', new: args.includes('--resume') ? 'reopened' : 'new' }[kind];
  log('phone server', s.id, 'start', kind, folder, how, permissionMode, s.title ? `"${s.title}"` : '');
  onChange(snapshot(s));
  s.timer = setTimeout(() => fail(s, s.lastError || 'Claude Code didn’t get going in time.'), START_TIMEOUT);
  try {
    s.term = await pty.open({ file: launcher.file, args: [...launcher.pre, ...args], cwd: folder, env, cols: 300, rows: 60 });
  } catch (e) {
    end(s, 'failed', e.message);
    return snapshot(s);
  }
  let pending = 0;
  s.term.onData((d) => {
    feed(s, d);
    clearTimeout(pending);
    pending = setTimeout(() => look(s), 120); // a burst of output is one screen update
  });
  s.term.onExit((code) => {
    clearTimeout(pending);
    look(s);
    if (s.status === 'ready' || s.stopping) end(s, 'stopped');
    else if (s.declined === 'trust') end(s, 'failed', 'You chose not to trust this folder, so Claude Code didn’t start.');
    else if (s.declined === 'consent') end(s, 'failed', 'Remote Control wasn’t turned on, so Claude Code didn’t start.');
    else end(s, 'failed', s.lastError || `Claude Code stopped (exit code ${code}).`);
  });
  return snapshot(s);
}

/** The keys that move a pick-list's cursor from `from` to `to` and confirm. */
function pick(from, to) {
  const step = to > from ? KEYS.down : KEYS.up;
  return step.repeat(Math.abs(to - from)) + KEYS.enter;
}

/**
 * Answers the open question with the phone's reply: { yes } for a yes/no
 * question, or { option } (an index) for a pick-list of other choices.
 */
function answer(id, promptId, reply) {
  const s = servers.get(id);
  if (!s || !s.prompt || s.prompt.id !== promptId || !s.term) return false;
  const p = s.prompt;
  const yes = Boolean(reply && reply.yes);
  let keys;
  if (p.mode === 'line') keys = p.kind === 'choice' ? (yes ? '1\r' : '2\r') : yes ? 'y\r' : 'n\r';
  else if (p.kind === 'choice') {
    const i = Number(reply && reply.option);
    if (!Number.isInteger(i) || i < 0 || i >= p.options.length) return false;
    keys = pick(p.current, i);
  } else keys = yes ? pick(p.current, p.yes) : KEYS.esc;
  if (!yes && (p.kind === 'trust' || p.kind === 'consent')) s.declined = p.kind;
  s.term.write(keys);
  s.answered = s.base + s.text.length;
  s.prompt = null;
  s.status = 'starting';
  clearTimeout(s.timer);
  s.timer = setTimeout(() => fail(s, s.lastError || 'Claude Code didn’t get going in time.'), START_TIMEOUT);
  log('phone server', id, 'answered', p.kind, p.kind === 'choice' && p.mode === 'select' ? `option ${reply.option}` : yes ? 'yes' : 'no');
  onChange(snapshot(s));
  return true;
}

/** Stops it the way Ctrl+C would (twice: a reopened session asks for a second one), then outright. */
function stop(id) {
  const s = servers.get(id);
  if (!s || !live(s) || !s.term) return false;
  s.stopping = true;
  s.term.write(KEYS.ctrlC);
  setTimeout(() => { if (live(s)) s.term.write(KEYS.ctrlC); }, 700);
  setTimeout(() => { if (live(s)) s.term.kill(); }, STOP_GRACE);
  return true;
}

/**
 * Claude's window for `account` opened: stops the sessions reopened in place
 * for that account, so the window and the phone never write to one
 * conversation at once. Resolves to the titles of the ones it stopped.
 */
function handBack(account) {
  const stopped = [];
  for (const s of servers.values()) {
    if (live(s) && s.account === account && s.kind === 'session' && !s.forkId && stop(s.id)) stopped.push(s.title || s.name);
  }
  return stopped;
}

/** Stops every one (Flock is quitting); resolves once they have gone or after `ms`. */
function stopAll(ms = 2500) {
  const running = [...servers.values()].filter((s) => live(s) && s.term);
  if (!running.length) return Promise.resolve();
  running.forEach((s) => { s.stopping = true; s.term.write(KEYS.ctrlC); });
  setTimeout(() => running.filter(live).forEach((s) => s.term.write(KEYS.ctrlC)), 700);
  return new Promise((resolve) => {
    const t0 = Date.now();
    const check = setInterval(() => {
      if (running.every((s) => !live(s)) || Date.now() - t0 > ms) {
        clearInterval(check);
        running.filter(live).forEach((s) => s.term.kill());
        resolve();
      }
    }, 100);
  });
}

function list() {
  prune();
  return [...servers.values()].map(snapshot).sort((a, b) => b.startedAt - a.startedAt);
}

function get(id) {
  const s = servers.get(id);
  return s ? snapshot(s) : null;
}

function watch(cb) {
  onChange = cb;
}

module.exports = { start, answer, stop, stopAll, handBack, list, get, watch, prefix, feed, question, dialog };
