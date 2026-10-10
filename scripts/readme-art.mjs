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

// ── the phone app ──────────────────────────────────────────────────────────
// Its screens drawn the way docs/app draws them: Flock's palette, cards and
// mascots, with the README's sample accounts and projects.

const PH = { screen: '#0B0C0E', card: '#141518', green: '#22C55E', greenText: '#86EFAC', red: '#F4505E', redText: '#FF8D97' };

/** A phone: body, screen and status bar. Its content is clipped to the screen. */
function phone(x, y, w, h, content) {
  const id = `ph${++uid}`;
  const sx = x + 10;
  const sy = y + 10;
  const sw = w - 20;
  const sh = h - 20;
  return `<g>
  <defs><clipPath id="${id}"><rect x="${sx}" y="${sy}" width="${sw}" height="${sh}" rx="32"/></clipPath></defs>
  <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="42" fill="#050506" stroke="#fff" stroke-opacity=".14"/>
  <rect x="${sx}" y="${sy}" width="${sw}" height="${sh}" rx="32" fill="${PH.screen}"/>
  <g clip-path="url(#${id})">
    <text x="${sx + 26}" y="${sy + 27}" font-family="${TEXT}" font-size="13" font-weight="600" fill="${C.ink}">9:41</text>
    <circle cx="${x + w / 2}" cy="${sy + 22}" r="6" fill="#000" stroke="#fff" stroke-opacity=".08"/>
    <g fill="${C.ink}">
      <rect x="${sx + sw - 62}" y="${sy + 20}" width="3" height="6" rx="1"/><rect x="${sx + sw - 57}" y="${sy + 18}" width="3" height="8" rx="1"/><rect x="${sx + sw - 52}" y="${sy + 16}" width="3" height="10" rx="1"/>
      <rect x="${sx + sw - 44}" y="${sy + 16}" width="20" height="10" rx="3" fill="none" stroke="${C.ink}" stroke-opacity=".6"/><rect x="${sx + sw - 42}" y="${sy + 18}" width="13" height="6" rx="1.5"/>
    </g>
    ${content(sx, sy, sw, sh)}
  </g>
</g>`;
}

const ICON = {
  back: (x, y) => `<path d="M${x + 9} ${y + 3}l-6 6 6 6" fill="none" stroke="${C.ink}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`,
  chev: (x, y) => `<path d="M${x} ${y}l5 5-5 5" fill="none" stroke="${C.dimmer}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`,
  chat: (x, y) => `<path d="M${x + 1} ${y + 3.5}c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2v6.5c0 1.1-.9 2-2 2H${x + 8.2}L${x + 4.5} ${y + 15}v-3h-.5c-1.1 0-2-.9-2-2z" fill="none" stroke="${C.ink}" stroke-opacity=".8" stroke-width="1.6" stroke-linejoin="round"/>`,
  open: (x, y) => `<path d="M${x + 9} ${y + 1}h6v6M${x + 15} ${y + 1}l-7.5 7.5M${x + 12} ${y + 10}v3.5c0 .8-.7 1.5-1.5 1.5H2.5c-.8 0-1.5-.7-1.5-1.5V5.5C1 4.7 1.7 4 2.5 4H6" fill="none" stroke="#0B0C0E" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`,
};

/** The top bar of a screen: a back button or Flock's mascot, a title and a line under it. */
function appBar(sx, sy, sw, title, sub, { back = false, pill = '' } = {}) {
  const lead = back
    ? `<rect x="${sx + 16}" y="${sy + 50}" width="40" height="40" rx="12" fill="#fff" fill-opacity=".06"/>${ICON.back(sx + 27, sy + 61)}`
    : mascot(sx + 16, sy + 50, 40, '#F5F6F8', { delay: -1.4 });
  const pillSvg = pill ? `<rect x="${sx + sw - 92}" y="${sy + 58}" width="76" height="24" rx="12" fill="${PH.green}" fill-opacity=".14"/>
    <circle cx="${sx + sw - 79}" cy="${sy + 70}" r="3.5" fill="${PH.green}"/>
    <text x="${sx + sw - 70}" y="${sy + 74.5}" font-family="${TEXT}" font-size="12" font-weight="600" fill="${PH.greenText}">${esc(pill)}</text>` : '';
  return `${lead}
    <text x="${sx + 68}" y="${sy + 67}" font-family="${SANS}" font-size="17" font-weight="650" fill="${C.ink}">${esc(title)}</text>
    <text x="${sx + 68}" y="${sy + 85}" font-family="${TEXT}" font-size="12" fill="${C.dim}">${esc(sub)}</text>
    ${pillSvg}`;
}

