'use strict';
// Small helpers shared by the main-process modules: Windows paths, command
// lines, slugs.

const fs = require('fs');
const os = require('os');
const path = require('path');

const HOME = process.env.USERPROFILE || os.homedir();
const APPDATA = process.env.APPDATA || path.join(HOME, 'AppData', 'Roaming');
const LOCALAPPDATA = process.env.LOCALAPPDATA || path.join(HOME, 'AppData', 'Local');

/** Case-insensitive, slash-insensitive key for comparing Windows paths. */
function pathKey(p) {
  if (!p) return '';
  return path.win32.resolve(String(p)).replace(/[\\/]+$/, '').toLowerCase();
}

function samePath(a, b) {
  return pathKey(a) === pathKey(b);
}

/** True when `p` exists — including App Execution Alias reparse points, which
 *  `fs.existsSync` can report as missing. */
function exists(p) {
  try {
    fs.lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

/** Splits a Windows command line the way CommandLineToArgvW does. */
function splitCommandLine(cmd) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  let started = false;
  let i = 0;
  const s = String(cmd || '');
  while (i < s.length) {
    const c = s[i];
    if (c === '\\') {
      let n = 0;
      while (s[i] === '\\') { n++; i++; }
      if (s[i] === '"') {
        cur += '\\'.repeat(Math.floor(n / 2));
        if (n % 2 === 1) { cur += '"'; i++; }
      } else {
        cur += '\\'.repeat(n);
      }
      started = true;
      continue;
    }
    if (c === '"') {
      if (inQuotes && s[i + 1] === '"') { cur += '"'; i += 2; started = true; continue; }
      inQuotes = !inQuotes;
      started = true;
      i++;
      continue;
    }
    if (!inQuotes && (c === ' ' || c === '\t')) {
      if (started) { out.push(cur); cur = ''; started = false; }
      i++;
      continue;
    }
    cur += c;
    started = true;
    i++;
  }
  if (started) out.push(cur);
  return out;
}

/** Value of a `--name=value` switch, or null. */
function switchValue(argv, name) {
  const prefix = `${name}=`;
  for (const a of argv) {
    if (a.toLowerCase().startsWith(prefix.toLowerCase())) return a.slice(prefix.length);
  }
  return null;
}

/** "Work Account!" -> "Work-Account" */
function slugify(name) {
  const s = String(name || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
  return s || 'Account';
}

function shortId() {
  return Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3);
}

/** "C:\Users\me\.claude" -> "~\.claude" for display. */
function tildify(p) {
  if (!p) return p;
  const home = HOME.replace(/[\\/]+$/, '');
  return pathKey(p).startsWith(pathKey(home) + '\\') || samePath(p, home)
    ? '~' + p.slice(home.length)
    : p;
}

module.exports = {
  HOME,
  APPDATA,
  LOCALAPPDATA,
  pathKey,
  samePath,
  exists,
  splitCommandLine,
  switchValue,
  slugify,
  shortId,
  tildify,
};
