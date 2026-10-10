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

// Using Flock from a phone (phone.js). Off until a phone is paired from Settings.
const DEFAULT_PHONE = {
  enabled: false,
  server: 'https://ntfy.sh', // the relay the encrypted messages travel through
  appUrl: 'https://hnf-frn.github.io/flock/app/', // where the phone app is served
  devices: [], // [{ id, name, topic, key (sealed with Windows' DPAPI), pairedAt, seenAt }]
  roots: [], // project folders the phone may open; empty = home and the folders of recent projects
  permissionMode: 'default', // for the sessions phone servers start: default | acceptEdits | auto | plan
  spawn: 'same-dir', // sessions the Claude app adds to a server: 'same-dir' or 'worktree' (git)
  keepAwake: true, // keep the PC from sleeping while a phone is paired
  recent: [], // [{ account, path, at }] folders started from the phone
  owners: {}, // Claude Code sign-in (cli.js) -> the account id it was signed in for from Flock
  pending: {}, // account id -> { key, done }: sign-in windows Flock opened, until `done` shows they succeeded
  renew: false, // ~/.claude's own sign-in has to be signed in again before Flock trusts whose it is
};

function normalizePhone(raw) {
  const p = { ...DEFAULT_PHONE, ...(raw && typeof raw === 'object' ? raw : {}) };
  p.devices = Array.isArray(p.devices) ? p.devices.filter((d) => d && d.id && d.topic && d.key) : [];
  p.roots = Array.isArray(p.roots) ? p.roots.filter((r) => typeof r === 'string' && r) : [];
  p.recent = Array.isArray(p.recent) ? p.recent.filter((r) => r && r.account && r.path).slice(0, 40) : [];
  p.owners = p.owners && typeof p.owners === 'object' ? p.owners : {};
  p.pending = p.pending && typeof p.pending === 'object' ? p.pending : {};
  for (const [id, w] of Object.entries(p.pending)) if (!w || typeof w.key !== 'string' || typeof w.done !== 'string') delete p.pending[id];
  // Flock 0.2.1 signed a second account sharing ~/.claude in with
  // CLAUDE_CONFIG_DIR set to ~/.claude ('explicit'), without a folder of its
  // own for the sign-in. On Windows that wrote over ~/.claude's own sign-in,
  // which may still be that account's under another's name.
  if (p.slots) {
    if (typeof p.slots === 'object' && Object.values(p.slots).includes('explicit')) p.renew = true;
    delete p.slots;
  }
  p.renew = p.renew === true;
  if (!['default', 'acceptEdits', 'auto', 'plan'].includes(p.permissionMode)) p.permissionMode = 'default';
  if (!['same-dir', 'worktree'].includes(p.spawn)) p.spawn = 'same-dir';
  return p;
}

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
  return { version: 1, settings, profiles, phone: normalizePhone(d.phone) };
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

module.exports = { PALETTE, DEFAULT_SETTINGS, DEFAULT_PHONE, load, save, get, update };