/** 5-hour and weekly usage bars, as the app shows them under an account. */
function usage(x, y, items) {
  let bx = x;
  return items.map(([label, pct]) => {
    const hot = pct >= 90;
    const lw = label.length * 6.3 + 5;
    const svg = `<text x="${bx}" y="${y + 4}" font-family="${TEXT}" font-size="11" fill="${C.dim}">${label}</text>
    <rect x="${bx + lw}" y="${y - 1}" width="28" height="4.5" rx="2.25" fill="#fff" fill-opacity=".1"/>
    <rect x="${bx + lw}" y="${y - 1}" width="${Math.max(3, (28 * pct) / 100)}" height="4.5" rx="2.25" fill="${hot ? PH.red : '#E9EBEE'}"/>
    <text x="${bx + lw + 33}" y="${y + 4}" font-family="${TEXT}" font-size="11" fill="${hot ? PH.redText : C.dim}">${pct}%</text>`;
    bx += lw + 33 + String(pct).length * 6.5 + 18;
    return svg;
  }).join('\n    ');
}

function button(x, y, w, label, { primary = true, icon = null } = {}) {
  const fill = primary ? C.ink : '#fff';
  const tw = label.length * 7.7;
  const gx = x + w / 2 - (tw + (icon ? 26 : 0)) / 2; // the icon and the label, centred together
  return `<rect x="${x}" y="${y}" width="${w}" height="46" rx="16" fill="${fill}" fill-opacity="${primary ? 1 : 0.09}"/>
    ${icon ? ICON[icon](gx, y + 15) : ''}
    <text x="${gx + (icon ? 26 : 0)}" y="${y + 28.5}" font-family="${TEXT}" font-size="14.5" font-weight="600" fill="${primary ? '#0B0C0E' : C.ink}">${esc(label)}</text>`;
}

