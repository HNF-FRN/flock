'use strict';
// What Flock does for Claude's windows themselves, all fed by wintrack.js:
// names each window after its account (identity.js), draws the accent edge
// along its top (edge.js) and tells the island which account has focus. It
// also tells the island when another app's window lies under it (a browser's
// tabs, an editor's toolbar), so the island can step aside. And it finds the
// window a chat has to itself, to bring it to the front from the island.
// Nothing is injected into Claude and nothing covers its content.

const { screen } = require('electron');
const wintrack = require('./wintrack');
const identity = require('./identity');
const edge = require('./edge');

// Claude's title bar keeps its buttons within these distances (DIP) of each end;
// the island may sit over a Claude window only between them.
const CLAUDE_BUSY_LEFT = 320;
const CLAUDE_BUSY_RIGHT = 340;
// How far (physical px) a chat's window may lie from where Claude last saw it.
const NEAR_PX = 16;
// Claude names its main window "Claude" or "<page> — Claude".
const CLAUDE_SUFFIX = /\s[—–-]\s(?:Claude|Claude Code)$/u;

let cfg = null; // { preload, page, skip, raise, onFocus: (accountId | null) => void, onYield: (boolean) => void }
let byPid = new Map(); // Claude process id -> account
let settings = {};
let report = { wins: [], fg: 0, under: null };
let focused = null;
let yielding = false;
let zone = null; // the island's area in physical px [l, t, r, b], or null while it is hidden
let running = false;

function init(options) {
  cfg = options;
  edge.init(options);
  identity.init({ onIcon: apply });
}

function hwndOf(win) {
  const b = win.getNativeWindowHandle();
  return b.length >= 8 ? Number(b.readBigUInt64LE(0)) : b.readUInt32LE(0);
}

/** Flock's own windows never count as covering a Claude window. */
function skipList() {
  const own = cfg.skip().filter((w) => w && !w.isDestroyed()).map(hwndOf);
  return [...edge.handles(), ...own];
}

let lastState = null;

/** Called with Flock's state whenever it changes. */
function sync(state) {
  if (!cfg) return;
  lastState = state;
  settings = state.settings;
  byPid = new Map();
  for (const a of state.accounts) for (const pid of a.pids) byPid.set(pid, a);
  const forWindows = byPid.size > 0 && (settings.windowNames || settings.windowEdge !== 'off' || settings.islandFocus);
  if (!forWindows && !zone) {
    stop();
    return;
  }
  running = true;
  wintrack.start(onReport);
  apply();
}

/** The island's area (physical px), to step aside for apps lying under it; null while it is hidden. */
function setZone(z) {
  zone = z;
  if (lastState) sync(lastState);
}

/** Whether the island should step aside: another app's window lies under it,
 *  or a Claude window whose title-bar buttons it would cover. */
function shouldYield(under) {
  if (!under || !zone || settings.islandYield === false) return false;
  const [, pid, l, , r] = under;
  if (!byPid.has(pid)) return true;
  const scale = screen.getDisplayNearestPoint(screen.screenToDipPoint({ x: zone[0], y: zone[1] })).scaleFactor || 1;
  return zone[0] < l + CLAUDE_BUSY_LEFT * scale || zone[2] > r - CLAUDE_BUSY_RIGHT * scale;
}

function onReport(r) {
  report = r;
  apply();
}

function apply() {
  if (!running) return;
  edge.update(report.wins, report.fg, byPid, settings.windowEdge);
  identity.sync(report.wins, byPid, Boolean(settings.windowNames));
  wintrack.watch([...byPid.keys()], skipList(), zone);
  const y = shouldYield(report.under);
  if (y !== yielding) {
    yielding = y;
    cfg.onYield(y);
  }
  const w = report.wins.find((x) => x.h === report.fg);
  const a = w ? byPid.get(w.p) : null;
  const id = a ? a.id : null;
  if (id !== focused) {
    focused = id;
    cfg.onFocus(id);
  }
}

function stop() {
  if (!running) return;
  running = false;
  edge.stop();
  identity.reset();
  wintrack.stop(); // the helper puts every window back before it exits
  report = { wins: [], fg: 0, under: null };
  if (focused) {
    focused = null;
    cfg.onFocus(null);
  }
  if (yielding) {
    yielding = false;
    cfg.onYield(false);
  }
}

// ── A chat's own window ──────────────────────────────────────────────────────

const plainTitle = (t) => String(t || '').replace(CLAUDE_SUFFIX, '').trim().toLowerCase();

/** Whether a window looks like an account's main window rather than one chat's. */
function mainLike(w) {
  return Boolean(w.ly) || (w.t != null && CLAUDE_SUFFIX.test(w.t));
}

/** Whether a window lies where Claude last saw a chat's window (`bounds` in DIP). */
function near(w, bounds) {
  if (w.min || !bounds) return false;
  const r = screen.dipToScreenRect(null, bounds);
  const [l, t, rt, b] = w.f;
  return Math.abs(l - r.x) <= NEAR_PX && Math.abs(t - r.y) <= NEAR_PX
    && Math.abs(rt - (r.x + r.width)) <= NEAR_PX && Math.abs(b - (r.y + r.height)) <= NEAR_PX;
}

/** Keeps the candidates passing `test`, unless none do. */
function prefer(list, test) {
  const kept = list.filter(test);
  return kept.length ? kept : list;
}

/**
 * Which window each chat Claude has in a window of its own lies in:
 * `pids` are the account's Claude processes, `popouts` [{ id, title, bounds }]
 * from sessions.popouts(). Returns Map(session id -> window handle) for the
 * ones found: by the title Claude gave the window, else by where Claude last
 * saw it, else as the only chat window left.
 */
function popoutWindows(pids, popouts) {
  const mine = new Set(pids);
  const wins = report.wins.filter((w) => mine.has(w.p));
  const found = new Map();
  const taken = new Set();
  let left = [...popouts];
  const free = () => wins.filter((w) => !taken.has(w.h));
  const settle = (pop, c) => {
    if (c.length !== 1) return;
    found.set(pop.id, c[0].h);
    taken.add(c[0].h);
    left = left.filter((x) => x !== pop);
  };
  for (const pop of [...left]) {
    const want = plainTitle(pop.title);
    if (!want) continue;
    let c = free().filter((w) => w.t != null && plainTitle(w.t) === want);
    // The main window can show the same chat; its title then ends in "— Claude".
    if (c.length > 1) c = prefer(c, (w) => !mainLike(w));
    if (c.length > 1) c = prefer(c, (w) => near(w, pop.bounds));
    settle(pop, c);
  }
  for (const pop of [...left]) settle(pop, free().filter((w) => near(w, pop.bounds)));
  if (left.length === 1) settle(left[0], free().filter((w) => !mainLike(w)));
  return found;
}

/** Brings one of Claude's windows to the front; resolves whether it got there. */
function raise(h) {
  return wintrack.raise(h);
}

/** Before Flock quits: give Claude's windows back their own names, then stop. */
async function quit() {
  await wintrack.plainAll();
  stop();
}

module.exports = { init, sync, setZone, popoutWindows, raise, stop, quit };
