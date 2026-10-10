'use strict';
// Claude Code Remote Control servers that Flock starts for the phone. Each is
// one `claude remote-control` in a folder, under one account's Claude Code
// sign-in, and serves several sessions: the one it starts with, and any the
// phone starts there later from the Claude app. It runs in a pseudo-console
// (pty.js) so Claude Code asks what it asks in a terminal: once per sign-in
// whether to turn Remote Control on, and whether to trust a folder it hasn't
// seen. Flock passes those questions to the phone word for word and types only
// the phone's answer; it never answers them itself.
//
// What the server shows is read back from its screen: "Ready · <folder>",
// the link that opens the folder in the Claude app, and one link per session
// (terminal hyperlinks, titled with the session's name).

const path = require('path');
const pty = require('./pty');
const { log } = require('./log');
const { pathKey } = require('./util');

const START_TIMEOUT = 90 * 1000; // neither a question nor "Ready" by then: give up
const ANSWER_TIMEOUT = 15 * 60 * 1000; // a question nobody answers stops the server
const STOP_GRACE = 4000; // after Ctrl+C, before it is stopped outright
const KEEP_ENDED = 30 * 60 * 1000; // how long a stopped server stays listed
const MAX_LIVE = 8;
const MAX_TEXT = 64 * 1024;

