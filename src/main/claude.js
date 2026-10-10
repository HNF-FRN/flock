'use strict';
// Everything Flock knows about Claude Desktop: where it is installed, how to
// start one account's window, which windows are running, and whether an
// account has signed in.
//
// How the multi-account trick works: Claude Desktop is an Electron app and
// Chromium keys its single-instance lock on the data folder. Starting it with
// --user-data-dir=<folder> gives a second, fully separate copy (own sign-in,
// chats, connectors). CLAUDE_CONFIG_DIR, read by Claude's own code, moves the
// Code tab's ~/.claude for that copy.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const procscan = require('./procscan');
const { HOME, APPDATA, LOCALAPPDATA, exists, pathKey, samePath, splitCommandLine, switchValue } = require('./util');

const STORE_FAMILIES = ['Claude_pzs8sxrjxfjjc', 'AnthropicPBC.Claude_fnn82j28hfe8t'];
const DESKTOP_EXE_RE = /\\WindowsApps\\[^\\]*Claude_[^\\]+\\app\\claude\.exe$/i;
const SQUIRREL_EXE_RE = /\\AnthropicClaude\\app-[^\\]+\\claude\.exe$/i;

const DEFAULT_DATA_DIR = path.join(APPDATA, 'Claude');
const DEFAULT_CONFIG_DIR = path.join(HOME, '.claude');

// ── Install ─────────────────────────────────────────────────────────────────

/** How to start Claude Desktop on this PC, or null when it is not installed. */
function locate() {
  // Store / MSIX build: the App Execution Alias keeps package identity and
  // survives updates (the versioned install folder changes, the alias does not).
  const alias = path.join(LOCALAPPDATA, 'Microsoft', 'WindowsApps', 'claude-desktop.exe');
  if (exists(alias)) return { kind: 'store', launcher: alias };
  // Classic installer (Squirrel): the stub forwards its arguments to the newest app-x.y.z.
  const squirrel = path.join(LOCALAPPDATA, 'AnthropicClaude', 'claude.exe');
  if (exists(squirrel)) return { kind: 'classic', launcher: squirrel };
  return null;
}

/** Package family names of the installed Store build ("Claude_pzs8sxrjxfjjc"). */
function packageFamilies() {
  const found = new Set(STORE_FAMILIES);
  try {
    const dir = path.join(LOCALAPPDATA, 'Microsoft', 'WindowsApps');
    for (const name of fs.readdirSync(dir)) {
      if (/^(AnthropicPBC\.)?Claude_[a-z0-9]+$/i.test(name)) found.add(name);
    }
  } catch {}
  return [...found];
}

// ── Data folders ────────────────────────────────────────────────────────────

function dataDirOf(profile) {
  return profile.kind === 'default' ? DEFAULT_DATA_DIR : profile.dataDir;
}

/**
 * Where a data folder physically lives. The Store build is virtualised: what it
 * writes under %APPDATA%\X really goes to
 * %LOCALAPPDATA%\Packages\<family>\LocalCache\Roaming\X, and only the app
 * itself sees it at %APPDATA%\X. Flock runs outside the package, so it checks both.
 */
function physicalDirs(dataDir) {
  const out = [dataDir];
  if (samePath(path.dirname(dataDir), APPDATA)) {
    for (const fam of packageFamilies()) {
      out.push(path.join(LOCALAPPDATA, 'Packages', fam, 'LocalCache', 'Roaming', path.basename(dataDir)));
    }
  }
  return out;
}

/** Every folder Claude keeps for an account: its data folder plus the logs it
 *  keeps under %LOCALAPPDATA%\<same name> — both real and virtualised copies. */
function allDirsOf(dataDir) {
  const base = path.basename(dataDir);
  const out = physicalDirs(dataDir);
  if (samePath(path.dirname(dataDir), APPDATA)) {
    out.push(path.join(LOCALAPPDATA, base));
    for (const fam of packageFamilies()) out.push(path.join(LOCALAPPDATA, 'Packages', fam, 'LocalCache', 'Local', base));
  }
  return out;
}

/** The physical folder that actually holds the account's files (newest wins). */
function existingDataDir(dataDir) {
  let best = null;
  for (const dir of physicalDirs(dataDir)) {
    try {
      const st = fs.statSync(path.join(dir, 'config.json'));
      if (!best || st.mtimeMs > best.mtime) best = { dir, mtime: st.mtimeMs };
    } catch {}
  }
  if (best) return best.dir;
  return physicalDirs(dataDir).find((d) => exists(d)) || null;
}

const accountCache = new Map(); // config.json path -> { mtime, info }

/**
 * Whether the account in this data folder has signed in. Reads only two
 * non-secret fields Claude keeps in config.json: the last account's id and
 * whether the window was last laid out signed in.
 */