function phoneApp() {
  const W = 1280;
  const H = 780;
  const pw = 300;
  const ph = 590;
  const gap = 70;
  const x0 = (W - 3 * pw - 2 * gap) / 2;
  const py = 160;

  // 1. The accounts, each with the usage it has left.
  const accounts = phone(x0, py, pw, ph, (sx, sy, sw) => {
    const rows = [
      { acc: ACCOUNTS[0], bars: [['5h', 9], ['Week', 36]] },
      { acc: ACCOUNTS[1], bars: [['5h', 100]] },
      { acc: ACCOUNTS[2], bars: [['5h', 42], ['Week', 61]] },
      { acc: ACCOUNTS[3], bars: [['5h', 12], ['Week', 20]] },
    ];
    const cards = rows.map((r, i) => {
      const y = sy + 138 + i * 78;
      return `<rect x="${sx + 14}" y="${y}" width="${sw - 28}" height="68" rx="16" fill="${PH.card}" stroke="#fff" stroke-opacity=".07"/>
    <rect x="${sx + 14}" y="${y + 10}" width="3" height="48" rx="1.5" fill="${r.acc.color}"/>
    ${mascot(sx + 26, y + 12, 44, r.acc.color, { delay: -i * 0.7 })}
    <text x="${sx + 80}" y="${y + 29}" font-family="${TEXT}" font-size="15" font-weight="600" fill="${C.ink}">${esc(r.acc.name)}</text>
    ${usage(sx + 80, y + 47, r.bars)}
    ${ICON.chev(sx + sw - 30, y + 29)}`;
    }).join('\n    ');
    return `${appBar(sx, sy, sw, 'Flock', 'Your PC', { pill: 'Online' })}
    <text x="${sx + 20}" y="${sy + 124}" font-family="${MONO}" font-size="11" letter-spacing="1.5" fill="${C.dim}">START A SESSION IN…</text>
    ${cards}`;
  });

  // 2. An account's sessions, grouped by project.
  const sessions = phone(x0 + pw + gap, py, pw, ph, (sx, sy, sw) => {
    const tabs = ['Recent', 'Sessions', 'Browse'];
    const tw = (sw - 36) / 3;
    const tabSvg = `<rect x="${sx + 14}" y="${sy + 104}" width="${sw - 28}" height="44" rx="14" fill="#0E0F11" stroke="#fff" stroke-opacity=".07"/>
    ${tabs.map((t, i) => `${i === 1 ? `<rect x="${sx + 18 + i * tw}" y="${sy + 108}" width="${tw}" height="36" rx="10" fill="#1D1F23"/>` : ''}
    <text x="${sx + 18 + i * tw + tw / 2}" y="${sy + 131}" text-anchor="middle" font-family="${TEXT}" font-size="13.5" font-weight="600" fill="${i === 1 ? C.ink : C.dim}">${t}</text>`).join('')}`;
    const groups = [
      { name: 'studio-site', path: '~\\work\\studio-site', items: [['Hero scroll animation polish', 'On your phone now', true], ['Case study page layout', '38 min ago']] },
      { name: 'client-portal', path: '~\\work\\client-portal', items: [['Pricing table redesign', '1 h ago'], ['Auth middleware refactor', '3 h ago']] },
    ];
    let y = sy + 176;
    const body = groups.map((g) => {
      const head = `<text x="${sx + 20}" y="${y}" font-family="${TEXT}" font-size="13" font-weight="600" fill="#E9EBEE">${g.name}</text>
    <text x="${sx + 22 + g.name.length * 7.3}" y="${y}" font-family="${MONO}" font-size="10.5" fill="${C.dimmer}">${esc(g.path)}</text>`;
      y += 12;
      const rows = g.items.map(([title, sub, live]) => {
        const r = `<rect x="${sx + 14}" y="${y}" width="${sw - 28}" height="60" rx="16" fill="${PH.card}" stroke="#fff" stroke-opacity=".07"/>
    <rect x="${sx + 26}" y="${y + 12}" width="36" height="36" rx="11" fill="#fff" fill-opacity=".06"/>${ICON.chat(sx + 34, y + 21)}
    <text x="${sx + 74}" y="${y + 27}" font-family="${TEXT}" font-size="13.5" font-weight="600" fill="${C.ink}">${esc(title.length > 24 ? `${title.slice(0, 23)}…` : title)}</text>
    <text x="${sx + 74}" y="${y + 45}" font-family="${TEXT}" font-size="11.5" fill="${live ? PH.greenText : C.dim}">${esc(sub)}</text>`;
        y += 68;
        return r;
      }).join('\n    ');
      y += 22;
      return `${head}\n    ${rows}`;
    }).join('\n    ');
    return `${appBar(sx, sy, sw, ACCOUNTS[0].name, 'Start a session or continue one', { back: true })}
    ${tabSvg}
    ${body}`;
  });

  // 3. Running on the PC, ready to open in the Claude app.
  const ready = phone(x0 + 2 * (pw + gap), py, pw, ph, (sx, sy, sw) => {
    const acc = ACCOUNTS[1];
    const cx = sx + sw / 2;
    const glowId = `hg${++uid}`;
    return `${appBar(sx, sy, sw, 'Pricing table redesign', `${acc.name} · ~\\work\\client-portal`, { back: true })}
    <defs><radialGradient id="${glowId}" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="${acc.color}" stop-opacity=".32"/><stop offset="1" stop-color="${acc.color}" stop-opacity="0"/></radialGradient></defs>
    <ellipse cx="${cx}" cy="${sy + 190}" rx="${sw / 2 - 10}" ry="80" fill="url(#${glowId})"/>
    ${mascot(cx - 55, sy + 135, 110, acc.color, { delay: -0.6 })}
    <text x="${cx}" y="${sy + 290}" text-anchor="middle" font-family="${TEXT}" font-size="15" fill="#E9EBEE">Remote Control is on. Open it</text>
    <text x="${cx}" y="${sy + 311}" text-anchor="middle" font-family="${TEXT}" font-size="15" fill="#E9EBEE">in the Claude app to carry on.</text>
    ${button(sx + 16, sy + 334, sw - 32, 'Open the session', { icon: 'open' })}
    <text x="${cx}" y="${sy + 410}" text-anchor="middle" font-family="${TEXT}" font-size="12" fill="${C.dim}">It belongs to ${acc.name}’s Claude account:</text>
    <text x="${cx}" y="${sy + 427}" text-anchor="middle" font-family="${TEXT}" font-size="12" fill="${C.dim}">the Claude app has to be signed in to it.</text>
    <rect x="${sx + 16}" y="${sy + 450}" width="${sw - 32}" height="46" rx="16" fill="${PH.red}" fill-opacity=".16"/>
    <text x="${cx}" y="${sy + 478}" text-anchor="middle" font-family="${TEXT}" font-size="14.5" font-weight="600" fill="${PH.redText}">Stop</text>`;
  });

  const steps = ['Pick an account', 'Pick a project, or a session', 'Open it in the Claude app'].map((label, i) => {
    const x = x0 + i * (pw + gap);
    return `<circle cx="${x + 13}" cy="${py - 24}" r="13" fill="none" stroke="#fff" stroke-opacity=".25"/>
  <text x="${x + 13}" y="${py - 19}" text-anchor="middle" font-family="${MONO}" font-size="13" fill="${C.ink}">${i + 1}</text>
  <text x="${x + 36}" y="${py - 18.5}" font-family="${TEXT}" font-size="16" font-weight="600" fill="${C.ink}">${esc(label)}</text>`;
  }).join('\n  ');

  const kicker = `<text x="${x0}" y="64" font-family="${MONO}" font-size="12" letter-spacing="2" fill="${C.dim}">FLOCK FROM YOUR PHONE</text>
  <text x="${x0}" y="98" font-family="${SANS}" font-size="26" font-weight="650" fill="${C.ink}">Start Claude Code on your PC, or carry on with a session, from anywhere.</text>`;

  return svgDoc(W, H, 'The Flock phone app: pick an account, pick a project or one of its sessions, and open it in the Claude app', `${backdrop(W, H)}
  ${kicker}
  ${steps}
  ${accounts}
  ${sessions}
  ${ready}`);
}