const ENV_URL_RE = /https:\/\/claude\.ai\/code\?environment=env_[A-Za-z0-9]+/g;
const SESSION_URL_RE = /^https:\/\/claude\.ai\/code\/session_[A-Za-z0-9]+/;
const READY_RE = /(?:^|[\s·])(Ready|Connected) · /m;
const ERROR_RE = /^(?:Error: .+|Remote Control did not start: .+|You must be logged in.+|.*Remote Control (?:requires|isn't enabled|is disabled|is only available).+)$/gm;
const STATUS_WORDS = new Set(['attached', 'detached', 'connecting', 'connected', 'idle', 'running', 'working', 'waiting']);

const servers = new Map(); // id -> server
let seq = 0;
let onChange = () => {};

const live = (s) => s.status === 'starting' || s.status === 'asking' || s.status === 'ready';

// ── Reading the screen ──────────────────────────────────────────────────────

/**
 * Turns terminal output into plain text, collecting its hyperlinks (OSC 8).
 * A jump to another row becomes a line break; erasing the screen below the
 * cursor or all of it (a redraw) becomes a form feed, so the text after the
 * last one is what the screen shows now.
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

/** A question waiting for its answer at the end of what was shown since the last answer, or null. */
function question(s) {
  const since = s.text.slice(Math.max(0, s.answered - s.base));
  const m = /([^\n]*(?:\[y\/N\]|\(y\/n\)|\[Y\/n\]|\[1\/2\][^\n]*:))\s*$/.exec(since);
  if (!m) return null;
  const ask = m[1].trim();
  const before = tidy(since.slice(0, m.index).split('\f').pop());
  if (/Enable Remote Control\?/.test(ask)) return { kind: 'consent', ask: 'Enable Remote Control?', text: before };
  const trust = /^Trust (.+)\? \[y\/N\]$/.exec(ask);
  if (trust) return { kind: 'trust', ask: `Trust ${trust[1]}?`, folder: trust[1], text: before };
  if (/\[1\/2\]/.test(ask)) return { kind: 'choice', ask, text: before };
  return { kind: 'question', ask: ask.replace(/\s*(\[y\/N\]|\(y\/n\)|\[Y\/n\])$/, ''), text: before.split('\n').slice(-6).join('\n') };
}

function look(s) {
  if (!live(s)) return;
  const before = JSON.stringify(snapshot(s));
  const urls = s.text.match(ENV_URL_RE);
  if (urls) s.envUrl = urls[urls.length - 1];
  const errors = s.text.match(ERROR_RE);
  if (errors) s.lastError = errors[errors.length - 1].trim();

  // The sessions are the links on the screen as it is now; each keeps the
  // latest name it showed ("Attached" and such are states, not names).
  for (const l of s.links) {
    const m = SESSION_URL_RE.exec(l.url);
    if (m && l.text && !STATUS_WORDS.has(l.text.toLowerCase())) s.titles.set(m[0], l.text);
  }
  const screen = s.text.slice(s.text.lastIndexOf('\f') + 1);
  if (READY_RE.test(screen)) {
    const urls = new Set();
    for (const l of s.links) {
      const m = l.frame === s.frame && SESSION_URL_RE.exec(l.url);
      if (m) urls.add(m[0]);
    }
    s.sessions = [...urls].map((url) => ({ url, title: s.titles.get(url) || null }));
  }
  s.links = s.links.filter((l) => l.frame === s.frame);

  if (!s.prompt) {
    const q = question(s);
    if (q) {
      s.prompt = { id: `q${++s.asked}`, ...q, at: Date.now() };
      s.status = 'asking';
      clearTimeout(s.timer);
      s.timer = setTimeout(() => fail(s, 'Nobody answered Claude Code’s question, so Flock stopped it.'), ANSWER_TIMEOUT);
      log('phone server', s.id, 'asks', q.kind);
    }
  }
  if (!s.prompt && s.status !== 'ready' && (READY_RE.test(s.text) || s.envUrl)) {
    s.status = 'ready';
    clearTimeout(s.timer);
    log('phone server', s.id, 'ready');
  }
  if (JSON.stringify(snapshot(s)) !== before) onChange(snapshot(s));
}

// ── Servers ─────────────────────────────────────────────────────────────────

function snapshot(s) {
  return {
    id: s.id,
    account: s.account,
    folder: s.folder,
    name: path.basename(s.folder) || s.folder,
    status: s.status,
    prompt: s.prompt ? { id: s.prompt.id, kind: s.prompt.kind, ask: s.prompt.ask, text: s.prompt.text, folder: s.prompt.folder || null } : null,
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

/** A name prefix for the sessions, from the folder: "Montero-graceful-unicorn" until the first prompt names them. */
function prefix(folder) {
  return (path.basename(folder) || 'flock').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'flock';
}

/**
 * Starts a server in `folder` for `account` (a profile id), or returns the
 * one already running there. `launcher` and `env` say how to run Claude Code
 * for that account's sign-in (see cli.js).
 */
async function start({ account, folder, launcher, env, spawnMode = 'same-dir', permissionMode = 'default' }) {
  prune();
  for (const s of servers.values()) {
    if (live(s) && s.account === account && pathKey(s.folder) === pathKey(folder)) return snapshot(s);
  }
  if ([...servers.values()].filter(live).length >= MAX_LIVE) {
    throw new Error(`Flock already runs ${MAX_LIVE} folders for your phone. Stop one first.`);
  }
  const args = ['remote-control', '--spawn', spawnMode, '--remote-control-session-name-prefix', prefix(folder)];
  if (permissionMode && permissionMode !== 'default') args.push('--permission-mode', permissionMode);
  const s = {
    id: `rc${Date.now().toString(36)}${++seq}`,
    account,
    folder,
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
    prompt: null,
    envUrl: null,
    lastError: null,
    term: null,
    timer: null,
  };
  servers.set(s.id, s);
  log('phone server', s.id, 'start', folder, spawnMode, permissionMode);
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
    else end(s, 'failed', s.lastError || `Claude Code stopped (exit code ${code}).`);
  });
  return snapshot(s);
}

/** Answers the server's open question with the phone's reply. */
function answer(id, promptId, yes) {
  const s = servers.get(id);
  if (!s || !s.prompt || s.prompt.id !== promptId || !s.term) return false;
  const kind = s.prompt.kind;
  s.term.write(kind === 'choice' ? (yes ? '1\r' : '2\r') : yes ? 'y\r' : 'n\r');
  s.answered = s.base + s.text.length;
  s.prompt = null;
  s.status = 'starting';
  clearTimeout(s.timer);
  s.timer = setTimeout(() => fail(s, s.lastError || 'Claude Code didn’t get going in time.'), START_TIMEOUT);
  log('phone server', id, 'answered', kind, yes ? 'yes' : 'no');
  onChange(snapshot(s));
  return true;
}

/** Stops a server the way Ctrl+C would, then outright if it lingers. */
function stop(id) {
  const s = servers.get(id);
  if (!s || !live(s) || !s.term) return false;
  s.stopping = true;
  s.term.write('\x03');
  setTimeout(() => { if (live(s)) s.term.kill(); }, STOP_GRACE);
  return true;
}

/** Stops every server (Flock is quitting); resolves once they have gone or after `ms`. */
function stopAll(ms = 2500) {
  const running = [...servers.values()].filter((s) => live(s) && s.term);
  if (!running.length) return Promise.resolve();
  running.forEach((s) => { s.stopping = true; s.term.write('\x03'); });
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

module.exports = { start, answer, stop, stopAll, list, get, watch, prefix, feed, question };
