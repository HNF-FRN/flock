'use strict';
// Folders for the phone: the ones it may browse, start Claude Code in, or
// create a new project in. That is anything inside the project folders set in
// Flock (by default the home folder and the folders that hold the accounts'
// recent projects), plus each recent project folder itself. Only folders are
// ever listed, never files.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { HOME, pathKey, samePath } = require('./util');

const HIDDEN = /^[.$~]|^(node_modules|__pycache__|System Volume Information|AppData)$/i;
const BAD_CHARS = /[<>:"/\\|?*\u0000-\u001f]/;
const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;
const MAX_LIST = 400;

function isDir(p) {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

/** True when `dir` is `root` or inside it. */
function within(dir, root) {
  const d = pathKey(dir);
  const r = pathKey(root);
  return d === r || d.startsWith(r.endsWith('\\') ? r : `${r}\\`);
}

/**
 * The project folders: the ones set in Flock or, when none are, the home
 * folder and the folders holding the most recent projects (a drive's root
 * only when set by hand).
 */
function roots(configured, recent) {
  const out = [];
  const add = (p) => {
    if (p && isDir(p) && !out.some((x) => samePath(x, p))) out.push(path.resolve(p));
  };
  if (configured && configured.length) {
    configured.forEach(add);
    return out;
  }
  add(HOME);
  const counts = new Map();
  for (const r of recent) {
    const parent = path.dirname(r.path);
    if (samePath(parent, path.parse(parent).root)) continue;
    const k = pathKey(parent);
    counts.set(k, { path: parent, n: ((counts.get(k) || {}).n || 0) + 1 });
  }
  [...counts.values()].sort((a, b) => b.n - a.n).slice(0, 4).forEach((c) => add(c.path));
  return out;
}

/** Whether the phone may use this folder: inside a project folder, or one of the recent ones. */
function allowed(dir, rootList, recent) {
  if (!dir || !path.isAbsolute(dir)) return false;
  return rootList.some((r) => within(dir, r)) || recent.some((r) => samePath(r.path, dir));
}

/** The folders inside `dir`, recently changed first: [{ name, at }]. */
async function list(dir) {
  let ents;
  try {
    ents = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch (e) {
    throw new Error(e.code === 'ENOENT' ? 'That folder no longer exists.' : 'Flock can’t open that folder.');
  }
  const dirs = ents.filter((e) => e.isDirectory() && !HIDDEN.test(e.name));
  const out = await Promise.all(dirs.map(async (e) => {
    try {
      return { name: e.name, at: (await fs.promises.stat(path.join(dir, e.name))).mtimeMs };
    } catch {
      return null; // no access, or gone
    }
  }));
  return out.filter(Boolean).sort((a, b) => b.at - a.at).slice(0, MAX_LIST);
}

/** Checks a name for a new folder; returns the reason it can't be used, or null. */
function badName(name) {
  const n = String(name || '');
  if (!n.trim()) return 'Give the folder a name.';
  if (n.length > 80) return 'That name is too long.';
  if (BAD_CHARS.test(n)) return 'A folder name can’t contain < > : " / \\ | ? or *.';
  if (RESERVED.test(n) || n === '.' || n === '..') return 'Windows reserves that name.';
  if (/[. ]$/.test(n) || /^ /.test(n)) return 'A folder name can’t start with a space or end with a space or a dot.';
  return null;
}

function gitInit(dir) {
  return new Promise((resolve) => {
    let c;
    try {
      c = spawn('git', ['init', '--quiet'], { cwd: dir, windowsHide: true, stdio: 'ignore' });
    } catch {
      resolve(false);
      return;
    }
    c.on('error', () => resolve(false));
    c.on('exit', (code) => resolve(code === 0));
  });
}

/** Creates `name` inside `parent` (optionally a git repository); resolves to { path, git }. */
async function create(parent, name, { git } = {}) {
  const why = badName(name);
  if (why) throw new Error(why);
  if (!isDir(parent)) throw new Error('The folder to create it in no longer exists.');
  const dir = path.join(parent, String(name).trim());
  try {
    await fs.promises.mkdir(dir);
  } catch (e) {
    throw new Error(e.code === 'EEXIST' ? 'A folder with that name is already there.' : 'Flock couldn’t create that folder.');
  }
  return { path: dir, git: git ? await gitInit(dir) : false };
}

function isGitRepo(dir) {
  let d = path.resolve(dir);
  for (;;) {
    try { if (fs.statSync(path.join(d, '.git'))) return true; } catch {}
    const up = path.dirname(d);
    if (up === d) return false;
    d = up;
  }
}

module.exports = { roots, allowed, list, create, badName, isDir, isGitRepo, within };
