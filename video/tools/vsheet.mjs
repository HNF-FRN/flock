// Contact sheet of a rendered film: one thumbnail every `step` seconds, timestamped.
//   node video/tools/vsheet.mjs out/preview30.mp4 out/qa/vsheet.png [from=0] [to=end] [step=1] [cols=6]
import path from 'node:path';
import { FFMPEG, run } from './capture.mjs';

const [video, out, from = '0', to = '9999', step = '1', cols = '6'] = process.argv.slice(2);
const n = Math.ceil((Number(to) - Number(from)) / Number(step));
const rows = Math.ceil(Math.min(n, 9999) / Number(cols));
const vf = [
  `fps=1/${step}`,
  'scale=320:180:flags=lanczos',
  `drawtext=text='%{pts\\:hms\\:${from}}':x=6:y=6:fontsize=16:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=4:fontfile='C\\:/Windows/Fonts/consola.ttf'`,
  `tile=${cols}x${rows}:padding=4:color=black`,
].join(',');
await run(FFMPEG, ['-y', '-v', 'error', '-ss', from, '-to', to, '-i', path.resolve(video), '-vf', vf, '-frames:v', '1', path.resolve(out)]);
console.log('sheet', out);
