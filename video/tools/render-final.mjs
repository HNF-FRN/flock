// Final render, resumable: the film is rendered in frame-exact chunks (each its
// own H.264 file with identical settings); chunks already rendered are kept, so
// an interrupted render picks up where it stopped. Then the chunks are joined
// without re-encoding, the soundtrack is mixed, and both are muxed.
//
//   node video/tools/render-final.mjs [--fps 60] [--scale 2] [--chunk 960]
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FFMPEG } from './capture.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'out');
const PARTS = path.join(OUT, 'parts');
const argv = process.argv.slice(2);
const opt = (k, d) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : d;
};
const FPS = Number(opt('fps', 60));
const SCALE = String(opt('scale', 2));
const CHUNK = Number(opt('chunk', 960));
const node = process.execPath;
const capture = path.join(ROOT, 'tools', 'capture.mjs');

function sh(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`${path.basename(cmd)} ${args.slice(0, 3).join(' ')} … exited ${r.status}`);
}

function frames(file) {
  // a finished part has a moov atom and the expected number of frames
  const r = spawnSync(FFMPEG, ['-v', 'error', '-i', file, '-map', '0:v:0', '-c', 'copy', '-f', 'null', '-'], { encoding: 'utf8' });
  if (r.status !== 0) return -1;
  const p = spawnSync(FFMPEG, ['-hide_banner', '-i', file, '-map', '0:v:0', '-c', 'copy', '-f', 'null', '-'], { encoding: 'utf8' });
  const m = /frame=\s*(\d+)/g;
  let last = -1;
  let x;
  while ((x = m.exec(p.stderr))) last = Number(x[1]);
  return last;
}

// how long is the film?
sh(node, [capture, 'cues']);
const { duration } = JSON.parse(fs.readFileSync(path.join(OUT, 'cues.json'), 'utf8'));
const total = Math.round(duration * FPS);
fs.mkdirSync(PARTS, { recursive: true });
const parts = [];
for (let i = 0, k = 0; i < total; i += CHUNK, k++) {
  const n = Math.min(CHUNK, total - i);
  const name = `part-${String(k).padStart(2, '0')}`;
  const file = path.join(PARTS, `${name}.mp4`);
  parts.push(file);
  if (fs.existsSync(file) && frames(file) === n) {
    console.log(`${name}: done (${n} frames) — kept`);
    continue;
  }
  console.log(`${name}: frames ${i}–${i + n - 1}`);
  sh(node, [capture, 'video', '--fps', String(FPS), '--scale', SCALE, '--workers', '6', '--format', 'jpeg', '--quality', '93',
    '--preset', 'slow', '--crf', '14', '--from', (i / FPS).toFixed(6), '--to', ((i + n) / FPS).toFixed(6), '--out', `parts/${name}`]);
  const got = frames(file);
  if (got !== n) throw new Error(`${name}: expected ${n} frames, got ${got}`);
}

// join (no re-encode), mix, mux
const list = path.join(PARTS, 'list.txt');
fs.writeFileSync(list, parts.map((p) => `file '${p.replace(/\\/g, '/')}'`).join('\n'));
const silent = path.join(OUT, 'flock-final-silent.mp4');
sh(FFMPEG, ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', silent]);
console.log(`joined ${parts.length} parts → ${path.relative(ROOT, silent)} (${frames(silent)} frames)`);
sh(node, [capture, 'cues']);
sh(node, [path.join(ROOT, 'tools', 'mix.mjs'), silent, path.join(OUT, 'flock-promo.mp4')]);
console.log('final: video/out/flock-promo.mp4');
