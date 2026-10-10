'use strict';
// The Claude Code CLI, as Flock uses it for sessions started from the phone:
// where claude.exe is, which Claude Code sign-in each account uses, and
// whether that sign-in is ready. Flock never reads or keeps a sign-in itself:
// it asks Claude Code (`claude auth status`) and opens a terminal window for
// `claude auth login`.
//
// Claude Code keeps a sign-in in two parts: the sign-in itself in the config
// folder (CLAUDE_CONFIG_DIR, or ~/.claude when that isn't set), on Windows in
// .credentials.json; and whose it is, in .claude.json in CLAUDE_CONFIG_DIR, or
// in ~/.claude.json when it isn't set. CLAUDE_SECURESTORAGE_CONFIG_DIR moves
// only the first part, to another folder.
//
// An account with its own ~/.claude uses that folder's sign-in. Two accounts
// can share ~/.claude and still each have their own:
// - one uses ~/.claude's own sign-in, the one Claude Code in a terminal uses;
// - the second runs with CLAUDE_CONFIG_DIR set to ~/.claude itself, so the
//   name goes to ~/.claude/.claude.json, and with its sign-in in a folder of
//   Flock's (`storeRoot`\<account id>).
// Both run with the same settings, skills, CLAUDE.md, memory and sessions.
// Another account sharing ~/.claude, or sharing another account's own folder
// ("Same as…"), would have to keep its name where another sign-in keeps its
// own, so it needs its own ~/.claude. Which account uses which sign-in: the
// one signed in to it from Flock, else the one in its organization, else the
// first in the list.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const claude = require('./claude');
const sessions = require('./sessions');
const { HOME, APPDATA, pathKey, samePath } = require('./util');

const STATUS_TTL = 5 * 60 * 1000;
const DEFAULT_KEY = '(default)'; // ~/.claude's own sign-in
const SECOND_KEY = '(second)'; // the second account's sign-in for ~/.claude
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/; // account ids, which name the second sign-in's folder

function isFile(p) {
  try { return fs.statSync(p).isFile(); } catch { return false; }
}

/** The copy Claude Desktop keeps for its Code tab: <data>\claude-code\<version>\<build>\claude.exe, newest version. */
function desktopCopy() {
  const found = [];
  for (const dir of claude.physicalDirs(claude.DEFAULT_DATA_DIR)) {
    const root = path.join(dir, 'claude-code');
    let versions = [];
    try { versions = fs.readdirSync(root); } catch { continue; }
    for (const v of versions) {
      let builds = [];
      try { builds = fs.readdirSync(path.join(root, v)); } catch { continue; }
      for (const b of builds) {
        const exe = path.join(root, v, b, 'claude.exe');
        if (isFile(exe)) found.push({ v: v.split('.').map(Number), exe });
      }
    }
  }
  found.sort((a, b) => {
    for (let i = 0; i < 4; i++) if ((b.v[i] || 0) !== (a.v[i] || 0)) return (b.v[i] || 0) - (a.v[i] || 0);
    return 0;
  });
  return found.length ? found[0].exe : null;
}

/** claude.exe (or npm's claude.cmd): on PATH, where its installers put it, or Claude Desktop's own copy. */
function locate() {
  for (const dir of (process.env.PATH || '').split(';').filter(Boolean)) {
    for (const name of ['claude.exe', 'claude.cmd']) {
      const f = path.join(dir.replace(/^"|"$/g, ''), name);
      if (isFile(f)) return f;
    }
  }
  for (const f of [path.join(HOME, '.local', 'bin', 'claude.exe'), path.join(APPDATA, 'npm', 'claude.cmd')]) {
    if (isFile(f)) return f;
  }
  return desktopCopy();
}

/** How to run it: { file, pre } (a .cmd goes through cmd.exe), or null when Claude Code isn't installed. */
function launcher() {
  const exe = locate();
  if (!exe) return null;
  return /\.cmd$/i.test(exe) ? { exe, file: 'cmd.exe', pre: ['/d', '/c', exe] } : { exe, file: exe, pre: [] };
}

