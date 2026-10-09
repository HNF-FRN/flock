// Flock's own UI, rebuilt for the film from the app's renderer: the same
// markup as island.js / mascot.js, styled by Flock's real CSS (film/vendor,
// generated from src/renderer). Only the clock is different: instead of
// timers and CSS transitions, everything is set from the film time, and the
// mascots' CSS keyframe loops are seeked with the Web Animations API.
(function () {
  'use strict';
  const F = window.Film;
  const { h, css, cls, text, at, transit, prog, E, clamp, lerp, hash } = F;

  // ── Icons (src/renderer/shared/icons.js) ─────────────────────────────────

  const s = (d, extra = '') =>
    `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" ${extra}>${d}</svg>`;
  const I = {
    plus: s('<path d="M8 3v10M3 8h10"/>'),
    gear: s('<path d="M6.9 1.8h2.2l.4 1.6c.4.1.8.3 1.1.5l1.4-.8 1.6 1.6-.8 1.4c.2.3.4.7.5 1.1l1.6.4v2.2l-1.6.4c-.1.4-.3.8-.5 1.1l.8 1.4-1.6 1.6-1.4-.8c-.3.2-.7.4-1.1.5l-.4 1.6H6.9l-.4-1.6c-.4-.1-.8-.3-1.1-.5l-1.4.8-1.6-1.6.8-1.4c-.2-.3-.4-.7-.5-1.1L1.8 9.1V6.9l1.6-.4c.1-.4.3-.8.5-1.1l-.8-1.4 1.6-1.6 1.4.8c.3-.2.7-.4 1.1-.5z" stroke-width="1.3"/><circle cx="8" cy="8" r="2"/>'),
    soundOn: s('<path d="M2.8 6.2h2.3L8.3 3.5v9L5.1 9.8H2.8z"/><path d="M10.6 5.6a3.2 3.2 0 0 1 0 4.8M12.3 3.9a5.6 5.6 0 0 1 0 8.2"/>'),
    playAll: s('<path d="M3 3.6v8.8l5.6-4.4zM8.6 3.6v8.8l5.6-4.4z" fill="currentColor" stroke-width="1.1"/>'),
    more: s('<circle cx="3.5" cy="8" r=".9" fill="currentColor"/><circle cx="8" cy="8" r=".9" fill="currentColor"/><circle cx="12.5" cy="8" r=".9" fill="currentColor"/>'),
    folder: s('<path d="M2.2 4.6c0-.7.5-1.2 1.2-1.2h2.8l1.4 1.5h5c.7 0 1.2.5 1.2 1.2v5.6c0 .7-.5 1.2-1.2 1.2H3.4c-.7 0-1.2-.5-1.2-1.2z"/>'),
    box: s('<path d="M2.6 5 8 2.4 13.4 5v6L8 13.6 2.6 11z"/><path d="M2.6 5 8 7.6 13.4 5M8 7.6v6"/>'),
    key: s('<circle cx="5.4" cy="10.6" r="2.6"/><path d="m7.3 8.7 5.4-5.4M10.6 5.4l1.6 1.6M11.9 4.1l1.3 1.3"/>'),
    search: s('<circle cx="7.2" cy="7.2" r="4.4"/><path d="m10.5 10.5 3.1 3.1"/>'),
    check: s('<path d="m3.4 8.4 3 3 6.2-6.6"/>'),
    edit: s('<path d="M10.4 3.2 12.8 5.6 5.6 12.8H3.2v-2.4z"/>'),
    drag: s('<circle cx="6" cy="4" r=".8" fill="currentColor"/><circle cx="10" cy="4" r=".8" fill="currentColor"/><circle cx="6" cy="8" r=".8" fill="currentColor"/><circle cx="10" cy="8" r=".8" fill="currentColor"/><circle cx="6" cy="12" r=".8" fill="currentColor"/><circle cx="10" cy="12" r=".8" fill="currentColor"/>'),
    warn: s('<path d="M8 2.6 14 13H2z"/><path d="M8 6.6v3M8 11.6v.1"/>'),
    link: s('<path d="M6.6 9.4a2.6 2.6 0 0 0 3.7 0l2.2-2.2a2.6 2.6 0 0 0-3.7-3.7l-.9.9M9.4 6.6a2.6 2.6 0 0 0-3.7 0L3.5 8.8a2.6 2.6 0 0 0 3.7 3.7l.9-.9"/>'),
  };

  // ── The mascot (src/renderer/shared/mascot.js) ──────────────────────────

  const EYE = '#141413';
  const CLAUDE_ORANGE = '#D97757';
  const INK = '#F5F6F8';

  function mix(hex, to, t) {
    const a = parseInt(hex.slice(1), 16);
    const b = parseInt(to.slice(1), 16);
    const ch = (sh) => Math.round(((a >> sh) & 255) * (1 - t) + ((b >> sh) & 255) * t);
    return `#${((1 << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).slice(1)}`;
  }

  function tones(color) {
    const body = color || CLAUDE_ORANGE;
    return {
      body,
      top: mix(body, '#ffffff', 0.16),
      bottom: mix(body, '#000000', 0.1),
      tip: mix(body, '#ffffff', 0.6),
      dark: mix(body, '#000000', 0.5),
    };
  }

  let uid = 0;
  function mascotMarkup(color, opts) {
    const t = tones(color);
    const id = `fm${++uid}`;
    const shadow = opts.shadow
      ? `<ellipse class="shadow" cx="20" cy="37" rx="12.5" ry="1.7" fill="url(#${id}s)"/>`
      : '';
    return `<svg class="mascot awake" viewBox="0 0 40 40" aria-hidden="true" style="--m-d:${opts.phase.toFixed(2)}s">
  <defs>
    <linearGradient id="${id}b" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${t.top}"/>
      <stop offset="1" stop-color="${t.bottom}"/>
    </linearGradient>
    <radialGradient id="${id}h" cx=".3" cy=".08" r=".75">
      <stop offset="0" stop-color="#ffffff" stop-opacity=".38"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="${id}g" cx=".5" cy=".5" r=".5">
      <stop offset="0" stop-color="${t.tip}" stop-opacity=".9"/>
      <stop offset="1" stop-color="${t.tip}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="${id}s" cx=".5" cy=".5" r=".5">
      <stop offset="0" stop-color="#000" stop-opacity=".55"/>
      <stop offset="1" stop-color="#000" stop-opacity="0"/>
    </radialGradient>
  </defs>
  ${shadow}
  <g class="bodyg">
    <rect class="leg la" x="11.6" y="31.4" width="5.2" height="4.8" rx="2.4" fill="${t.dark}"/>
    <rect class="leg lb" x="23.2" y="31.4" width="5.2" height="4.8" rx="2.4" fill="${t.dark}"/>
    <g class="antenna">
      <path class="stalk" d="M26.6 12.8 Q27.4 9.6 28.6 7.4" fill="none" stroke="${t.dark}" stroke-width="1.6" stroke-linecap="round"/>
      <circle class="ping" cx="29" cy="6.4" r="2.3" fill="none" stroke="${t.tip}" stroke-width=".9"/>
      <circle class="glow" cx="29" cy="6.4" r="4.6" fill="url(#${id}g)"/>
      <circle class="tip" cx="29" cy="6.4" r="2.3" fill="${t.tip}"/>
    </g>
    <rect class="torso" x="5.5" y="11.5" width="29" height="22" rx="8.5" fill="url(#${id}b)"/>
    <rect class="sheen" x="5.5" y="11.5" width="29" height="22" rx="8.5" fill="url(#${id}h)"/>
    <g class="gaze">
      <g class="look">
        <g class="eyes" fill="${EYE}">
          <rect x="13.6" y="18.6" width="3.4" height="5.6" rx="1.7"/>
          <rect x="23" y="18.6" width="3.4" height="5.6" rx="1.7"/>
        </g>
        <g class="closed" fill="${EYE}" opacity="0">
          <rect x="13.2" y="21.6" width="4.2" height="1.3" rx=".65"/>
          <rect x="22.6" y="21.6" width="4.2" height="1.3" rx=".65"/>
        </g>
      </g>
    </g>
  </g>
</svg>`;
  }

  // One-off move lengths (s) — the CSS keyframes in tokens.css match.
  const MOVES = {
    wake: 0.82, doze: 1.25, ready: 0.78, startle: 0.54, shudder: 0.64,
    glance: 1.9, twitch: 0.72, blink2: 0.56, stretch: 1.05,
    jump: 0.56, squish: 0.62, twirl: 0.9, enter: 0.46,
  };
  const FIDGETS = ['glance', 'twitch', 'blink2', 'stretch'];
  // Keyframes that loop while a state lasts; every other mascot keyframe belongs to a move.
  const LOOPS = new Set([
    'm-blink', 'm-idle', 'm-idle-sway', 'm-breathe', 'm-droop', 'm-sleep-light', 'm-walk', 'm-step',
    'm-sway', 'm-load', 'm-load-glow', 'm-signal', 'm-glow', 'm-ping', 'm-nudge', 'm-look-up',
    'm-flicker', 'm-wilted', 'm-sigh',
  ]);
  const DIM = { asleep: [0.6, 0.74], error: [0.45, 0.78] };

  function moveBetween(from, to) {
    if (!from || from === to) return null;
    const sleeping = from === 'asleep' || from === 'error';
    if (to === 'asleep') return from === 'error' ? null : 'doze';
    if (to === 'error') return 'shudder';
    if (to === 'alert') return sleeping ? 'wake' : 'startle';
    if (sleeping) return 'wake';
    if (to === 'awake') return 'ready';
    return null;
  }

  const ALL = [];
  let seedN = 0;

  /**
   * A mascot whose state, moves and colour follow the film clock.
   *   m.state(t, 'launching').state(t2, 'awake')  — a change plays its move (unless quiet)
   *   m.move(t, 'jump') · m.color(t, '#38BDF8') · m.lookAt = (t) => [dx, dy]
   */
  class Mascot {
    constructor(color, opts = {}) {
      this.opts = opts;
      this.seed = opts.seed ?? ++seedN * 7919;
      this.phase = opts.phase ?? -(hash(this.seed, 3) * 8);
      this.calm = Boolean(opts.calm);
      this.colors = [[-1e9, color]];
      this.states = [[-100, opts.state || 'awake', true]];
      this.explicit = [];
      this.lookAt = null;
      this.lookLag = 0.18; // the product eases the eyes over 0.18s
      this.el = h('span', { class: 'mascot-wrap' });
      if (opts.size) css(this.el, { width: `${opts.size}px`, height: `${opts.size}px` });
      this._render(color);
      // A few deterministic fidgets while awake (the app picks one now and then).
      this.fidgets = [];
      if (!this.calm && opts.fidget !== false) {
        let ft = 1.2 + hash(this.seed, 11) * 5;
        for (let i = 0; i < 40; i++) {
          this.fidgets.push([ft, FIDGETS[Math.floor(hash(this.seed + i, 17) * FIDGETS.length)]]);
          ft += 7 + hash(this.seed + i, 23) * 6;
        }
      }
      ALL.push(this);
    }

    _render(color) {
      this.el.innerHTML = mascotMarkup(color, { shadow: this.opts.shadow, phase: this.phase });
      this.svg = this.el.firstElementChild;
      this.lookG = this.svg.querySelector('.look');
      this._color = color;
      this._cls = null;
    }

    state(t, st, quiet) {
      this.states.push([t, st, Boolean(quiet)]);
      this.states.sort((a, b) => a[0] - b[0]);
      return this;
    }
    move(t, mv) {
      this.explicit.push([t, mv]);
      return this;
    }
    color(t, c) {
      this.colors.push([t, c]);
      this.colors.sort((a, b) => a[0] - b[0]);
      return this;
    }

    stateAt(t) {
      let i = 0;
      for (let j = 0; j < this.states.length; j++) if (this.states[j][0] <= t) i = j;
      return { i, start: this.states[i][0], state: this.states[i][1] };
    }

    /** The one-off move playing at t: [start, name] or null. */
    moveAt(t) {
      const list = [];
      for (let k = 1; k < this.states.length; k++) {
        const [tk, st, quiet] = this.states[k];
        const mv = quiet ? null : moveBetween(this.states[k - 1][1], st);
        if (mv) list.push([tk, mv]);
      }
      for (const m of this.explicit) list.push(m);
      let best = null;
      for (const [ts, mv] of list) {
        if (ts <= t && t < ts + MOVES[mv] && (!best || ts >= best[0])) best = [ts, mv];
      }
      if (best) return best;
      // fidgets only while awake and nothing else is going on
      for (const [ts, mv] of this.fidgets) {
        if (ts <= t && t < ts + MOVES[mv]) {
          const st = this.stateAt(ts).state;
          const busy = list.some(([o, om]) => o < ts + MOVES[mv] && ts < o + MOVES[om] + 0.6);
          if (st === 'awake' && this.stateAt(t).state === 'awake' && !busy) return [ts, mv];
        }
      }
      return null;
    }

    sync(t) {
      const col = at(t, this.colors);
      if (col !== this._color) this._render(col);
      const { i, start, state } = this.stateAt(t);
      const mv = this.moveAt(t);
      const name = `mascot ${state}${mv ? ` mv-${mv[1]}` : ''}`;
      if (name !== this._cls) {
        this._cls = name;
        this.svg.setAttribute('class', name);
      }
      // The app eases the dim filter of sleeping mascots over 0.8s.
      const prevState = i > 0 ? this.states[i - 1][1] : state;
      const dimOf = (st) => DIM[st] || [1, 1];
      const k = E.ease(prog(t, start, start + 0.8));
      const [s0, b0] = dimOf(prevState);
      const [s1, b1] = dimOf(state);
      const sat = lerp(s0, s1, k);
      const bri = lerp(b0, b1, k);
      css(this.svg, { filter: sat === 1 && bri === 1 ? 'none' : `saturate(${sat.toFixed(3)}) brightness(${bri.toFixed(3)})` });
      for (const a of this.svg.getAnimations({ subtree: true })) {
        const base = LOOPS.has(a.animationName) ? start : mv ? mv[0] : start;
        const ms = Math.max(0, t - base) * 1000;
        if (a.currentTime !== ms) a.currentTime = ms;
      }
      if (this.lookAt) {
        // the eyes follow with the app's 0.18s ease: average the target over that window
        let dx = 0;
        let dy = 0;
        const n = 6;
        for (let j = 0; j < n; j++) {
          const [x, y] = this.lookAt(t - (this.lookLag * j) / n, this);
          dx += x;
          dy += y;
        }
        dx = clamp(dx / n, -1, 1) * 1.8;
        dy = clamp(dy / n, -1, 1) * 1.2;
        css(this.lookG, { transform: `translate(${dx.toFixed(3)}px, ${dy.toFixed(3)}px)` });
      }
    }
  }

  // ── The island (src/renderer/island) ─────────────────────────────────────

  const OPEN_W = 760;
  const OPEN_H = 270;
  const COMPACT_H = 30;
  const MAX_MINIS = 6;

  let measureCtx = null;
  function textWidth(str, font) {
    if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
    measureCtx.font = font;
    return measureCtx.measureText(str).width;
  }

  function needsSignIn(a, st) {
    return a.kind !== 'default' && !st.signedIn;
  }
  function mascotState(a, st) {
    if (st.launching) return 'launching';
    if (st.running && (st.capturing || needsSignIn(a, st))) return 'alert';
    if (st.running) return 'awake';
    if (st.error) return 'error';
    return 'asleep';
  }
  function dotClass(a, st) {
    if (st.launching) return 'launch';
    if (st.capturing || (st.running && needsSignIn(a, st))) return 'wait';
    if (st.running) return 'on';
    return '';
  }
  function statusOf(a, st) {
    if (st.launching) return ['Opening…', 'busy'];
    if (st.capturing) return ['Waiting for sign-in', 'warn'];
    if (st.running && needsSignIn(a, st)) return ['Needs sign-in', 'warn'];
    if (st.running) return [`Open · ${st.since || 'just now'}`, 'ok'];
    if (st.error) return ['Couldn’t open', 'err'];
    if (needsSignIn(a, st)) return ['Not signed in yet', 'warn'];
    return ['Closed', ''];
  }
  function peeks(a, st) {
    return st.signedIn !== false && !st.launching && !st.capturing && !(st.running && needsSignIn(a, st));
  }

  /**
   * The island, scripted:
   *   accounts: [{ id, name, note, color, kind, cfg, data }]
   *   sessions: { id: [{ title, folder, ago }] }
   *   states:   { id: [[t, { running, launching, signedIn, capturing, since }], ...] }
   *   open:     [[tOpen, tClose], ...]       hero: [[t, id]]      focus: [[t, id|null]]
   *   tuck:     [[t, bool]]                  shown: [[t, n]] (accounts listed)
   *   pointer:  (t) => [x, y] in the island window's px, or null
   */
  function Island(o) {
    const root = h('div', { class: 'fx-island film-island' });
    const ear = (side) => h('i', { class: `ear ${side}` });
    const cLogo = h('span', { id: 'cLogo' });
    const cCount = h('span', { id: 'cCount' });
    const cMinis = h('span', { id: 'cMinis' });
    const compact = h('div', { id: 'compact', 'data-calm': '' }, cLogo, cCount, cMinis);
    const headStatus = h('div', { id: 'headStatus' });
    const hbtn = (icon, title) => h('button', { class: 'hbtn', title, html: icon });
    const openAllBtn = hbtn(I.playAll, 'Open every account (A)');
    const gearBtn = hbtn(I.gear, 'Settings');
    const sndBtn = hbtn(I.soundOn, 'Sounds');
    const header = h('header', { id: 'header' }, headStatus, h('div', { class: 'header-actions' }, openAllBtn, gearBtn, sndBtn));
    const accountsNav = h('nav', { class: 'accounts', id: 'accounts' });
    const dMascotBox = h('span', { class: 'd-mascot', id: 'dMascot' });
    const dState = h('span', { class: 'd-state', id: 'dState' });
    const stage = h('div', { class: 'stage' }, dMascotBox, dState);
    const dName = h('b', { class: 'd-name', id: 'dName' });
    const dSub = h('span', { class: 'd-sub', id: 'dSub' });
    const dActions = h('div', { class: 'd-actions', id: 'dActions' });
    const dFacts = h('div', { class: 'd-facts', id: 'dFacts' });
    const dSessions = h('div', { class: 'sessions', id: 'dSessions' });
    const detail = h('section', { class: 'detail', id: 'detail' },
      stage,
      h('div', { class: 'd-main' },
        h('div', { class: 'd-head' }, h('div', { class: 'd-who' }, dName, dSub), dActions),
        h('div', { class: 'd-body' }, dFacts, dSessions)));
    const full = h('div', { id: 'full' }, header, h('div', { id: 'body' }, accountsNav, detail));
    const clip = h('div', { id: 'clip' }, compact, full);
    const islandEl = h('div', { id: 'island', class: 'mode-compact' }, ear('l'), ear('r'), clip);
    root.append(islandEl);

    const accounts = o.accounts;
    const stateOf = (id, t) => {
      const list = (o.states && o.states[id]) || [[0, { running: false, signedIn: true }]];
      return at(t, list);
    };
    const shownAt = (t) => (o.shown ? at(t, o.shown) : accounts.length);

    // Flock's own logo mascot (takes the focused account's colour) and the minis.
    const logo = new Mascot(INK, { calm: true, seed: 101 });
    cLogo.append(logo.el);
    const minis = accounts.map((a, i) => {
      const m = new Mascot(a.color, { calm: true, seed: 200 + i });
      m.el.classList.add('mini');
      return m;
    });
    minis.forEach((m) => cMinis.append(m.el));

    // Rows
    const rows = accounts.map((a, i) => {
      const pet = new Mascot(a.color, { seed: 300 + i, fidget: false });
      pet.el.classList.add('mini');
      const bar = h('i', { class: 'bar' });
      const name = h('span', { class: 'name', text: a.name });
      const num = h('span', { class: 'num', text: String(i + 1) });
      const dot = h('i', { class: 'dot' });
      const el = h('button', { class: 'acct' }, bar, pet.el, name, num, dot);
      el.style.setProperty('--c', a.color);
      accountsNav.append(el);
      return { a, el, pet, bar, dot };
    });
    const addRow = h('button', { class: 'acct add', html: `${I.plus}<span class="name">Add account</span>` });
    accountsNav.append(addRow);

    // The detail's big mascot: one per account, so each keeps its own clock.
    const heroes = accounts.map((a, i) => {
      const m = new Mascot(a.color, { shadow: true, seed: 400 + i });
      css(m.el, { position: 'absolute', inset: '0', width: '100%', height: '100%' });
      dMascotBox.append(m.el);
      return m;
    });

    // Session rows per account
    const sessionEls = {};
    for (const a of accounts) {
      const list = (o.sessions && o.sessions[a.id]) || [];
      sessionEls[a.id] = list.map((sx) => {
        const here = h('span', { class: 'here', html: I.plus });
        const el = h('button', { class: 'session' },
          h('span', { class: 't', text: sx.title || 'Untitled session' }),
          sx.folder ? h('span', { class: 'f', text: sx.folder }) : null,
          h('span', { class: 'm', text: sx.ago }),
          here,
          h('i', { class: 'row-seam' })); // the film's row-embed seam (hidden unless animated)
        el.style.position = 'relative';
        return el;
      });
    }
    const emptySessions = h('div', { class: 'empty', html: '<b>No Code sessions yet</b><span>Start one with New.</span>' });

    // Detail actions: rebuilt only when their kind changes.
    let actionsKey = '';
    const actionBtns = {};
    function renderActions(a, st, listing) {
      const key = [a.id, st.running, st.launching, Boolean(st.capturing), needsSignIn(a, st), listing].join('|');
      if (key === actionsKey) return;
      actionsKey = key;
      dActions.innerHTML = '';
      for (const k in actionBtns) delete actionBtns[k];
      const add = (name, c, html) => {
        const b = h('button', { class: `btn ${c}`, html });
        actionBtns[name] = b;
        dActions.append(b);
      };
      if (listing) {
        add('main', 'primary', `${st.running ? 'Show' : 'Open'} <span class="kbd">↵</span>`);
        add('new', 'secondary', `${I.plus}New`);
        add('search', 'secondary icon', I.search);
      } else if (st.capturing) {
        add('main', 'primary', 'Open');
        add('stop', 'secondary', 'Stop waiting');
      } else if (needsSignIn(a, st) && !st.running) {
        add('main', 'primary', 'Open &amp; sign in <span class="kbd">↵</span>');
      } else {
        add('main', 'primary', `${st.running ? 'Show' : 'Open'} <span class="kbd">↵</span>`);
      }
      add('more', 'secondary icon', I.more);
    }

    let factsKey = '';
    function renderFacts(a, st, listing) {
      const key = `${a.id}|${listing}|${st.capturing ? 1 : 0}|${st.running ? 1 : 0}|${st.signedIn ? 1 : 0}`;
      if (key === factsKey) return;
      factsKey = key;
      if (listing) {
        dFacts.innerHTML = '';
        return;
      }
      const facts = [];
      if (st.capturing) facts.push(['key', 'Google and e-mail sign-in links are sent to this window', 'warn']);
      else if (st.running && needsSignIn(a, st)) facts.push(['key', 'Sign in once in its window; Flock remembers it', 'warn']);
      else if (needsSignIn(a, st)) facts.push(['key', 'Open it and sign in once', 'warn']);
      facts.push(['folder', a.cfg || 'Shared ~/.claude', '']);
      facts.push(['box', a.kind === 'default' ? 'Claude default data' : a.data || `Claude-${a.name.replace(/\W+/g, '-')}`, 'mono']);
      dFacts.innerHTML = facts.map(([icon, txt, c]) => `<div class="fact ${c}">${I[icon] || ''}<span>${txt}</span></div>`).join('');
    }

    let sessionsKey = '';
    function renderSessions(a, listing) {
      const key = `${a.id}|${listing}`;
      if (key === sessionsKey) return;
      sessionsKey = key;
      dSessions.innerHTML = '';
      if (!listing) return;
      const list = sessionEls[a.id];
      if (!list.length) dSessions.append(emptySessions);
      else list.forEach((el) => dSessions.append(el));
    }

    // Times at which something changes: transitions re-target there.
    const evts = new Set();
    (o.open || []).forEach(([a, b]) => { evts.add(a); if (b != null) evts.add(b); });
    (o.focus || []).forEach(([t]) => evts.add(t));
    (o.tuck || []).forEach(([t]) => evts.add(t));
    (o.shown || []).forEach(([t]) => evts.add(t));
    for (const id in o.states || {}) o.states[id].forEach(([t]) => evts.add(t));
    const events = [...evts].sort((a, b) => a - b);

    const isOpen = (t) => (o.open || []).some(([a, b]) => t >= a && (b == null || t < b));
    const focusAt = (t) => (o.focus ? at(t, o.focus) : null);
    const tuckAt = (t) => (o.tuck ? at(t, o.tuck) : false);

    function compactWidth(t) {
      const n = Math.min(shownAt(t), MAX_MINIS);
      const fid = focusAt(t);
      const focus = fid ? accounts.find((a) => a.id === fid) : null;
      const running = accounts.slice(0, shownAt(t)).filter((a) => stateOf(a.id, t).running).length;
      const label = focus ? Math.ceil(textWidth(focus.name, '600 11.5px "Segoe UI Variable Text", "Segoe UI"')) + 4 : running ? 12 : 0;
      const w = 21 + 7 + label + n * 19 + 34;
      return Math.max(116, Math.min(360, w));
    }

    // Visible size of the island: [w, h, r]
    function sizeAt(t) {
      const w = transit(t, events, (x) => (isOpen(x) ? OPEN_W : compactWidth(x)), 0.46, E.spring);
      const hgt = transit(t, events, (x) => (isOpen(x) ? OPEN_H : COMPACT_H), 0.46, E.spring);
      const r = transit(t, events, (x) => (isOpen(x) ? 30 : 14), 0.3, E.ease);
      return [w, hgt, r];
    }

    // When did the island last open (for the stage-rise animation)?
    const lastOpen = (t) => {
      let s = -100;
      for (const [a] of o.open || []) if (a <= t) s = a;
      return s;
    };

    // Layout rects relative to the island window (800 px wide), measured through any camera.
    function rect(el) {
      const r = el.getBoundingClientRect();
      const o = root.getBoundingClientRect();
      const z = o.width / 800 || 1;
      return { x: (r.left - o.left) / z, y: (r.top - o.top) / z, w: r.width / z, h: r.height / z };
    }

    const api = {
      el: root,
      islandEl,
      accounts,
      rows,
      heroes,
      minis,
      logo,
      actionBtns,
      sessionEls,
      addRow,
      openAllBtn,
      gearBtn,
      /** Position of an element's point (fx, fy) in island-window px (the island is centred in its 800px window). */
      point(el, fx = 0.5, fy = 0.5) {
        const r = rect(el);
        return [r.x + r.w * fx, r.y + r.h * fy];
      },
      sync(t) {
        const open = isOpen(t);
        const [w, hgt, r] = sizeAt(t);
        cls(islandEl, 'open', open);
        css(islandEl, {
          width: `${w.toFixed(2)}px`,
          height: `${hgt.toFixed(2)}px`,
          borderRadius: `0 0 ${r.toFixed(2)}px ${r.toFixed(2)}px`,
          boxShadow: `0 14px 40px rgba(0, 0, 0, ${(0.45 * clamp((hgt - COMPACT_H) / (OPEN_H - COMPACT_H))).toFixed(3)})`,
        });
        // tucked away for another app (or 'hover' mode)
        const tk = transit(t, events, (x) => (tuckAt(x) && !isOpen(x) ? 1 : 0), 0.34, E.spring);
        const fade = transit(t, events, (x) => (tuckAt(x) && !isOpen(x) ? 0 : 1), 0.2, E.ease);
        css(islandEl, { transform: `translate(-50%, ${(-100 * tk).toFixed(3)}%)`, opacity: fade.toFixed(3) });
        // compact fades out as it opens; full fades in a beat later
        const compactOp = transit(t, events, (x) => (isOpen(x) ? 0 : 1), 0.2, E.ease);
        css(compact, { opacity: compactOp.toFixed(3) });
        let fullOp;
        {
          // opening: opacity 0.26s ease-out after 0.12s; closing: 0.14s ease-in
          let from = isOpen(-1e9) ? 1 : 0;
          let to = from;
          let start = -1e9;
          let dur = 0.26;
          let delay = 0;
          let ease = E.easeOut;
          for (const e of events) {
            if (e > t) break;
            const want = isOpen(e) ? 1 : 0;
            if (want === to) continue;
            from = lerp(from, to, ease(prog(e, start + delay, start + delay + dur)));
            to = want;
            start = e;
            dur = want ? 0.26 : 0.14;
            delay = want ? 0.12 : 0;
            ease = want ? E.easeOut : E.easeIn;
          }
          fullOp = lerp(from, to, ease(prog(t, start + delay, start + delay + dur)));
        }
        css(full, { opacity: fullOp.toFixed(3) });

        // Compact contents
        const n = shownAt(t);
        minis.forEach((m, i) => {
          const a = accounts[i];
          const on = i < n && i < MAX_MINIS;
          css(m.el, { display: on ? '' : 'none' });
          if (on) {
            m.states.length = 0;
            m.states.push([-100, mascotState(a, stateOf(a.id, -100)), true]);
            for (const [ts, st] of (o.states && o.states[a.id]) || []) m.states.push([ts, mascotState(a, st), false]);
            m.sync(t);
          }
        });
        const fid = focusAt(t);
        const focus = fid ? accounts.find((a) => a.id === fid) : null;
        const running = accounts.slice(0, n).filter((a) => stateOf(a.id, t).running).length;
        text(cCount, focus ? focus.name : running ? String(running) : '');
        cls(cCount, 'focus', Boolean(focus));
        css(cCount, { color: focus ? focus.color : '' });
        cls(islandEl, 'focused', Boolean(focus));
        css(islandEl, { '--focus': focus ? focus.color : 'transparent' });
        logo.colors.length = 0;
        logo.colors.push([-1e9, INK]);
        for (const [ts, id] of o.focus || []) {
          const fa = id ? accounts.find((a) => a.id === id) : null;
          logo.colors.push([ts, fa ? fa.color : INK]);
        }
        logo.sync(t);

        // Header
        const shownAccts = accounts.slice(0, n);
        const rr = shownAccts.filter((a) => stateOf(a.id, t).running).length;
        const waiting = shownAccts.filter((a) => stateOf(a.id, t).capturing).length;
        const hs = `<span><b>${rr}</b> of ${n} open</span>${waiting ? '<span class="wait">Waiting for sign-in</span>' : ''}`;
        if (headStatus.__html !== hs) {
          headStatus.__html = hs;
          headStatus.innerHTML = hs;
        }

        // Rows + detail (only worth the work while the full view shows)
        const heroId = o.hero ? at(t, o.hero) : accounts[0].id;
        const pointer = o.pointer ? o.pointer(t) : null;
        const hovered = (el) => {
          if (!pointer || fullOp < 0.5 || !el.isConnected) return false;
          const rc = rect(el);
          if (!rc.w) return false;
          return pointer[0] >= rc.x && pointer[0] < rc.x + rc.w && pointer[1] >= rc.y && pointer[1] < rc.y + rc.h;
        };
        rows.forEach((row, i) => {
          const a = row.a;
          const on = i < n;
          css(row.el, { display: on ? '' : 'none' });
          if (!on) return;
          const st = stateOf(a.id, t);
          cls(row.el, 'off', !st.running && !st.launching);
          const isCur = a.id === heroId;
          cls(row.el, 'cur', isCur);
          cls(row.el, 'fx-hover', hovered(row.el));
          row.dot.className = `dot ${dotClass(a, st)}`;
          // the selected bar grows in (0.25s spring) when a row becomes current
          const heroEvents = (o.hero || []).map(([x]) => x);
          const k = transit(t, heroEvents, (x) => ((o.hero ? at(x, o.hero) : accounts[0].id) === a.id ? 1 : 0), 0.25, E.spring);
          const op = transit(t, heroEvents, (x) => ((o.hero ? at(x, o.hero) : accounts[0].id) === a.id ? 1 : 0), 0.2, E.ease);
          css(row.bar, { opacity: op.toFixed(3), transform: `scaleY(${lerp(0.4, 1, k).toFixed(3)})` });
          row.pet.states.length = 0;
          row.pet.states.push([-100, mascotState(a, stateOf(a.id, -100)), true]);
          for (const [ts, s2] of (o.states && o.states[a.id]) || []) row.pet.states.push([ts, mascotState(a, s2), false]);
          if (fullOp > 0.01) row.pet.sync(t);
        });
        cls(addRow, 'fx-hover', hovered(addRow));

        // Detail
        const a = accounts.find((x) => x.id === heroId) || accounts[0];
        const st = stateOf(a.id, t);
        const heroChange = (() => {
          let s2 = -100;
          for (const [ts] of o.hero || []) if (ts <= t) s2 = ts;
          return s2;
        })();
        // colour pool: a short glide between accounts
        const prevHero = (() => {
          let p = a;
          for (const [ts, id] of o.hero || []) if (ts < heroChange) p = accounts.find((x) => x.id === id) || p;
          return p;
        })();
        const ck = E.ease(prog(t, heroChange, heroChange + 0.18));
        css(detail, { '--c': F.mixHex(prevHero.color, a.color, ck) });
        detail.dataset.state = mascotState(a, st);
        heroes.forEach((m, i) => {
          const mine = accounts[i].id === a.id;
          css(m.el, { display: mine ? '' : 'none' });
          if (!mine) return;
          m.states.length = 0;
          m.states.push([-100, mascotState(a, stateOf(a.id, -100)), true]);
          for (const [ts, s2] of (o.states && o.states[a.id]) || []) m.states.push([ts, mascotState(a, s2), false]);
          // a different account taking the stage steps on
          const enters = m.explicit.filter(([, mv]) => mv !== 'enter');
          m.explicit = enters;
          if (heroChange > -100) m.explicit.push([heroChange, 'enter']);
          if (fullOp > 0.01) m.sync(t);
        });
        const [txt, tone] = statusOf(a, st);
        dState.className = `d-state ${tone}`;
        const sh = `<span>${txt}</span>`;
        if (dState.__html !== sh) {
          dState.__html = sh;
          dState.innerHTML = sh;
        }
        text(dName, a.name);
        text(dSub, a.note || (a.kind === 'default' ? 'Claude’s own data folder' : ''));
        const listing = peeks(a, st);
        cls(detail, 'peek', listing);
        renderFacts(a, st, listing);
        renderSessions(a, listing);
        renderActions(a, st, listing);
        for (const b of Object.values(actionBtns)) cls(b, 'fx-hover', hovered(b));
        for (const el of sessionEls[a.id] || []) cls(el, 'fx-hover', hovered(el));
        for (const b of [openAllBtn, gearBtn, sndBtn]) cls(b, 'fx-hover', hovered(b));

        // The island's own CSS animations (stage rise, pulsing dots): seek them.
        const openStart = lastOpen(t);
        for (const an of root.getAnimations({ subtree: true })) {
          const nm = an.animationName;
          if (!nm || !nm.startsWith('isl-')) continue;
          const base = nm === 'isl-stage-rise' ? openStart : 0;
          const ms = Math.max(0, t - base) * 1000;
          if (an.currentTime !== ms) an.currentTime = ms;
        }
      },
    };
    return api;
  }

  // ── The settings window (src/renderer/settings) ──────────────────────────

  const PALETTE = ['#D97757', '#FACC15', '#F4505E', '#E879F9', '#C084FC', '#818CF8', '#38BDF8', '#2DD4BF', '#4ADE80', '#F5F6F8'];

  /**
   * Flock's settings window, 640×800, with the account editor sheet.
   *   o.accounts: [{ id, name, note, color, kind, sub, tag: [text, cls], act }]
   */
  function Settings(o) {
    const root = h('div', { class: 'fx-settings setwin' });
    const brandM = new Mascot(INK, { calm: true, seed: 2001 });
    const titlebar = h('div', { class: 'titlebar' },
      h('span', { class: 'brand' }, h('span', { id: 'brandMascot' }, brandM.el), h('b', { text: 'Flock' }), h('span', { class: 'version', text: o.version || '0.1.2' })),
      h('span', { class: 'sw-ctrls', html: '<i>—</i><i>▢</i><i>✕</i>' }));
    const addBtn = h('button', { class: 'btn primary small', id: 'addBtn', text: 'Add account' });
    const openAllBtn = h('button', { class: 'btn secondary small', id: 'openAllBtn', text: 'Open all' });
    const count = h('span', { class: 'count', id: 'acctCount' });
    const list = h('div', { class: 'acct-list', id: 'acctList' });
    const accounts = h('section', { id: 'accounts' },
      h('h2', null, 'Accounts ', count, h('span', { class: 'spacer' }), openAllBtn, addBtn),
      list,
      h('p', { class: 'hint', text: 'Each account opens its own Claude window with its own sign-in, chats and connectors. Drag to reorder — the order is the island\'s 1–9 shortcuts.' }));
    const sw = (on) => h('button', { class: `switch${on ? ' on' : ''}` });
    const chips = h('div', { class: 'chips', id: 'autoChips' });
    const startup = h('section', { id: 'startup' },
      h('h2', { text: 'When Flock starts' }),
      h('div', { class: 'row' }, h('span', { class: 'grow', text: 'Start Flock with Windows' }), sw(true)),
      h('div', { class: 'row top' }, h('span', { class: 'grow', text: 'Open these accounts automatically' })),
      chips,
      h('div', { class: 'row' }, h('span', { class: 'grow', text: 'Gap between windows when opening several' }), h('select', { id: 'stagger', html: '<option>1.2 s</option>' })));
    const seg = (items, on) => h('div', { class: 'seg' }, ...items.map((x) => h('button', { class: x === on ? 'on' : '', text: x })));
    const islandSec = h('section', { id: 'islandSec' },
      h('h2', { text: 'Island' }),
      h('div', { class: 'row' }, h('span', { class: 'grow', text: 'Show the island at the top of the screen' }), seg(['Always', 'On hover', 'Off'], 'Always')),
      h('div', { class: 'row' }, h('span', { class: 'grow', text: 'Step aside when another app\'s window is under it' }), sw(true)));
    const main = h('main', { id: 'root' }, accounts, startup, islandSec);

    // the sheet (account editor)
    const sheetM = h('span', { class: 'sheet-mascot', id: 'sheetMascot' });
    const nameIn = h('div', { class: 'fake-input', id: 'fName' });
    const nameText = h('span', { class: 'fi-text' });
    const namePh = h('span', { class: 'fi-ph', text: 'Work, Personal, Client…' });
    const caret = h('i', { class: 'fi-caret' });
    nameIn.append(nameText, caret, namePh);
    const noteIn = h('div', { class: 'fake-input', id: 'fNote' }, h('span', { class: 'fi-ph', text: 'Optional — e.g. the e-mail you\'ll sign in with' }));
    const swatches = h('div', { class: 'swatches', id: 'fColors' });
    const swEls = PALETTE.map((c) => {
      const b = h('button', { class: 'swatch' });
      b.style.background = c;
      swatches.append(b);
      return b;
    });
    const modeBtns = ['Shared', 'Its own', 'Same as…'].map((x) => h('button', { 'data-mode': x, text: x }));
    const thumb = h('i', { class: 'seg-thumb' });
    const modeSeg = h('div', { class: 'seg wide', id: 'fMode' }, thumb, ...modeBtns);
    const dShared = h('div', { class: 'mode-detail', 'data-for': 'shared', html: '<p class="hint">Uses <code>~\\.claude</code> like your other shared accounts: same CLAUDE.md, skills, plugins, settings and memory.</p>' });
    const dOwn = h('div', { class: 'mode-detail', 'data-for': 'own', html: `<div class="pathrow"><code id="fOwnDir">C:\\Users\\you\\.claude-side-project</code><button class="btn secondary small">Change…</button></div><label class="check"><span class="fake-check on"></span> Start with a copy of my CLAUDE.md and settings.json</label><label class="check"><span class="fake-check"></span> Copy my skills too <span class="dimtxt">(166 MB)</span></label><p class="hint">History, projects and plugins are not copied — this account starts clean and keeps its own memory.</p>` });
    const field = (label, ctl, cls2 = '') => h('div', { class: `field ${cls2}` }, h('label', { text: label }), ctl);
    const saveBtn = h('button', { class: 'btn primary', id: 'fSave', text: 'Add & sign in' });
    const sheet = h('div', { class: 'sheet', id: 'sheet' },
      h('div', { class: 'sheet-head' }, sheetM, h('h3', { id: 'sheetTitle', text: 'Add an account' })),
      field('Name', nameIn),
      field('Note', noteIn),
      field('Colour', swatches),
      h('div', { class: 'field col' }, h('label', { text: '~/.claude for the Code tab' }), modeSeg, dShared, dOwn),
      h('div', { class: 'field toggle' }, h('label', { text: 'Open automatically when Flock starts' }), sw(false)),
      h('details', { class: 'adv', id: 'fAdv' }, h('summary', { text: 'Data folder' })),
      h('div', { class: 'sheet-foot' }, h('span', { class: 'spacer' }), h('button', { class: 'btn secondary', text: 'Cancel' }), saveBtn));
    const backdrop = h('div', { class: 'backdrop', id: 'sheetWrap' }, sheet);
    root.append(titlebar, main, backdrop);

    const sheetMascot = new Mascot(o.newColor, { seed: 2002 });
    sheetM.append(sheetMascot.el);

    // account rows (settings.js makeRow)
    const rows = o.accounts.map((a, i) => {
      const pet = new Mascot(a.color, { seed: 2100 + i, state: a.state || 'awake' });
      const tag = h('span', { class: 'tag st' });
      const act = h('button', { class: 'btn secondary small act' });
      const r = h('div', { class: 'acct' },
        h('span', { class: 'grip', html: I.drag }),
        h('span', { class: 'avatar' }, pet.el),
        h('div', { class: 'acct-main' },
          h('div', { class: 'acct-name' }, h('b', { text: a.name }), h('span', { class: 'note', text: a.note || '' }), tag),
          h('div', { class: 'acct-sub', text: a.sub })),
        h('div', { class: 'acct-actions' }, act, h('button', { class: 'btn secondary icon small edit', html: I.edit })));
      r.style.setProperty('--c', a.color);
      list.append(r);
      return { a, r, pet, tag, act };
    });
    o.accounts.forEach((a, i) => {
      const chipM = new Mascot(a.color, { seed: 2200 + i, calm: true, state: a.auto ? 'awake' : 'asleep' });
      const ch = h('button', { class: `chip${a.auto ? ' on' : ''}` }, chipM.el, a.name);
      ch.style.setProperty('--c', a.color);
      chips.append(ch);
      rows[i].chip = ch;
      rows[i].chipM = chipM;
    });

    return {
      el: root,
      rows,
      addBtn,
      nameIn,
      swEls,
      modeBtns,
      modeSeg,
      thumb,
      saveBtn,
      sheet,
      backdrop,
      sheetMascot,
      brandM,
      dShared,
      dOwn,
      count,
      PALETTE,
      setName(s, focus, t) {
        text(nameText, s);
        css(namePh, { display: s ? 'none' : '' });
        css(caret, { display: focus ? '' : 'none', opacity: focus && (Math.floor(t * 1.9) % 2 === 0 || s.length && t % 1 < 0.6) ? '1' : '0' });
        cls(nameIn, 'focus', focus);
      },
    };
  }

  window.FlockUI = { I, Mascot, Island, Settings, PALETTE, tones, mix, INK, CLAUDE_ORANGE, MOVES, textWidth, mascotState };
})();
