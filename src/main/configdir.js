'use strict';
// Independent ~/.claude folders for accounts that should not share the default one.

const fs = require('fs');
const path = require('path');
const { HOME, exists, pathKey } = require('./util');

const DEFAULT_CONFIG_DIR = path.join(HOME, '.claude');

// Small, user-authored things worth carrying over. History, projects, caches,
// credentials and plugins stay behind: the point of an own folder is a clean slate.
const BASICS = ['CLAUDE.md', 'settings.json', 'keybindings.json', 'agents', 'commands', 'output-styles'];

function suggestDir(slug, taken) {
  const base = path.join(HOME, `.claude-${slug.toLowerCase()}`);
  let dir = base;
  let n = 2;
  const used = new Set(taken.map(pathKey));
  while (used.has(pathKey(dir)) || exists(dir)) {
    dir = `${base}-${n++}`;
  }
  return dir;
}

function dirSize(p) {
  let total = 0;
  const stack = [p];
  while (stack.length) {
    const cur = stack.pop();
    let entries;
    try { entries = fs.readdirSync(cur, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const full = path.join(cur, e.name);
      if (e.isDirectory()) stack.push(full);
      else { try { total += fs.statSync(full).size; } catch {} }
    }
  }
  return total;
}

/** What can be copied from the default ~/.claude, with sizes, for the editor UI. */
function seedInfo() {
  const basics = BASICS.filter((n) => exists(path.join(DEFAULT_CONFIG_DIR, n)));
  const skillsDir = path.join(DEFAULT_CONFIG_DIR, 'skills');
  return {
    from: DEFAULT_CONFIG_DIR,
    basics,
    skillsBytes: exists(skillsDir) ? dirSize(skillsDir) : 0,
  };
}

/** Creates an own config folder and optionally copies the basics / skills into it. */
async function prepare(dir, { basics = true, skills = false } = {}) {
  await fs.promises.mkdir(dir, { recursive: true });
  const items = [];
  if (basics) items.push(...BASICS);
  if (skills) items.push('skills');
  const copied = [];
  for (const name of items) {
    const src = path.join(DEFAULT_CONFIG_DIR, name);
    const dst = path.join(dir, name);
    if (!exists(src) || exists(dst)) continue;
    await fs.promises.cp(src, dst, { recursive: true, errorOnExist: false, force: false });
    copied.push(name);
  }
  return copied;
}

module.exports = { DEFAULT_CONFIG_DIR, suggestDir, seedInfo, prepare };
