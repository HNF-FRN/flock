'use strict';
// Flock's own settings and account list, kept in %APPDATA%\Flock\flock.json.
// Writes go through a temp file + rename so a crash never leaves half a file.

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

// Colours that stay readable on the island's black and under the mascot's dark eyes.
// The first one is Claude orange, which Main gets.
const PALETTE = [
  '#D97757', '#FACC15', '#F4505E', '#E879F9', '#C084FC',
  '#818CF8', '#38BDF8', '#2DD4BF', '#4ADE80', '#F5F6F8',
];

const DEFAULT_SETTINGS = {
  launchAtLogin: false,
  islandMode: 'compact', // 'compact' | 'hover' | 'off'
  sound: true,
  hotkey: 'Control+Alt+F',
  autoRouteSignIn: true, // pass Google sign-in links on to accounts waiting for sign-in
  staggerMs: 1200, // gap between windows when opening several accounts
  windowNames: true, // name each Claude window after its account: title, icon, own taskbar button
  windowEdge: 'all', // accent edge along the top of Claude windows: 'all' | 'focus' | 'off'
  islandFocus: true, // the island shows which account's window has focus
  islandYield: true, // the island steps aside while another app's window lies under it
};

function mainProfile() {
  return {
    id: 'main',
    kind: 'default',
    name: 'Main',
    note: '',
    color: PALETTE[0],
    config: { mode: 'shared' },
    openOnStart: false,
    createdAt: Date.now(),
  };
}

let file = null;
let data = null;

function filePath() {
  if (!file) file = path.join(app.getPath('userData'), 'flock.json');
  return file;
}

function normalize(raw) {
  const d = raw && typeof raw === 'object' ? raw : {};
  const settings = { ...DEFAULT_SETTINGS, ...(d.settings || {}) };
  delete settings.windowTint; // 0.1.2's colour layer, replaced by windowNames and windowEdge
  let profiles = Array.isArray(d.profiles) ? d.profiles.filter((p) => p && p.id && p.name) : [];
  if (!profiles.some((p) => p.kind === 'default')) profiles.unshift(mainProfile());
  profiles = profiles.map((p) => ({
    note: '',
    openOnStart: false,
    config: { mode: 'shared' },
    ...p,
    color: /^#[0-9a-f]{6}$/i.test(p.color || '') ? p.color.toUpperCase() : PALETTE[0],
  }));
  return { version: 1, settings, profiles };
}

function load() {
  try {
    data = normalize(JSON.parse(fs.readFileSync(filePath(), 'utf8')));
  } catch (e) {
    if (e.code !== 'ENOENT') {
      // Keep the unreadable file next to the new one instead of silently losing it.
      try { fs.copyFileSync(filePath(), filePath() + '.broken-' + Date.now()); } catch {}
    }
    data = normalize(null);
    save();
  }
  return data;
}

function save() {
  const target = filePath();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, target);
}

function get() {
  return data || load();
}

function update(mutator) {
  const d = get();
  mutator(d);
  data = normalize(d);
  save();
  return data;
}

module.exports = { PALETTE, DEFAULT_SETTINGS, load, save, get, update };
