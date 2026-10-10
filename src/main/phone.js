'use strict';
// Flock from your phone. Pairs phones with this PC (a QR code in Settings),
// then answers what the Flock phone app asks over the encrypted relay
// (../shared/relay.js): the accounts and how much of their usage is left,
// folders to pick or create, and Claude Code Remote Control servers
// (remote.js) started in any of them under any account. The sessions those
// servers run are driven from the Claude app, signed in to that account; this
// link starts and stops them and passes on Claude Code's own questions, but
// never carries a prompt, so it can't tell Claude what to do.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { app, safeStorage, powerSaveBlocker } = require('electron');
const qrcode = require('qrcode-generator');
const Relay = require('../shared/relay');
const store = require('./store');
const claude = require('./claude');
const cli = require('./cli');
const sessions = require('./sessions');
const folders = require('./folders');
const remote = require('./remote');
const { log } = require('./log');
const { samePath, pathKey, shortId } = require('./util');

const PAIR_TTL = 10 * 60 * 1000;
const SEEN_SAVE_MS = 60 * 1000;
const FIVE_HOURS = 5 * 60 * 60 * 1000;
const WEEK = 7 * 24 * 60 * 60 * 1000;
const MAX_DIRS = 200;

let deps = null; // { profiles, findProfile, isRunning, version, onChange, toast, scriptDir }
const channels = new Map(); // device id -> relay channel
let pairing = null; // { topic, key, until, channel, url, svg, timer }
let blocker = null;
let recentCache = { at: 0, list: [] };

const opts = () => store.get().phone;
// Where Flock keeps the second Claude Code sign-in for ~/.claude (cli.js), one folder per account.
const storeRoot = () => path.join(deps.scriptDir, 'sign-ins');

// ── Keys ────────────────────────────────────────────────────────────────────
// A paired phone's key is kept sealed with Windows' DPAPI (Electron's
// safeStorage), readable only by this Windows user on this PC.

function seal(key) {
  return safeStorage.isEncryptionAvailable() ? `enc:${safeStorage.encryptString(key).toString('base64')}` : `raw:${key}`;
}

function unseal(v) {
  try {
    if (v.startsWith('enc:')) return safeStorage.decryptString(Buffer.from(v.slice(4), 'base64'));
    if (v.startsWith('raw:')) return v.slice(4);
  } catch {}
  return null;
}

/** Takes in the sign-ins finished in a window Flock opened: from then on, each is its account's. */
function settleSignIns() {
  for (const [id, w] of Object.entries(opts().pending)) {
    if (!fs.existsSync(w.done)) continue;
    try { fs.unlinkSync(w.done); } catch {}
    store.update((d) => {
      delete d.phone.pending[id];
      for (const k of Object.keys(d.phone.owners)) if (d.phone.owners[k] === id) delete d.phone.owners[k];
      d.phone.owners[w.key] = id;
      if (w.key === cli.DEFAULT_KEY) d.phone.renew = false;
    });
    cli.forget();
    log('phone', 'signed in', id, w.key);
  }
}

/** Each account's Claude Code sign-in (cli.signIns). */
async function accountSignIns(extra) {
  settleSignIns();
  const o = opts();
  // Until Flock signs an account in to ~/.claude, a name kept with
  // CLAUDE_CONFIG_DIR set to ~/.claude comes from a sign-in that wrote over
  // ~/.claude's own (Flock 0.2.1's, or one by hand). Once found, that stays
  // true until ~/.claude's own is signed in again from Flock.
  if (!o.renew && !o.owners[cli.DEFAULT_KEY] && !o.owners[cli.SECOND_KEY] && await cli.overwritten(extra)) {
    store.update((d) => { d.phone.renew = true; });
    log('phone', '~/.claude sign-in may be another account’s: it has to be signed in again');
  }
  return cli.signIns(deps.profiles(), { ...opts(), storeRoot: storeRoot() }, extra);
}

// ── Views ───────────────────────────────────────────────────────────────────

function usageOf(p) {
  const u = claude.readUsage(claude.dataDirOf(p));
  if (!u) return null;
  const age = Date.now() - u.t;
  const out = { fh: age < FIVE_HOURS ? u.fh : null, sd: age < WEEK ? u.sd : null, t: u.t };
  return out.fh == null && out.sd == null ? null : out;
}

