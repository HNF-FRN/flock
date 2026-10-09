// The film's own motion engine (no framework): time, easing, springs,
// keyframe tracks, seeded noise, the scene timeline and the sound cue sheet.
// Everything on screen is a pure function of the film time `t` (seconds), so
// any frame can be rendered on its own, in any order, and comes out the same.
(function () {
  'use strict';

  // ── Numbers ──────────────────────────────────────────────────────────────

  const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, k) => a + (b - a) * k;
  /** 0→1 as t goes a→b (clamped). */
  const prog = (t, a, b) => (b === a ? (t >= b ? 1 : 0) : clamp((t - a) / (b - a)));
  const smooth = (k) => k * k * (3 - 2 * k);

  // ── Easing ───────────────────────────────────────────────────────────────

  /** A CSS cubic-bezier(x1, y1, x2, y2) timing function, solved like the browser does. */
  function bezier(x1, y1, x2, y2) {
    const cx = 3 * x1;
    const bx = 3 * (x2 - x1) - cx;
    const ax = 1 - cx - bx;
    const cy = 3 * y1;
    const by = 3 * (y2 - y1) - cy;
    const ay = 1 - cy - by;
    const sx = (s) => ((ax * s + bx) * s + cx) * s;
    const sy = (s) => ((ay * s + by) * s + cy) * s;
    const dsx = (s) => (3 * ax * s + 2 * bx) * s + cx;
    const fn = (t) => {
      if (t <= 0) return 0;
      if (t >= 1) return 1;
      let s = t;
      for (let i = 0; i < 8; i++) {
        const e = sx(s) - t;
        if (Math.abs(e) < 1e-7) return sy(s);
        const d = dsx(s);
        if (Math.abs(d) < 1e-6) break;
        s -= e / d;
      }
      let lo = 0;
      let hi = 1;
      s = t;
      for (let i = 0; i < 50; i++) {
        const v = sx(s);
        if (Math.abs(v - t) < 1e-7) break;
        if (v < t) lo = s;
        else hi = s;
        s = (lo + hi) / 2;
      }
      return sy(s);
    };
    fn.css = `cubic-bezier(${x1}, ${y1}, ${x2}, ${y2})`;
    return fn;
  }

  const E = {
    linear: (k) => k,
    // CSS keywords
    ease: bezier(0.25, 0.1, 0.25, 1),
    easeIn: bezier(0.42, 0, 1, 1),
    easeOut: bezier(0, 0, 0.58, 1),
    easeInOut: bezier(0.42, 0, 0.58, 1),
    // Flock's own spring (tokens.css --spring): a small overshoot, then settle.
    spring: bezier(0.3, 1.2, 0.4, 1),
    // The film's motion voice
    out: bezier(0.16, 1, 0.3, 1), // expo-out: text and UI arriving
    outSoft: bezier(0.25, 0.46, 0.45, 0.94),
    inOut: bezier(0.65, 0, 0.35, 1), // camera moves
    cam: bezier(0.45, 0, 0.15, 1), // camera: gentle start, long glide in
    hand: bezier(0.42, 0, 0.18, 1), // a hand moving a mouse: quick, then a long settle
    flick: bezier(0.42, 0, 0.16, 1.07), // …with a small wrist-flick past the target and back
    outCubic: bezier(0.33, 1, 0.68, 1),
    in: bezier(0.55, 0, 1, 0.45),
    inExpo: bezier(0.7, 0, 0.84, 0),
    back: bezier(0.34, 1.56, 0.64, 1),
  };

  /** Damped spring from 0 to 1 (physics, not a curve); `t` in seconds. */
  function spring(t, { stiffness = 170, damping = 26, mass = 1, velocity = 0 } = {}) {
    if (t <= 0) return 0;
    const w0 = Math.sqrt(stiffness / mass);
    const zeta = damping / (2 * Math.sqrt(stiffness * mass));
    if (zeta < 1) {
      const wd = w0 * Math.sqrt(1 - zeta * zeta);
      return 1 - Math.exp(-zeta * w0 * t) * (Math.cos(wd * t) + ((zeta * w0 - velocity) / wd) * Math.sin(wd * t));
    }
    return 1 - Math.exp(-w0 * t) * (1 + (w0 - velocity) * t);
  }

  /** Eased value from a→b while t goes t0→t1. */
  function tween(t, t0, t1, a, b, ease = E.out) {
    const k = ease(prog(t, t0, t1));
    if (Array.isArray(a)) return a.map((v, i) => lerp(v, b[i], k));
    return lerp(a, b, k);
  }

  /**
   * Keyframe track: keys = [[time, value, easeToNext?], ...] (sorted).
   * Values may be numbers or arrays of numbers. Holds the ends.
   */
  function track(t, keys) {
    if (t <= keys[0][0]) return keys[0][1];
    for (let i = 0; i < keys.length - 1; i++) {
      const [t0, v0, ease] = keys[i];
      const [t1, v1] = keys[i + 1];
      if (t < t1) {
        const k = (ease || E.inOut)(prog(t, t0, t1));
        if (Array.isArray(v0)) return v0.map((v, j) => lerp(v, v1[j], k));
        return lerp(v0, v1, k);
      }
    }
    return keys[keys.length - 1][1];
  }

  const mixVal = (a, b, k) => (Array.isArray(a) ? a.map((v, i) => lerp(v, b[i], k)) : lerp(a, b, k));

  /**
   * A CSS-style transition that re-targets: at each time in `events` the target
   * becomes targetAt(event) and the value glides there from wherever it was.
   */
  function transit(t, events, targetAt, dur, ease = E.ease) {
    let from = targetAt(-1e9);
    let to = from;
    let start = -1e9;
    for (const e of events) {
      if (e > t) break;
      const cur = mixVal(from, to, ease(prog(e, start, start + dur)));
      const next = targetAt(e);
      if (JSON.stringify(next) === JSON.stringify(to)) continue;
      from = cur;
      to = next;
      start = e;
    }
    return mixVal(from, to, ease(prog(t, start, start + dur)));
  }

  /** Value of a step timeline [[time, value], ...] at t (first value before the first time). */
  function at(t, list) {
    let v = list[0][1];
    for (const [ti, vi] of list) if (t >= ti) v = vi;
    return v;
  }

  /** Which step of a list of times we are on: index of the last time <= t (or -1). */
  function step(t, times) {
    let i = -1;
    for (let j = 0; j < times.length; j++) if (t >= times[j]) i = j;
    return i;
  }

  /** In/out envelope: 0 before a, rises over `inDur`, holds, falls over `outDur` to 0 at b. */
  function env(t, a, b, inDur = 0.3, outDur = 0.3, easeIn = E.out, easeOut = E.easeIn) {
    if (t < a || t > b) return 0;
    const i = inDur > 0 ? easeIn(prog(t, a, a + inDur)) : 1;
    const o = outDur > 0 ? 1 - easeOut(prog(t, b - outDur, b)) : 1;
    return Math.min(i, o);
  }

  // ── Colour ───────────────────────────────────────────────────────────────

  function rgb(hex) {
    const n = parseInt(hex.replace('#', ''), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgba(hex, a = 1) {
    const [r, g, b] = rgb(hex);
    return `rgba(${r}, ${g}, ${b}, ${+a.toFixed(4)})`;
  }
  function mixHex(a, b, k) {
    const x = rgb(a);
    const y = rgb(b);
    const c = x.map((v, i) => Math.round(lerp(v, y[i], k)));
    return `#${((1 << 24) | (c[0] << 16) | (c[1] << 8) | c[2]).toString(16).slice(1)}`;
  }

  // ── Deterministic randomness ─────────────────────────────────────────────

  function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hash(n, seed = 0) {
    let h = (n * 374761393 + seed * 668265263) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  /** Smooth 1-D value noise in [-1, 1]. */
  function noise(x, seed = 0) {
    const i = Math.floor(x);
    const f = x - i;
    const a = hash(i, seed) * 2 - 1;
    const b = hash(i + 1, seed) * 2 - 1;
    return lerp(a, b, smooth(f));
  }

  // ── DOM helpers ──────────────────────────────────────────────────────────

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'style' && typeof v === 'object') {
          for (const [sk, sv] of Object.entries(v)) {
            if (sk.startsWith('--')) el.style.setProperty(sk, sv); // custom properties need setProperty
            else el.style[sk] = sv;
          }
        }
        else if (k === 'html') el.innerHTML = v;
        else if (k === 'text') el.textContent = v;
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false) continue;
      el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }
  /** Sets only the style properties that changed (keeps per-frame work small). */
  function css(el, props) {
    const cache = el.__css || (el.__css = {});
    for (const k in props) {
      const v = props[k];
      if (cache[k] === v) continue;
      cache[k] = v;
      if (k.startsWith('--')) el.style.setProperty(k, v);
      else el.style[k] = v;
    }
  }
  function cls(el, name, on) {
    if (el.classList.contains(name) !== Boolean(on)) el.classList.toggle(name, Boolean(on));
  }
  function text(el, s) {
    if (el.__text !== s) {
      el.__text = s;
      el.textContent = s;
    }
  }
  function show(el, on) {
    css(el, { display: on ? '' : 'none' });
  }

  // ── Timeline ─────────────────────────────────────────────────────────────

  const scenes = [];
  const afterHooks = [];
  const cues = [];
  let filmEl = null;

  const Film = {
    fps: 60,
    width: 1920,
    height: 1080,
    duration: 0,
    t: 0,
    E,
    bezier,
    spring,
    tween,
    track,
    transit,
    at,
    step,
    env,
    clamp,
    lerp,
    prog,
    smooth,
    rgb,
    rgba,
    mixHex,
    mulberry32,
    hash,
    noise,
    h,
    css,
    cls,
    text,
    show,

    /** Registers a scene: { id, start, end, z?, build(el) -> ctx, update(local, ctx, t) }. */
    scene(def) {
      scenes.push(def);
      Film.duration = Math.max(Film.duration, def.end);
      return def;
    },
    /** Runs after every scene update (mascot clocks, cursor, grain). */
    after(fn) {
      afterHooks.push(fn);
    },
    /** A sound at film time t (seconds): { t, src, vol, dur?, fadeOut? }. */
    cue(t, src, vol = 0.5, opts = {}) {
      cues.push({ t: +t.toFixed(4), src, vol, ...opts });
    },
    cues: () => cues.slice().sort((a, b) => a.t - b.t),

    mount(root) {
      filmEl = root;
      scenes.sort((a, b) => (a.z || 0) - (b.z || 0));
      for (const s of scenes) {
        s.el = h('section', { class: `scene scene-${s.id}`, 'data-scene': s.id });
        s.el.style.zIndex = String(s.z || 0);
        root.appendChild(s.el);
        s.ctx = s.build ? s.build(s.el) : {};
        s.visible = null;
      }
    },

    seek(t) {
      Film.t = t;
      for (const s of scenes) {
        const on = t >= s.start && t < s.end;
        if (on !== s.visible) {
          s.visible = on;
          s.el.style.display = on ? '' : 'none';
        }
        if (on && s.update) s.update(t - s.start, s.ctx, t);
      }
      for (const fn of afterHooks) fn(t);
    },

    visible(id) {
      const s = scenes.find((x) => x.id === id);
      return Boolean(s && s.visible);
    },
    scenesList: () => scenes.map((s) => ({ id: s.id, start: s.start, end: s.end })),
  };

  window.Film = Film;
})();
