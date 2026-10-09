// Renders the film frame by frame in headless Chrome (DevTools protocol, no
// dependencies — like dev/cdp.js) and encodes it with ffmpeg.
//
//   node video/tools/capture.mjs stills 3.5 12 40.25          → out/qa/t3.500.png …
//   node video/tools/capture.mjs video [--fps 60] [--from 0] [--to 95] [--scale 2] [--workers 6] [--out name]
//
// Env: CHROME (default: Program Files Chrome), FFMPEG (default: Stremio's bundled ffmpeg if
// installed, else ffmpeg on PATH)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'out');
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const STREMIO_FFMPEG = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Stremio', 'ffmpeg.exe');
export const FFMPEG = process.env.FFMPEG || (fs.existsSync(STREMIO_FFMPEG) ? STREMIO_FFMPEG : 'ffmpeg');

// ── args ──
const argv = process.argv.slice(2);
const mode = argv[0];
const opt = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : def;
};

// ── static server ──
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.mp3': 'audio/mpeg', '.jpg': 'image/jpeg', '.webp': 'image/webp' };
function serve() {
  return new Promise((res) => {
    const srv = http.createServer((req, rsp) => {
      const p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
      if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { rsp.writeHead(404).end(); return; }
      rsp.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      fs.createReadStream(p).pipe(rsp);
    });
    srv.listen(0, '127.0.0.1', () => res(srv));
  });
}

