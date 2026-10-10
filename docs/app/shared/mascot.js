// Flock's mascot: a little block with an antenna, one per account, in the
// account's colour. Soft vector shapes: a gently shaded body, rounded eyes, an
// antenna whose tip lights up when the account needs you, and two feet.
// States (class on the <svg>): awake, asleep, launching (walks on the spot),
// alert (antenna signals) and error (its last launch failed).
// Moving between states plays a one-off move (waking up, dozing off, ready,
// startled, a shudder); awake mascots fidget now and then; a poke gets one of
// a few reactions.
(function () {
  const EYE = '#141413';
  const CLAUDE_ORANGE = '#D97757';
  const INK = '#F5F6F8'; // Flock's own colour, when the mascot stands for no account
  const STATES = ['awake', 'asleep', 'launching', 'alert', 'error'];

  // How long each one-off move runs (ms); the CSS keyframes match.
  const MOVES = {
    // between states
    wake: 820,
    doze: 1250,
    ready: 780,
    startle: 540,
    shudder: 640,
    // fidgets
    glance: 1900,
    twitch: 720,
    blink2: 560,
    stretch: 1050,
    // pokes
    jump: 560,
    squish: 620,
    twirl: 900,
    // a new account taking the stage
    enter: 460,
  };
  const FIDGETS = ['glance', 'twitch', 'blink2', 'stretch'];
  const POKES = ['jump', 'squish', 'twirl', 'glance'];
  const FIDGET_REST = 9000; // ms a mascot waits before it fidgets again

  const reduced = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };

  function mix(hex, to, t) {
    const a = parseInt(hex.slice(1), 16);
    const b = parseInt(to.slice(1), 16);
    const ch = (s) => Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t);
    return `#${((1 << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).slice(1)}`;
  }

  /** The colours one account's mascot is drawn with. */
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

  /** The mascot as SVG markup (viewBox 40×40). */
  function svg(color, opts = {}) {
    const t = tones(color);
    const id = `fm${++uid}`;
    // Each mascot runs its loops at its own phase, so a row of them never blinks in step.
    const phase = (-Math.random() * 8).toFixed(2);
    const shadow = opts.shadow
      ? `<ellipse class="shadow" cx="20" cy="37" rx="12.5" ry="1.7" fill="url(#${id}s)"/>`
      : '';
    return `<svg class="mascot awake" viewBox="0 0 40 40" aria-hidden="true" style="--m-d:${phase}s">
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

  function svgOf(target) {
    if (!target) return null;
    if (target.matches && target.matches('svg.mascot')) return target;
    return target.querySelector ? target.querySelector('svg.mascot') : null;
  }

  /** A <span> holding a mascot; `state` is awake | asleep | launching | alert | error. */
  function create(color, state, opts) {
    const wrap = document.createElement('span');
    wrap.className = 'mascot-wrap';
    wrap.dataset.color = color;
    wrap.dataset.shadow = opts && opts.shadow ? '1' : '';
    wrap.innerHTML = svg(color, opts);
    setState(wrap, state || 'awake');
    startFidgets();
    return wrap;
  }

  /** The move that marks going from one state to another, if any. */
  function moveBetween(from, to) {
    if (!from || from === to) return null;
    const sleeping = from === 'asleep' || from === 'error';
    if (to === 'asleep') return from === 'error' ? null : 'doze';
    if (to === 'error') return 'shudder';
    if (to === 'alert') return sleeping ? 'wake' : 'startle';
    if (sleeping) return 'wake';
    if (to === 'awake') return 'ready'; // its window opened, or it got signed in
    return null;
  }

  /** Sets the state; a real change plays its move unless `opts.quiet` (a different account took its place). */
  function setState(wrap, state, opts) {
    const el = svgOf(wrap);
    if (!el || el.dataset.state === state) return;
    const from = el.dataset.state;
    el.classList.remove(...STATES);
    el.classList.add(state);
    el.dataset.state = state;
    if (opts && opts.quiet) {
      stop(el);
      return;
    }
    const move = moveBetween(from, state);
    if (move) play(el, move);
  }

  /** Redraws in a new colour, only when the colour really changed. */
  function recolor(wrap, color) {
    if (!wrap || wrap.dataset.color === color) return;
    const old = svgOf(wrap);
    const state = old ? old.dataset.state : 'awake';
    wrap.innerHTML = svg(color, { shadow: wrap.dataset.shadow === '1' });
    wrap.dataset.color = color;
    setState(wrap, state || 'awake');
  }

  /** Eyes follow the pointer: dx, dy in -1…1. */
  function look(wrap, dx, dy) {
    const g = wrap && wrap.querySelector('.look');
    if (!g) return;
    const x = Math.max(-1, Math.min(1, dx)) * 1.8;
    const y = Math.max(-1, Math.min(1, dy)) * 1.2;
    g.style.transform = `translate(${x}px, ${y}px)`;
  }

  /** Plays a one-off move (a key of MOVES); it takes over from the loop until it ends. */
  function play(target, move) {
    const el = svgOf(target);
    if (!el || !MOVES[move] || reduced.matches) return;
    stop(el);
    void el.getBoundingClientRect(); // the same move again starts over
    el.classList.add(`mv-${move}`);
    el._move = move;
    el._moveT = setTimeout(() => stop(el), MOVES[move]);
  }

  function stop(el) {
    clearTimeout(el._moveT);
    if (el._move) el.classList.remove(`mv-${el._move}`);
    el._move = null;
  }

  /** One-off jump (opening an account). */
  function hop(wrap) {
    play(wrap, 'jump');
  }

  /** A click on the mascot: one of a few reactions, never the same twice running. */
  function poke(wrap) {
    const el = svgOf(wrap);
    if (!el) return;
    const options = POKES.filter((m) => m !== el._lastPoke);
    const move = options[Math.floor(Math.random() * options.length)];
    el._lastPoke = move;
    play(el, move);
  }

  // ── Fidgets ────────────────────────────────────────────────────────────────
  // Every few seconds one awake mascot on screen glances around, twitches its
  // antenna, blinks twice or stretches. Bigger mascots are picked more often;
  // mascots inside [data-calm] (the compact island) keep still.

  let fidgetT = 0;

  function startFidgets() {
    if (fidgetT) return;
    const next = () => {
      fidgetT = setTimeout(() => {
        fidget();
        next();
      }, 2600 + Math.random() * 4000);
    };
    next();
  }

  function visible(el) {
    if (el.checkVisibility) return el.checkVisibility({ opacityProperty: true, visibilityProperty: true });
    return el.getClientRects().length > 0;
  }

  function fidget() {
    if (reduced.matches || document.hidden) return;
    const now = Date.now();
    const pool = [];
    let total = 0;
    for (const el of document.querySelectorAll('svg.mascot.awake')) {
      if (el._move || now - (el._fidgetAt || 0) < FIDGET_REST || el.closest('[data-calm]')) continue;
      const w = el.getBoundingClientRect().width;
      if (w < 18 || !visible(el)) continue;
      pool.push([el, w]);
      total += w;
    }
    let pick = Math.random() * total;
    for (const [el, w] of pool) {
      pick -= w;
      if (pick > 0) continue;
      el._fidgetAt = now;
      play(el, FIDGETS[Math.floor(Math.random() * FIDGETS.length)]);
      return;
    }
  }

  window.FlockMascot = { CLAUDE_ORANGE, INK, tones, svg, create, setState, recolor, look, play, hop, poke };
})();