function readAccount(dataDir) {
  let best = null;
  for (const dir of physicalDirs(dataDir)) {
    const file = path.join(dir, 'config.json');
    try {
      const st = fs.statSync(file);
      if (!best || st.mtimeMs > best.mtime) best = { file, mtime: st.mtimeMs };
    } catch {}
  }
  if (!best) return { accountId: null, signedIn: false, seen: false };
  const cached = accountCache.get(best.file);
  if (cached && cached.mtime === best.mtime) return cached.info;
  let info = { accountId: null, signedIn: false, seen: true };
  try {
    const j = JSON.parse(fs.readFileSync(best.file, 'utf8'));
    const id = typeof j.lastKnownAccountUuid === 'string' ? j.lastKnownAccountUuid : null;
    info = { accountId: id, signedIn: Boolean(id), seen: true };
  } catch {}
  accountCache.set(best.file, { mtime: best.mtime, info });
  return info;
}

const usageCache = new Map(); // plan-usage-history.json path -> { mtime, usage }

/**
 * The account's latest plan usage, as Claude samples it about every 15 minutes
 * while the window runs: { fh, sd, t } with the 5-hour and weekly use in
 * percent (either can be missing) and when it was sampled; null when unknown.
 */
function readUsage(dataDir) {
  const dir = existingDataDir(dataDir);
  if (!dir) return null;
  const file = path.join(dir, 'plan-usage-history.json');
  let mtime;
  try { mtime = fs.statSync(file).mtimeMs; } catch { return null; }
  const hit = usageCache.get(file);
  if (hit && hit.mtime === mtime) return hit.usage;
  let usage = null;
  try {
    const samples = JSON.parse(fs.readFileSync(file, 'utf8')).samples;
    const last = Array.isArray(samples) ? samples[samples.length - 1] : null;
    if (last && last.u && Number.isFinite(last.t)) {
      const pct = (v) => (Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : null);
      usage = { fh: pct(last.u.fh), sd: pct(last.u.sd), t: last.t };
    }
  } catch {}
  usageCache.set(file, { mtime, usage });
  return usage;
}

// ── Config dir (~/.claude) ──────────────────────────────────────────────────

/** The CLAUDE_CONFIG_DIR an account runs with, or null for the shared ~/.claude. */
function configDirOf(profile, profiles) {
  const c = profile.config || { mode: 'shared' };
  if (c.mode === 'own' && c.dir) return c.dir;
  if (c.mode === 'link') {
    const other = profiles.find((p) => p.id === c.profileId);
    if (other && other.config && other.config.mode === 'own' && other.config.dir) return other.config.dir;
  }
  return null;
}

// ── Launching ───────────────────────────────────────────────────────────────

// Variables that belong to the process that started Flock — for instance a
// Claude Code session — and must not leak into a fresh Claude window.
const SESSION_VAR_RE = /^(CLAUDECODE|CLAUDE_CODE_.*|CLAUDE_AGENT_SDK_.*|CLAUDE_PID|CLAUDE_PREVIEW_.*|ANTHROPIC_.*|CLAUDE_CONFIG_DIR)$/i;
const NEVER_PASS_RE = /^(ELECTRON_RUN_AS_NODE|ELECTRON_NO_ATTACH_CONSOLE|ELECTRON_ENABLE_LOGGING|ELECTRON_LOG_FILE|ELECTRON_ENABLE_STACK_DUMPING|NODE_OPTIONS)$/i;

function envFor(profile, profiles) {
  const insideClaudeSession = Boolean(process.env.CLAUDECODE || process.env.CLAUDE_CODE_ENTRYPOINT);
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (NEVER_PASS_RE.test(k)) continue;
    if (insideClaudeSession && SESSION_VAR_RE.test(k)) continue;
    env[k] = v;
  }
  const cfg = configDirOf(profile, profiles);
  if (cfg) env.CLAUDE_CONFIG_DIR = cfg;
  else if (insideClaudeSession) delete env.CLAUDE_CONFIG_DIR;
  return env;
}

function argsFor(profile, url) {
  const args = [];
  if (profile.kind !== 'default') args.push(`--user-data-dir=${profile.dataDir}`);
  if (url) args.push(url);
  return args;
}

function quoteForCmd(arg) {
  return `"${String(arg).replace(/"/g, '""')}"`;
}

function spawnDetached(file, args, env) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (fn, v) => { if (!settled) { settled = true; fn(v); } };

    const viaCmd = () => {
      // Fallback for systems where a direct CreateProcess on the alias fails:
      // `start` goes through ShellExecute, which always understands aliases.
      const line = ['start', '""', quoteForCmd(file), ...args.map(quoteForCmd)].join(' ');
      try {
        const c = spawn('cmd.exe', ['/d', '/s', '/c', `"${line}"`], {
          detached: true, stdio: 'ignore', env, windowsHide: true, windowsVerbatimArguments: true,
        });
        c.once('error', (e) => done(reject, e));
        c.once('spawn', () => { c.unref(); done(resolve, { pid: null, via: 'shell' }); });
      } catch (e) {
        done(reject, e);
      }
    };

    let child;
    try {
      child = spawn(file, args, { detached: true, stdio: 'ignore', env });
    } catch {
      viaCmd();
      return;
    }
    child.once('error', () => viaCmd());
    child.once('spawn', () => { child.unref(); done(resolve, { pid: child.pid, via: 'direct' }); });
  });
}

