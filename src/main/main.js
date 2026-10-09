'use strict';
// Flock — run Claude Desktop with several accounts side by side.
// Main process: the island at the top of the screen, the settings window, the
// tray, the account list, and the loop that watches which Claude windows run.

const { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage, screen, shell, dialog, globalShortcut, powerMonitor } = require('electron');
const fs = require('fs');
const path = require('path');

const store = require('./store');
const claude = require('./claude');
const configdir = require('./configdir');
const procscan = require('./procscan');
const windows = require('./windows');
const sessions = require('./sessions');
const { createRouter } = require('./links');
const linkwatch = require('./linkwatch');
const { log, safeUrl } = require('./log');
const { APPDATA, exists, pathKey, samePath, slugify, shortId, tildify } = require('./util');

const ROOT = path.join(__dirname, '..', '..');
const RENDERER = path.join(ROOT, 'src', 'renderer');
const ASSETS = path.join(ROOT, 'assets');
const PRELOAD = path.join(ROOT, 'src', 'preload.js');

const ISLAND_W = 800; // the open island (760) and its ears
const ISLAND_H = 340;
// The compact island's area (DIP, centred at the top): when another app's
// window lies there, the island steps aside. Its width follows the island's.
const ISLAND_ZONE_PAD = 16; // the notch's ears and a little room either side
const ISLAND_ZONE_H = 34;
const SIGNIN_TTL = 10 * 60 * 1000;
const ROUTE_NEXT_TTL = 3 * 60 * 1000;
const LAUNCH_GRACE = 25 * 1000;
const PEEK_SESSIONS = 6; // Code sessions the island lists for an account

// Development runs can keep their own settings, apart from an installed Flock.
if (!app.isPackaged && process.env.FLOCK_DEV_USER_DATA) app.setPath('userData', process.env.FLOCK_DEV_USER_DATA);

// One Flock at a time. Starting it again just brings up its window
// (Flock.exe --quit asks the running one to quit instead).
if (!app.requestSingleInstanceLock() || process.argv.includes('--quit')) {
  app.quit();
  return;
}

app.setAppUserModelId('dev.hnf.flock');

let island = null;
let settingsWin = null;
let settingsGoto = null; // what a settings window that is still loading should open
let tray = null;
let router = null;
let hotkeyOk = true;
let islandExpanded = false;
let lastStateJson = '';
let pollTimer = null;
let polling = false;
let quitting = false;

const live = new Map(); // profile id -> { pids, start, launchingUntil, error }
const armedWith = new Map(); // profile id -> account id it had when sign-in routing started
let captureSnap = {};
let unmanaged = 0;
let focusedId = null; // the account whose Claude window has focus
let compactW = 160; // the compact island's width (DIP), as the island reports it

// ── State ───────────────────────────────────────────────────────────────────

function profiles() {
  return store.get().profiles;
}

function findProfile(id) {
  return profiles().find((p) => p.id === id) || null;
}

function claudeInfo() {
  const where = claude.locate();
  return where ? { found: true, kind: where.kind, launcher: where.launcher } : { found: false };
}

function computeState() {
  const d = store.get();
  const now = Date.now();
  const accounts = d.profiles.map((p) => {
    const L = live.get(p.id) || {};
    const dataDir = claude.dataDirOf(p);
    const acct = claude.readAccount(dataDir);
    const cfg = claude.configDirOf(p, d.profiles);
    const running = Boolean(L.pids && L.pids.length);
    return {
      id: p.id,
      kind: p.kind,
      name: p.name,
      note: p.note || '',
      color: p.color,
      openOnStart: Boolean(p.openOnStart),
      config: p.config,
      dataDir,
      dataDirShort: tildify(dataDir),
      configDir: cfg || configdir.DEFAULT_CONFIG_DIR,
      configShort: tildify(cfg || configdir.DEFAULT_CONFIG_DIR),
      configShared: !cfg,
      running,
      pids: L.pids || [],
      since: running ? L.start : null,
      launching: !running && (L.launchingUntil || 0) > now,
      signedIn: acct.signedIn,
      accountId: acct.accountId,
      capturing: captureSnap[p.id] || null,
      dupOf: null,
      error: L.error || null,
    };
  });
  const seen = new Map();
  for (const a of accounts) {
    if (!a.accountId) continue;
    if (seen.has(a.accountId)) a.dupOf = seen.get(a.accountId);
    else seen.set(a.accountId, a.id);
  }
  return {
    version: app.getVersion(),
    packaged: app.isPackaged,
    claude: claudeInfo(),
    settings: d.settings,
    accounts,
    unmanaged,
    hotkeyOk,
    focused: d.settings.islandFocus ? focusedId : null,
  };
}

