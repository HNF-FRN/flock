// The world around Flock: a Windows desktop seen through a camera, app
// windows (stand-ins for Claude Desktop — no Anthropic artwork, only the
// title Flock gives them), the pointer, the taskbar, keycaps and the film's
// typography.
(function () {
  'use strict';
  const F = window.Film;
  const { h, css, cls, text, E, clamp, lerp, prog, tween, rgba, track } = F;

  // ── Desktop + camera ─────────────────────────────────────────────────────

  /**
   * A 1920×1080 desktop on a "screen", seen through a camera.
   * cam = { x, y, zoom, rx, ry, rz, radius }  (x, y: desktop point at frame centre)
   */
  function Desktop(opts = {}) {
    const stage = h('div', { class: 'stage' });
    const screen = h('div', { class: 'screen' });
    const desk = h('div', { class: 'desk' });
    const wall = h('div', { class: 'wall' });
    const windows = h('div', { class: 'layer layer-windows' });
    const taskbarLayer = h('div', { class: 'layer layer-taskbar' });
    const islandLayer = h('div', { class: 'layer layer-island' });
    const overlay = h('div', { class: 'layer layer-overlay' });
    const pointer = h('div', { class: 'layer layer-pointer' });
    desk.append(wall, windows, taskbarLayer, islandLayer, overlay, pointer);
    screen.append(desk);
    stage.append(screen);
    if (opts.wall) css(wall, { background: opts.wall });

    let cam = { x: 960, y: 540, zoom: 1, rx: 0, ry: 0, rz: 0, radius: 0 };
    return {
      stage,
      screen,
      desk,
      wall,
      windows,
      taskbarLayer,
      islandLayer,
      overlay,
      pointer,
      get cam() {
        return cam;
      },
      camera(c) {
        cam = { x: 960, y: 540, zoom: 1, rx: 0, ry: 0, rz: 0, radius: 0, ...c };
        css(screen, {
          transform: `translate(960px, 540px) rotateX(${cam.rx.toFixed(3)}deg) rotateY(${cam.ry.toFixed(3)}deg) rotateZ(${cam.rz.toFixed(3)}deg) scale(${cam.zoom.toFixed(5)}) translate(${(-cam.x).toFixed(3)}px, ${(-cam.y).toFixed(3)}px)`,
          borderRadius: `${cam.radius.toFixed(2)}px`,
        });
      },
      /** Desktop point → frame point (2-D cameras only). */
      toFrame(x, y) {
        return [960 + (x - cam.x) * cam.zoom, 540 + (y - cam.y) * cam.zoom];
      },
      /** Element (fx, fy) point in desktop px, measured through the current camera (2-D only). */
      pointOf(el, fx = 0.5, fy = 0.5) {
        const r = el.getBoundingClientRect();
        const d = desk.getBoundingClientRect();
        const z = d.width / 1920;
        return [(r.left - d.left + r.width * fx) / z, (r.top - d.top + r.height * fy) / z];
      },
    };
  }

  // ── Wallpaper ────────────────────────────────────────────────────────────
  // After the design-preview backdrop in island.css (purple and teal light on graphite).
  const WALL = [
    'radial-gradient(1500px 820px at 18% -6%, #3b2f63 0%, rgba(59,47,99,0.55) 32%, transparent 64%)',
    'radial-gradient(1300px 950px at 92% 104%, #1d4a5c 0%, rgba(29,74,92,0.5) 34%, transparent 66%)',
    'radial-gradient(900px 600px at 70% 30%, rgba(80,70,140,0.18), transparent 70%)',
    '#202329',
  ].join(', ');

  // ── App window (a stand-in for a Claude Desktop window) ──────────────────

  const CTRL = {
    min: '<svg viewBox="0 0 10 10" width="10" height="10"><path d="M0.5 5h9" stroke="currentColor" stroke-width="1"/></svg>',
    max: '<svg viewBox="0 0 10 10" width="10" height="10"><rect x="0.5" y="0.5" width="9" height="9" rx="1.5" fill="none" stroke="currentColor" stroke-width="1"/></svg>',
    close: '<svg viewBox="0 0 10 10" width="10" height="10"><path d="M0.6 0.6l8.8 8.8M9.4 0.6L0.6 9.4" stroke="currentColor" stroke-width="1"/></svg>',
  };

  /**
   * A chat/code app window, Windows 11 frame. Flock's marks on it: the title
   * ("Work — Claude") and the accent edge along its top (edge.css).
   *   o = { title, color, x, y, w, h, content: { side: [..], heading, ask, answer: [..], code: [..] } }
   */
  function AppWindow(o) {
    const root = h('div', { class: 'appwin' });
    const title = h('span', { class: 'aw-title-text', text: o.title || 'Claude' });
    const ctrls = h('div', { class: 'aw-ctrls' },
      h('span', { html: CTRL.min }), h('span', { html: CTRL.max }), h('span', { class: 'x', html: CTRL.close }));
    const bar = h('div', { class: 'aw-bar' }, title, ctrls);
    // content: one or more variants (a session switch crossfades between them)
    const variants = (o.variants || [o.content || {}]).map((c) => {
      const side = h('div', { class: 'aw-side-list' },
        ...(c.side || []).map((s2, i) => h('div', { class: `aw-item${i === 0 ? ' on' : ''}`, text: s2 })));
      const convo = h('div', { class: 'aw-convo' },
        h('div', { class: 'aw-head', text: c.heading || '' }),
        c.ask ? h('div', { class: 'aw-ask', text: c.ask }) : null,
        h('div', { class: 'aw-answer' }, ...(c.answer || []).map((p) => h('p', { text: p }))),
        c.code ? h('pre', { class: 'aw-code', html: c.code.join('\n') }) : null,
        ...(c.after || []).map((p) => h('p', { class: 'aw-after', text: p })));
      if (c.empty) convo.append(h('div', { class: 'aw-empty' }, h('b', { text: c.empty }), c.emptySub ? h('span', { text: c.emptySub }) : null));
      return { c, side, convo };
    });
    const side = h('div', { class: 'aw-side' },
      h('div', { class: 'aw-new' }, h('i', { class: 'aw-plus' }), h('span', { text: 'New session' })),
      h('div', { class: 'aw-label', text: 'Recents' }),
      h('div', { class: 'aw-side-stack' }, ...variants.map((v) => v.side)),
      h('div', { class: 'aw-me' }, h('i', { class: 'aw-av', text: (o.initial || 'A') }), h('span', { text: o.me || 'You' })));
    const convo = h('div', { class: 'aw-convo-stack' }, ...variants.map((v) => v.convo));
    const placeholder = h('span', { text: (o.content && o.content.placeholder) || 'Reply…' });
    const caret = h('i', { class: 'aw-caret' });
    const composer = h('div', { class: 'aw-composer' }, caret, placeholder, h('i', { class: 'aw-send' }));
    const main = h('div', { class: 'aw-main' }, convo, composer);
    const body = h('div', { class: 'aw-body' }, side, main);
    const frame = h('div', { class: 'aw-frame' }, bar, body);
    // Flock's accent edge: a slim line on the window's own top border, a glow when focused.
    const eGlow = h('div', { class: 'aw-edge-glow' });
    const eLine = h('div', { class: 'aw-edge-line' });
    const edge = h('div', { class: 'aw-edge' }, eGlow, eLine);
    root.append(frame, edge);
    if (o.color) root.style.setProperty('--c', o.color);
    const api = {
      el: root,
      frame,
      bar,
      title,
      side,
      main,
      convo,
      composer,
      edge,
      x: o.x || 0,
      y: o.y || 0,
      w: o.w || 1100,
      h: o.h || 700,
      place(x, y, w, hh) {
        api.x = x;
        api.y = y;
        api.w = w;
        api.h = hh;
        css(root, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${hh}px` });
      },
      /** edge: 0 hidden · 0.7 unfocused · 1 focused (+glow), pulse 0..1 = brightness beat on focus */
      setEdge(on, focus, pulse = 0) {
        css(edge, { opacity: on.toFixed(3) });
        css(eLine, { opacity: lerp(0.7, 1, focus).toFixed(3), filter: pulse > 0 ? `brightness(${(1 + 0.6 * pulse).toFixed(3)}) saturate(${(1 + 0.2 * pulse).toFixed(3)})` : 'none' });
        css(eGlow, { opacity: focus.toFixed(3), filter: pulse > 0 ? `brightness(${(1 + 0.6 * pulse).toFixed(3)})` : 'none' });
      },
      setTitle(s) {
        text(title, s);
      },
      /** Switch to content variant i (k = 0..1 of the way, from `from`): a fade-through, never two texts at once. */
      showVariant(i, k = 1, from = 0) {
        const outK = clamp(k / 0.42);
        const inK = E.out(clamp((k - 0.48) / 0.52));
        variants.forEach((v, j) => {
          let op = 0;
          let y = 0;
          if (j === i && (i !== from || k >= 0.48)) {
            op = i === from ? 1 : inK;
            y = (1 - inK) * 8;
          } else if (j === from && i !== from) op = 1 - outK;
          css(v.convo, { opacity: op.toFixed(3), display: op > 0.001 ? '' : 'none', transform: `translateY(${y.toFixed(2)}px)` });
          css(v.side, { opacity: op.toFixed(3), display: op > 0.001 ? '' : 'none' });
        });
      },
      /** composer: focused caret (blinking) and placeholder */
      setComposer(focus, t, ph) {
        if (ph != null) text(placeholder, ph);
        css(caret, { display: focus ? '' : 'none', opacity: focus && Math.floor(t * 1.9) % 2 === 0 ? '1' : '0' });
        cls(composer, 'focus', focus);
      },
      variants,
    };
    api.place(api.x, api.y, api.w, api.h);
    api.showVariant(0);
    return api;
  }

  // ── Pointer ──────────────────────────────────────────────────────────────

  // Windows arrow, drawn at 1.5× so it reads in a 1080p film.
  const ARROW = '<svg viewBox="0 0 24 34" width="24" height="34"><path d="M1.5 1.5 L1.5 26.2 L7.3 20.6 L11.2 29.6 L15.3 27.8 L11.4 19 L19.4 19 Z" fill="#fff" stroke="#0b0b0c" stroke-width="1.6" stroke-linejoin="round"/></svg>';

  /**
   * The pointer: a path of moves, clicks and presses.
   *   p = Pointer([x, y])
   *   p.to(t0, dur, [x, y], { arc })   move, starting at t0
   *   p.click(t) · p.down(t0, t1) (held, e.g. a drag)
   */
  function Pointer(start, o = {}) {
    const el = h('div', { class: 'pointer', html: ARROW });
    const ripple = h('div', { class: 'pointer-ripple' });
    // a ring that fills while the pointer rests (e.g. on the top edge, to call the island back)
    const dwellRing = h('div', { class: 'pointer-dwell', html: '<svg viewBox="0 0 48 48" width="48" height="48"><circle class="track" cx="24" cy="24" r="19"/><circle class="fill" cx="24" cy="24" r="19"/></svg>' });
    const dwellLabel = h('div', { class: 'pointer-dwell-label' });
    const wrap = h('div', { class: 'pointer-wrap' }, ripple, dwellRing, dwellLabel, el);
    const moves = [];
    const clicks = [];
    const holds = [];
    const dwells = [];
    let last = start.slice();
    const api = {
      el: wrap,
      scale: o.scale || 1.5,
      to(t0, dur, p, opt = {}) {
        moves.push({ t0, t1: t0 + dur, a: last.slice(), b: p.slice(), arc: opt.arc ?? 0.1, ease: opt.ease || (opt.flick === false ? E.hand : E.flick) });
        moves.sort((m1, m2) => m1.t0 - m2.t0);
        last = p.slice();
        return api;
      },
      click(t) {
        clicks.push(t);
        return api;
      },
      down(t0, t1) {
        holds.push([t0, t1]);
        return api;
      },
      /** A resting pointer: a ring fills from t0 to t1, with an optional hint beside it. */
      dwell(t0, t1, label) {
        dwells.push([t0, t1, label]);
        return api;
      },
      pos(t) {
        let p = start;
        for (const m of moves) {
          if (t >= m.t1) {
            p = m.b;
            continue;
          }
          if (t >= m.t0) {
            const k = m.ease(prog(t, m.t0, m.t1));
            // a gentle arc: quadratic bezier bowed to one side
            const mx = (m.a[0] + m.b[0]) / 2;
            const my = (m.a[1] + m.b[1]) / 2;
            const dx = m.b[0] - m.a[0];
            const dy = m.b[1] - m.a[1];
            const cx = mx - dy * m.arc;
            const cy = my + dx * m.arc;
            const u = 1 - k;
            return [u * u * m.a[0] + 2 * u * k * cx + k * k * m.b[0], u * u * m.a[1] + 2 * u * k * cy + k * k * m.b[1]];
          }
          break;
        }
        return p;
      },
      pressAt(t) {
        let p = 0;
        for (const c of clicks) {
          if (t >= c - 0.05 && t < c + 0.2) p = Math.max(p, t < c ? prog(t, c - 0.05, c) : 1 - E.easeOut(prog(t, c, c + 0.2)));
        }
        for (const [a, b] of holds) if (t >= a && t < b + 0.15) p = Math.max(p, t < b ? E.easeOut(prog(t, a, a + 0.06)) : 1 - prog(t, b, b + 0.15));
        return p;
      },
      clicks,
      sync(t, visible = 1) {
        const [x, y] = api.pos(t);
        const press = api.pressAt(t);
        css(wrap, { transform: `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px)`, opacity: visible.toFixed(3) });
        css(el, { transform: `scale(${(api.scale * (1 - 0.12 * press)).toFixed(4)})` });
        // ripple from the most recent click: grows out-cubic, fades linearly (decoupled, input-trigger-moves A),
        // and stays where the click happened even when the pointer moves on
        let rp = null;
        for (const c of clicks) if (t >= c && t < c + 0.42) rp = c;
        if (rp == null) css(ripple, { opacity: '0' });
        else {
          const [cx, cy] = api.pos(rp);
          const r = lerp(5, 38, E.outCubic(prog(t, rp, rp + 0.34)));
          const op = 0.7 * (1 - prog(t, rp, rp + 0.42));
          css(ripple, { opacity: op.toFixed(3), width: `${(r * 2).toFixed(2)}px`, height: `${(r * 2).toFixed(2)}px`, transform: `translate(${(cx - x - r).toFixed(2)}px, ${(cy - y - r).toFixed(2)}px)` });
        }
        // dwell ring + hint
        let dw = null;
        for (const d2 of dwells) if (t >= d2[0] - 0.15 && t < d2[1] + 0.35) dw = d2;
        if (!dw) {
          css(dwellRing, { opacity: '0' });
          css(dwellLabel, { opacity: '0' });
        } else {
          const [d0, d1, label] = dw;
          const fill = clamp(prog(t, d0, d1));
          const vis = E.out(prog(t, d0 - 0.15, d0 + 0.05)) * (1 - E.easeIn(prog(t, d1 - 0.02, d1 + 0.14)));
          const lab = E.out(prog(t, d0 - 0.15, d0 + 0.05)) * (1 - E.easeIn(prog(t, d1 - 0.12, d1 + 0.01)));
          css(dwellRing, { opacity: vis.toFixed(3), '--fill': fill.toFixed(4) });
          css(dwellLabel, { opacity: lab.toFixed(3) });
          if (label) text(dwellLabel, label);
        }
      },
    };
    return api;
  }

  // ── Taskbar (Windows 11, drawn generically) ─────────────────────────────

  function Taskbar(o = {}) {
    const el = h('div', { class: 'taskbar' });
    const center = h('div', { class: 'tb-center' });
    const glyph = (cls2, inner = '') => h('div', { class: `tb-btn ${cls2}`, html: inner });
    center.append(
      glyph('tb-start', '<i></i><i></i><i></i><i></i>'),
      glyph('tb-search', '<svg viewBox="0 0 16 16" width="17" height="17"><circle cx="7" cy="7" r="4.6" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="m10.4 10.4 3.4 3.4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>'),
      glyph('tb-files', '<i></i>'),
      glyph('tb-browser', '<i></i>'),
      glyph('tb-code', '<i></i>'));
    const accts = h('div', { class: 'tb-accts' });
    center.append(accts);
    const tray = h('div', { class: 'tb-tray' });
    const flockTray = h('span', { class: 'tb-flock' });
    const clock = h('div', { class: 'tb-clock', html: `<b>${o.time || '10:24'}</b><span>${o.date || '08/10/2026'}</span>` });
    tray.append(h('span', { class: 'tb-chev', html: '<svg viewBox="0 0 10 10" width="10" height="10"><path d="M2 6.5 5 3.5l3 3" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>' }), flockTray, h('span', { class: 'tb-wifi' }), h('span', { class: 'tb-vol' }), clock);
    el.append(center, tray);
    const buttons = {};
    return {
      el,
      flockTray,
      accts,
      /** A taskbar button per account (Flock gives each its own): a tile in the account's colour. */
      addAccount(id, color, initial) {
        const b = h('div', { class: 'tb-btn tb-acct' }, h('i', { class: 'tb-acct-tile', text: initial }), h('b', { class: 'tb-run' }));
        b.style.setProperty('--c', color);
        accts.append(b);
        buttons[id] = b;
        return b;
      },
      buttons,
    };
  }

  // ── Keycaps ──────────────────────────────────────────────────────────────

  function Keycap(label, o = {}) {
    const el = h('div', { class: `keycap-3d${o.wide ? ' wide' : ''}` }, h('span', { class: 'kc-top', text: label }));
    return {
      el,
      /** press 0..1 */
      set(press, lit = 0) {
        css(el, { '--press': press.toFixed(3), '--lit': lit.toFixed(3) });
      },
    };
  }

  // ── Typography ───────────────────────────────────────────────────────────

  /**
   * A line of words that arrive one by one (rise + unblur), the film's text voice.
   *   parts: ['Every', ['Claude', '#38BDF8'], 'account'] — a word may carry a colour
   */
  function Words(parts, o = {}) {
    const el = h('div', { class: `words ${o.class || ''}` });
    const words = parts.map((p, i) => {
      const [w, color, extraCls] = Array.isArray(p) ? p : [p];
      const span = h('span', { class: `w ${extraCls || ''}`, text: w });
      if (color) css(span, { color });
      el.append(span);
      if (i < parts.length - 1) el.append(document.createTextNode(' '));
      return span;
    });
    return {
      el,
      words,
      /** k-th word arrives at start + k*stagger over dur; leaves (all together) at out. */
      sync(t, start, { stagger = 0.07, dur = 0.75, rise = 0.32, blur = 10, out = Infinity, outDur = 0.35, outRise = -0.18 } = {}) {
        words.forEach((sp, k) => {
          const a = E.out(prog(t, start + k * stagger, start + k * stagger + dur));
          const b = E.easeIn(prog(t, out, out + outDur));
          const op = a * (1 - b);
          const y = (1 - a) * rise + b * outRise;
          const bl = (1 - a) * blur + b * blur * 0.6;
          css(sp, { opacity: op.toFixed(3), transform: `translateY(${y.toFixed(3)}em)`, filter: bl > 0.05 ? `blur(${bl.toFixed(2)}px)` : 'none' });
        });
      },
    };
  }

  /** Lower-left caption: a small kicker and a headline on a dark glass plate, so it reads over any UI. */
  function Caption(kicker, parts, o = {}) {
    const k = h('div', { class: 'cap-kicker' }, h('i', { class: 'cap-dot' }), h('span', { text: kicker }));
    if (o.color) k.style.setProperty('--c', o.color);
    const line = Words(parts, { class: 'cap-title' });
    const plate = h('div', { class: 'cap-plate' });
    const el = h('div', { class: `caption ${o.class || ''}` }, plate, k, line.el);
    const scrim = h('div', { class: 'cap-scrim' });
    const wrap = h('div', { class: 'caption-wrap' }, scrim, el);
    return {
      el: wrap,
      sync(t, start, end) {
        const inK = E.out(prog(t, start, start + 0.6));
        const outK = E.easeIn(prog(t, end - 0.35, end));
        css(k, { opacity: (inK * (1 - outK)).toFixed(3), transform: `translateY(${((1 - inK) * 10 - outK * 6).toFixed(2)}px)` });
        line.sync(t, start + 0.12, { out: end - 0.35, stagger: 0.055, dur: 0.7 });
        // the plate opens from the left with the words, and closes the same way
        const open = E.out(prog(t, start - 0.05, start + 0.55));
        const close = E.easeIn(prog(t, end - 0.35, end + 0.05));
        const reveal = open * (1 - close);
        css(plate, { opacity: Math.min(1, reveal * 2.5).toFixed(3), clipPath: `inset(0 ${((1 - reveal) * 100).toFixed(2)}% 0 0 round 22px)` });
        css(scrim, { opacity: (Math.min(E.out(prog(t, start - 0.2, start + 0.5)), 1 - E.easeIn(prog(t, end - 0.3, end + 0.2)))).toFixed(3) });
      },
    };
  }

  // ── Camera track ─────────────────────────────────────────────────────────

  const CAM0 = { x: 960, y: 540, zoom: 1, rx: 0, ry: 0, rz: 0, radius: 0 };
  /** keys: [[t, { x, y, zoom, rx, ry, rz, radius }, ease?], …] — eases toward each key from the previous one. */
  function camAt(t, keys) {
    const full = keys.map(([kt, v, e]) => [kt, { ...CAM0, ...v }, e]);
    if (t <= full[0][0]) return full[0][1];
    for (let i = 0; i < full.length - 1; i++) {
      const [t0, a, ease] = full[i];
      const [t1, b] = full[i + 1];
      if (t < t1) {
        const k = (ease || E.cam)(prog(t, t0, t1));
        // zoom interpolates geometrically so pushes feel even
        const z = Math.exp(lerp(Math.log(a.zoom), Math.log(b.zoom), k));
        return { x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k), zoom: z, rx: lerp(a.rx, b.rx, k), ry: lerp(a.ry, b.ry, k), rz: lerp(a.rz, b.rz, k), radius: lerp(a.radius, b.radius, k) };
      }
    }
    return full[full.length - 1][1];
  }

  // ── Callout (annotation with a drawn leader line) ────────────────────────

  function Callout(title, sub, o = {}) {
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('class', 'callout-svg');
    svg.setAttribute('width', '1920');
    svg.setAttribute('height', '1080');
    const line = document.createElementNS(svgNS, 'path');
    line.setAttribute('class', 'callout-line');
    const ring = document.createElementNS(svgNS, 'circle');
    ring.setAttribute('class', 'callout-ring');
    const dot = document.createElementNS(svgNS, 'circle');
    dot.setAttribute('class', 'callout-dot');
    svg.append(line, ring, dot);
    const label = h('div', { class: `callout-label${o.inline ? ' inline' : ''}` }, h('b', { text: title }), sub ? h('span', { text: sub }) : null);
    if (o.color) {
      label.style.setProperty('--c', o.color);
      svg.style.setProperty('--c', o.color);
    }
    const el = h('div', { class: 'callout' }, svg, label);
    return {
      el,
      /** anchor and label point in frame px; k = 0..1 arriving, out = 0..1 leaving */
      sync(anchor, to, k, out = 0) {
        const vis = k * (1 - out);
        css(el, { display: vis > 0.002 ? '' : 'none' });
        if (vis <= 0.002) return;
        const [ax, ay] = anchor;
        const [lx, ly] = to;
        // an elbow: straight up/down from the anchor, then across to the label
        line.setAttribute('d', `M${ax.toFixed(1)} ${ay.toFixed(1)} L${ax.toFixed(1)} ${ly.toFixed(1)} L${lx.toFixed(1)} ${ly.toFixed(1)}`);
        const len = Math.abs(ly - ay) + Math.abs(lx - ax);
        const dk = E.out(prog(k, 0.1, 0.65));
        line.setAttribute('stroke-dasharray', `${len.toFixed(1)} ${(len + 2).toFixed(1)}`);
        line.setAttribute('stroke-dashoffset', ((1 - dk) * len).toFixed(1));
        const fade = (1 - out).toFixed(3);
        css(line, { opacity: fade });
        const rk = E.back(prog(k, 0, 0.35));
        for (const [c2, r] of [[ring, 7], [dot, 3.5]]) {
          c2.setAttribute('cx', ax.toFixed(1));
          c2.setAttribute('cy', ay.toFixed(1));
          c2.setAttribute('r', (r * rk).toFixed(2));
          css(c2, { opacity: fade });
        }
        const lk = E.out(prog(k, 0.45, 1));
        const right = lx >= ax;
        css(label, {
          transform: `translate(${lx.toFixed(1)}px, ${ly.toFixed(1)}px) translate(${right ? '14px' : 'calc(-100% - 14px)'}, -50%) translateX(${((1 - lk) * (right ? -10 : 10)).toFixed(2)}px)`,
          opacity: (lk * (1 - out)).toFixed(3),
          filter: lk < 0.99 ? `blur(${((1 - lk) * 6).toFixed(2)}px)` : 'none',
        });
      },
    };
  }

  // ── Alt+Tab (the Windows task switcher, drawn generically) ───────────────

  function AltTab(items) {
    // items: [{ title, color, initial, node }] — node: a window element cloned as the thumbnail
    const row = h('div', { class: 'at-row' });
    const cards = items.map((it) => {
      const clone = it.node.cloneNode(true);
      clone.classList.add('at-clone');
      clone.style.left = '0px';
      clone.style.top = '0px';
      const thumb = h('div', { class: 'at-thumb' }, clone);
      const icon = h('i', { class: 'at-icon', text: it.initial });
      icon.style.setProperty('--c', it.color);
      const card = h('div', { class: 'at-card' }, h('div', { class: 'at-title' }, icon, h('span', { text: it.title })), thumb);
      row.append(card);
      return { card, clone };
    });
    const panel = h('div', { class: 'at-panel' }, row);
    const el = h('div', { class: 'alttab' }, panel);
    return {
      el,
      cards,
      /** k: 0..1 shown; sel: index selected */
      sync(k, sel) {
        css(el, { display: k > 0.002 ? '' : 'none', opacity: k.toFixed(3) });
        css(panel, { transform: `translate(-50%, -50%) scale(${lerp(0.965, 1, E.out(k)).toFixed(4)})` });
        cards.forEach((c, i) => cls(c.card, 'sel', i === sel));
      },
    };
  }

  /** A slow float on top of a camera — about a 9 s breath, a few px — so holds are never dead still. */
  function drift(cam, t, k = 1) {
    return {
      ...cam,
      zoom: cam.zoom * (1 + 0.009 * k * Math.sin(t * 0.69 + 0.4)),
      x: cam.x + 3.2 * k * F.noise(t * 0.22, 7) / cam.zoom,
      y: cam.y + 2.4 * k * F.noise(t * 0.19, 11) / cam.zoom,
    };
  }

  window.Desk = { Desktop, WALL, AppWindow, Pointer, Taskbar, Keycap, Words, Caption, camAt, Callout, AltTab, drift };
})();
