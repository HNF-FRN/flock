'use strict';
// An account's recent Claude Code sessions, for the island's session peek.
// Claude Desktop keeps one small JSON file per Code session in the account's
// data folder: claude-code-sessions/<account uuid>/<organization uuid>/
// local_<id>.json, with the title its sidebar shows, the folder, and when it
// was last active. Flock only reads them, and only the signed-in account's: a
// data folder can still hold the sessions of an account that signed in there
// before. Each file is parsed again only when it changes, and all of it is
// asynchronous: an account can have hundreds of sessions.
//
// A session can also be open in a window of its own (Claude's "Open in → New
// window"). Claude lists those in session-popouts.json in the data folder,
// within a second of one opening or closing, to bring them back at its next
// start; so while the account's window runs, that file says which are open.

const fs = require('fs');
const path = require('path');
const claude = require('./claude');

const ID_RE = /^local_[A-Za-z0-9-]{1,64}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FILE_RE = /^local_[A-Za-z0-9-]{1,64}\.json$/; // removed sessions are renamed deleted_*
const POPOUTS_FILE = 'session-popouts.json';
const cache = new Map(); // file -> { mtime, session }
const popoutCache = new Map(); // file -> { mtime, list }

async function entries(dir, dirs) {
  try {
    return (await fs.promises.readdir(dir, { withFileTypes: true }))
      .filter((e) => (dirs ? e.isDirectory() : e.isFile()))
      .map((e) => e.name);
  } catch {
    return [];
  }
}

/** The folders holding this account's sessions: whichever level is named after the signed-in account. */
async function folders(profile) {
  const dataDir = claude.existingDataDir(claude.dataDirOf(profile));
  const { accountId } = claude.readAccount(claude.dataDirOf(profile));
  if (!dataDir || !accountId) return [];
  const root = path.join(dataDir, 'claude-code-sessions');
  const out = [];
  for (const a of await entries(root, true)) {
    for (const b of await entries(path.join(root, a), true)) {
      if (a === accountId || b === accountId) out.push(path.join(root, a, b));
    }
  }
  return out;
}

async function load(file) {
  let mtime;
  try { mtime = (await fs.promises.stat(file)).mtimeMs; } catch { return null; }
  const hit = cache.get(file);
  if (hit && hit.mtime === mtime) return hit.session;
  let session = null;
  try {
    const j = JSON.parse(await fs.promises.readFile(file, 'utf8'));
    if (ID_RE.test(j.sessionId || '')) {
      session = {
        id: j.sessionId,
        title: typeof j.title === 'string' && j.title.trim() ? j.title.trim() : null,
        cwd: typeof j.cwd === 'string' ? j.cwd : null,
        at: Number(j.lastActivityAt || j.createdAt) || 0,
        archived: Boolean(j.isArchived),
        // The Claude Code conversation behind it, and how it ran, so the phone can pick it up.
        cli: UUID_RE.test(j.cliSessionId || '') ? j.cliSessionId : null,
        model: typeof j.model === 'string' && /^[A-Za-z0-9._:[\]-]{1,64}$/.test(j.model) ? j.model : null,
        effort: ['low', 'medium', 'high', 'xhigh', 'max'].includes(j.effort) ? j.effort : null,
      };
    }
  } catch {}
  cache.set(file, { mtime, session });
  return session;
}

/** Every session of the signed-in account, newest first. */
async function everyone(profile) {
  const files = [];
  for (const dir of await folders(profile)) {
    for (const name of await entries(dir, false)) {
      if (FILE_RE.test(name)) files.push(path.join(dir, name));
    }
  }
  const all = (await Promise.all(files.map(load))).filter(Boolean);
  return all.sort((x, y) => y.at - x.at);
}

/**
 * Newest first, archived ones left out: [{ id, title, cwd, folder, at }]. The
 * sessions in `keep` are always listed, first, within `limit`.
 */