function send(win, channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function broadcast(force) {
  const s = computeState();
  const json = JSON.stringify(s);
  if (!force && json === lastStateJson) return;
  lastStateJson = json;
  send(island, 'state', s);
  send(settingsWin, 'state', s);
  rebuildTray(s);
  windows.sync(s);
}

function toast(text, tone = 'info') {
  send(island, 'toast', { text, tone });
  send(settingsWin, 'toast', { text, tone });
}

// ── Watching Claude windows ─────────────────────────────────────────────────

async function poll() {
  if (polling) return;
  polling = true;
  try {
    const inst = await claude.instances();
    const list = profiles();
    const found = new Map();
    let stray = 0;
    for (const i of inst) {
      if (i.link && !i.dataDir) continue; // Windows passing a claude:// link on, gone in a moment
      const id = claude.matchInstance(i, list);
      if (!id) { stray++; continue; }
      const cur = found.get(id) || { pids: [], start: null };
      cur.pids.push(i.pid);
      if (i.start && (!cur.start || i.start < cur.start)) cur.start = i.start;
      found.set(id, cur);
    }
    unmanaged = stray;
    for (const p of list) {
      const prev = live.get(p.id) || {};
      const f = found.get(p.id);
      live.set(p.id, {
        ...prev,
        pids: f ? f.pids : [],
        start: f ? f.start : null,
        launchingUntil: f ? 0 : prev.launchingUntil || 0,
        error: f ? null : prev.error || null,
      });
    }
    // Stop routing sign-in links for an account as soon as it has signed in.
    for (const [id, cap] of Object.entries(router.snapshot())) {
      const p = findProfile(id);
      if (!p) { router.disarm(id); continue; }
      if (cap.scope !== 'signin') continue;
      const acct = claude.readAccount(claude.dataDirOf(p));
      if (acct.signedIn && acct.accountId !== (armedWith.get(id) || null)) {
        router.disarm(id);
        armedWith.delete(id);
        toast(`${p.name} is signed in`, 'ok');
      }
    }
  } catch {
    // Keep the last known state; the next poll will try again.
  } finally {
    polling = false;
  }
  broadcast();
}

function pollInterval() {
  const busy = islandExpanded
    || (settingsWin && !settingsWin.isDestroyed() && settingsWin.isVisible())
    || Object.keys(captureSnap).length > 0
    || [...live.values()].some((l) => (l.launchingUntil || 0) > Date.now());
  return busy ? 1500 : 5000;
}

function schedulePoll(delay) {
  clearTimeout(pollTimer);
  pollTimer = setTimeout(async () => {
    await poll();
    if (!quitting) schedulePoll(pollInterval());
  }, delay == null ? pollInterval() : delay);
}

// ── Actions ─────────────────────────────────────────────────────────────────

function armSignIn(id) {
  const p = findProfile(id);
  if (!p) return;
  armedWith.set(id, claude.readAccount(claude.dataDirOf(p)).accountId || null);
  router.arm(id, 'signin', SIGNIN_TTL);
}

async function launchProfile(id, opts = {}) {
  const p = findProfile(id);
  if (!p) throw new Error('Unknown account');
  const cfg = claude.configDirOf(p, profiles());
  if (cfg && !exists(cfg)) await fs.promises.mkdir(cfg, { recursive: true });

  const L = live.get(id) || {};
  const running = Boolean(L.pids && L.pids.length);
  if (!running) live.set(id, { ...L, launchingUntil: Date.now() + LAUNCH_GRACE, error: null });
  broadcast();
  try {
    const r = await claude.launch(p, profiles(), { url: opts.url });
    log('launch', p.name, running ? '(focus)' : '(start)', opts.url ? safeUrl(opts.url) : '', `via ${r.via}`, cfg ? `CLAUDE_CONFIG_DIR=${cfg}` : 'shared ~/.claude');
  } catch (e) {
    log('launch failed', p.name, e.message);
    live.set(id, { ...(live.get(id) || {}), launchingUntil: 0, error: e.message });
    broadcast();
    toast(e.message, 'err');
    throw e;
  }
  // A window that has never signed in is about to show Claude's sign-in page:
  // make sure a Google sign-in comes back to it.
  if (!opts.url && p.kind !== 'default' && store.get().settings.autoRouteSignIn && !router.isWaiting(id)) {
    if (!claude.readAccount(claude.dataDirOf(p)).signedIn) armSignIn(id);
  }
  schedulePoll(1200);
}

async function launchMany(ids) {
  const gap = store.get().settings.staggerMs;
  let first = true;
  for (const id of ids) {
    const L = live.get(id) || {};
    if (L.pids && L.pids.length) continue;
    if (!first) await new Promise((r) => setTimeout(r, gap));
    first = false;
    try { await launchProfile(id); } catch {}
  }
}

async function quitProfile(id) {
  const L = live.get(id) || {};
  if (!L.pids || !L.pids.length) return;
  await claude.quit(L.pids);
  log('quit', (findProfile(id) || {}).name);
  live.set(id, { ...(live.get(id) || {}), pids: [], start: null });
  broadcast();
  schedulePoll(600);
}

function reservedName(name) {
  return /^(claude|claude code|claude-3p|claude-data)$/i.test(name);
}

function uniqueDataDir(slug) {
  const used = new Set(profiles().filter((p) => p.dataDir).map((p) => pathKey(p.dataDir)));
  let n = 1;
  for (;;) {
    const base = n === 1 ? `Claude-${slug}` : `Claude-${slug}-${n}`;
    const dir = path.join(APPDATA, base);
    n++;
    if (reservedName(base) || used.has(pathKey(dir))) continue;
    if (claude.physicalDirs(dir).some((d) => exists(d))) continue;
    return dir;
  }
}

async function configFromInput(input, slug, ownerId) {
  const c = input || { mode: 'shared' };
  if (c.mode === 'own') {
    const taken = profiles().filter((p) => p.id !== ownerId && p.config && p.config.mode === 'own').map((p) => p.config.dir);
    const dir = c.dir && c.dir.trim() ? c.dir.trim() : configdir.suggestDir(slug, taken);
    if (samePath(dir, configdir.DEFAULT_CONFIG_DIR)) return { mode: 'shared' };
    const preexisting = exists(dir);
    await configdir.prepare(dir, { basics: Boolean(c.seedBasics), skills: Boolean(c.seedSkills) });
    return { mode: 'own', dir, created: c.created || !preexisting };
  }
  if (c.mode === 'link' && c.profileId) {
    const target = findProfile(c.profileId);
    if (target && target.config && target.config.mode === 'own') return { mode: 'link', profileId: c.profileId };
  }
  return { mode: 'shared' };
}

function cleanName(s) {
  return String(s || '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, 40);
}

async function addProfile(input) {
  const name = cleanName(input.name) || 'Account';
  const slug = slugify(name);
  const dataDir = input.dataDir && input.dataDir.trim() ? input.dataDir.trim() : uniqueDataDir(slug);
  const config = await configFromInput(input.config, slug, null);
  const p = {
    id: `p_${shortId()}`,
    kind: 'profile',
    name,
    note: cleanName(input.note),
    color: input.color || store.PALETTE[profiles().length % store.PALETTE.length],
    dataDir,
    config,
    openOnStart: Boolean(input.openOnStart),
    createdAt: Date.now(),
  };
  store.update((d) => { d.profiles.push(p); });
  broadcast(true);
  return p.id;
}

async function updateProfile(id, patch) {
  const p = findProfile(id);
  if (!p) throw new Error('Unknown account');
  const next = {};
  if (patch.name != null) next.name = cleanName(patch.name) || p.name;
  if (patch.note != null) next.note = cleanName(patch.note);
  if (patch.color) next.color = patch.color;
  if (patch.openOnStart != null) next.openOnStart = Boolean(patch.openOnStart);
  if (patch.config) {
    const keepOwn = patch.config.mode === 'own' && p.config && p.config.mode === 'own'
      && (!patch.config.dir || samePath(patch.config.dir, p.config.dir));
    next.config = keepOwn
      ? { ...p.config }
      : await configFromInput(patch.config, slugify(next.name || p.name), id);
    if (keepOwn && (patch.config.seedBasics || patch.config.seedSkills)) {
      await configdir.prepare(p.config.dir, { basics: patch.config.seedBasics, skills: patch.config.seedSkills });
    }
  }
  store.update((d) => {
    const t = d.profiles.find((x) => x.id === id);
    Object.assign(t, next);
  });
  broadcast(true);
}

async function removeProfile(id, { deleteData } = {}) {
  const p = findProfile(id);
  if (!p || p.kind === 'default') throw new Error('The Main account cannot be removed.');
  const L = live.get(id) || {};
  if (L.pids && L.pids.length) await claude.quit(L.pids);
  await router.disarm(id);
  if (deleteData) {
    // Only this account's own folders (always named Claude-…), and only to the Recycle Bin.
    for (const dir of claude.allDirsOf(p.dataDir)) {
      const base = path.basename(dir);
      if (/^Claude-/i.test(base) && !reservedName(base) && exists(dir)) {
        try { await shell.trashItem(dir); } catch (e) { log('could not recycle', dir, e.message); }
      }
    }
    const cfg = p.config || {};
    const linked = profiles().some((x) => x.id !== id && x.config && x.config.mode === 'link' && x.config.profileId === id);
    if (cfg.mode === 'own' && cfg.created && cfg.dir && !linked && !samePath(cfg.dir, configdir.DEFAULT_CONFIG_DIR) && exists(cfg.dir)) {
      try { await shell.trashItem(cfg.dir); } catch {}
    }
  }
  store.update((d) => {
    d.profiles = d.profiles.filter((x) => x.id !== id);
    for (const x of d.profiles) {
      if (x.config && x.config.mode === 'link' && x.config.profileId === id) x.config = { mode: 'shared' };
    }
  });
  live.delete(id);
  broadcast(true);
}

async function revealProfile(id, which) {
  const p = findProfile(id);
  if (!p) return;
  if (which === 'config') {
    const dir = claude.configDirOf(p, profiles()) || configdir.DEFAULT_CONFIG_DIR;
    await fs.promises.mkdir(dir, { recursive: true }).catch(() => {});
    shell.openPath(dir);
    return;
  }
  const dir = claude.existingDataDir(claude.dataDirOf(p));
  if (dir) shell.openPath(dir);
  else toast('This account has not been opened yet, so it has no data folder.', 'warn');
}

// ── Session peek ────────────────────────────────────────────────────────────
// The island lists an account's recent Code sessions; these open them in that
// account's window with Claude's own links, delivered like sign-in links. A
// session Claude already shows in a window of its own is brought to the front
// instead: the link would open it a second time, in the main window.

/** The account's sessions open in windows of their own: [{ id, title, h }], h null when not found. */
async function popouts(p) {
  const L = live.get(p.id) || {};
  if (!L.pids || !L.pids.length) return []; // Claude keeps the list after it quits, to restore them
  const list = await sessions.popouts(p);
  if (!list.length) return [];
  const found = windows.popoutWindows(L.pids, list);
  return list.map((x) => ({ id: x.id, title: x.title, h: found.get(x.id) || null }));
}

async function recentSessions(id) {
  const p = findProfile(id);
  if (!p) return [];
  const open = await popouts(p);
  const list = await sessions.recent(p, PEEK_SESSIONS, open.map((x) => x.id));
  // One Claude has no file for (yet) is still listed, by the title Claude gave its window.
  for (const x of open) {
    if (!list.some((s) => s.id === x.id)) list.unshift({ id: x.id, title: x.title, cwd: null, folder: null, at: 0 });
  }
  const ids = new Set(open.map((x) => x.id));
  return list.map((s) => ({ ...s, window: ids.has(s.id) }));
}

async function openSession(id, sessionId) {
  const p = findProfile(id);
  if (!p || !sessions.ID_RE.test(String(sessionId || ''))) return null;
  const own = (await popouts(p)).find((x) => x.id === sessionId);
  if (own && own.h) {
    if (await windows.raise(own.h)) {
      log('show', p.name, 'session window');
      return 'window';
    }
    log('could not bring a session window forward', p.name);
  }
  await launchProfile(id, { url: `claude://code/continue?session=${sessionId}` });
  return 'opened';
}

/** A new Code session; in the folder of one of the account's sessions when given one. */
async function newSession(id, fromSessionId) {
  const p = findProfile(id);
  if (!p) return;
  const from = fromSessionId ? await sessions.find(p, fromSessionId) : null;
  const url = from && from.cwd ? `claude://code/new?folder=${encodeURIComponent(from.cwd)}` : 'claude://code/new';
  await launchProfile(id, { url });
}

async function searchSessions(id) {
  if (!findProfile(id)) return;
  await launchProfile(id, { url: 'claude://code/search' });
}

function onLinkRouted(kind, _url, ids, keptFromMain) {
  const names = ids.map((id) => (findProfile(id) || {}).name).filter(Boolean).join(', ');
  if (kind === 'google') toast(`Google sign-in passed to ${names}`, 'ok');
  else if (kind === 'signin' && keptFromMain) toast(`Sign-in link sent to ${names}`, 'ok');
  else if (kind === 'signin') toast(`Sign-in link sent to ${names} — if Main shows a code page, ignore it`, 'warn');
  else toast(`Link passed to ${names}`, 'ok');
}

/** Stops the short-lived Claude.exe Windows started for a link, before it reaches Main. */
function stopLinkProcess(pid) {
  try {
    process.kill(pid);
    return true;
  } catch {
    return false;
  }
}

// ── Settings ────────────────────────────────────────────────────────────────

function applyLoginItem() {
  if (!app.isPackaged) return; // a dev build would register electron.exe itself
  app.setLoginItemSettings({ openAtLogin: Boolean(store.get().settings.launchAtLogin), args: ['--hidden'] });
}

function registerHotkey() {
  globalShortcut.unregisterAll();
  const key = store.get().settings.hotkey;
  hotkeyOk = true;
  if (!key) return;
  try {
    hotkeyOk = globalShortcut.register(key, () => toggleIsland(true));
  } catch {
    hotkeyOk = false;
  }
}

async function setSettings(patch) {
  const allowed = ['launchAtLogin', 'islandMode', 'sound', 'hotkey', 'autoRouteSignIn', 'staggerMs', 'windowNames', 'windowEdge', 'islandFocus', 'islandYield'];
  store.update((d) => {
    for (const k of allowed) if (k in patch) d.settings[k] = patch[k];
  });
  if ('launchAtLogin' in patch) applyLoginItem();
  if ('hotkey' in patch) registerHotkey();
  if ('islandMode' in patch) applyIslandMode();
  broadcast(true);
}

// ── Island window ───────────────────────────────────────────────────────────

function islandBounds() {
  const area = screen.getPrimaryDisplay().bounds;
  return {
    x: Math.round(area.x + (area.width - ISLAND_W) / 2),
    y: area.y,
    width: ISLAND_W,
    height: ISLAND_H,
  };
}

/** The island's compact area at the top of the screen, in physical px, for windows.js. */
function islandZone() {
  if (!island || island.isDestroyed() || store.get().settings.islandMode === 'off') return null;
  const b = island.getBounds();
  const width = compactW + 2 * ISLAND_ZONE_PAD;
  const r = screen.dipToScreenRect(null, { x: Math.round(b.x + (b.width - width) / 2), y: b.y, width, height: ISLAND_ZONE_H });
  return [r.x, r.y, r.x + r.width, r.y + r.height];
}

function updateZone() {
  windows.setZone(islandZone());
}

function createIsland() {
  island = new BrowserWindow({
    ...islandBounds(),
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    show: false,
    title: 'Flock',
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
      spellcheck: false,
    },
  });
  island.setAlwaysOnTop(true, 'screen-saver');
  island.setIgnoreMouseEvents(true, { forward: true });
  island.loadFile(path.join(RENDERER, 'island', 'index.html'));
  island.once('ready-to-show', () => applyIslandMode());
  island.on('blur', () => send(island, 'island:blur'));
  island.on('closed', () => { island = null; });
  const fit = () => {
    if (island && !island.isDestroyed()) island.setBounds(islandBounds());
    updateZone();
  };
  screen.on('display-metrics-changed', fit);
  screen.on('display-added', fit);
  screen.on('display-removed', fit);
}

function applyIslandMode() {
  if (!island || island.isDestroyed()) return;
  const mode = store.get().settings.islandMode;
  if (mode === 'off') island.hide();
  else if (!island.isVisible()) island.showInactive();
  updateZone();
}

function toggleIsland(focus) {
  if (!island || island.isDestroyed()) return;
  if (!island.isVisible()) island.showInactive();
  if (focus) {
    island.setIgnoreMouseEvents(false);
    island.focus();
  }
  send(island, 'island:toggle');
}

function expandIsland(reason) {
  if (!island || island.isDestroyed()) return;
  if (!island.isVisible()) island.showInactive();
  send(island, 'island:expand', reason || null);
}

function profileMenu(id) {
  const s = computeState();
  const a = s.accounts.find((x) => x.id === id);
  if (!a) return null;
  const items = [
    { label: a.running ? `Show ${a.name}` : `Open ${a.name}`, click: () => launchProfile(id).catch(() => {}) },
  ];
  if (a.running) items.push({ label: 'Quit this window', click: () => quitProfile(id) });
  items.push({ type: 'separator' });
  if (a.kind !== 'default') {
    items.push(a.capturing
      ? { label: 'Stop waiting for sign-in', click: () => router.disarm(id) }
      : { label: a.signedIn ? 'Sign in again…' : 'Sign in…', click: () => signIn(id) });
  }
  if (a.kind !== 'default') items.push({ label: 'Pass the next claude:// link here (connector sign-in)', click: () => routeNext(id) });
  items.push({ type: 'separator' });
  items.push({ label: 'Edit…', click: () => openSettings({ edit: id }) });
  items.push({ label: 'Open data folder', click: () => revealProfile(id, 'data') });
  items.push({ label: a.configShared ? 'Open ~/.claude (shared)' : 'Open its own ~/.claude', click: () => revealProfile(id, 'config') });
  return Menu.buildFromTemplate(items);
}

async function signIn(id) {
  armSignIn(id);
  await launchProfile(id).catch(() => {});
  broadcast(true);
}

function routeNext(id) {
  router.arm(id, 'all', ROUTE_NEXT_TTL);
  const p = findProfile(id);
  toast(`For 3 min, the next claude:// link also goes to ${p ? p.name : 'this account'} — connect the connector now`, 'info');
}

// ── Settings window ─────────────────────────────────────────────────────────

function openSettings(goto) {
  if (settingsWin && !settingsWin.isDestroyed()) {
    if (settingsWin.isMinimized()) settingsWin.restore();
    settingsWin.show();
    settingsWin.focus();
    if (goto) send(settingsWin, 'settings:goto', goto);
    schedulePoll(0);
    return;
  }
  settingsWin = new BrowserWindow({
    width: 640,
    height: 800,
    minWidth: 540,
    minHeight: 560,
    show: false,
    title: 'Flock',
    icon: path.join(ASSETS, 'icon.png'),
    backgroundColor: '#0b0c0e',
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#0b0c0e', symbolColor: '#9398a1', height: 40 },
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      sandbox: true,
      spellcheck: false,
    },
  });
  settingsWin.loadFile(path.join(RENDERER, 'settings', 'index.html'));
  // A brand-new window may not be listening yet: it asks for this once it has loaded.
  settingsGoto = goto || null;
  settingsWin.once('ready-to-show', () => settingsWin.show());
  settingsWin.on('closed', () => { settingsWin = null; });
  schedulePoll(0);
}

