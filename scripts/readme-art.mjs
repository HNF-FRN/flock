// Draws the README's artwork into docs/assets: the banner, the download button,
// the two diagrams and the feature icons. Plain SVG built from the app's own
// mascot geometry (src/renderer/shared/mascot.js) and palette (tokens.css), so
// the art matches Flock. Run: node scripts/readme-art.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'docs', 'assets');

const C = {
  void: '#08090B',
  card: '#0E0F11',
  card2: '#141518',
  ink: '#F5F6F8',
  dim: '#9398A1',
  dimmer: '#6B7079',
  hair: 'rgba(255,255,255,0.08)',
  purple: '#3B2F63',
  teal: '#1D4A5C',
};
const ACCOUNTS = [
  { name: 'Main', color: '#D97757' },
  { name: 'Work', color: '#38BDF8' },
  { name: 'Client A', color: '#4ADE80' },
  { name: 'Research', color: '#C084FC' },
  { name: 'Side project', color: '#FACC15' },
];
const SANS = "'Segoe UI Variable Display','Segoe UI',-apple-system,BlinkMacSystemFont,'Helvetica Neue',Arial,sans-serif";
const TEXT = "'Segoe UI Variable Text','Segoe UI',-apple-system,BlinkMacSystemFont,'Helvetica Neue',Arial,sans-serif";
const MONO = "'Cascadia Mono','Cascadia Code',Consolas,'SF Mono',Menlo,monospace";

// ── mascot (mascot.js, viewBox 40×40) ──────────────────────────────────────

function mix(hex, to, t) {
  const a = parseInt(hex.slice(1), 16);
  const b = parseInt(to.slice(1), 16);
  const ch = (s) => Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t);
  return `#${((1 << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).slice(1)}`;
}

function tones(body) {
  return {
    body,
    top: mix(body, '#ffffff', 0.16),
    bottom: mix(body, '#000000', 0.1),
    tip: mix(body, '#ffffff', 0.6),
    dark: mix(body, '#000000', 0.5),
  };
}

let uid = 0;

/** A mascot whose 40×40 box has its top-left at (x, y), drawn `size` px wide. */
function mascot(x, y, size, color, { delay = 0, shadow = false, cls = '' } = {}) {
  const t = tones(color);
  const id = `m${++uid}`;
  return `<g class="m ${cls}" transform="translate(${x} ${y}) scale(${size / 40})" style="--d:${delay}s">
  <defs>
    <linearGradient id="${id}b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${t.top}"/><stop offset="1" stop-color="${t.bottom}"/></linearGradient>
    <radialGradient id="${id}h" cx=".3" cy=".08" r=".75"><stop offset="0" stop-color="#fff" stop-opacity=".38"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
    <radialGradient id="${id}g" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="${t.tip}" stop-opacity=".9"/><stop offset="1" stop-color="${t.tip}" stop-opacity="0"/></radialGradient>
    <radialGradient id="${id}s" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#000" stop-opacity=".55"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
  </defs>
  ${shadow ? `<ellipse cx="20" cy="37" rx="12.5" ry="1.7" fill="url(#${id}s)"/>` : ''}
  <g class="bd">
    <rect x="11.6" y="31.4" width="5.2" height="4.8" rx="2.4" fill="${t.dark}"/>
    <rect x="23.2" y="31.4" width="5.2" height="4.8" rx="2.4" fill="${t.dark}"/>
    <path d="M26.6 12.8 Q27.4 9.6 28.6 7.4" fill="none" stroke="${t.dark}" stroke-width="1.6" stroke-linecap="round"/>
    <circle class="gl" cx="29" cy="6.4" r="4.6" fill="url(#${id}g)"/>
    <circle cx="29" cy="6.4" r="2.3" fill="${t.tip}"/>
    <rect x="5.5" y="11.5" width="29" height="22" rx="8.5" fill="url(#${id}b)"/>
    <rect x="5.5" y="11.5" width="29" height="22" rx="8.5" fill="url(#${id}h)"/>
    <g class="ey" fill="#141413">
      <rect x="13.6" y="18.6" width="3.4" height="5.6" rx="1.7"/>
      <rect x="23" y="18.6" width="3.4" height="5.6" rx="1.7"/>
    </g>
  </g>
</g>`;
}