/** The accounts using the Claude Code sign-ins an 'unsupported' account's ~/.claude can have, by name. */
function usersOf(s) {
  if (!s || s.problem !== 'unsupported') return null;
  const names = (s.users || []).map((id) => deps.findProfile(id)).filter(Boolean).map((p) => p.name);
  return names.length ? names.join(' and ') : null;
}

function cliView(s) {
  if (!s) return { ok: false, problem: 'unknown' };
  return { ok: Boolean(s.ok), problem: s.problem || null, email: s.status ? s.status.email : null, holder: usersOf(s) };
}

function serverView(snap) {
  const p = deps.findProfile(snap.account);
  return { ...snap, accountName: p ? p.name : 'Removed account', color: p ? p.color : '#9398A1' };
}

async function state() {
  const profiles = deps.profiles();
  const signIns = await accountSignIns();
  return {
    pc: { name: os.hostname(), version: deps.version },
    accounts: profiles.map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      main: p.kind === 'default',
      window: deps.isRunning(p.id),
      usage: usageOf(p),
      cli: cliView(signIns.get(p.id)),
    })),
    servers: remote.list().map(serverView),
    options: { permissionMode: opts().permissionMode, spawn: opts().spawn },
  };
}

// ── Folders ─────────────────────────────────────────────────────────────────

/** Recent project folders of every account (for the default project folders), refreshed each minute. */
async function everyRecent() {
  if (Date.now() - recentCache.at < 60 * 1000) return recentCache.list;
  const lists = await Promise.all(deps.profiles().map((p) => sessions.recentFolders(p, 20).catch(() => [])));
  const extra = opts().recent.map((r) => ({ path: r.path, at: r.at }));
  recentCache = { at: Date.now(), list: [...lists.flat(), ...extra] };
  return recentCache.list;
}

/** The account's recent folders, from its Code sessions and from the phone, newest first. */
async function recentOf(p) {
  const fromPhone = opts().recent.filter((r) => r.account === p.id).map((r) => ({ path: r.path, at: r.at }));
  const merged = [...(await sessions.recentFolders(p, 20)), ...fromPhone].sort((a, b) => b.at - a.at);
  const seen = new Set();
  const out = [];
  for (const r of merged) {
    const k = pathKey(r.path);
    if (seen.has(k) || !folders.isDir(r.path)) continue;
    seen.add(k);
    out.push(r);
    if (out.length >= 12) break;
  }
  return out;
}

function remember(account, dir) {
  store.update((d) => {
    d.phone.recent = [{ account, path: dir, at: Date.now() }, ...d.phone.recent.filter((r) => !(r.account === account && samePath(r.path, dir)))].slice(0, 40);
  });
  recentCache.at = 0;
}

function profileOr(id) {
  const p = deps.findProfile(id);
  if (!p) throw new Error('That account isn’t in Flock any more.');
  return p;
}

async function rootList() {
  return folders.roots(opts().roots, await everyRecent());
}

async function listFolders(accountId, dir) {
  const p = profileOr(accountId);
  const roots = await rootList();
  if (!dir) {
    return {
      recent: (await recentOf(p)).map((r) => ({ path: r.path, name: path.basename(r.path) || r.path, at: r.at })),
      roots: roots.map((r) => ({ path: r, name: path.basename(r) || r })),
    };
  }
  if (!folders.allowed(dir, roots, await everyRecent())) {
    throw new Error('That folder isn’t in your project folders. Add it in Flock’s settings on the PC.');
  }
  const root = roots.find((r) => folders.within(dir, r)) || null;
  const dirs = root ? await folders.list(dir) : [];
  return {
    path: dir,
    name: path.basename(dir) || dir,
    parent: root && !samePath(root, dir) ? path.dirname(dir) : null,
    canCreate: Boolean(root),
    git: folders.isGitRepo(dir),
    dirs: dirs.slice(0, MAX_DIRS),
    more: Math.max(0, dirs.length - MAX_DIRS),
  };
}

async function makeFolder(accountId, parent, name, git) {
  const p = profileOr(accountId);
  const roots = await rootList();
  if (!parent || !roots.some((r) => folders.within(parent, r))) {
    throw new Error('New folders go inside your project folders. Add one in Flock’s settings on the PC.');
  }
  const made = await folders.create(parent, name, { git: Boolean(git) });
  log('phone', 'new folder', made.path, made.git ? '(git)' : '', 'for', p.name);
  remember(p.id, made.path);
  return made;
}