/** Starts (or, when it is already open, focuses) an account's Claude window. */
async function launch(profile, profiles, { url } = {}) {
  const where = locate();
  if (!where) throw new Error('Claude Desktop is not installed (no claude-desktop.exe or AnthropicClaude found).');
  if (profile.kind !== 'default' && !profile.dataDir) throw new Error('This account has no data folder.');
  return spawnDetached(where.launcher, argsFor(profile, url), envFor(profile, profiles));
}

// ── Running windows ─────────────────────────────────────────────────────────

let runningExe = null; // the installed Claude.exe, as last seen running

/**
 * Main (browser) processes of every running Claude Desktop: the data folder
 * each was started with (null = Claude's default folder) and, for the
 * short-lived copies Windows starts to pass on a claude:// link, that link.
 */
async function instances() {
  const procs = await procscan.scan();
  const mains = [];
  for (const p of procs) {
    if (!p.exe || !(DESKTOP_EXE_RE.test(p.exe) || SQUIRREL_EXE_RE.test(p.exe))) continue;
    const argv = splitCommandLine(p.cmd || '');
    if (argv.some((a) => a.startsWith('--type='))) continue; // renderer, GPU, utility…
    runningExe = p.exe;
    mains.push({
      pid: p.pid,
      start: p.start || null,
      dataDir: switchValue(argv, '--user-data-dir'),
      link: argv.slice(1).find((a) => /^claude:\/\//i.test(a)) || null,
    });
  }
  return mains;
}

/**
 * Where Claude's own app icon can be read: the Store build's logo images, one
 * per size ({ kind: 'store', files: [{ size, file }] }), or the classic build's
 * exe ({ kind: 'exe', exe }). Read only, to draw each account's coloured icon.
 */
function appIcon() {
  if (!runningExe) return null;
  if (DESKTOP_EXE_RE.test(runningExe)) {
    const assets = path.join(path.dirname(path.dirname(runningExe)), 'assets');
    const files = [];
    for (const size of [16, 20, 24, 30, 32, 36, 40, 48, 60, 64, 72, 80, 96, 256]) {
      const file = path.join(assets, `Square44x44Logo.targetsize-${size}_altform-unplated.png`);
      if (exists(file)) files.push({ size, file });
    }
    if (files.length) return { kind: 'store', files };
  }
  return { kind: 'exe', exe: runningExe };
}

/**
 * { pid, url } when this process is Windows passing a claude:// link on to
 * Claude: Claude Desktop's own exe, Claude's default folder, a link argument.
 * Flock's own deliveries carry --user-data-dir and are never matched.
 */
function linkFromProcess(p) {
  if (!p || !p.exe || !(DESKTOP_EXE_RE.test(p.exe) || SQUIRREL_EXE_RE.test(p.exe))) return null;
  const argv = splitCommandLine(p.cmd || '');
  if (argv.some((a) => a.startsWith('--type=')) || switchValue(argv, '--user-data-dir')) return null;
  const url = argv.slice(1).find((a) => /^claude:\/\//i.test(a));
  return url ? { pid: p.pid, url } : null;
}

/** claude:// links Windows is handing to Claude right now. */
async function pendingLinks() {
  return (await procscan.scan()).map(linkFromProcess).filter(Boolean);
}

/** Which profile a running instance belongs to (id), or null if Flock does not manage it. */
function matchInstance(inst, profiles) {
  if (!inst.dataDir || samePath(inst.dataDir, DEFAULT_DATA_DIR)) {
    const main = profiles.find((p) => p.kind === 'default');
    return main ? main.id : null;
  }
  const key = pathKey(inst.dataDir);
  const p = profiles.find((x) => x.kind !== 'default' && pathKey(x.dataDir) === key);
  return p ? p.id : null;
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

function taskkill(pid, force) {
  return new Promise((resolve) => {
    const args = ['/PID', String(pid), '/T'];
    if (force) args.push('/F');
    const c = spawn('taskkill.exe', args, { windowsHide: true, stdio: 'ignore' });
    c.once('error', () => resolve());
    c.once('exit', () => resolve());
  });
}

/** Asks an account's window to close, then forces it if it is still up. */
async function quit(pids) {
  await Promise.all(pids.map((pid) => taskkill(pid, false)));
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline && pids.some(isAlive)) {
    await new Promise((r) => setTimeout(r, 300));
  }
  const left = pids.filter(isAlive);
  await Promise.all(left.map((pid) => taskkill(pid, true)));
}

module.exports = {
  DEFAULT_DATA_DIR,
  DEFAULT_CONFIG_DIR,
  locate,
  dataDirOf,
  physicalDirs,
  allDirsOf,
  existingDataDir,
  readAccount,
  readUsage,
  configDirOf,
  SESSION_VAR_RE,
  NEVER_PASS_RE,
  launch,
  instances,
  appIcon,
  linkFromProcess,
  pendingLinks,
  matchInstance,
  quit,
};