/**
 * The environment Claude Code runs with for one sign-in: `dir` and `store`
 * are the CLAUDE_CONFIG_DIR and CLAUDE_SECURESTORAGE_CONFIG_DIR it sets (null:
 * not set). Variables of the session that may have started Flock, API keys,
 * other endpoints and other places to keep the sign-in are left out: Remote
 * Control needs this sign-in, a claude.ai one, talking to Anthropic directly.
 */
function envFor(signIn) {
  const { dir, store } = signIn || {};
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (claude.NEVER_PASS_RE.test(k) || claude.SESSION_VAR_RE.test(k)) continue;
    env[k] = v;
  }
  if (dir) env.CLAUDE_CONFIG_DIR = dir;
  if (store) env.CLAUDE_SECURESTORAGE_CONFIG_DIR = store;
  return env;
}

/** The CLAUDE_CONFIG_DIR an account's Claude Code runs with, or null to leave it unset (~/.claude). */
function dirOf(profile, profiles) {
  const dir = claude.configDirOf(profile, profiles);
  // ~/.claude named outright is still ~/.claude: run it with ~/.claude's own sign-in.
  return dir && !samePath(dir, claude.DEFAULT_CONFIG_DIR) ? dir : null;
}

/** The second sign-in for ~/.claude, as the account `id` has it. */
function secondOf(id, storeRoot) {
  return { dir: claude.DEFAULT_CONFIG_DIR, store: path.join(storeRoot, id) };
}

// ── Sign-in status ──────────────────────────────────────────────────────────

const statusCache = new Map(); // sign-in key -> { at, value, pending }

function keyOf({ dir, store } = {}) {
  return `${dir ? pathKey(dir) : DEFAULT_KEY}${store ? `|${pathKey(store)}` : ''}`;
}

