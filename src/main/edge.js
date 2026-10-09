'use strict';
// The accent edge: a slim line in the account's colour along the top of each
// Claude window, so a glance says which account a window belongs to. The
// window you are typing in gets the full colour and a soft glow, the others a
// quieter line. It lies in the empty strip at the very top of Claude's title
// bar, above every control, never over Claude's content. Flock draws it in a
// small window of its own: clicks go straight through, it skips any part of
// the edge another window covers, and screenshots and screen sharing leave it
// out. Claude itself is never touched.

const { BrowserWindow, screen } = require('electron');

const BAND = 7; // DIP: the line and its glow. Claude's title-bar controls start 8 DIP down.
const RADIUS = 8; // DIP: Windows 11 rounds a window's corners unless it is maximized or snapped

let cfg = null; // { preload, page, raise: () => void }
const layers = new Map(); // Claude window handle -> { win, ready, wanted, boundsKey, payloadKey, payload }
let raiseQueued = false;

function init(options) {
  cfg = options;
}

function alive(win) {
  return Boolean(win && !win.isDestroyed());
}

function hwndOf(win) {
  const b = win.getNativeWindowHandle();
  return b.length >= 8 ? Number(b.readBigUInt64LE(0)) : b.readUInt32LE(0);
}

/** Flock's own edge windows, which never count as covering a Claude window. */
function handles() {
  return [...layers.values()].map((L) => L.win).filter(alive).map(hwndOf);
}

/**
 * Called with every report from wintrack: `wins`, the window with focus `fg`,
 * `byPid` (Claude process id -> account) and the windowEdge setting.
 */
function update(wins, fg, byPid, mode) {
  const present = new Set();
  if (mode !== 'off') {
    for (const w of wins) {
      const a = byPid.get(w.p);
      if (!a) continue;
      present.add(w.h);
      const focused = w.h === fg;
      if (w.min || w.mv || !w.v.length || (mode === 'focus' && !focused)) hide(w.h);
      else place(w, a.color, focused);
    }
  }
  for (const [h, L] of layers) {
    if (present.has(h)) continue;
    if (alive(L.win)) L.win.destroy();
    layers.delete(h);
  }
}

const round = (n) => Math.round(n * 100) / 100;

/** Whether Windows draws this window with square corners: maximized, or snapped to a side. */
function square(w, frame) {
  if (w.max) return true;
  const area = screen.getDisplayMatching(frame).workArea;
  const near = (a, b) => Math.abs(a - b) <= 1;
  return near(frame.y, area.y) && near(frame.y + frame.height, area.y + area.height);
}

function place(w, color, focused) {
  const [l, t, r, b] = w.f;
  const dip = screen.screenToDipRect(null, { x: l, y: t, width: r - l, height: b - t });
  const frame = { x: Math.round(dip.x), y: Math.round(dip.y), width: Math.max(1, Math.round(dip.width)), height: Math.max(1, Math.round(dip.height)) };
  const bounds = { x: frame.x, y: frame.y, width: frame.width, height: BAND };
  const scale = (r - l) / frame.width || 1;
  const band = t + BAND * scale;
  // The uncovered parts of the window, cut to the band, in the band's own DIP.
  const rects = [];
  for (const [vl, vt, vr, vb] of w.v) {
    const top = Math.max(vt, t);
    const bottom = Math.min(vb, band);
    if (bottom <= top) continue;
    rects.push([round((vl - l) / scale), round((top - t) / scale), round((vr - vl) / scale), round((bottom - top) / scale)]);
  }
  if (!rects.length) {
    hide(w.h);
    return;
  }
  const payload = { color, focused, radius: square(w, frame) ? 0 : RADIUS, w: bounds.width, h: BAND, rects };
  const L = layers.get(w.h) || create(w.h, bounds);
  const boundsKey = JSON.stringify(bounds);
  if (boundsKey !== L.boundsKey) {
    L.win.setBounds(bounds);
    L.boundsKey = boundsKey;
  }
  const payloadKey = JSON.stringify(payload);
  if (payloadKey !== L.payloadKey) {
    L.payloadKey = payloadKey;
    L.payload = payload;
    if (L.ready) L.win.webContents.send('edge', payload);
  }
  L.wanted = true;
  if (L.ready && !L.win.isVisible()) show(L);
}

function create(h, bounds) {
  const win = new BrowserWindow({
    ...bounds,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    thickFrame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    title: 'Flock edge',
    webPreferences: {
      preload: cfg.preload,
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
      spellcheck: false,
    },
  });
  win.setIgnoreMouseEvents(true);
  // For your eyes only. FLOCK_EDGE_CAPTURE=1 lets a development run screenshot it.
  if (!process.env.FLOCK_EDGE_CAPTURE) win.setContentProtection(true);
  const L = { win, ready: false, wanted: false, boundsKey: JSON.stringify(bounds), payloadKey: '', payload: null };
  win.webContents.once('did-finish-load', () => {
    L.ready = true;
    if (L.payload) win.webContents.send('edge', L.payload);
    if (L.wanted) show(L);
  });
  win.loadFile(cfg.page);
  layers.set(h, L);
  return L;
}

function show(L) {
  if (!alive(L.win)) return;
  L.win.showInactive();
  // Keep the island above every edge.
  if (raiseQueued) return;
  raiseQueued = true;
  setImmediate(() => {
    raiseQueued = false;
    cfg.raise();
  });
}

function hide(h) {
  const L = layers.get(h);
  if (!L) return;
  L.wanted = false;
  if (alive(L.win) && L.win.isVisible()) L.win.hide();
}

function stop() {
  for (const L of layers.values()) if (alive(L.win)) L.win.destroy();
  layers.clear();
}

module.exports = { init, update, handles, stop };
