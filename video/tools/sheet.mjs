// Contact sheet of stills, two per row at half size, each labelled.
//   node video/tools/sheet.mjs out/qa/sheet.png out/qa/t1.000.png out/qa/t2.000.png …
import path from 'node:path';
import { FFMPEG, run } from './capture.mjs';

const [out, ...files] = process.argv.slice(2);
const cols = 2;
const W = 960;
const H = 540;
const inputs = files.flatMap((f) => ['-i', f]);
const parts = files.map((f, i) => {
  const label = path.basename(f, '.png').replace(/^[a-z_]*?(\d)/, '$1').replace(/'/g, '');
  return `[${i}:v]scale=${W}:${H}:flags=lanczos,drawtext=text='${label}':x=12:y=10:fontsize=26:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=6:fontfile='C\\:/Windows/Fonts/consola.ttf'[v${i}]`;
});
const layout = files.map((_, i) => `${(i % cols) * W}_${Math.floor(i / cols) * H}`).join('|');
const filter = files.length === 1
  ? `${parts[0]};[v0]null[out]`
  : `${parts.join(';')};${files.map((_, i) => `[v${i}]`).join('')}xstack=inputs=${files.length}:layout=${layout}:fill=black[out]`;
await run(FFMPEG, ['-y', '-v', 'error', ...inputs, '-filter_complex', filter, '-map', '[out]', '-frames:v', '1', out]);
console.log('sheet', out);
