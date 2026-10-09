'use strict';
// A small log at %APPDATA%\Flock\flock.log for troubleshooting launches and
// sign-in routing. Links are logged without their query or fragment, because
// those carry one-time sign-in codes.

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const MAX_BYTES = 1024 * 1024;
let file = null;

function target() {
  if (file) return file;
  file = path.join(app.getPath('userData'), 'flock.log');
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (fs.statSync(file).size > MAX_BYTES) fs.renameSync(file, `${file}.old`);
  } catch {}
  return file;
}

function safeUrl(url) {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}${u.pathname}${u.search || u.hash ? ' (+params hidden)' : ''}`;
  } catch {
    return '(unparseable link)';
  }
}

function log(...parts) {
  const line = parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join(' ');
  try {
    fs.appendFileSync(target(), `[${new Date().toISOString()}] ${line}\n`);
  } catch {}
}

module.exports = { log, safeUrl };