// ── Servers ─────────────────────────────────────────────────────────────────

function problemText(p, s) {
  const name = p.name;
  switch (s.problem) {
    case 'no-cli': return 'Claude Code isn’t installed on your PC. Install it there (claude.com/claude-code), then try again.';
    case 'signed-out': return `${name}’s Claude Code isn’t signed in yet. On your PC: Flock → Settings → Phone → Sign in next to ${name}.`;
    case 'other-account': return `${name}’s Claude Code is signed in as ${s.status.email || 'another account'}, not ${name}’s Claude account. Sign it in again from Flock’s settings on your PC.`;
    case 'not-claude-ai': return `${name}’s Claude Code uses an API key. Remote Control needs a claude.ai sign-in: sign in again from Flock’s settings on your PC.`;
    case 'renew': return `${name}’s Claude Code sign-in may have been taken over by another account. Sign it in again from Flock’s settings on your PC.`;
    case 'unsupported': {
      const others = usersOf(s) || 'other accounts';
      return `${name} shares its ~/.claude with ${others}, and there’s no Claude Code sign-in left for it. To start sessions as ${name}, give it its own ~/.claude in Flock on your PC.`;
    }
    default: return `Flock couldn’t check ${name}’s Claude Code sign-in.`;
  }
}

/**
 * A session's name, from the phone or a session's title, as it can go on a
 * command line (through cmd.exe, with npm's claude.cmd): one line, without
 * quotes or cmd.exe's special characters, 80 characters at most; null if
 * nothing is left.
 */