// ── how the phone reaches the PC ───────────────────────────────────────────

const RELAY = '#2DD4BF'; // Flock's own messages
const CHAT = '#C084FC'; // the conversation with Claude

/** A card with a title, a few lines and an optional code line, as in the sign-in diagram. */
function infoCard(x, y, w, h, title, sub, mono = '') {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="18" fill="${C.card}" stroke="#fff" stroke-opacity=".09"/>
  <text x="${x + 22}" y="${y + 38}" font-family="${SANS}" font-size="20" font-weight="650" fill="${C.ink}">${esc(title)}</text>
  ${sub.map((s, i) => `<text x="${x + 22}" y="${y + 64 + i * 20}" font-family="${TEXT}" font-size="15" fill="${C.dim}">${esc(s)}</text>`).join('\n  ')}
  ${mono ? `<text x="${x + 22}" y="${y + h - 18}" font-family="${MONO}" font-size="13" fill="${C.dimmer}">${esc(mono)}</text>` : ''}`;
}

function padlock(x, y, color) {
  return `<g fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round"><rect x="${x}" y="${y + 7}" width="16" height="12" rx="3"/><path d="M${x + 4} ${y + 7}v-2.5a4 4 0 0 1 8 0V${y + 7}"/></g>`;
}

/** A dotted line with a dot travelling along it, both ways when `back` is set. */
function lane(d, color, { dur = 2.8, begin = 0, back = false, label = '' } = {}) {
  const pill = label
    ? `<g class="flow"><rect x="${-label.length * 4 - 12}" y="-12" width="${label.length * 8 + 24}" height="24" rx="12" fill="${color}"/><text y="4.5" text-anchor="middle" font-family="${MONO}" font-size="12" font-weight="600" fill="#0E0F11">${esc(label)}</text><animateMotion dur="${dur}s" begin="${begin}s" repeatCount="indefinite" path="${d}"/></g>`
    : `<circle class="flow" r="4" fill="${color}"><animateMotion dur="${dur}s" begin="${begin}s" repeatCount="indefinite" path="${d}"/></circle>`;
  const ret = back
    ? `<circle class="flow" r="3.5" fill="${color}" fill-opacity=".7"><animateMotion dur="${dur}s" begin="${begin - dur / 2}s" repeatCount="indefinite" path="${d}" keyPoints="1;0" keyTimes="0;1" calcMode="linear"/></circle>`
    : '';
  return `<path d="${d}" fill="none" stroke="${color}" stroke-opacity=".6" stroke-width="2" stroke-dasharray="1 7" stroke-linecap="round"/>
  ${pill}
  ${ret}`;
}

