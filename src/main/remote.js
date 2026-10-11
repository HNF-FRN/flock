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
// Remote Control on, whether to trust a folder it hasn't seen, and, the first
// time its full-screen view runs for a sign-in, its setup (a colour theme, then
// security notes to read). Flock passes those questions to the phone word for
// word and types only the phone's answer; it never answers them itself.
//
// What Claude Code shows is read from its screen, played back cell by cell
// (screen.js): its questions, "Ready · <folder>", the link that opens the
// folder in the Claude app, and each session's link (as a terminal hyperlink
// titled with the session's name, or as plain text).

const path = require('path');
const pty = require('./pty');
const { Screen } = require('./screen');
const { log } = require('./log');
const { pathKey } = require('./util');

const START_TIMEOUT = 90 * 1000; // neither a question nor "Ready" by then: give up
const ANSWER_TIMEOUT = 15 * 60 * 1000; // a question nobody answers stops it
const QUIET = 6000; // a screen this still is waiting for something: look harder for a question
const STEADY = 350; // a question has to look the same for this long before it goes to the phone
const STOP_GRACE = 4000; // after Ctrl+C, before it is stopped outright
const KEEP_ENDED = 30 * 60 * 1000; // how long a stopped one stays listed
const MAX_LIVE = 8;
const COLS = 300;
const ROWS = 60;

const SESSION_URL_RE = /^https:\/\/claude\.ai\/code\/session_[A-Za-z0-9]+/;
const STATUS_WORDS = new Set(['attached', 'detached', 'connecting', 'connected', 'idle', 'running', 'working', 'waiting']);
const KEYS = { up: '\x1b[A', down: '\x1b[B', enter: '\r', esc: '\x1b', ctrlC: '\x03' };

