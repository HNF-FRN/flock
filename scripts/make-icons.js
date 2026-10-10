// Draws Flock's mascot (src/renderer/shared/mascot.js) into the app icon
// (build/icon.ico), the window icon (assets/icon.png) and the tray icons
// (assets/tray*.png). The app icon puts the mascot on a dark tile, like the
// island; the tray icon is the mascot alone, with a soft dark halo so it shows
// on light and dark taskbars.
// Run with: npm run icons   (runs under Electron for a canvas)

const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const INK = '#F5F6F8';

function drawInPage(size, kind, svgText) {
  return new Promise((resolve, reject) => {
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const ctx = c.getContext('2d');
    const img = new Image();
    img.onload = () => {
      if (kind === 'tile' || kind === 'mask') {
        const g = ctx.createLinearGradient(0, 0, 0, size);
        g.addColorStop(0, '#1d1f24');
        g.addColorStop(1, '#0b0c0e');
        ctx.fillStyle = g;
        ctx.beginPath();
        // A maskable icon fills the square (the phone cuts its own shape) and
        // keeps the mascot inside the middle 60%.
        ctx.roundRect(0, 0, size, size, kind === 'mask' ? 0 : size * 0.22);
        ctx.fill();
        const m = size * (kind === 'mask' ? 0.56 : 0.78);
        ctx.drawImage(img, (size - m) / 2, (size - m) / 2, m, m);
      } else {
        ctx.shadowColor = 'rgba(0, 0, 0, 0.75)';
        ctx.shadowBlur = Math.max(1, size * 0.07);
        const m = size * 0.94;
        ctx.drawImage(img, (size - m) / 2, (size - m) / 2, m, m);
      }
      resolve(c.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error('the mascot did not render'));
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgText)}`;
  });
}

function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const dir = Buffer.alloc(16 * images.length);
  let offset = 6 + dir.length;
  images.forEach((im, i) => {
    const b = i * 16;
    dir.writeUInt8(im.size >= 256 ? 0 : im.size, b);
    dir.writeUInt8(im.size >= 256 ? 0 : im.size, b + 1);
    dir.writeUInt8(0, b + 2);
    dir.writeUInt8(0, b + 3);
    dir.writeUInt16LE(1, b + 4);
    dir.writeUInt16LE(32, b + 6);
    dir.writeUInt32LE(im.png.length, b + 8);
    dir.writeUInt32LE(offset, b + 12);
    offset += im.png.length;
  });
  return Buffer.concat([header, dir, ...images.map((im) => im.png)]);
}

process.on('uncaughtException', (e) => { console.error(e); app.exit(1); });
process.on('unhandledRejection', (e) => { console.error(e); app.exit(1); });

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 300, height: 300, webPreferences: { offscreen: true } });
  await win.loadURL('data:text/html,<html><body style="margin:0"></body></html>');
  await win.webContents.executeJavaScript(fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'shared', 'mascot.js'), 'utf8'));
  // The mascot alone, cropped to its own bounds; the antenna's glow only shows in the app.
  const svgText = (await win.webContents.executeJavaScript(`FlockMascot.svg(${JSON.stringify(INK)})`))
    .replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ')
    .replace('viewBox="0 0 40 40"', 'viewBox="3 3.2 34 34"')
    .replace(/<circle class="glow"[^>]*\/>/, '');
  const render = async (size, kind) => {
    const url = await win.webContents.executeJavaScript(`(${drawInPage.toString()})(${size}, ${JSON.stringify(kind)}, ${JSON.stringify(svgText)})`);
    return Buffer.from(url.split(',')[1], 'base64');
  };

  fs.mkdirSync(path.join(ROOT, 'build'), { recursive: true });
  fs.mkdirSync(path.join(ROOT, 'assets'), { recursive: true });

  const images = [];
  for (const size of [16, 20, 24, 32, 40, 48, 64, 96, 128, 256]) images.push({ size, png: await render(size, 'tile') });
  fs.writeFileSync(path.join(ROOT, 'build', 'icon.ico'), ico(images));
  fs.writeFileSync(path.join(ROOT, 'assets', 'icon.png'), await render(256, 'tile'));
  fs.writeFileSync(path.join(ROOT, 'assets', 'tray.png'), await render(16, 'tray'));
  fs.writeFileSync(path.join(ROOT, 'assets', 'tray@1.5x.png'), await render(24, 'tray'));
  fs.writeFileSync(path.join(ROOT, 'assets', 'tray@2x.png'), await render(32, 'tray'));
  // The phone app's home-screen icons (docs/app, served by GitHub Pages).
  const phone = path.join(ROOT, 'docs', 'app', 'icons');
  fs.mkdirSync(phone, { recursive: true });
  fs.writeFileSync(path.join(phone, 'icon-192.png'), await render(192, 'tile'));
  fs.writeFileSync(path.join(phone, 'icon-512.png'), await render(512, 'tile'));
  fs.writeFileSync(path.join(phone, 'maskable-512.png'), await render(512, 'mask'));
  console.log('icons written');
  app.quit();
});