// ── Tray ────────────────────────────────────────────────────────────────────

let trayKey = '';

function rebuildTray(s) {
  if (!tray) return;
  const key = JSON.stringify(s.accounts.map((a) => [a.id, a.name, a.running, a.launching]));
  if (key === trayKey) return;
  trayKey = key;
  const running = s.accounts.filter((a) => a.running).length;
  tray.setToolTip(`Flock — ${running} of ${s.accounts.length} open`);
  const accountItems = s.accounts.map((a) => ({
    label: `${a.running ? '●' : '○'}  ${a.name}`,
    click: () => launchProfile(a.id).catch(() => {}),
  }));
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Flock', enabled: false },
    { type: 'separator' },
    ...accountItems,
    { type: 'separator' },
    { label: 'Open every account', click: () => launchMany(s.accounts.map((a) => a.id)) },
    { label: 'Show the island', click: () => expandIsland() },
    { label: 'Settings…', click: () => openSettings() },
    { type: 'separator' },
    { label: 'Quit Flock', click: () => app.quit() },
  ]));
}

function createTray() {
  const img = nativeImage.createFromPath(path.join(ASSETS, 'tray.png'));
  tray = new Tray(img.isEmpty() ? nativeImage.createEmpty() : img);
  tray.on('click', () => expandIsland('tray'));
  tray.on('double-click', () => openSettings());
}

