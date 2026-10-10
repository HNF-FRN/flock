'use strict';
// The Claude Code CLI, as Flock uses it for sessions started from the phone:
// where claude.exe is, which Claude Code sign-in each account uses, and
// whether that sign-in is ready. Flock never reads or keeps a sign-in itself:
// it asks Claude Code (`claude auth status`) and opens a terminal window for
// `claude auth login`.
//
// Claude Code keeps one sign-in per config folder: on Windows, the
// .credentials.json in CLAUDE_CONFIG_DIR, or in ~/.claude when that isn't set.
// An account with its own ~/.claude uses that folder's. The accounts that run
// Claude Code with the same folder (those that share ~/.claude, or one
// account's own folder through "Same as…") share its one sign-in, so only one
// of them can use it: the one signed in to it from Flock, else the one in the
// sign-in's organization, else the first. The others need their own ~/.claude.
// (Setting CLAUDE_CONFIG_DIR to ~/.claude itself makes a second sign-in only on
// macOS, where the Keychain keeps it apart. On Windows it is the same file,
// so both accounts would run as whichever signed in last.)

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const claude = require('./claude');
const sessions = require('./sessions');
const { HOME, APPDATA, pathKey, samePath } = require('./util');

const STATUS_TTL = 5 * 60 * 1000;

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
 * The environment Claude Code runs with for one sign-in (`dir` null: the
 * default one). Variables of the session that may have started Flock, API
 * keys, other endpoints and other places to keep the sign-in are left out:
 * Remote Control needs this sign-in, a claude.ai one, talking to Anthropic
 * directly.
 */
function envFor(dir) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (claude.NEVER_PASS_RE.test(k) || claude.SESSION_VAR_RE.test(k)) continue;
    env[k] = v;
  }
  if (dir) env.CLAUDE_CONFIG_DIR = dir;
  return env;
}

/** The CLAUDE_CONFIG_DIR an account's Claude Code runs with, or null to leave it unset (~/.claude). */
function dirOf(profile, profiles) {
  const dir = claude.configDirOf(profile, profiles);
  // ~/.claude named outright is still ~/.claude's one sign-in: run it as such.
  return dir && !samePath(dir, claude.DEFAULT_CONFIG_DIR) ? dir : null;
}

// ── Sign-in status ──────────────────────────────────────────────────────────

const statusCache = new Map(); // sign-in key -> { at, value, pending }

function keyOf(dir) {
  return dir ? pathKey(dir) : '(default)';
}

function runStatus(dir) {
  const l = launcher();
  if (!l) return Promise.resolve({ loggedIn: false, problem: 'no-cli' });
  return new Promise((resolve) => {
    let out = '';
    let c;
    try {
      c = spawn(l.file, [...l.pre, 'auth', 'status', '--json'], { env: envFor(dir), windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
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

/** What `claude auth status` says for one sign-in, asked at most every few minutes. */
function status(dir, { fresh } = {}) {
  const key = keyOf(dir);
  const hit = statusCache.get(key);
  if (hit && hit.pending) return hit.pending;
  if (hit && hit.value && !fresh && Date.now() - hit.at < STATUS_TTL) return Promise.resolve(hit.value);
  const pending = runStatus(dir).then((value) => {
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
 * Each account's Claude Code sign-in: Map(id -> { dir, key, holder, status,
 * ok, problem }). `dir` is the CLAUDE_CONFIG_DIR it runs with (null: not
 * set) and `key` names that folder's sign-in. Of the accounts that share a
 * folder, only the `holder` (an account id) can use its sign-in; for the
 * others the problem is 'unsupported'. `owners` holds the accounts signed in
 * from Flock (key -> id). With `renew`, the ~/.claude sign-in has to be
 * signed in again before Flock trusts whose it is.
 */
async function signIns(profiles, { owners = {}, renew = false } = {}, opts = {}) {
  const folders = new Map(); // key -> { dir, members }
  for (const p of profiles) {
    const dir = dirOf(p, profiles);
    const key = keyOf(dir);
    if (!folders.has(key)) folders.set(key, { dir, members: [] });
    folders.get(key).members.push(p);
  }
  const out = new Map();
  await Promise.all([...folders].map(async ([key, { dir, members }]) => {
    const st = await status(dir, opts);
    const orgs = await Promise.all(members.map((p) => (st.orgId ? sessions.orgOf(p) : null)));
    // Whose the sign-in is: the account signed in from Flock, else the one in
    // its organization, else the first.
    let holder = members.find((p) => p.id === owners[key]);
    if (!holder) {
      const match = members.filter((p, i) => st.orgId && orgs[i] === st.orgId);
      holder = match.length === 1 ? match[0] : members[0];
    }
    members.forEach((p, i) => {
      const s = { dir, key, holder: holder.id, status: p === holder ? st : null };
      if (p !== holder) s.problem = 'unsupported';
      // A sign-in to another organization than the account's sessions is
      // another Claude account: its sessions would not reach this account's phone.
      else if (!st.problem && orgs[i] && st.orgId !== orgs[i]) s.problem = 'other-account';
      else if (!st.problem && renew && !dir) s.problem = 'renew';
      else s.problem = st.problem;
      s.ok = !s.problem;
      out.set(p.id, s);
    });
  }));
  return out;
}

/**
 * Opens a terminal window that runs `claude auth login` for this sign-in and
 * stays open, so the result can be read. The browser it opens is where the
 * account's claude.ai login goes.
 */
function openSignIn(dir, { title, account, scriptDir }) {
  const l = launcher();
  if (!l) throw new Error('Claude Code isn’t installed on this PC. Install it from claude.com/claude-code, then try again.');
  const ascii = (s) => String(s || '').replace(/[^\x20-\x7e]/g, '').replace(/[&|<>^%"]/g, '');
  // A small script, so quoting stays simple and the window waits at the end.
  const script = path.join(scriptDir, `sign-in-${ascii(account).replace(/[^A-Za-z0-9-]/g, '') || 'account'}.cmd`);
  const lines = [
    '@echo off',
    'chcp 65001 >nul',
    `title ${ascii(title)}`,
    'echo.',
    `echo   Sign in to Claude Code with the Claude account you use for ${ascii(account)}.`,
    'echo   A browser opens: make sure it is that account before you approve.',
    'echo.',
    `"${l.exe}" auth login`,
    'echo.',
    `echo   Done? Close this window and go back to Flock.`,
    'pause >nul',
  ];
  fs.mkdirSync(scriptDir, { recursive: true });
  fs.writeFileSync(script, `${lines.join('\r\n')}\r\n`, 'utf8');
  const env = envFor(dir);
  const c = spawn('cmd.exe', ['/d', '/c', `start "" "${script}"`], {
    env, detached: true, stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: true,
  });
  c.unref();
  forget();
}

module.exports = { locate, launcher, envFor, status, forget, signIns, openSignIn };