function phoneLink() {
  const W = 1280;
  const H = 560;

  // The phone, with the two apps that take part.
  const tile = (x, y, title, sub, art) => `<rect x="${x}" y="${y}" width="206" height="86" rx="16" fill="${PH.card}" stroke="#fff" stroke-opacity=".07"/>
    ${art}
    <text x="${x + 72}" y="${y + 39}" font-family="${TEXT}" font-size="16" font-weight="600" fill="${C.ink}">${esc(title)}</text>
    <text x="${x + 72}" y="${y + 59}" font-family="${TEXT}" font-size="13" fill="${C.dim}">${esc(sub)}</text>`;
  const ph = phone(40, 150, 260, 352, (sx, sy) => `${tile(sx + 17, sy + 60, 'Flock', 'start, stop, answer', mascot(sx + 29, sy + 77, 46, '#F5F6F8', { delay: -0.5 }))}
    ${tile(sx + 17, sy + 168, 'Claude app', 'your conversation', `<rect x="${sx + 31}" y="${sy + 189}" width="44" height="44" rx="13" fill="#fff" fill-opacity=".06"/>${ICON.chat(sx + 44, sy + 202)}`)}
    <rect x="${sx + 37}" y="${sy + 276}" width="166" height="28" rx="14" fill="${PH.green}" fill-opacity=".12"/>
    <circle cx="${sx + 54}" cy="${sy + 290}" r="4" fill="${PH.green}"/>
    <text x="${sx + 66}" y="${sy + 295}" font-family="${TEXT}" font-size="13" font-weight="600" fill="${PH.greenText}">Paired with your PC</text>`);

  // The PC: Flock starts Claude Code there.
  const pc = `<rect x="980" y="150" width="260" height="352" rx="22" fill="${C.card}" fill-opacity=".92" stroke="#fff" stroke-opacity=".09"/>
  <text x="1002" y="184" font-family="${MONO}" font-size="12" letter-spacing="2" fill="${C.dim}">YOUR PC</text>
  <rect x="997" y="220" width="226" height="86" rx="16" fill="${PH.card}" stroke="#fff" stroke-opacity=".07"/>
  <rect x="1011" y="242" width="104" height="42" rx="21" fill="#000" stroke="#fff" stroke-opacity=".09"/>
  ${ACCOUNTS.slice(0, 3).map((a, i) => mascot(1018 + i * 30, 249, 28, a.color, { delay: -i * 0.9 })).join('\n  ')}
  <text x="1129" y="259" font-family="${TEXT}" font-size="16" font-weight="600" fill="${C.ink}">Flock</text>
  <text x="1129" y="279" font-family="${TEXT}" font-size="13" fill="${C.dim}">starts it</text>
  <path d="M1110 310v18" stroke="${RELAY}" stroke-width="2" stroke-linecap="round" marker-end="url(#ahr)"/>
  <rect x="997" y="336" width="226" height="86" rx="16" fill="${PH.card}" stroke="#fff" stroke-opacity=".07"/>
  <text x="1015" y="370" font-family="${TEXT}" font-size="16" font-weight="600" fill="${C.ink}">Claude Code</text>
  <circle cx="1020" cy="393" r="4" fill="${PH.green}"/>
  <text x="1031" y="398" font-family="${MONO}" font-size="12.5" fill="${PH.greenText}">Remote Control on</text>
  <text x="1002" y="470" font-family="${TEXT}" font-size="13" fill="${C.dimmer}">in the folder you picked,</text>
  <text x="1002" y="488" font-family="${TEXT}" font-size="13" fill="${C.dimmer}">with that account's sign-in</text>`;

  // In between: Flock's encrypted messages, and Claude's own Remote Control.
  const relay = `${infoCard(510, 205, 260, 112, 'ntfy.sh relay', ['end-to-end encrypted: it only', 'ever sees scrambled data'])}
  ${padlock(732, 223, RELAY)}`;
  const anthropic = infoCard(510, 365, 260, 112, 'Anthropic', ["Claude's Remote Control,", 'with your Claude login']);
  const lanes = `${lane('M286 263 L 510 263', RELAY, { label: 'start', dur: 3.2, back: true })}
  ${lane('M770 263 L 997 263', RELAY, { dur: 3.2, begin: -1.6, back: true })}
  ${lane('M286 371 C 400 371, 400 421, 510 421', CHAT, { dur: 3, back: true })}
  ${lane('M770 421 C 880 421, 880 379, 997 379', CHAT, { dur: 3, begin: -1.5, back: true })}`;

  const legend = `<circle cx="46" cy="537" r="5" fill="${RELAY}"/>
  <text x="60" y="542" font-family="${TEXT}" font-size="14" fill="${C.dim}">Flock's messages: start, stop, and Claude Code's own questions</text>
  <circle cx="600" cy="537" r="5" fill="${CHAT}"/>
  <text x="614" y="542" font-family="${TEXT}" font-size="14" fill="${C.dim}">Your conversation: everything you and Claude say</text>`;

  const kicker = `<text x="40" y="78" font-family="${MONO}" font-size="12" letter-spacing="2" fill="${C.dim}">HOW YOUR PHONE REACHES YOUR PC</text>
  <text x="40" y="112" font-family="${SANS}" font-size="26" font-weight="650" fill="${C.ink}">Flock passes on the controls. Claude carries the conversation.</text>`;

  return svgDoc(W, H, 'How the phone reaches the PC: Flock\'s encrypted messages go through the ntfy.sh relay to Flock, which starts Claude Code; the conversation goes through Anthropic\'s Remote Control to the Claude app', `${backdrop(W, H)}
  <defs><marker id="ahr" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="${RELAY}"/></marker></defs>
  ${kicker}
  ${lanes}
  ${ph}
  ${pc}
  ${relay}
  ${anthropic}
  ${legend}`);
}