function sessionName(raw) {
  if (typeof raw !== 'string') return null;
  const s = raw.replace(/["%^&|<>\x00-\x1f\x7f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80).trim();
  return s || null;
}

/** Whether Claude Code, run with the config folder `dir`, keeps a conversation `id`: projects\<folder>\<id>.jsonl. */
function hasConversation(dir, id) {
  const root = path.join(dir || claude.DEFAULT_CONFIG_DIR, 'projects');
  let names = [];
  try { names = fs.readdirSync(root); } catch { return false; }
  return names.some((n) => {
    try { return fs.statSync(path.join(root, n, `${id}.jsonl`)).isFile(); } catch { return false; }
  });
}

/**
 * Starts Claude Code with Remote Control in a folder. With a `name`, a new
 * conversation under that name; or, given the id of one started that way
 * (`conversation`) that Claude Code kept, that one again. Without a name, a
 * server (`claude remote-control`) whose session Claude Code names itself.
 */
async function startServer(accountId, dir, name, conversation) {
  const p = profileOr(accountId);
  if (!dir || !folders.isDir(dir)) throw new Error('That folder doesn’t exist on your PC any more.');
  if (!folders.allowed(dir, await rootList(), await everyRecent())) {
    throw new Error('That folder isn’t in your project folders. Add it in Flock’s settings on the PC.');
  }
  const signIn = (await accountSignIns()).get(p.id);
  if (!signIn || !signIn.ok) throw new Error(problemText(p, signIn || {}));
  const launcher = cli.launcher();
  const env = cli.envFor(signIn);
  const title = sessionName(name);
  let snap;
  if (title) {
    const again = typeof conversation === 'string' && sessions.UUID_RE.test(conversation) && hasConversation(signIn.dir, conversation);
    const id = again ? conversation : crypto.randomUUID();
    const args = again ? ['--resume', id] : ['--session-id', id];
    if (opts().permissionMode !== 'default') args.push('--permission-mode', opts().permissionMode);
    args.push('--remote-control', title);
    snap = await remote.start({ kind: 'new', account: p.id, folder: dir, launcher, env, args, title, conversation: id });
  } else {
    const spawnMode = opts().spawn === 'worktree' && folders.isGitRepo(dir) ? 'worktree' : 'same-dir';
    snap = await remote.start({ account: p.id, folder: dir, launcher, env, spawnMode, permissionMode: opts().permissionMode });
  }
  remember(p.id, dir);
  return serverView(snap);
}

/** The account's Code sessions, newest first; only one folder's when `dir` is given. */
async function listSessions(accountId, dir) {
  const p = profileOr(accountId);
  const running = new Map(remote.list().filter((s) => s.kind === 'session' && ['starting', 'asking', 'ready'].includes(s.status)).map((s) => [s.session, s.id]));
  const list = await sessions.continuable(p, { folder: dir || null });
  return {
    window: deps.isRunning(p.id),
    sessions: list.map((s) => ({ ...s, server: running.get(s.id) || null })),
  };
}

/**
 * Reopens one of the account's Code sessions with Remote Control on, so it
 * carries on from the phone with all its history. When the account's Claude
 * window is open it may still be using the session, and two programs writing
 * one conversation would split it, so the phone then gets a copy (a fork with
 * an id of Flock's choosing, which Claude's window can open later). It shows
 * as `name` in the Claude app, else under the session's own title.
 */
async function continueSession(accountId, sessionId, name) {
  const p = profileOr(accountId);
  const s = sessionId ? await sessions.find(p, sessionId) : null;
  if (!s || !s.cli) throw new Error('Flock can’t find that session on your PC any more.');
  if (!s.cwd || !folders.isDir(s.cwd)) throw new Error('That session’s folder isn’t on your PC any more.');
  const signIn = (await accountSignIns()).get(p.id);
  if (!signIn || !signIn.ok) throw new Error(problemText(p, signIn || {}));
  const forkId = deps.isRunning(p.id) ? crypto.randomUUID() : null;
  const title = sessionName(name) || sessionName(s.title) || sessionName(path.basename(s.cwd)) || 'Claude Code';
  const args = ['--resume', s.cli];
  if (forkId) args.push('--fork-session', '--session-id', forkId);
  if (s.model) args.push('--model', s.model);
  if (s.effort) args.push('--effort', s.effort);
  if (opts().permissionMode !== 'default') args.push('--permission-mode', opts().permissionMode);
  args.push('--remote-control', title);
  const snap = await remote.start({
    kind: 'session', account: p.id, folder: s.cwd, launcher: cli.launcher(), env: cli.envFor(signIn), args, title, session: s.id, forkId,
  });
  remember(p.id, s.cwd);
  return serverView(snap);
}

function answer(serverId, promptId, reply) {
  if (!remote.answer(serverId, promptId, reply || {})) throw new Error('That question was already answered, or has gone.');
  return true;
}

function stopServer(serverId) {
  if (!remote.stop(serverId)) throw new Error('That folder isn’t running any more.');
  return true;
}

/**
 * An account's Claude window just opened: the sessions the phone reopened in
 * place for it go back to the window, so the two never write to one
 * conversation at once.
 */
function windowOpened(id) {
  const stopped = remote.handBack(id);
  if (!stopped.length) return;
  const p = deps.findProfile(id);
  const names = stopped.map((t) => `“${t}”`).join(', ');
  deps.toast(`${p ? `${p.name}’s` : 'A'} Claude window opened, so Flock stopped ${names} on the phone. It carries on in the window.`, 'info');
}

/**
 * Opens the copy of a session the phone carried on, in its account's Claude
 * window (Claude imports the conversation). Stops it on the phone first:
 * Claude won't take over a conversation another program is still running.
 */
async function openCopy(serverId) {
  const s = remote.get(serverId);
  if (!s || !s.forkId || !sessions.UUID_RE.test(s.forkId)) throw new Error('That session has no copy to open.');
  const running = () => ['starting', 'asking', 'ready'].includes((remote.get(serverId) || {}).status);
  if (running()) {
    remote.stop(serverId);
    for (let waited = 0; running() && waited < 8000; waited += 200) await new Promise((r) => setTimeout(r, 200));
  }
  await deps.openInWindow(s.account, `claude://resume?session=${s.forkId}`);
}

// ── The link ────────────────────────────────────────────────────────────────

function broadcast(msg) {
  for (const ch of channels.values()) ch.send(msg).catch(() => {});
}

let seenTimer = 0;
const seenNow = new Map(); // device id -> last message time, saved now and then

function touch(id) {
  seenNow.set(id, Date.now());
  if (seenTimer) return;
  seenTimer = setTimeout(() => {
    seenTimer = 0;
    store.update((d) => {
      for (const dev of d.phone.devices) if (seenNow.has(dev.id)) dev.seenAt = seenNow.get(dev.id);
    });
    deps.onChange();
  }, SEEN_SAVE_MS);
}

/** A folder path from the phone, made absolute and free of ".." before any check, or null. */
function folderArg(p) {
  return typeof p === 'string' && p && path.isAbsolute(p) ? path.resolve(p) : null;
}

async function handle(dev, msg) {
  switch (msg.t) {
    case 'hello':
    case 'state': return state();
    case 'folders': return listFolders(msg.account, folderArg(msg.path));
    case 'mkdir': return makeFolder(msg.account, folderArg(msg.parent), msg.name, msg.git);
    case 'start': return startServer(msg.account, folderArg(msg.path), msg.name, msg.conversation);
    case 'sessions': return listSessions(msg.account, folderArg(msg.path));
    case 'continue': return continueSession(msg.account, typeof msg.session === 'string' ? msg.session : null, msg.name);
    case 'answer': return answer(msg.server, msg.prompt, { yes: Boolean(msg.yes), option: msg.option });
    case 'stop': return stopServer(msg.server);
    case 'forget':
      setTimeout(() => unpair(dev.id), 500); // after the reply has gone out
      return true;
    default: throw new Error('Flock on your PC doesn’t know that request. Update Flock.');
  }
}

async function onMessage(devId, msg) {
  const ch = channels.get(devId);
  const dev = opts().devices.find((d) => d.id === devId);
  if (!ch || !dev || typeof msg.t !== 'string') return;
  touch(devId);
  try {
    const data = await handle(dev, msg);
    await ch.send({ t: 're', re: msg.id, ok: true, data });
  } catch (e) {
    await ch.send({ t: 're', re: msg.id, ok: false, error: String((e && e.message) || e) }).catch(() => {});
  }
}

function connect(dev) {
  if (channels.has(dev.id)) return;
  const key = unseal(dev.key);
  if (!key) {
    log('phone', 'could not unseal the key of', dev.name);
    return;
  }
  channels.set(dev.id, Relay.connect({
    server: opts().server,
    topic: dev.topic,
    key,
    role: 'pc',
    onMessage: (msg) => { onMessage(dev.id, msg); },
    onStatus: (s) => { if (s !== 'connecting') log('phone link', dev.name, s); },
  }));
}

function disconnectAll() {
  for (const ch of channels.values()) ch.close();
  channels.clear();
}

function syncAwake() {
  const want = opts().enabled && opts().keepAwake && opts().devices.length > 0;
  if (want && blocker == null) blocker = powerSaveBlocker.start('prevent-app-suspension');
  if (!want && blocker != null) {
    powerSaveBlocker.stop(blocker);
    blocker = null;
  }
}

/** Connects every paired phone, or none when phone access is off. */
function sync() {
  if (!opts().enabled) {
    disconnectAll();
    cancelPairing();
  } else {
    const ids = new Set(opts().devices.map((d) => d.id));
    for (const [id, ch] of channels) if (!ids.has(id)) { ch.close(); channels.delete(id); }
    opts().devices.forEach(connect);
  }
  syncAwake();
}

// ── Pairing ─────────────────────────────────────────────────────────────────

function cancelPairing() {
  if (!pairing) return;
  clearTimeout(pairing.timer);
  pairing.channel.close();
  pairing = null;
  if (deps.onPairing) deps.onPairing(false);
}

/** Shows a fresh pairing code: a QR code with the phone app's address, the channel and the key. */
function pair() {
  cancelPairing();
  const fresh = Relay.newPairing();
  const url = `${opts().appUrl}#p=${Relay.encodePairing({ ...fresh, server: opts().server, name: os.hostname() })}`;
  const qr = qrcode(0, 'M');
  qr.addData(url);
  qr.make();
  const p = {
    ...fresh,
    url,
    svg: qr.createSvgTag({ cellSize: 4, margin: 3, scalable: true }),
    until: Date.now() + PAIR_TTL,
    timer: null,
    channel: null,
  };
  // The phone says hello on the new channel as soon as it has read the code.
  p.channel = Relay.connect({
    server: opts().server,
    topic: p.topic,
    key: p.key,
    role: 'pc',
    onMessage: (msg) => { if (msg.t === 'hello') adopt(p, msg); },
  });
  p.timer = setTimeout(() => { cancelPairing(); deps.onChange(); }, PAIR_TTL);
  pairing = p;
  if (deps.onPairing) deps.onPairing(true);
  log('phone', 'pairing code shown');
  return { url: p.url, svg: p.svg, until: p.until };
}

function adopt(p, hello) {
  if (pairing !== p) return;
  const name = String((hello.device && hello.device.name) || 'Phone').replace(/[\r\n\t]+/g, ' ').trim().slice(0, 40) || 'Phone';
  const dev = { id: `d_${shortId()}`, name, topic: p.topic, key: seal(p.key), pairedAt: Date.now(), seenAt: Date.now() };
  clearTimeout(p.timer);
  pairing = null;
  if (deps.onPairing) deps.onPairing(false);
  store.update((d) => { d.phone.devices.push(dev); });
  // The phone keeps this channel; its hello is answered on the device's own connection.
  p.channel.close();
  connect(dev);
  log('phone', 'paired', name);
  deps.toast(`Paired with ${name}`, 'ok');
  syncAwake();
  deps.onChange();
  setTimeout(() => onMessage(dev.id, hello), 600);
}

function unpair(id) {
  const dev = opts().devices.find((d) => d.id === id);
  if (!dev) return;
  const ch = channels.get(id);
  if (ch) ch.close();
  channels.delete(id);
  store.update((d) => { d.phone.devices = d.phone.devices.filter((x) => x.id !== id); });
  log('phone', 'unpaired', dev.name);
  syncAwake();
  deps.onChange();
}

// ── Settings window ─────────────────────────────────────────────────────────

/** Everything the Phone section of Settings shows. */
async function view({ fresh } = {}) {
  const o = opts();
  const profiles = deps.profiles();
  const signIns = await accountSignIns({ fresh });
  const roots = await rootList();
  return {
    enabled: o.enabled,
    cliFound: Boolean(cli.locate()),
    devices: o.devices.map((d) => ({ id: d.id, name: d.name, pairedAt: d.pairedAt, seenAt: seenNow.get(d.id) || d.seenAt || null })),
    pairing: pairing ? { url: pairing.url, svg: pairing.svg, until: pairing.until } : null,
    accounts: profiles.map((p) => ({ id: p.id, name: p.name, color: p.color, cli: cliView(signIns.get(p.id)) })),
    roots,
    rootsSet: o.roots.length > 0,
    servers: remote.list().map(serverView),
    permissionMode: o.permissionMode,
    spawn: o.spawn,
    keepAwake: o.keepAwake,
    server: o.server,
    appUrl: o.appUrl,
  };
}

async function setOptions(patch) {
  const allowed = ['enabled', 'permissionMode', 'spawn', 'keepAwake', 'roots'];
  store.update((d) => {
    for (const k of allowed) if (k in patch) d.phone[k] = patch[k];
  });
  recentCache.at = 0;
  sync();
  deps.onChange();
}

/**
 * Opens a terminal to sign this account's Claude Code in. Once that sign-in
 * succeeds, it is the account's (accountSignIns); closing the window first
 * changes nothing.
 */
async function signIn(id) {
  const p = profileOr(id);
  const s = (await accountSignIns()).get(p.id);
  if (!s || s.problem === 'unsupported') throw new Error(problemText(p, s || {}));
  const done = cli.openSignIn(s, { title: `Flock: sign ${p.name} in to Claude Code`, account: p.name, id: p.id, scriptDir: deps.scriptDir });
  store.update((d) => { d.phone.pending[p.id] = { key: s.key, done }; });
  log('phone', 'sign-in window for', p.name, s.key, s.store || s.dir || '');
}

/** Before an account leaves Flock: forgets which sign-ins were its, and signs out the one Flock kept for it. */
async function forgetAccount(id) {
  store.update((d) => {
    delete d.phone.pending[id];
    for (const k of Object.keys(d.phone.owners)) if (d.phone.owners[k] === id) delete d.phone.owners[k];
  });
  await cli.signOut(id, storeRoot());
}

// ── Lifecycle ───────────────────────────────────────────────────────────────

function init(d) {
  deps = d;
  remote.watch((snap) => {
    broadcast({ t: 'server', server: serverView(snap) });
    deps.onChange();
  });
  sync();
}

async function quit() {
  cancelPairing();
  await remote.stopAll();
  disconnectAll();
  if (blocker != null) powerSaveBlocker.stop(blocker);
  blocker = null;
}

module.exports = { init, view, setOptions, pair, cancelPairing, unpair, signIn, forgetAccount, stopServer, windowOpened, openCopy, quit, refresh: () => cli.forget() };