function runStatus(signIn) {
  const l = launcher();
  if (!l) return Promise.resolve({ loggedIn: false, problem: 'no-cli' });
  return new Promise((resolve) => {
    let out = '';
    let c;
    try {
      c = spawn(l.file, [...l.pre, 'auth', 'status', '--json'], { env: envFor(signIn), windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      resolve({ loggedIn: false, problem: 'no-cli' });
      return;
    }
    const timer = setTimeout(() => { try { c.kill(); } catch {} }, 20000);
    c.stdout.on('data', (d) => { out += d; });
    c.on('error', () => { clearTimeout(timer); resolve({ loggedIn: false, problem: 'no-cli' }); });
    c.on('close', () => {
      clearTimeout(timer);
      try {
        const j = JSON.parse(out.slice(out.indexOf('{')));
        const viaClaudeAi = j.authMethod === 'claude.ai';
        resolve({
          loggedIn: Boolean(j.loggedIn),
          email: typeof j.email === 'string' ? j.email : null,
          orgId: typeof j.orgId === 'string' ? j.orgId : null,
          problem: !j.loggedIn ? 'signed-out' : viaClaudeAi ? null : 'not-claude-ai',
        });
      } catch {
        resolve({ loggedIn: false, problem: 'unknown' });
      }
    });
  });
}

/** What `claude auth status` says for one sign-in ({ dir, store }), asked at most every few minutes. */
function status(signIn, { fresh } = {}) {
  const key = keyOf(signIn);
  const hit = statusCache.get(key);
  if (hit && hit.pending) return hit.pending;
  if (hit && hit.value && !fresh && Date.now() - hit.at < STATUS_TTL) return Promise.resolve(hit.value);
  const pending = runStatus(signIn).then((value) => {
    statusCache.set(key, { at: Date.now(), value });
    return value;
  });
  statusCache.set(key, { ...(hit || {}), pending });
  return pending;
}

/** Forget what was asked, so the next look asks again (after signing in). */
function forget() {
  statusCache.clear();
}

/**
 * Whether ~/.claude's own sign-in may be another account's than the one
 * `claude auth status` names. Signing in with CLAUDE_CONFIG_DIR set to
 * ~/.claude but without a folder of its own, as Flock 0.2.1 did for a second
 * account, writes over that sign-in and keeps the name in
 * ~/.claude/.claude.json instead of ~/.claude.json. When the two names differ,
 * the sign-in is whichever was signed in last. (Only meaningful before Flock
 * signs an account in to ~/.claude's second sign-in, which keeps its name there too.)
 */
async function overwritten(opts) {
  const st = await status({}, opts);
  if (!st.loggedIn) return false;
  const named = await status({ dir: claude.DEFAULT_CONFIG_DIR }, opts);
  return Boolean(named.loggedIn && (named.email || named.orgId) && (named.email !== st.email || named.orgId !== st.orgId));
}

/**
 * Whether Claude Code keeps a sign-in where CLAUDE_SECURESTORAGE_CONFIG_DIR
 * says, which ~/.claude's second sign-in depends on: asked with it pointing at
 * an empty folder while ~/.claude's own sign-in is signed in, a Claude Code
 * that ignores it says signed in. (Signed out, there is nothing to tell apart.)
 */
async function storesApart(storeRoot, opts) {
  const st = await status({}, opts);
  if (!st.loggedIn) return true;
  const empty = path.join(storeRoot, '.empty');
  try { fs.mkdirSync(empty, { recursive: true }); } catch {}
  const probe = await status({ dir: claude.DEFAULT_CONFIG_DIR, store: empty }, opts);
  return probe.problem === 'signed-out';
}

/**
 * Each account's Claude Code sign-in: Map(id -> { dir, store, key, users,
 * status, ok, problem }). `dir` and `store` say how Claude Code runs for it
 * (envFor); `key` names the sign-in in `owners`, which holds the accounts
 * signed in from Flock (key -> id). An account that can't have a sign-in of
 * its own gets the problem 'unsupported', and `users` lists the accounts that
 * use the ones its folder can have. With `renew`, ~/.claude's own sign-in has
 * to be signed in again before Flock trusts whose it is. Without `storeRoot`,
 * or with a Claude Code that can't keep a sign-in apart, ~/.claude has no
 * second sign-in.
 */
async function signIns(profiles, { owners = {}, renew = false, storeRoot = null } = {}, opts = {}) {
  const folders = new Map(); // key -> { dir, members }
  for (const p of profiles) {
    const dir = dirOf(p, profiles);
    const key = keyOf({ dir });
    if (!folders.has(key)) folders.set(key, { dir, members: [] });
    folders.get(key).members.push(p);
  }
  const out = new Map();
  await Promise.all([...folders].map(async ([key, { dir, members }]) => {
    const st = await status({ dir }, opts);
    const orgs = new Map(await Promise.all(members.map(async (p) => [p, await sessions.orgOf(p)])));
    const own = (p) => Boolean(p.config && p.config.mode === 'own');
    const first = (list) => list.find(own) || list[0] || null;
    const owner = (k) => members.find((p) => p.id === owners[k]) || null;
    const two = !dir && Boolean(storeRoot) && await storesApart(storeRoot, opts);

    // Whose the folder's own sign-in is, and (~/.claude) whose the second one.
    let holder = owner(key);
    let second = two ? owner(SECOND_KEY) : null;
    if (second === holder || (second && !ID_RE.test(second.id))) second = null;
    const rest = () => members.filter((p) => p !== holder && p !== second);
    if (!holder) holder = first(rest().filter((p) => st.orgId && orgs.get(p) === st.orgId));
    // Signed out, the folder's own sign-in goes to the first account; signed in
    // to another account (in a terminal, say), it goes to whoever is left over.
    if (!holder && !st.loggedIn) holder = first(rest());
    if (two && !second) second = rest().find((p) => ID_RE.test(p.id)) || null;
    if (!holder) holder = first(rest());
    const st2 = second ? await status(secondOf(second.id, storeRoot), opts) : null;
    const users = [holder, second].filter(Boolean).map((p) => p.id);

    for (const p of members) {
      const use = p === holder ? { dir, store: null, key, st }
        : p === second ? { ...secondOf(p.id, storeRoot), key: SECOND_KEY, st: st2 }
          : null;
      const s = { dir, store: null, key, users, status: null };
      if (!use) s.problem = 'unsupported';
      else {
        Object.assign(s, { dir: use.dir, store: use.store, key: use.key, status: use.st });
        const org = orgs.get(p);
        // A sign-in to another organization than the account's sessions is
        // another Claude account: its sessions would not reach this account's phone.
        if (!use.st.problem && org && use.st.orgId !== org) s.problem = 'other-account';
        else if (!use.st.problem && renew && use.key === DEFAULT_KEY) s.problem = 'renew';
        else s.problem = use.st.problem;
      }
      s.ok = !s.problem;
      out.set(p.id, s);
    }
  }));
  return out;
}

/**
 * Opens a terminal window that runs `claude auth login` for this sign-in
 * ({ dir, store }) and stays open, so the result can be read. The browser it
 * opens is where the account's claude.ai login goes. Returns the file that
 * appears once the sign-in succeeded (closing the window first leaves it out).
 */
function openSignIn(signIn, { title, account, id, scriptDir }) {
  const l = launcher();
  if (!l) throw new Error('Claude Code isn’t installed on this PC. Install it from claude.com/claude-code, then try again.');
  const ascii = (s) => String(s || '').replace(/[^\x20-\x7e]/g, '').replace(/[&|<>^%"]/g, '');
  // A small script, so quoting stays simple and the window waits at the end.
  const name = String(id).replace(/[^A-Za-z0-9_-]/g, '') || 'account';
  const script = path.join(scriptDir, `sign-in-${name}.cmd`);
  const done = path.join(scriptDir, `sign-in-${name}.done`);
  try { fs.unlinkSync(done); } catch {}
  const lines = [
    '@echo off',
    'chcp 65001 >nul',
    `title ${ascii(title)}`,
    'echo.',
    `echo   Sign in to Claude Code with the Claude account you use for ${ascii(account)}.`,
    'echo   A browser opens: make sure it is that account before you approve.',
    'echo.',
    `call "${l.exe}" auth login`, // `call`, or npm's claude.cmd would end this script
    `if not errorlevel 1 type nul > "${done}"`,
    'echo.',
    `echo   Done? Close this window and go back to Flock.`,
    'pause >nul',
  ];
  fs.mkdirSync(scriptDir, { recursive: true });
  if (signIn.store) fs.mkdirSync(signIn.store, { recursive: true });
  fs.writeFileSync(script, `${lines.join('\r\n')}\r\n`, 'utf8');
  const env = envFor(signIn);
  const c = spawn('cmd.exe', ['/d', '/c', `start "" "${script}"`], {
    env, detached: true, stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: true,
  });
  c.unref();
  forget();
  return done;
}

/**
 * Signs out the second sign-in Flock keeps for an account (`claude auth
 * logout`), then removes its folder. Its name goes with it: it runs with that
 * folder as its config folder, so ~/.claude/.claude.json stays as it is.
 */
function signOut(id, storeRoot) {
  if (!ID_RE.test(String(id)) || !storeRoot) return Promise.resolve();
  const store = path.join(storeRoot, id);
  if (!fs.existsSync(store)) return Promise.resolve();
  const remove = () => { try { fs.rmSync(store, { recursive: true, force: true }); } catch {} };
  const l = launcher();
  if (!l) { remove(); return Promise.resolve(); }
  return new Promise((resolve) => {
    let c;
    try {
      c = spawn(l.file, [...l.pre, 'auth', 'logout'], { env: envFor({ dir: store, store }), windowsHide: true, stdio: 'ignore' });
    } catch {
      remove();
      resolve();
      return;
    }
    const timer = setTimeout(() => { try { c.kill(); } catch {} }, 20000);
    let ended = false;
    const end = () => {
      if (ended) return;
      ended = true;
      clearTimeout(timer);
      remove();
      forget();
      resolve();
    };
    c.on('error', end);
    c.on('close', end);
  });
}

module.exports = { DEFAULT_KEY, SECOND_KEY, locate, launcher, envFor, status, forget, overwritten, signIns, openSignIn, signOut };
