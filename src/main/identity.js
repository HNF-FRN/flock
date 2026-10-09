'use strict';
// Names each Claude window after its account wherever Windows lists windows:
// the title ("Work — Claude") in Alt+Tab, Win+Tab, taskbar previews and screen-
// share pickers, the window's icon there, and a taskbar button of its own with
// the account's icon. The icon is Claude's own, recoloured on this PC from the
// installed app's artwork: Flock ships none of it. All of it lives on the window
// itself, and wintrack.js puts the window back as it was when this is switched
// off or Flock quits.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app, nativeImage } = require('electron');
const claude = require('./claude');
const wintrack = require('./wintrack');
const { log } = require('./log');

const CLAUDE_ORANGE = '#D97757';

const named = new Map(); // window handle -> what it was given (JSON)
const icons = new Map(); // source + colour -> .ico path ('' while it is being drawn)
let onIcon = () => {};

function init(options) {
  onIcon = options.onIcon || onIcon;
}

// ── Icons ───────────────────────────────────────────────────────────────────

function rgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Claude's icon in another colour: the orange tile takes the account's colour
 * (a little lighter at the top, as in the original), the white mark stays white
 * (dark on very light colours). Bitmaps are BGRA with premultiplied alpha.
 */
function recolor(img, hex) {
  const { width, height } = img.getSize();
  const px = img.toBitmap();
  const acc = rgb(hex);
  const lum = (0.2126 * acc[0] + 0.7152 * acc[1] + 0.0722 * acc[2]) / 255;
  const mark = lum > 0.72 ? [28, 28, 30] : [254, 252, 251];
  for (let y = 0; y < height; y++) {
    const shade = 1.05 - (0.1 * y) / Math.max(1, height - 1);
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const a = px[i + 3];
      if (!a) continue;
      const mx = Math.max(px[i], px[i + 1], px[i + 2]);
      const mn = Math.min(px[i], px[i + 1], px[i + 2]);
      // How much of the white mark this pixel holds: the tile is saturated, the mark is not.
      const t = Math.max(0, Math.min(1, 1 - (mx ? (mx - mn) / mx : 0) / 0.62));
      const c = (k) => Math.round(((Math.min(255, acc[k] * shade) * (1 - t)) + mark[k] * t) * a / 255);
      px[i] = c(2);
      px[i + 1] = c(1);
      px[i + 2] = c(0);
    }
  }
  return nativeImage.createFromBitmap(px, { width, height });
}

/** An .ico holding PNG images, one per size. */
function ico(images) {
  const head = Buffer.alloc(6);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(images.length, 4);
  const dir = Buffer.alloc(16 * images.length);
  let offset = head.length + dir.length;
  images.forEach((im, i) => {
    const b = i * 16;
    dir.writeUInt8(im.size >= 256 ? 0 : im.size, b);
    dir.writeUInt8(im.size >= 256 ? 0 : im.size, b + 1);
    dir.writeUInt16LE(1, b + 4);
    dir.writeUInt16LE(32, b + 6);
    dir.writeUInt32LE(im.png.length, b + 8);
    dir.writeUInt32LE(offset, b + 12);
    offset += im.png.length;
  });
  return Buffer.concat([head, dir, ...images.map((im) => im.png)]);
}

async function draw(src, hex) {
  const images = [];
  if (src.kind === 'store') {
    for (const { size, file } of src.files) {
      const img = nativeImage.createFromBuffer(fs.readFileSync(file));
      if (!img.isEmpty()) images.push({ size, png: recolor(img, hex).toPNG() });
    }
  } else {
    const big = await app.getFileIcon(src.exe, { size: 'large' });
    if (!big.isEmpty()) {
      const c = recolor(big, hex);
      const s = c.getSize().width;
      images.push({ size: 16, png: c.resize({ width: 16, height: 16, quality: 'best' }).toPNG() });
      if (s > 16) images.push({ size: s, png: c.toPNG() });
    }
  }
  return images;
}

/** Path of the account's icon, or null while it is being drawn (onIcon fires once it is). */
function iconFor(hex) {
  const src = claude.appIcon();
  if (!src) return null;
  const from = src.kind === 'store' ? path.dirname(src.files[0].file) : src.exe;
  const key = `${from}|${hex}`;
  if (icons.has(key)) return icons.get(key) || null;
  icons.set(key, '');
  // A new name for every source and colour: Windows caches taskbar icons by file.
  const tag = crypto.createHash('sha1').update(key).digest('hex').slice(0, 8);
  const file = path.join(app.getPath('userData'), 'icons', `claude-${hex.slice(1).toLowerCase()}-${tag}.ico`);
  (async () => {
    if (!fs.existsSync(file)) {
      const images = await draw(src, hex);
      if (!images.length) throw new Error('no icon images');
      await fs.promises.mkdir(path.dirname(file), { recursive: true });
      await fs.promises.writeFile(file, ico(images));
    }
    icons.set(key, file);
    onIcon();
  })().catch((e) => log('could not draw icon', hex, e.message));
  return null;
}

// ── Windows ─────────────────────────────────────────────────────────────────

/** How a pinned account button starts that account again: through Flock. */
function relaunchCommand(id) {
  const q = (s) => `"${s}"`;
  return app.isPackaged
    ? `${q(process.execPath)} --open=${id}`
    : `${q(process.execPath)} ${q(app.getAppPath())} --open=${id}`;
}

function spec(account) {
  const title = `${account.name} — Claude`;
  // Main keeps Claude's own taskbar button and icon while it wears Claude's colour.
  if (account.kind === 'default' && account.color.toUpperCase() === CLAUDE_ORANGE) return { title };
  const icon = iconFor(account.color);
  if (!icon) return { title };
  return {
    title,
    icon,
    appId: `Flock.Claude.${account.id}`,
    relaunch: relaunchCommand(account.id),
    relaunchName: title,
  };
}

/**
 * Brings every followed window in line: `wins` from wintrack, `byPid` maps a
 * Claude process id to its account, `on` is the windowNames setting.
 */
function sync(wins, byPid, on) {
  if (!on) {
    if (named.size) wintrack.plainAll();
    named.clear();
    return;
  }
  for (const w of wins) {
    const a = byPid.get(w.p);
    if (!a) continue;
    const s = spec(a);
    const key = JSON.stringify(s);
    if (named.get(w.h) === key) continue;
    wintrack.name(w.h, s);
    named.set(w.h, key);
  }
  // Forget closed windows (wintrack frees what they held); one that is only out
  // of sight, on another desktop, is named again unchanged when it comes back.
  const present = new Set(wins.map((w) => w.h));
  for (const h of [...named.keys()]) if (!present.has(h)) named.delete(h);
}

function reset() {
  named.clear();
}

module.exports = { init, sync, reset };