// Idle motion shared by every file: a slow bob, a glowing antenna tip, a blink.
const MOTION = `
  .m .bd { animation: bob 3.4s ease-in-out infinite; animation-delay: var(--d); }
  .m .gl { animation: glow 2.6s ease-in-out infinite; animation-delay: var(--d); }
  .m .ey { transform-box: fill-box; transform-origin: center; animation: blink 6s infinite; animation-delay: var(--d); }
  @keyframes bob { 0%, 100% { transform: translateY(0) } 50% { transform: translateY(-1.1px) } }
  @keyframes glow { 0%, 100% { opacity: .25 } 50% { opacity: 1 } }
  @keyframes blink { 0%, 93%, 100% { transform: scaleY(1) } 96% { transform: scaleY(.12) } }
  @media (prefers-reduced-motion: reduce) { * { animation: none !important } .flow { display: none } }`;

function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** The dark card every big piece sits on (purple and teal pools, like the film's desktop). */
function backdrop(w, h, r = 28) {
  return `<defs>
    <radialGradient id="pP" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(${w * 0.16} ${h * 0.05}) scale(${w * 0.5} ${h * 1.1})"><stop offset="0" stop-color="${C.purple}" stop-opacity=".85"/><stop offset="1" stop-color="${C.purple}" stop-opacity="0"/></radialGradient>
    <radialGradient id="pT" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(${w * 0.9} ${h}) scale(${w * 0.5} ${h * 1.1})"><stop offset="0" stop-color="${C.teal}" stop-opacity=".8"/><stop offset="1" stop-color="${C.teal}" stop-opacity="0"/></radialGradient>
    <pattern id="dots" width="22" height="22" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="#fff" fill-opacity=".045"/></pattern>
    <clipPath id="card"><rect width="${w}" height="${h}" rx="${r}"/></clipPath>
  </defs>
  <g clip-path="url(#card)">
    <rect width="${w}" height="${h}" fill="${C.void}"/>
    <rect width="${w}" height="${h}" fill="url(#pP)"/>
    <rect width="${w}" height="${h}" fill="url(#pT)"/>
    <rect width="${w}" height="${h}" fill="url(#dots)"/>
  </g>
  <rect x=".5" y=".5" width="${w - 1}" height="${h - 1}" rx="${r - 0.5}" fill="none" stroke="#fff" stroke-opacity=".07"/>`;
}

function svgDoc(w, h, label, body, style = '') {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(label)}">
<title>${esc(label)}</title>
<style>${MOTION}${style}</style>
${body}
</svg>
`;
}

/** A small Claude-style window with Flock's marks: its account's name and accent edge. */
function windowCard(x, y, w, h, acc, { focused = false, lines = [] } = {}) {
  const glow = focused
    ? `<rect x="${x + 14}" y="${y - 3}" width="${w - 28}" height="6" rx="3" fill="${acc.color}" opacity=".55" filter="url(#soft)"/>`
    : '';
  return `<g>
    ${glow}
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="12" fill="${C.card}" stroke="#fff" stroke-opacity=".09"/>
    <rect x="${x + 14}" y="${y}" width="${w - 28}" height="2.5" rx="1.25" fill="${acc.color}" opacity="${focused ? 1 : 0.75}"/>
    <text x="${x + 18}" y="${y + 31}" font-family="${TEXT}" font-size="15" font-weight="600" fill="${C.ink}">${esc(acc.name)} — Claude</text>
    <g stroke="${C.dimmer}" stroke-width="1.4" fill="none" stroke-linecap="round">
      <path d="M${x + w - 77} ${y + 26}h9"/>
      <rect x="${x + w - 52}" y="${y + 21.5}" width="9" height="9" rx="1.5"/>
      <path d="M${x + w - 27} ${y + 21.5}l9 9M${x + w - 18} ${y + 21.5}l-9 9"/>
    </g>
    <path d="M${x} ${y + 46}h${w}" stroke="#fff" stroke-opacity=".06"/>
    ${lines.join('\n    ')}
  </g>`;
}

const SOFT = `<filter id="soft" x="-20%" y="-300%" width="140%" height="700%"><feGaussianBlur stdDeviation="6"/></filter>`;

// ── banner ─────────────────────────────────────────────────────────────────

function banner() {
  const W = 1280;
  const H = 540;
  const cx = W / 2;
  // The compact island hangs from the top edge, one mascot per account.
  const iw = 292;
  const island = `<rect x="${cx - iw / 2}" y="-30" width="${iw}" height="96" rx="30" fill="#000" stroke="#fff" stroke-opacity=".09"/>
  ${ACCOUNTS.map((a, i) => mascot(cx - 2 * 50 + i * 50 - 17, 18, 34, a.color, { delay: -i * 0.9, cls: `hop h${i}` })).join('\n')}`;

  // Wordmark: Flock's own white mascot + the name.
  const mark = `${mascot(388, 168, 112, '#F5F6F8', { delay: -2.2, shadow: true })}
  <text x="520" y="268" font-family="${SANS}" font-size="132" font-weight="650" letter-spacing="-4" fill="${C.ink}">Flock</text>
  <text x="${cx}" y="338" text-anchor="middle" font-family="${SANS}" font-size="30" fill="${C.dim}">Every Claude account, <tspan fill="${C.ink}" font-weight="600">side by side.</tspan></text>`;

  // Window name chips along the bottom; the "focused" one glows in turn, and
  // its mascot in the island hops.
  const shown = ACCOUNTS.slice(0, 4);
  const cw = 232;
  const gap = 16;
  const x0 = cx - (shown.length * cw + (shown.length - 1) * gap) / 2;
  const chips = shown.map((a, i) => {
    const x = x0 + i * (cw + gap);
    const y = 404;
    return `<g>
    <rect class="fx f${i}" x="${x + 16}" y="${y - 4}" width="${cw - 32}" height="8" rx="4" fill="${a.color}" filter="url(#soft)"/>
    <rect x="${x}" y="${y}" width="${cw}" height="62" rx="14" fill="${C.card}" fill-opacity=".92" stroke="#fff" stroke-opacity=".09"/>
    <rect x="${x + 16}" y="${y}" width="${cw - 32}" height="2.5" rx="1.25" fill="${a.color}"/>
    <circle cx="${x + 24}" cy="${y + 33}" r="5" fill="${a.color}"/>
    <text x="${x + 38}" y="${y + 39}" font-family="${TEXT}" font-size="17" font-weight="600" fill="${C.ink}">${esc(a.name)} <tspan fill="${C.dimmer}" font-weight="400">— Claude</tspan></text>
  </g>`;
  }).join('\n');

  const cycle = shown.length * 2.2;
  const style = `
  .fx { opacity: 0; animation: focus ${cycle}s infinite; }
  ${shown.map((_, i) => `.f${i} { animation-delay: ${(i * 2.2).toFixed(1)}s } .h${i} > .bd { animation: bob 3.4s ease-in-out infinite, hop ${cycle}s infinite; animation-delay: var(--d), ${(i * 2.2).toFixed(1)}s }`).join('\n  ')}
  @keyframes focus { 0% { opacity: 0 } 4% { opacity: .75 } 22% { opacity: .75 } 26%, 100% { opacity: 0 } }
  @keyframes hop { 0%, 8%, 100% { translate: 0 0 } 3% { translate: 0 -5px } }`;

  return svgDoc(W, H, 'Flock: every Claude account, side by side', `${backdrop(W, H)}
  <defs>${SOFT}</defs>
  ${island}
  ${mark}
  ${chips}`, style);
}

// ── download button ────────────────────────────────────────────────────────

function download() {
  const W = 360;
  const H = 76;
  return svgDoc(W, H, 'Download Flock for Windows', `<defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1C1D22"/><stop offset="1" stop-color="#0E0F11"/></linearGradient>
    <linearGradient id="rim" x1="0" y1="0" x2="1" y2="0">${ACCOUNTS.map((a, i) => `<stop offset="${i / (ACCOUNTS.length - 1)}" stop-color="${a.color}"/>`).join('')}</linearGradient>
  </defs>
  <rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="${(H - 2) / 2}" fill="url(#bg)" stroke="url(#rim)" stroke-opacity=".7" stroke-width="1.5"/>
  <circle cx="38" cy="38" r="22" fill="${C.ink}"/>
  <path d="M38 27v17M31 37.5l7 7 7-7M30 49h16" fill="none" stroke="#0E0F11" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
  <text x="74" y="35" font-family="${SANS}" font-size="21" font-weight="650" fill="${C.ink}">Download for Windows</text>
  <text x="74" y="56" font-family="${TEXT}" font-size="14" fill="${C.dim}">Free · open source · MIT</text>`);
}

// ── how it works ───────────────────────────────────────────────────────────

function howItWorks() {
  const W = 1280;
  const H = 564;
  const rows = [
    { acc: ACCOUNTS[0], data: '%APPDATA%\\Claude', config: '~\\.claude', note: 'shared', flag: 'claude-desktop.exe' },
    { acc: ACCOUNTS[1], data: '%APPDATA%\\Claude-Work', config: '~\\.claude', note: 'shared', flag: '--user-data-dir=…\\Claude-Work' },
    { acc: ACCOUNTS[2], data: '%APPDATA%\\Claude-ClientA', config: '~\\.claude-clienta', note: 'its own', flag: '--user-data-dir=…\\Claude-ClientA' },
  ];
  const wx = 760;
  const ww = 476;
  const wh = 128;
  const ys = [92, 242, 392];

  // Flock: the island and what it does.
  const fx = 44;
  const fy = 196;
  const flock = `<rect x="${fx}" y="${fy}" width="300" height="236" rx="20" fill="${C.card}" fill-opacity=".92" stroke="#fff" stroke-opacity=".09"/>
  <rect x="${fx + 50}" y="${fy + 26}" width="200" height="52" rx="26" fill="#000" stroke="#fff" stroke-opacity=".09"/>
  ${ACCOUNTS.slice(0, 3).map((a, i) => mascot(fx + 150 - 66 + i * 44 - 16, fy + 32, 32, a.color, { delay: -i * 1.1 })).join('\n')}
  <text x="${fx + 150}" y="${fy + 124}" text-anchor="middle" font-family="${SANS}" font-size="30" font-weight="650" fill="${C.ink}">Flock</text>
  <text x="${fx + 150}" y="${fy + 154}" text-anchor="middle" font-family="${TEXT}" font-size="15" fill="${C.dim}">starts one Claude window per account</text>
  <text x="${fx + 150}" y="${fy + 176}" text-anchor="middle" font-family="${TEXT}" font-size="15" fill="${C.dim}">and names and colours it</text>
  <text x="${fx + 150}" y="${fy + 212}" text-anchor="middle" font-family="${MONO}" font-size="13" fill="${C.dimmer}">one install, many data folders</text>`;

  const sx = fx + 300;
  const sy = fy + 118;
  const links = rows.map((r, i) => {
    const ty = ys[i] + wh / 2;
    const d = `M${sx} ${sy} C ${sx + 170} ${sy}, ${wx - 190} ${ty}, ${wx} ${ty}`;
    const lx = (sx + wx) / 2;
    const ly = (sy + ty) / 2 + (i === 1 ? -22 : i === 0 ? -16 : 16);
    const tw = r.flag.length * 7.9 + 26;
    return `<path d="${d}" fill="none" stroke="${r.acc.color}" stroke-opacity=".55" stroke-width="2" stroke-dasharray="1 7" stroke-linecap="round"/>
  <circle class="flow" r="4" fill="${r.acc.color}"><animateMotion dur="2.6s" begin="${-i * 0.8}s" repeatCount="indefinite" path="${d}"/></circle>
  <rect x="${lx - tw / 2}" y="${ly - 15}" width="${tw}" height="30" rx="15" fill="#000" stroke="${r.acc.color}" stroke-opacity=".5"/>
  <text x="${lx}" y="${ly + 5}" text-anchor="middle" font-family="${MONO}" font-size="13" fill="${C.ink}">${esc(r.flag)}</text>`;
  }).join('\n');

  const windows = rows.map((r, i) => {
    const y = ys[i];
    const k = (label, yy) => `<text x="${wx + 18}" y="${yy}" font-family="${MONO}" font-size="12" letter-spacing="1" fill="${C.dimmer}">${label}</text>`;
    const v = (val, yy, extra = '') => `<text x="${wx + 128}" y="${yy}" font-family="${MONO}" font-size="14" fill="${C.ink}">${esc(val)}${extra}</text>`;
    return windowCard(wx, y, ww, wh, r.acc, {
      focused: i === 1,
      lines: [
        k('DATA', y + 78), v(r.data, y + 78),
        k('~/.CLAUDE', y + 104), v(r.config, y + 104, `<tspan fill="${C.dimmer}">  (${r.note})</tspan>`),
      ],
    });
  }).join('\n');

  const kicker = `<text x="${wx}" y="62" font-family="${MONO}" font-size="12" letter-spacing="2" fill="${C.dim}">EACH ACCOUNT, ITS OWN WINDOW</text>
  <text x="${fx}" y="62" font-family="${MONO}" font-size="12" letter-spacing="2" fill="${C.dim}">HOW FLOCK OPENS AN ACCOUNT</text>`;

  return svgDoc(W, H, 'How Flock works: one Claude install, one data folder and one named window per account', `${backdrop(W, H)}
  <defs>${SOFT}</defs>
  ${kicker}
  ${links}
  ${flock}
  ${windows}`);
}

// ── sign-in links ──────────────────────────────────────────────────────────

function signIn() {
  const W = 1280;
  const H = 480;
  const card = (x, y, w, h, title, sub, mono = '') => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="18" fill="${C.card}" stroke="#fff" stroke-opacity=".09"/>
  <text x="${x + 22}" y="${y + 40}" font-family="${SANS}" font-size="20" font-weight="650" fill="${C.ink}">${esc(title)}</text>
  ${sub.map((s, i) => `<text x="${x + 22}" y="${y + 68 + i * 21}" font-family="${TEXT}" font-size="15" fill="${C.dim}">${esc(s)}</text>`).join('\n  ')}
  ${mono ? `<text x="${x + 22}" y="${y + h - 22}" font-family="${MONO}" font-size="13" fill="${C.dimmer}">${esc(mono)}</text>` : ''}`;

  const y = 196;
  const h = 148;
  const step = (n, x) => `<circle cx="${x + 22}" cy="${y - 26}" r="13" fill="none" stroke="#fff" stroke-opacity=".25"/><text x="${x + 22}" y="${y - 21}" text-anchor="middle" font-family="${MONO}" font-size="13" fill="${C.ink}">${n}</text>`;

  const browser = card(40, y, 250, h, 'You sign in', ['Google, or the link in', 'the e-mail, in your browser'], 'claude://login…');
  const windows = card(350, y, 260, h, 'Windows', ['starts a short-lived Claude.exe', 'meant for your main window'], 'Claude.exe "claude://…"');
  const flock = `${card(670, y, 250, h, 'Flock', ['spots it in about 0.1 s', 'and takes the link'], 'WMI process-start event')}
  ${mascot(862, y + 14, 40, '#F5F6F8', { delay: -1 })}`;

  const work = ACCOUNTS[1];
  const main = ACCOUNTS[0];
  const wWork = windowCard(990, 120, 250, 112, work, {
    focused: true,
    lines: [
      `<circle cx="1012" cy="196" r="9" fill="${ACCOUNTS[2].color}"/><path d="M1007.5 196.3l3 3 6-6.2" fill="none" stroke="#0E0F11" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`,
      `<text x="1030" y="201" font-family="${TEXT}" font-size="15" fill="${C.ink}">signed in, the right window</text>`,
    ],
  });
  const wMain = `<g opacity=".55">${windowCard(990, 300, 250, 112, main, {
    lines: [`<text x="1008" y="381" font-family="${TEXT}" font-size="15" fill="${C.dim}">left alone</text>`],
  })}</g>`;

  const arrow = (d, color, cls = '', dash = '') => `<path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" ${dash ? `stroke-dasharray="${dash}"` : ''} class="${cls}" marker-end="url(#ah)"/>`;
  const mid = y + h / 2;
  const toWork = `M920 ${mid} C 955 ${mid}, 955 176, 986 176`;
  const toMain = `M920 ${mid} C 955 ${mid}, 955 356, 986 356`;
  // The link pill runs behind the cards, so it shows only between the steps.
  const pillPath = `M200 ${mid} L 920 ${mid} C 955 ${mid}, 955 176, 986 176`;
  const pill = `<g class="flow"><rect x="-34" y="-12" width="68" height="24" rx="12" fill="${work.color}"/><text y="4.5" text-anchor="middle" font-family="${MONO}" font-size="12" font-weight="600" fill="#0E0F11">claude://</text><animateMotion dur="4.2s" repeatCount="indefinite" path="${pillPath}" keyPoints="0;1;1" keyTimes="0;.8;1" calcMode="linear"/></g>`;

  const arrows = `<defs><marker id="ah" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="${C.ink}"/></marker></defs>
  ${arrow(`M290 ${mid} L 346 ${mid}`, C.ink)}
  ${arrow(`M610 ${mid} L 666 ${mid}`, C.ink)}
  ${arrow(toWork, work.color)}
  <path d="${toMain}" fill="none" stroke="${C.dimmer}" stroke-width="2" stroke-dasharray="3 6" stroke-linecap="round"/>`;

  const kicker = `<text x="40" y="78" font-family="${MONO}" font-size="12" letter-spacing="2" fill="${C.dim}">SIGNING IN TO AN EXTRA ACCOUNT</text>
  <text x="40" y="112" font-family="${SANS}" font-size="26" font-weight="650" fill="${C.ink}">Sign-in links skip Main and reach the window that asked for them.</text>
  ${step(1, 40)}${step(2, 350)}${step(3, 670)}`;

  return svgDoc(W, H, 'Sign-in links: Flock catches the claude:// link Windows hands to the main window and passes it to the account that is signing in', `${backdrop(W, H)}
  <defs>${SOFT}</defs>
  ${kicker}
  ${pill}
  ${browser}
  ${windows}
  ${flock}
  ${wWork}
  ${wMain}
  ${arrows}`);
}