// ── IPC ─────────────────────────────────────────────────────────────────────

function wireIpc() {
  ipcMain.handle('state:get', () => computeState());
  ipcMain.handle('profile:launch', (_e, id) => launchProfile(id));
  ipcMain.handle('profile:launchMany', (_e, ids) => launchMany(Array.isArray(ids) ? ids : []));
  ipcMain.handle('profile:quit', (_e, id) => quitProfile(id));
  ipcMain.handle('profile:signIn', (_e, id) => signIn(id));
  ipcMain.handle('profile:signInDone', (_e, id) => { armedWith.delete(id); return router.disarm(id); });
  ipcMain.handle('profile:routeNext', (_e, id) => routeNext(id));
  ipcMain.handle('profile:add', (_e, input) => addProfile(input || {}));
  ipcMain.handle('profile:update', (_e, id, patch) => updateProfile(id, patch || {}));
  ipcMain.handle('profile:remove', (_e, id, opts) => removeProfile(id, opts || {}));
  ipcMain.handle('profile:reveal', (_e, id, which) => revealProfile(id, which));
  ipcMain.handle('profile:sessions', (_e, id) => recentSessions(id));
  ipcMain.handle('profile:openSession', (_e, id, sessionId) => openSession(id, sessionId));
  ipcMain.handle('profile:newSession', (_e, id, fromSessionId) => newSession(id, fromSessionId));
  ipcMain.handle('profile:searchSessions', (_e, id) => searchSessions(id));
  ipcMain.handle('profile:reorder', (_e, ids) => {
    store.update((d) => {
      const order = new Map((ids || []).map((id, i) => [id, i]));
      d.profiles.sort((a, b) => (order.get(a.id) ?? 999) - (order.get(b.id) ?? 999));
    });
    broadcast(true);
  });
  ipcMain.handle('settings:set', (_e, patch) => setSettings(patch || {}));
  ipcMain.handle('settings:open', (_e, goto) => openSettings(goto));
  ipcMain.handle('settings:takeGoto', () => {
    const g = settingsGoto;
    settingsGoto = null;
    return g;
  });
  ipcMain.handle('seed:info', () => configdir.seedInfo());
  ipcMain.handle('suggest:paths', (_e, name) => {
    const slug = slugify(name || 'Account');
    const taken = profiles().filter((p) => p.config && p.config.mode === 'own').map((p) => p.config.dir);
    return { dataDir: uniqueDataDir(slug), configDir: configdir.suggestDir(slug, taken) };
  });
  ipcMain.handle('dialog:folder', async (e, opts) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const r = await dialog.showOpenDialog(win, {
      title: (opts && opts.title) || 'Choose a folder',
      defaultPath: opts && opts.defaultPath,
      properties: ['openDirectory', 'createDirectory'],
    });
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle('app:quit', () => app.quit());
  ipcMain.handle('app:openExternal', (_e, url) => {
    let u;
    try { u = new URL(String(url)); } catch { return; }
    if (u.protocol === 'https:' && ['claude.ai', 'github.com'].includes(u.hostname)) shell.openExternal(u.toString());
  });
  ipcMain.on('island:mouse', (_e, inside) => {
    if (island && !island.isDestroyed()) island.setIgnoreMouseEvents(!inside, { forward: true });
  });
  ipcMain.on('island:width', (_e, w) => {
    const next = Math.max(80, Math.min(ISLAND_W, Number(w) || 0));
    if (next === compactW) return;
    compactW = next;
    updateZone();
  });
  ipcMain.on('island:expanded', (_e, on) => {
    islandExpanded = Boolean(on);
    if (on) schedulePoll(0);
  });
  ipcMain.on('island:menu', (_e, id) => {
    const m = profileMenu(id);
    if (m && island && !island.isDestroyed()) m.popup({ window: island });
  });
}

// ── Lifecycle ───────────────────────────────────────────────────────────────

/** A pinned account button starts Flock with --open=<account>: open that account. */
function openFromArgs(argv) {
  const arg = (argv || []).find((a) => a.startsWith('--open='));
  const id = arg ? arg.slice('--open='.length) : null;
  if (!id || !findProfile(id)) return false;
  launchProfile(id).catch(() => {});
  return true;
}

app.on('second-instance', (_e, argv) => {
  if (argv.includes('--quit')) app.quit();
  else if (!openFromArgs(argv)) openSettings();
});

app.on('window-all-closed', () => {
  // Flock lives in the tray; closing windows does not quit it.
});

app.on('before-quit', (e) => {
  if (quitting) return;
  quitting = true;
  e.preventDefault();
  clearTimeout(pollTimer);
  globalShortcut.unregisterAll();
  if (router) router.stop();
  procscan.stop();
  // Give Claude's windows their own names and icons back before leaving.
  windows.quit().finally(() => app.exit(0));
});

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  store.load();
  router = createRouter({
    watchLinks: (onLink) => linkwatch.start((proc) => {
      const link = claude.linkFromProcess(proc);
      if (link) onLink(link);
    }),
    scanLinks: () => claude.pendingLinks(),
    suppress: stopLinkProcess,
    deliver: async (id, url) => {
      const p = findProfile(id);
      if (p) await claude.launch(p, profiles(), { url });
    },
    onRouted: onLinkRouted,
    onChange: (snap) => {
      captureSnap = snap;
      broadcast();
    },
  });
  wireIpc();
  const where = claude.locate();
  log('start', `Flock ${app.getVersion()}`, app.isPackaged ? 'installed' : 'dev', where ? `${where.kind} ${where.launcher}` : 'Claude not found');
  createTray();
  createIsland();
  windows.init({
    preload: PRELOAD,
    page: path.join(RENDERER, 'edge', 'index.html'),
    skip: () => [island],
    raise: () => { if (island && !island.isDestroyed()) island.moveTop(); },
    onFocus: (id) => {
      focusedId = id;
      broadcast();
    },
    onYield: (on) => send(island, 'island:yield', on),
  });
  registerHotkey();
  applyLoginItem();
  await poll();
  schedulePoll();

  const hidden = process.argv.includes('--hidden') || openFromArgs(process.argv);
  const extra = profiles().filter((p) => p.kind !== 'default');
  if (!hidden && extra.length === 0) openSettings({ welcome: true });
  else if (!hidden) setTimeout(() => expandIsland('hello'), 700);

  const autoOpen = profiles().filter((p) => p.openOnStart).map((p) => p.id);
  if (autoOpen.length) setTimeout(() => launchMany(autoOpen), hidden ? 2500 : 900);

  powerMonitor.on('resume', () => schedulePoll(1000));
});