async function recent(profile, limit = 6, keep = []) {
  const all = await everyone(profile);
  const kept = new Set(keep);
  const first = all.filter((s) => kept.has(s.id));
  const rest = all.filter((s) => !kept.has(s.id) && !s.archived);
  return [...first, ...rest].slice(0, Math.max(limit, first.length)).map((s) => ({
    id: s.id,
    title: s.title,
    cwd: s.cwd,
    folder: s.cwd ? path.basename(s.cwd) : null,
    at: s.at,
  }));
}

function bounds(b) {
  const ok = b && ['x', 'y', 'width', 'height'].every((k) => Number.isFinite(b[k])) && b.width > 0 && b.height > 0;
  return ok ? { x: b.x, y: b.y, width: b.width, height: b.height } : null;
}

/**
 * The sessions Claude has in windows of their own: [{ id, title, bounds }],
 * bounds in DIP as Claude last saw them. Only meaningful while the account's
 * window runs: Claude keeps the list after it quits, to restore them.
 */
async function popouts(profile) {
  const dataDir = claude.existingDataDir(claude.dataDirOf(profile));
  if (!dataDir) return [];
  const file = path.join(dataDir, POPOUTS_FILE);
  let mtime;
  try { mtime = (await fs.promises.stat(file)).mtimeMs; } catch { return []; } // none open: Claude removes it
  const hit = popoutCache.get(file);
  if (hit && hit.mtime === mtime) return hit.list;
  let list = [];
  try {
    const j = JSON.parse(await fs.promises.readFile(file, 'utf8'));
    list = (Array.isArray(j.popouts) ? j.popouts : [])
      .filter((p) => p && ID_RE.test(String(p.sessionId || '')))
      .map((p) => ({
        id: p.sessionId,
        title: typeof p.title === 'string' && p.title.trim() ? p.title.trim() : null,
        bounds: bounds(p.bounds),
      }));
  } catch {}
  popoutCache.set(file, { mtime, list });
  return list;
}

/** One of the account's sessions by id, or null. */
async function find(profile, id) {
  if (!ID_RE.test(String(id || ''))) return null;
  for (const dir of await folders(profile)) {
    const s = await load(path.join(dir, `${id}.json`));
    if (s) return s;
  }
  return null;
}

/**
 * The account's sessions the phone can continue, newest first, archived ones
 * left out; only those in `folder` when given: [{ id, title, cwd, folder, at }].
 */
async function continuable(profile, { folder, limit = 60 } = {}) {
  const key = (p) => String(p || '').replace(/[\\/]+$/, '').toLowerCase();
  return (await everyone(profile))
    .filter((s) => !s.archived && s.cli && s.cwd && (!folder || key(s.cwd) === key(folder)))
    .slice(0, limit)
    .map((s) => ({ id: s.id, title: s.title, cwd: s.cwd, folder: path.basename(s.cwd), at: s.at }));
}

/** The folders the account's Code sessions ran in, newest first: [{ path, at }]. */
async function recentFolders(profile, limit = 12) {
  const seen = new Set();
  const out = [];
  for (const s of await everyone(profile)) {
    if (!s.cwd) continue;
    const key = s.cwd.replace(/[\\/]+$/, '').toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ path: s.cwd, at: s.at });
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * The organization the signed-in account works in, read from the folder names
 * (<account>/<organization>): an account can belong to several, and the one
 * holding its sessions is the one its window uses. Null before its first session.
 */
async function orgOf(profile) {
  const { accountId } = claude.readAccount(claude.dataDirOf(profile));
  let best = null;
  for (const dir of await folders(profile)) {
    const [a, b] = dir.split(path.sep).slice(-2);
    const org = a === accountId ? b : b === accountId ? a : null;
    if (!org || org === accountId) continue;
    const count = (await entries(dir, false)).filter((n) => FILE_RE.test(n)).length;
    if (!best || count > best.count) best = { org, count };
  }
  return best ? best.org : null;
}

module.exports = { ID_RE, UUID_RE, recent, find, popouts, recentFolders, continuable, orgOf };