// ── chrome + CDP ──
async function launchChrome() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flock-film-'));
  const proc = spawn(CHROME, [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${dir}`,
    '--hide-scrollbars', '--mute-audio', '--no-first-run', '--no-default-browser-check',
    '--force-color-profile=srgb', '--disable-lcd-text', '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    '--run-all-compositor-stages-before-draw', '--disable-new-content-rendering-timeout',
    '--window-size=1920,1080', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  const wsUrl = await new Promise((res, rej) => {
    let buf = '';
    proc.stderr.on('data', (d) => {
      buf += d;
      const m = /DevTools listening on (ws:\/\/\S+)/.exec(buf);
      if (m) res(m[1]);
    });
    proc.on('exit', (c) => rej(new Error(`chrome exited ${c}\n${buf}`)));
    setTimeout(() => rej(new Error('chrome did not start')), 20000);
  });
  return { proc, wsUrl, dir };
}

function cdp(wsUrl) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();
    const listeners = [];
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) {
        const { ok, err } = pending.get(m.id);
        pending.delete(m.id);
        if (m.error) err(new Error(`${m.error.message} ${m.error.data || ''}`));
        else ok(m.result);
      } else if (m.method) listeners.forEach((l) => l(m));
    };
    ws.onopen = () => res({
      send(method, params = {}, sessionId) {
        return new Promise((ok, err) => {
          const i = ++id;
          pending.set(i, { ok, err });
          ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) }));
        });
      },
      on(fn) { listeners.push(fn); },
      close() { ws.close(); },
    });
    ws.onerror = rej;
  });
}

async function openPage(c, url, scale) {
  // its own window, so it is visible and gets animation frames (background tabs get none)
  const { targetId } = await c.send('Target.createTarget', { url: 'about:blank', newWindow: true, background: false });
  const { sessionId } = await c.send('Target.attachToTarget', { targetId, flatten: true });
  const s = (m, p) => c.send(m, p, sessionId);
  await s('Page.enable');
  await s('Runtime.enable');
  await s('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: scale, mobile: false });
  const errors = [];
  c.on((m) => {
    if (m.sessionId !== sessionId) return;
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map((a) => a.value || a.description).join(' '));
  });
  await s('Page.navigate', { url });
  let ready = false;
  for (let i = 0; i < 300 && !ready; i++) {
    const r = await s('Runtime.evaluate', { expression: 'Boolean(window.__film && window.__film.ready)', returnByValue: true });
    ready = r.result.value;
    if (!ready) await new Promise((z) => setTimeout(z, 100));
    if (errors.length) break;
  }
  if (!ready) throw new Error(`film did not load:\n${errors.join('\n') || 'timeout'}`);
  const info = await s('Runtime.evaluate', { expression: 'JSON.stringify({d: __film.duration, cues: __film.cues, scenes: __film.scenes})', returnByValue: true });
  return { s, info: JSON.parse(info.result.value) };
}

async function shoot(page, t, format, quality) {
  const r = await page.s('Runtime.evaluate', { expression: `__film.seek(${t})`, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(`seek(${t}) failed: ${JSON.stringify(r.exceptionDetails.exception || r.exceptionDetails)}`);
  const shot = await page.s('Page.captureScreenshot', { format, ...(format === 'jpeg' ? { quality } : {}), captureBeyondViewport: false, fromSurface: true });
  return Buffer.from(shot.data, 'base64');
}

async function main() {
  const srv = await serve();
  const port = srv.address().port;
  const url = `http://127.0.0.1:${port}/film/index.html?capture`;
  const { proc, wsUrl, dir } = await launchChrome();
  const c = await cdp(wsUrl);
  const cleanup = () => {
    try { c.close(); } catch {}
    try { proc.kill(); } catch {}
    srv.close();
    setTimeout(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} }, 1500);
  };
  try {
    if (mode === 'stills') {
      const scale = Number(opt('scale', 1));
      const page = await openPage(c, url, scale);
      fs.mkdirSync(path.join(OUT, 'qa'), { recursive: true });
      const times = [];
      for (let i = 1; i < argv.length; i++) {
        if (argv[i].startsWith('--')) { i++; continue; }
        times.push(argv[i]);
      }
      for (const t of times) {
        const buf = await shoot(page, Number(t), 'png');
        const name = path.join(OUT, 'qa', `${opt('prefix', 't')}${Number(t).toFixed(3)}.png`);
        fs.writeFileSync(name, buf);
        console.log('saved', path.relative(ROOT, name));
      }
    } else if (mode === 'cues') {
      const page = await openPage(c, url, 1);
      fs.writeFileSync(path.join(OUT, 'cues.json'), JSON.stringify({ duration: page.info.d, from: 0, to: page.info.d, cues: page.info.cues, scenes: page.info.scenes }, null, 2));
      console.log(`cues: ${page.info.cues.length} → out/cues.json (film ${page.info.d.toFixed(2)}s)`);
    } else if (mode === 'video') {
      const fps = Number(opt('fps', 60));
      const scale = Number(opt('scale', 1));
      const workers = Number(opt('workers', 6));
      const format = opt('format', 'jpeg');
      const quality = Number(opt('quality', 94));
      const probe = await openPage(c, url, scale);
      const from = Number(opt('from', 0));
      const to = Math.min(Number(opt('to', probe.info.d)), probe.info.d);
      const n = Math.round((to - from) * fps);
      fs.writeFileSync(path.join(OUT, 'cues.json'), JSON.stringify({ duration: probe.info.d, from, to, cues: probe.info.cues, scenes: probe.info.scenes }, null, 2));
      const pages = [probe];
      for (let i = 1; i < workers; i++) pages.push(await openPage(c, url, scale));
      const name = opt('out', 'flock-silent');
      const outFile = path.join(OUT, `${name}.mp4`);
      const vf = scale !== 1 ? ['-vf', 'scale=1920:1080:flags=lanczos'] : [];
      // frames stream into ffmpeg in order: workers take frames round-robin, a small buffer reorders them
      const ff = spawn(FFMPEG, ['-y', '-v', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', format === 'png' ? 'png' : 'mjpeg', '-i', '-', ...vf,
        '-c:v', 'libx264', '-preset', opt('preset', 'slow'), '-crf', opt('crf', '14'), '-pix_fmt', 'yuv420p', '-tune', 'animation',
        '-x264-params', 'aq-mode=3', '-movflags', '+faststart', outFile], { stdio: ['pipe', 'inherit', 'inherit'] });
      const ffDone = new Promise((res, rej) => ff.on('exit', (code) => (code === 0 ? res() : rej(new Error(`ffmpeg exited ${code}`)))));
      const pending = new Map();
      let next = 0;
      let chain = Promise.resolve();
      const flush = () => {
        chain = chain.then(async () => {
          while (pending.has(next)) {
            const buf = pending.get(next);
            pending.delete(next);
            if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
            next++;
          }
        });
        return chain;
      };
      let done = 0;
      const t0 = Date.now();
      await Promise.all(pages.map(async (pg, w) => {
        for (let f = w; f < n; f += workers) {
          while (f - next > workers * 6) await new Promise((r) => setTimeout(r, 15)); // don't run far ahead
          const buf = await shoot(pg, from + f / fps, format, quality);
          pending.set(f, buf);
          await flush();
          done++;
          if (done % 100 === 0 || done === n) {
            const el = (Date.now() - t0) / 1000;
            process.stdout.write(`\r${done}/${n} frames  ${(done / el).toFixed(1)} fps  eta ${((n - done) / (done / el)).toFixed(0)}s   `);
          }
        }
      }));
      await flush();
      ff.stdin.end();
      await ffDone;
      console.log(`\nrendered ${n} frames in ${((Date.now() - t0) / 1000).toFixed(1)}s → ${path.relative(ROOT, outFile)}`);
    } else {
      console.log('usage: capture.mjs stills <t...> | video [--fps 60] [--from s] [--to s] [--scale 1|2]');
    }
  } finally {
    cleanup();
  }
}

export function run(cmd, args) {
  return new Promise((res, rej) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'inherit', 'inherit'] });
    p.on('exit', (code) => (code === 0 ? res() : rej(new Error(`${path.basename(cmd)} exited ${code}`))));
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