// ── feature icons (24×24 glyphs on a 64×64 tile) ───────────────────────────

const GLYPHS = {
  'side-by-side': '<rect x="2.5" y="4.5" width="8.5" height="15" rx="2"/><rect x="13" y="4.5" width="8.5" height="15" rx="2"/><path d="M4.5 8h4.5M15 8h4.5"/>',
  identity: '<rect x="2.5" y="5" width="19" height="14.5" rx="2.5"/><path d="M5.5 5h13" stroke-width="2.6"/><path d="M6 10h7M6 13.5h10"/>',
  island: '<rect x="5" y="2.5" width="14" height="6" rx="3"/><circle cx="9" cy="5.5" r=".9" fill="currentColor"/><circle cx="12" cy="5.5" r=".9" fill="currentColor"/><circle cx="15" cy="5.5" r=".9" fill="currentColor"/><rect x="2.5" y="11.5" width="19" height="10" rx="2"/>',
  sessions: '<path d="M3.5 6h10M3.5 11h10M3.5 16h6"/><circle cx="17.5" cy="15.5" r="4.5"/><path d="M17.5 13.3v2.4l1.6 1"/>',
  'sign-in': '<circle cx="7.5" cy="12" r="4"/><path d="M11.5 12h9.5M18 12v3M21 12v2.5"/>',
  folder: '<path d="M2.5 7.5a2 2 0 0 1 2-2h4.2l2 2h8.8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-15a2 2 0 0 1-2-2z"/><path d="M7 13.5h3"/>',
  'out-of-way': '<rect x="2.5" y="14" width="19" height="6" rx="3"/><path d="M8 9.5l4-4 4 4"/>',
  keyboard: '<rect x="3" y="3.5" width="18" height="17" rx="4"/><path d="M7 16.5h10"/><path d="M11 7.5l1.6-1v6"/>',
  trust: '<path d="M12 2.8l7.5 3v5.4c0 4.6-3.2 8.1-7.5 10-4.3-1.9-7.5-5.4-7.5-10V5.8z"/><path d="M8.8 12l2.3 2.3 4.3-4.6"/>',
  phone: '<rect x="4.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M8.5 18.2h3"/><path d="M18.5 8.5a4.5 4.5 0 0 1 0 7"/><path d="M21 6a8 8 0 0 1 0 12"/>',
};