// Claude Code's own lines, each matched from the start of a line, so the same
// words inside other text (a conversation, a folder's settings) don't count.
// A server's status block:
const READY_RE = /^\s*\S{0,6}\s*(?:Ready|Connected) · /m;
const ENV_LINE_RE = /^\s*(?:Continue coding in|Code anywhere with) .*?(https:\/\/claude\.ai\/code\?environment=env_[A-Za-z0-9]+)/gm;
// The full-screen view's: the line Remote Control prints once it is on, its
// header while it connects, and a failure.
const RC_ON_RE = /^\s*\/remote-control is active · .*?(https:\/\/claude\.ai\/code\/session_[A-Za-z0-9]+)/;
const RC_HEADER_RE = /^\s*▝▝\s+▝▝\s+.* · \/rc(.*)$/;
const RC_FAILED_RE = /^\s*(?:[^\w\s●]\s+)?(?:\/remote-control|Remote Control)\b.*\b(?:failed|disconnected)\b.*$/i;
const ERROR_RE = /^\s*(?:[^\w\s●]\s+)?(?:[Ee]rror: .+|Remote Control did not start: .+|You must be logged in.+|No conversation found.+|Remote Control (?:requires|isn't enabled|is disabled|is only available).+)$/;
const TRACE_RE = /^\s*(?:at\s|(?:Node\.js|Bun) v\d|\^+$|\d+\s*\||file:\/\/\/)/; // a stack trace under an error

// A pick-list's cursor: "❯", or ">" where Claude Code thinks the terminal has no Unicode.
const CURSOR_RE = /^[❯>]\s+(?=\S)/;
const CHECK_RE = /^[✔✓√]\s+/; // marks the option in use (the current theme)
// The hint under a pick-list. The theme picker has none: a syntax-theme line ends it instead.
const HINT_RE = /Enter to (?:confirm|select|continue|submit)|Esc to (?:cancel|exit|go back|reject|skip)|ctrl\+t to (?:disable|enable)/i;
const CONTINUE_RE = /^\s*Press Enter to continue/i;
const RULE_RE = /^\s*[─━═]{10,}/; // the rules above and below Claude Code's prompt box
const TYPED_RE = /^(.*?)\s*(\[y\/N\]|\(y\/n\)|\[Y\/n\]|\[1\/2\][^\n]*:)$/;

const servers = new Map(); // id -> server
let seq = 0;
let onChange = () => {};

const live = (s) => s.status === 'starting' || s.status === 'asking' || s.status === 'ready';
const interactive = (s) => s.kind !== 'folder'; // one conversation in Claude Code's full-screen view, not a server

// ── Reading the screen ──────────────────────────────────────────────────────

/** Lines with words in them; rules, borders and drawings (the logo) have none. */
const wordy = (l) => /[A-Za-z0-9]/.test(l);

/** The index of the last line with anything on it, or -1. */
function lastLine(lines) {
  let i = lines.length - 1;
  while (i >= 0 && !lines[i].trim()) i--;
  return i;
}

/**
 * The text just above line `end` (exclusive): back to two blank lines in a
 * row, or a line without words (a rule, the logo), at most `max` lines; tidied
 * and without its common indent.
 */
function above(lines, end, max = 24) {
  let i = end - 1;
  while (i >= 0 && !lines[i].trim()) i--;
  const out = [];
  for (let blanks = 0; i >= 0 && out.length < max; i--) {
    const l = lines[i];
    if (!l.trim()) {
      if (++blanks >= 2) break;
      out.unshift('');
      continue;
    }
    if (!wordy(l)) break;
    blanks = 0;
    out.unshift(l);
  }
  while (out.length && !out[0].trim()) out.shift();
  const indent = Math.min(...out.filter((l) => l.trim()).map((l) => l.search(/\S/)));
  return out.map((l) => l.slice(Number.isFinite(indent) ? indent : 0).replace(/\s+$/, '')).join('\n').trim();
}

/** The first line of the last paragraph of `text`, or the last line ending in "?". */
function heading(text) {
  const lines = text.split('\n').map((l) => l.trim());
  const q = lines.filter((l) => /\?$/.test(l)).pop();
  if (q) return q;
  const paras = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  return paras.length ? paras[paras.length - 1].split('\n')[0].trim() : '';
}

/** How a line reads as a pick-list option: { col (where its words start), text, cursor }, or null. */
function option(line) {
  if (!line.trim()) return null;
  let col = line.search(/\S/);
  let rest = line.slice(col);
  const c = CURSOR_RE.exec(rest);
  if (c) { col += c[0].length; rest = rest.slice(c[0].length); }
  const k = CHECK_RE.exec(rest);
  if (k) { col += k[0].length; rest = rest.slice(k[0].length); }
  return { col, text: rest.trim().replace(/^\d+\.\s+/, ''), cursor: Boolean(c) };
}

/**
 * The pick-list whose cursor is the last one at or above line `end`: the
 * options are the lines next to the cursor's whose words start in the same
 * column (a longer description under one is indented further and skipped).
 * Null unless 2 to 9 options.
 */
function pickList(lines, end) {
  let at = -1;
  for (let i = end; i >= 0 && i > end - 30; i--) {
    const o = option(lines[i]);
    if (o && o.cursor) { at = i; break; }
  }
  if (at === -1) return null;
  const col = option(lines[at]).col;
  const fits = (i) => {
    const o = option(lines[i]);
    return o ? (o.col === col ? 'option' : o.col > col && !o.cursor ? 'more' : null) : null;
  };
  let first = at;
  for (let i = at - 1; i >= 0 && fits(i); i--) if (fits(i) === 'option') first = i;
  let last = at;
  for (let i = at + 1; i <= end && fits(i); i++) if (fits(i) === 'option') last = i;
  const rows = [];
  for (let i = first; i <= last; i++) if (fits(i) === 'option' || i === at) rows.push(i);
  if (rows.length < 2 || rows.length > 9) return null;
  return { first, last, options: rows.map((i) => option(lines[i]).text), current: rows.indexOf(at) };
}

/**
 * The folder a trust question names: the line under "Accessing workspace:",
 * looked for anywhere between the question's top rule and its options.
 */
function workspaceOf(lines, first) {
  for (let i = first - 1; i >= 0; i--) {
    if (RULE_RE.test(lines[i])) break;
    if (/^\s*Accessing workspace:\s*$/.test(lines[i])) {
      for (let j = i + 1; j < first; j++) if (lines[j].trim()) return lines[j].trim();
    }
  }
  return null;
}

/**
 * Makes a pick-list into a question for the phone. What kind it is comes from
 * Claude Code's own wording of the options, never from text above them, which
 * can quote a folder's settings: a trust question is one that offers to trust
 * the folder. Anything else goes to the phone as its options, word for word.
 */
function asDialog(lines, list, folder) {
  const { options, current } = list;
  const body = above(lines, list.first);
  const trustAt = options.findIndex((o) => /^yes\b.*\btrust\b/i.test(o));
  if (trustAt !== -1) {
    const named = workspaceOf(lines, list.first) || folder;
    return { kind: 'trust', mode: 'select', ask: named ? `Trust ${named}?` : 'Trust this folder?', folder: named || null, text: body, options, current, yes: trustAt };
  }
  const yes = options.findIndex((o) => /^(yes\b|enable)/i.test(o));
  const ask = heading(body);
  if (yes !== -1 && /\bRemote Control\b/i.test(`${ask} ${options.join(' ')}`)) {
    return { kind: 'consent', mode: 'select', ask: 'Enable Remote Control?', text: body, options, current, yes };
  }
  return { kind: 'choice', mode: 'select', ask: ask || 'Claude Code asks', text: body, options, current };
}

/** A typed question at the bottom of the screen (`… [y/N]`), as `claude remote-control` asks them, or null. */
function question(sc) {
  const lines = sc.text().split('\n');
  const end = lastLine(lines);
  if (end === -1) return null;
  const m = TYPED_RE.exec(lines[end].trim());
  if (!m) return null;
  const ask = lines[end].trim();
  const before = above(lines, end, 12);
  if (/^Enable Remote Control\?/.test(ask)) return { kind: 'consent', mode: 'line', ask: 'Enable Remote Control?', text: before };
  const trust = /^Trust (.+)\?$/.exec(m[1]);
  if (trust && m[2] === '[y/N]') return { kind: 'trust', mode: 'line', ask: `Trust ${trust[1]}?`, folder: trust[1], text: before };
  if (/\[1\/2\]/.test(m[2])) return { kind: 'choice', mode: 'line', ask, text: before, options: ['1', '2'] };
  return { kind: 'question', mode: 'line', ask: m[1], text: before.split('\n').slice(-6).join('\n') };
}

/**
 * Where Claude Code's prompt box is (its top rule's line), or -1: a rule,
 * then the prompt ("❯" or ">"), then a rule, near the bottom of the screen.
 * While it shows, Claude Code is waiting for a message, not asking anything.
 */
function promptBox(lines) {
  const end = lastLine(lines);
  for (let i = end; i >= 2 && i > end - 12; i--) {
    if (!RULE_RE.test(lines[i])) continue;
    for (let j = i - 2; j >= Math.max(0, i - 5); j--) {
      if (RULE_RE.test(lines[j]) && lines.slice(j + 1, i).some((l) => /^\s*[❯>]/.test(l))) return j;
    }
  }
  return -1;
}

/**
 * A question Claude Code's full-screen view is showing at the bottom of the
 * screen, or null: a pick-list over its hint ("Enter to confirm · Esc to
 * cancel"), or a notice to read ("Press Enter to continue…"). With `still`
 * (the screen hasn't changed for a while), also a pick-list without a hint.
 * Never while the prompt box shows, nor a list with a rule under it: a list
 * quoted in a conversation isn't a question, and answering one would type
 * arrow keys and Enter into the prompt box, and send a message.
 */
function dialog(sc, { still = false, folder = null } = {}) {
  const lines = sc.lines();
  const end = lastLine(lines);
  if (end === -1 || promptBox(lines) !== -1) return null;
  if (CONTINUE_RE.test(lines[end])) {
    const text = above(lines, end);
    if (!text) return null;
    const ask = text.split('\n')[0].trim().replace(/:$/, '');
    return { kind: 'choice', mode: 'enter', ask, text: text.split('\n').slice(1).join('\n').trim(), options: ['Continue'], current: 0 };
  }
  let list = null;
  if (HINT_RE.test(lines[end])) list = pickList(lines, end - 1);
  if (!list && still) list = pickList(lines, end);
  if (!list || lines.slice(list.first, end + 1).some((l) => RULE_RE.test(l))) return null;
  return asDialog(lines, list, folder);
}

const signature = (q) => JSON.stringify([q.kind, q.mode, q.ask, q.options || null, q.text]);

/** What Claude Code asks right now, if anything (the screen is read afresh). */
function asking(s) {
  const still = Date.now() - s.lastData >= QUIET - 50;
  // A server asks typed questions; the full-screen view, pick-lists and notices.
  return interactive(s) ? dialog(s.screen, { still, folder: s.folder }) : question(s.screen) || dialog(s.screen, { still, folder: s.folder });
}

/**
 * The lines Claude Code printed itself that matter here, from the screen and
 * what scrolled off it: Remote Control's line (with its link), failures and
 * errors. For the full-screen view, the ones already there when its prompt
 * box first showed are left out: those are the conversation's (a reopened
 * one shows its history), not news.
 */
function status(s) {
  const all = s.screen.text({ history: true }).split('\n');
  const own = (l) => !s.before || !s.before.has(l);
  const on = all.filter((l) => RC_ON_RE.test(l) && own(l));
  const failed = all.filter((l) => RC_FAILED_RE.test(l) && own(l));
  // An error is near the bottom: what Claude Code says last, under a stack trace if any.
  const bottom = s.screen.text().split('\n').filter((l) => l.trim() && !TRACE_RE.test(l)).slice(-12);
  const error = bottom.filter((l) => ERROR_RE.test(l) && own(l)).pop();
  return { all, on, failed, error: error ? error.trim() : null };
}

/**
 * Notes the lines a reopened conversation shows, once Claude Code's main view
 * is up: its header (drawn as it starts, before Remote Control can connect,
 * even when a question then takes the prompt box's place) or its prompt box.
 */
function baseline(s) {
  if (s.before || !interactive(s)) return;
  const all = s.screen.text({ history: true }).split('\n');
  if (promptBox(s.screen.lines()) === -1 && !all.some((l) => RC_HEADER_RE.test(l))) return;
  s.before = new Set(all.filter((l) => RC_ON_RE.test(l) || RC_FAILED_RE.test(l) || ERROR_RE.test(l)));
}

function look(s, { exited = false } = {}) {
  if (!live(s)) return;
  const before = JSON.stringify(snapshot(s));
  const sc = s.screen;
  baseline(s);
  const st = status(s);
  if (st.error) s.lastError = st.error;

  if (interactive(s)) {
    // Remote Control is on once it prints its line after the prompt box came
    // up. The header, while still on screen (a short conversation), says
    // "/rc connecting…" until then, and "/rc" once it is on.
    const header = sc.lines().slice(0, 4).map((l) => RC_HEADER_RE.exec(l)).find(Boolean);
    const connecting = header && /connecting/i.test(header[1]);
    const connected = header && !header[1].trim();
    let lines = st.on.length && s.before && !connecting ? st.on
      : connected ? st.all.filter((l) => RC_ON_RE.test(l)) : [];
    // Remote Control may have come on while a question stood where the prompt
    // box goes, so before the box came up. Its line is then the last one
    // above the box: taken once the screen has stayed still a while.
    if (!lines.length && Date.now() - s.lastData >= QUIET - 50) {
      const rows = sc.lines();
      const box = promptBox(rows);
      const lastAbove = box === -1 ? null : rows.slice(0, box).filter((l) => l.trim()).pop();
      if (lastAbove && RC_ON_RE.test(lastAbove) && !connecting) lines = [lastAbove];
    }
    if (s.status !== 'ready' && lines.length) {
      s.sessions = [{ url: RC_ON_RE.exec(lines[lines.length - 1])[1], title: s.title }];
    }
  } else {
    // A server: its status block, and its sessions as terminal hyperlinks on
    // the screen as it is now, each keeping the latest name it showed
    // ("Attached" and such are states, not names).
    const shown = sc.text();
    const env = [...shown.matchAll(ENV_LINE_RE)].pop();
    if (env) s.envUrl = env[1];
    const links = sc.links();
    for (const l of links) {
      const m = SESSION_URL_RE.exec(l.url);
      if (m && l.text && !STATUS_WORDS.has(l.text.toLowerCase())) s.titles.set(m[0], l.text);
    }
    s.serving = READY_RE.test(shown);
    if (s.serving) {
      const now = new Set(links.map((l) => SESSION_URL_RE.exec(l.url)).filter(Boolean).map((m) => m[0]));
      s.sessions = [...now].map((url) => ({ url, title: s.titles.get(url) || null }));
    }
  }

  // Questions: only while Claude Code can still take an answer.
  if (!s.prompt && s.status !== 'ready' && !exited && !s.stopping) {
    if (interactive(s) && st.failed.length) {
      fail(s, st.failed[st.failed.length - 1].trim());
      return;
    }
    let q = asking(s);
    // The question just answered stays on the screen until Claude Code moves on.
    if (q && signature(q) === s.answeredSig) q = null;
    else s.answeredSig = null;
    // A question goes to the phone once it has looked the same for a moment:
    // not while the screen is still being drawn.
    const seen = q && `${signature(q)}#${q.current}`;
    if (q && (!s.steady || s.steady.seen !== seen)) {
      s.steady = { seen, at: Date.now() };
      clearTimeout(s.steadyTimer);
      s.steadyTimer = setTimeout(() => look(s), STEADY);
      q = null;
    } else if (q && Date.now() - s.steady.at < STEADY - 20) q = null;
    if (!seen) s.steady = null;
    if (q) {
      s.steady = null;
      s.prompt = { id: `q${++s.asked}`, ...q, at: Date.now() };
      s.status = 'asking';
      clearTimeout(s.timer);
      s.timer = setTimeout(() => fail(s, 'Nobody answered Claude Code’s question, so Flock stopped it.'), ANSWER_TIMEOUT);
      log('phone server', s.id, 'asks', q.kind, q.kind === 'choice' ? `"${q.ask.slice(0, 60)}"` : '');
    }
  }
  const ready = interactive(s) ? s.sessions.length > 0 : s.serving || Boolean(s.envUrl);
  if (!s.prompt && s.status === 'starting' && ready && !exited) {
    s.status = 'ready';
    clearTimeout(s.timer);
    log('phone server', s.id, 'ready');
  }
  if (JSON.stringify(snapshot(s)) !== before) onChange(snapshot(s));
}

/**
 * Gives up on one that neither asked anything nor got going. Unless Claude
 * Code's prompt box is up, says what its screen showed (a question Flock
 * doesn't know, say); with it up, only that Remote Control didn't come on, as
 * the screen then shows the conversation.
 */
function tooSlow(s) {
  if (!live(s)) return;
  if (s.lastError) return fail(s, s.lastError);
  if (s.before && promptBox(s.screen.lines()) !== -1) return fail(s, 'Claude Code started, but Remote Control didn’t come on in time.');
  const lines = s.screen.text().split('\n').map((l) => l.trim()).filter((l) => l && wordy(l));
  const shows = lines.slice(-3).join(' / ').slice(0, 280);
  log('phone server', s.id, 'stuck at', JSON.stringify(shows));
  return fail(s, `Claude Code didn’t get going in time.${shows ? ` It showed: “${shows}”` : ''}`);
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
    prompt: p ? { id: p.id, kind: p.kind, ask: p.ask, text: p.text, folder: p.folder || null, options: p.mode !== 'line' && p.kind === 'choice' ? p.options : null } : null,
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
  clearTimeout(s.steadyTimer);
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
    screen: new Screen(COLS, ROWS),
    lastData: Date.now(),
    before: null, // the full-screen view's lines from before its prompt box came up (status())
    serving: false,
    titles: new Map(),
    sessions: [],
    asked: 0,
    answeredSig: null,
    steady: null,
    steadyTimer: 0,
    declined: null,
    prompt: null,
    envUrl: null,
    lastError: null,
    term: null,
    timer: null,
  };
  servers.set(s.id, s);
  const how = { folder: spawnMode, session: forkId ? 'as a copy' : 'in place', new: args.includes('--resume') ? 'reopened' : 'new' }[kind];
  log('phone server', s.id, 'start', kind, account, folder, how, permissionMode, s.title ? `"${s.title}"` : '');
  onChange(snapshot(s));
  s.timer = setTimeout(() => tooSlow(s), START_TIMEOUT);
  try {
    s.term = await pty.open({ file: launcher.file, args: [...launcher.pre, ...args], cwd: folder, env, cols: COLS, rows: ROWS });
  } catch (e) {
    end(s, 'failed', e.message);
    return snapshot(s);
  }
  let pending = 0;
  let quiet = 0;
  let busy = 0;
  s.term.onData((d) => {
    s.screen.write(d);
    s.lastData = Date.now();
    clearTimeout(pending);
    clearTimeout(quiet);
    pending = setTimeout(() => look(s), 120); // a burst of output is one screen update
    quiet = setTimeout(() => look(s), QUIET); // then a still screen, which may wait for an answer
    // A long burst (a reopened conversation drawing its history) is looked at as it goes too.
    if (!busy) busy = setTimeout(() => { busy = 0; look(s); }, 500);
  });
  s.term.onExit((code) => {
    clearTimeout(pending);
    clearTimeout(quiet);
    clearTimeout(busy);
    clearTimeout(s.steadyTimer);
    look(s, { exited: true });
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
 * question, or { option } (an index) for a pick-list of other choices (a
 * notice to read has one, "Continue").
 */
function answer(id, promptId, reply) {
  const s = servers.get(id);
  if (!s || !s.prompt || s.prompt.id !== promptId || !s.term || s.stopping) return false;
  const p = s.prompt;
  // Keys go in only if Claude Code still shows that question, as it was.
  const now = asking(s);
  if (!now || signature(now) !== signature(p) || now.current !== p.current) {
    s.prompt = null;
    s.status = 'starting';
    clearTimeout(s.timer);
    s.timer = setTimeout(() => tooSlow(s), START_TIMEOUT);
    log('phone server', id, 'question gone before the answer', p.kind);
    onChange(snapshot(s));
    setTimeout(() => look(s), 0);
    return false;
  }
  const yes = Boolean(reply && reply.yes);
  let keys;
  if (p.mode === 'line') keys = p.kind === 'choice' ? (yes ? '1\r' : '2\r') : yes ? 'y\r' : 'n\r';
  else if (p.kind === 'choice') {
    const i = Number(reply && reply.option);
    if (!Number.isInteger(i) || i < 0 || i >= p.options.length) return false;
    keys = p.mode === 'enter' ? KEYS.enter : pick(p.current, i);
  } else keys = yes ? pick(p.current, p.yes) : KEYS.esc;
  if (!yes && (p.kind === 'trust' || p.kind === 'consent')) s.declined = p.kind;
  s.term.write(keys);
  s.answeredSig = signature(p);
  s.prompt = null;
  s.status = 'starting';
  clearTimeout(s.timer);
  s.timer = setTimeout(() => tooSlow(s), START_TIMEOUT);
  log('phone server', id, 'answered', p.kind, p.kind === 'choice' && p.mode !== 'line' ? `option ${reply.option}` : yes ? 'yes' : 'no');
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

module.exports = { start, answer, stop, stopAll, handBack, list, get, watch, prefix, question, dialog };
