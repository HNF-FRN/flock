// Copies what the phone app (docs/app, served by GitHub Pages) shares with the
// desktop app into docs/app/shared: the relay, the mascot and the design
// tokens. Then renames the app's offline cache after its contents, so phones
// pick up the new version. Run after changing any of them:
//   node scripts/phone-app.mjs
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = path.join(ROOT, 'docs', 'app');
const SHARED = [
  ['src/shared/relay.js', 'relay.js'],
  ['src/renderer/shared/mascot.js', 'mascot.js'],
  ['src/renderer/shared/tokens.css', 'tokens.css'],
];

fs.mkdirSync(path.join(APP, 'shared'), { recursive: true });
for (const [from, to] of SHARED) fs.copyFileSync(path.join(ROOT, from), path.join(APP, 'shared', to));

const hash = crypto.createHash('sha256');
for (const f of ['index.html', 'app.css', 'app.js', 'manifest.webmanifest', ...SHARED.map(([, to]) => `shared/${to}`)]) {
  hash.update(fs.readFileSync(path.join(APP, f)));
}
const sw = path.join(APP, 'sw.js');
const name = `flock-${hash.digest('hex').slice(0, 10)}`;
fs.writeFileSync(sw, fs.readFileSync(sw, 'utf8').replace(/const CACHE = '[^']*';/, `const CACHE = '${name}';`));
console.log(`docs/app updated (cache ${name})`);