function icon(name, color) {
  const glow = mix(color, '#ffffff', 0.25);
  return svgDoc(64, 64, name, `<defs>
    <linearGradient id="t" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1B1C21"/><stop offset="1" stop-color="#0E0F11"/></linearGradient>
    <radialGradient id="p" cx=".25" cy=".15" r=".9"><stop offset="0" stop-color="${color}" stop-opacity=".28"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></radialGradient>
  </defs>
  <rect x=".5" y=".5" width="63" height="63" rx="16" fill="url(#t)"/>
  <rect x=".5" y=".5" width="63" height="63" rx="16" fill="url(#p)"/>
  <rect x=".5" y=".5" width="63" height="63" rx="16" fill="none" stroke="#fff" stroke-opacity=".1"/>
  <g transform="translate(14 14) scale(1.5)" fill="none" stroke="${glow}" color="${glow}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${GLYPHS[name]}</g>`);
}

// ── write ──────────────────────────────────────────────────────────────────

fs.mkdirSync(path.join(OUT, 'icons'), { recursive: true });
const files = {
  'banner.svg': banner(),
  'download.svg': download(),
  'how-it-works.svg': howItWorks(),
  'sign-in.svg': signIn(),
};
const iconColors = ['#D97757', '#38BDF8', '#4ADE80', '#C084FC', '#FACC15'];
Object.keys(GLYPHS).forEach((name, i) => {
  files[`icons/${name}.svg`] = icon(name, iconColors[i % iconColors.length]);
});
for (const [name, svg] of Object.entries(files)) {
  fs.writeFileSync(path.join(OUT, name), svg);
  console.log(`docs/assets/${name}  ${(svg.length / 1024).toFixed(1)} KB`);
}
