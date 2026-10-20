'use strict';
// Keeps every account in its own data folder now that Claude Desktop moves
// its data out of the Store package.
//
// Claude Desktop 2.42304 (October 2026) moves its data folder from the
// package to %LOCALAPPDATA%\Claude-Data\<package family>. That is one fixed
// folder whatever --user-data-dir says. The first account Claude moves takes
// it, and from then on Claude points every other account that starts at that
// same folder. They then share one single-instance lock, so only one window
// opens, and one sign-in. An account with its own ~/.claude finds none of the
// sessions that window lists.
//
// Claude decides at each start from marker files in the package's copy of the
// data folder (read from the 2.42304 bundle; CLAUDE_USER_DATA_DIR, the other
// way out, is ignored by signed builds):
// - .user-data-left.<family>: this folder's data was moved out.
// - .user-data-back.<family>: it came back, so it stays where it is.
// - A moved folder without ant-did (Claude's install id) is "occupied" for
//   every folder that holds its own ant-did, which then stays where it is.
//
// So before Flock starts an account it:
// 1. moves a moved account back into its own folder once nothing uses it;
// 2. holds the moved place with a small placeholder folder, so Claude moves
//    no account again and every account with a profile stays put;
// 3. marks the other accounts "came back" while the move cannot be undone
//    yet (that account is open), and an account with no profile yet, so they
//    still start in their own folders. Flock takes its own markers back once
//    they are not needed.

const fs = require('fs');
const path = require('path');
const { APPDATA, LOCALAPPDATA, exists, samePath } = require('./util');

const INSTALL_ID = 'ant-did';
const PLACEHOLDER = 'Flock keeps Claude accounts apart.txt';
const PLACEHOLDER_TEXT = [
  'Flock holds this folder so Claude Desktop keeps each account in its own data folder.',
  'Claude moves only one data folder here, and then opens every other account from it too.',
  'Deleting this folder is safe: Flock makes it again the next time it opens an account.',
  '',
].join('\r\n');
const FLOCK_MARK = 'flock'; // the contents of the markers Flock adds, so it can tell them apart
const MARKER_RE = /^\.user-data-[a-z]+\.[a-z0-9._-]+$/i;

const marker = (kind, family) => `.user-data-${kind}.${family.toLowerCase()}`;

/** Where Claude moves its data folder to for this package family. */
function targetOf(family) {
  return path.join(LOCALAPPDATA, 'Claude-Data', family.toLowerCase());
}

/** The package's copy of a data folder under %APPDATA%, where Claude looks for its markers. */
function packageCopyOf(dataDir, family) {
  if (!dataDir || !samePath(path.dirname(dataDir), APPDATA)) return null;
  return path.join(LOCALAPPDATA, 'Packages', family, 'LocalCache', 'Roaming', path.basename(dataDir));
}

const holdsProfile = (dir) => exists(path.join(dir, INSTALL_ID));
const has = (dir, kind, family) => exists(path.join(dir, marker(kind, family)));
const movedOut = (copy, family) => has(copy, 'left', family) && !has(copy, 'back', family);

function isOurs(file) {
  try { return fs.readFileSync(file, 'utf8') === FLOCK_MARK; } catch { return false; }
}

/** The folder Claude moved this account's data to, or null when it holds its own. */
function movedTo(dataDir, families) {
  for (const family of families) {
    const copy = packageCopyOf(dataDir, family);
    const target = targetOf(family);
    if (copy && movedOut(copy, family) && holdsProfile(target)) return target;
  }
  return null;
}

/** Puts a moved account back in its own folder. Only when that folder holds nothing but Claude's markers. */
function moveBack(target, copy, log) {
  let names;
  try { names = fs.readdirSync(copy); } catch { return false; }
  if (!names.every((n) => MARKER_RE.test(n))) {
    log('data folder', copy, 'holds data as well as', target, '- left as it is');
    return false;
  }
  const aside = `${copy}.flock-${Date.now()}`;
  try {
    fs.renameSync(copy, aside);
  } catch (e) {
    log('could not move', target, 'back yet:', e.code || e.message);
    return false;
  }
  try {
    fs.renameSync(target, copy);
  } catch (e) {
    try { fs.renameSync(aside, copy); } catch {}
    log('could not move', target, 'back yet:', e.code || e.message);
    return false;
  }
  for (const n of names) {
    try { fs.unlinkSync(path.join(aside, n)); } catch {}
  }
  try { fs.rmdirSync(aside); } catch {}
  log('moved', target, 'back to', copy);
  return true;
}

function hold(target, log) {
  try {
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, PLACEHOLDER), PLACEHOLDER_TEXT);
    log('holding', target, 'so Claude keeps accounts apart');
  } catch (e) {
    log('could not hold', target, e.code || e.message);
  }
}

function guardFamily(dataDirs, family, launching, log) {
  if (!exists(path.join(LOCALAPPDATA, 'Packages', family))) return;
  const target = targetOf(family);
  const accounts = dataDirs
    .map((dataDir) => ({ dataDir, copy: packageCopyOf(dataDir, family) }))
    .filter((a) => a.copy);

  if (holdsProfile(target) && !exists(path.join(target, 'lockfile'))) {
    const owners = accounts.filter((a) => exists(a.copy) && movedOut(a.copy, family));
    if (owners.length === 1) moveBack(target, owners[0].copy, log);
    else log(target, 'holds an account Flock cannot tell', `(${owners.length} candidates) - left as it is`);
  }
  if (!exists(target)) hold(target, log);

  const shared = holdsProfile(target); // still some account's data: others must not join it
  for (const { dataDir, copy } of accounts) {
    if (!exists(copy) && !samePath(dataDir, launching)) continue;
    if (exists(copy) && movedOut(copy, family)) continue; // it lives in the moved folder for now
    const back = path.join(copy, marker('back', family));
    const needed = shared || !holdsProfile(copy);
    try {
      if (needed && !exists(back)) {
        fs.mkdirSync(copy, { recursive: true });
        fs.writeFileSync(back, FLOCK_MARK);
      } else if (!needed && isOurs(back)) {
        fs.unlinkSync(back);
      }
    } catch (e) {
      log('could not mark', copy, e.code || e.message);
    }
  }
}

/**
 * Run before starting any account: undoes Claude's move where it can and keeps
 * every account (dataDirs) in its own folder. `launching` is the data folder
 * about to start, which may not exist yet.
 */
function guard(dataDirs, families, { launching = null, log = () => {} } = {}) {
  for (const family of families) {
    try {
      guardFamily(dataDirs, family, launching, log);
    } catch (e) {
      log('data folder guard failed for', family, e.message);
    }
  }
}

module.exports = { guard, movedTo, targetOf, packageCopyOf };