// ── continuing a session ───────────────────────────────────────────────────

function continueSession() {
  const W = 1280;
  const H = 630;
  const work = ACCOUNTS[1];
  const title = 'Pricing table redesign';

  /** The session as the Claude app shows it once Remote Control is on. */
  const onPhone = (x, y) => `<rect x="${x}" y="${y}" width="330" height="128" rx="18" fill="${C.card}" stroke="#fff" stroke-opacity=".09"/>
    <rect x="${x + 18}" y="${y + 18}" width="36" height="36" rx="11" fill="#fff" fill-opacity=".06"/>${ICON.chat(x + 26, y + 27)}
    <text x="${x + 66}" y="${y + 33}" font-family="${TEXT}" font-size="13" fill="${C.dim}">Claude app, on your phone</text>
    <text x="${x + 66}" y="${y + 52}" font-family="${TEXT}" font-size="16" font-weight="600" fill="${C.ink}">${title}</text>
    <circle cx="${x + 24}" cy="${y + 84}" r="4" fill="${PH.green}"/>
    <text x="${x + 36}" y="${y + 89}" font-family="${TEXT}" font-size="14" fill="${PH.greenText}">Remote Control on</text>
    <text x="${x + 36}" y="${y + 109}" font-family="${TEXT}" font-size="13" fill="${C.dim}">with everything said so far</text>`;

  const sessionLine = (x, y, sub, dim = false) => `<rect x="${x + 18}" y="${y + 62}" width="30" height="30" rx="9" fill="#fff" fill-opacity=".06"/>${ICON.chat(x + 25, y + 69)}
    <text x="${x + 60}" y="${y + 76}" font-family="${TEXT}" font-size="15" font-weight="600" fill="${dim ? C.dim : C.ink}">${title}</text>
    <text x="${x + 60}" y="${y + 95}" font-family="${TEXT}" font-size="13" fill="${C.dimmer}">${esc(sub)}</text>`;

  const flag = (x, y, text, color) => {
    const tw = text.length * 7.9 + 26;
    return `<rect x="${x - tw / 2}" y="${y - 15}" width="${tw}" height="30" rx="15" fill="#000" stroke="${color}" stroke-opacity=".5"/>
  <text x="${x}" y="${y + 5}" text-anchor="middle" font-family="${MONO}" font-size="13" fill="${C.ink}">${esc(text)}</text>`;
  };

  const back = (d, color, text, lx, ly) => `<path d="${d}" fill="none" stroke="${color}" stroke-opacity=".7" stroke-width="2" stroke-dasharray="3 6" stroke-linecap="round" marker-end="url(#ahb)"/>
  <text x="${lx}" y="${ly}" text-anchor="middle" font-family="${TEXT}" font-size="14" fill="${C.dim}">${esc(text)}</text>`;

  // While the window is open, the phone gets a copy; the window keeps the original.
  const y1 = 172;
  const open = `<text x="40" y="${y1 - 14}" font-family="${MONO}" font-size="12" letter-spacing="2" fill="${C.dim}">WHILE ${work.name.toUpperCase()}'S CLAUDE WINDOW IS OPEN</text>
  ${windowCard(40, y1, 340, 128, work, { focused: true, lines: [sessionLine(40, y1, 'the window keeps the original')] })}
  ${lane(`M380 ${y1 + 64} L 906 ${y1 + 64}`, work.color, { dur: 3.4 })}
  ${flag(643, y1 + 64, 'a copy: --fork-session', work.color)}
  ${onPhone(910, y1)}
  ${back(`M1075 ${y1 + 132} C 1075 ${y1 + 176}, 210 ${y1 + 176}, 210 ${y1 + 136}`, C.dim, `Back at your PC: Settings → Phone → Open in ${work.name}'s window`, 643, y1 + 190)}`;

  // While it is closed, the phone carries on with the session itself.
  const y2 = 420;
  const closed = `<text x="40" y="${y2 - 14}" font-family="${MONO}" font-size="12" letter-spacing="2" fill="${C.dim}">WHILE IT IS CLOSED</text>
  <g opacity=".5">${windowCard(40, y2, 340, 128, work, { lines: [sessionLine(40, y2, 'not open anywhere', true)] })}</g>
  ${lane(`M380 ${y2 + 64} L 906 ${y2 + 64}`, work.color, { dur: 3.4, begin: -1.7 })}
  ${flag(643, y2 + 64, 'the session itself: --resume', work.color)}
  ${onPhone(910, y2)}
  ${back(`M1075 ${y2 + 132} C 1075 ${y2 + 170}, 210 ${y2 + 170}, 210 ${y2 + 136}`, C.dim, 'Open the window again and it goes back there', 643, y2 + 178)}`;

  const kicker = `<text x="40" y="70" font-family="${MONO}" font-size="12" letter-spacing="2" fill="${C.dim}">CONTINUING A SESSION FROM YOUR PHONE</text>
  <text x="40" y="104" font-family="${SANS}" font-size="26" font-weight="650" fill="${C.ink}">Flock reopens it with Remote Control on, with everything said so far.</text>`;

  return svgDoc(W, H, 'Continuing a session from the phone: with its Claude window open, the phone gets a copy that can come back to the window later; with the window closed, the phone carries on with the session itself', `${backdrop(W, H)}
  <defs>${SOFT}<marker id="ahb" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="${C.dim}"/></marker></defs>
  ${kicker}
  ${open}
  ${closed}`);
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
  'phone.svg': phoneApp(),
  'phone-link.svg': phoneLink(),
  'continue.svg': continueSession(),
};
const iconColors = ['#D97757', '#38BDF8', '#4ADE80', '#C084FC', '#FACC15'];
Object.keys(GLYPHS).forEach((name, i) => {
  files[`icons/${name}.svg`] = icon(name, iconColors[i % iconColors.length]);
});
for (const [name, svg] of Object.entries(files)) {
  fs.writeFileSync(path.join(OUT, name), svg);
  console.log(`docs/assets/${name}  ${(svg.length / 1024).toFixed(1)} KB`);
}
