// S12 — the drop: a launch-style group photo (outro-group-photo-launch).
// The island drops in at the top, the five windows fan in behind, the flock
// lands on a stage, the name slams down, light sweeps, dust drifts. Hold. Out.
(function () {
  'use strict';
  const F = window.Film;
  const { h, css, E, prog, lerp, clamp, hash } = F;
  const { Mascot, Island, INK } = window.FlockUI;
  const D = window.Desk;
  const C = window.Cast;
  const { B, BAR } = C;

  const IDS = ['main', 'work', 'client', 'research', 'side'];
  const T = {
    start: BAR(48) - 0.05, // 88.75
    drop: BAR(48), // 88.80
    slam: BAR(48) + 0.05,
    line: B(194), // 89.73
    foot: B(196), // 90.65
    fadeOut: 94.1,
    end: 95.5,
  };
  C.T_FIN = T;
  // the windows behind: [x, y, rotY, z, w, h]
  const FAN = IDS.map((id, i) => ({ id, x: 960 + (i - 2) * 352, y: 330, ry: (2 - i) * 9, z: -380 - Math.abs(i - 2) * 60 }));
  const EASE_LAND = F.bezier(0.34, 1.4, 0.44, 1); // lands with a real overshoot (y1 > 1)

  F.scene({
    id: 'finale',
    start: T.start,
    end: T.end,
    z: 12,
    build(el) {
      const bg = h('div', { class: 'fin-bg' });
      const crane = h('div', { class: 'fin-crane' });
      const back = h('div', { class: 'fin-back' });
      const wins = FAN.map((f) => {
        const a = C.byId[f.id];
        const w = D.AppWindow({ title: `${a.name} — Claude`, color: a.color, variants: [C.CONTENT[f.id === 'side' ? 'main' : f.id]], initial: 'Y', me: 'You' });
        w.place(0, 0, 1040, 640);
        w.el.classList.add('fin-win');
        back.append(w.el);
        return w;
      });
      const sweep = h('div', { class: 'fin-sweep' });
      const spots = h('div', { class: 'fin-spots' });
      // the island at the top, all five awake
      const isl = Island({
        accounts: IDS.map((id) => C.byId[id]),
        sessions: C.SESSIONS,
        states: Object.fromEntries(IDS.map((id) => [id, [[0, { running: true, signedIn: true }]]])),
        open: [],
      });
      const islWrap = h('div', { class: 'fin-island' }, isl.el);
      // the name
      const leader = new Mascot(INK, { shadow: true, seed: 4000, size: 150 });
      const word = h('div', { class: 'fin-word' }, ...'Flock'.split('').map((ch) => h('span', { text: ch })));
      const lock = h('div', { class: 'fin-lock' }, h('div', { class: 'fin-leader' }, leader.el), word);
      const line = D.Words(['All', 'your', 'Claude', 'accounts.', ['One', '#f5f6f8'], ['flock.', '#f5f6f8']], { class: 'fin-line' });
      // the flock on its stage
      const pets = IDS.map((id, i) => {
        const m = new Mascot(C.byId[id].color, { shadow: true, seed: 4100 + i, size: 112 });
        const pool = h('i', { class: 'fin-pool' });
        pool.style.setProperty('--c', C.byId[id].color);
        const slot = h('div', { class: 'fin-slot' }, pool, m.el);
        return { m, slot, pool };
      });
      const flock = h('div', { class: 'fin-flock' }, ...pets.map((p) => p.slot));
      const foot = h('div', { class: 'fin-foot' },
        h('span', { text: 'Open source' }), h('i'), h('span', { text: 'For Claude Desktop on Windows' }));
      const legal = h('div', { class: 'fin-legal', text: 'Flock is an independent project. It is not made by, or affiliated with, Anthropic.' });
      // dust
      const dust = h('div', { class: 'fin-dust' });
      const motes = Array.from({ length: 26 }, (_, i) => {
        const d = h('i');
        dust.append(d);
        return { d, x: hash(i, 41) * 1920, y: 300 + hash(i, 43) * 820, s: 1.6 + hash(i, 47) * 2.2, v: 18 + hash(i, 53) * 34, a: 0.12 + hash(i, 59) * 0.28, ph: hash(i, 61) * 6 };
      });
      crane.append(back, spots, islWrap, lock, line.el, flock, dust);
      const flash = h('div', { class: 'fin-flash' });
      const fade = h('div', { class: 'fin-fade' });
      el.append(bg, crane, sweep, foot, legal, flash, fade);
      pets.forEach((p, i) => {
        p.m.lookAt = (t) => (t < T.slam + 0.4 ? [0, -1] : [Math.sin(t * 0.4 + i) * 0.15, -0.35]);
      });
      leader.lookAt = (t) => (t < T.line ? [0, -0.2] : [0.15, 0.4]);
      return { bg, crane, back, wins, sweep, spots, isl, islWrap, leader, lock, word, line, pets, flock, foot, legal, dust, motes, flash, fade };
    },

    update(local, c, t) {
      // white flash out of the keys, then the room
      css(c.flash, { opacity: (0.62 * (1 - E.easeOut(prog(t, T.start, T.drop + 0.3)))).toFixed(3) });
      // crane: the whole set settles from a slightly high angle, then pushes in slowly
      const craneK = E.out(prog(t, T.drop, T.drop + 1.5));
      const push = prog(t, T.drop + 1.5, T.end);
      css(c.crane, { transform: `perspective(1600px) rotateX(${lerp(5, 0, craneK).toFixed(3)}deg) scale(${(lerp(1.08, 1, craneK) + 0.03 * push).toFixed(4)})` });
      // windows fan in behind, out of focus (depth), each wearing its edge
      c.wins.forEach((w, i) => {
        const f = FAN[i];
        const a = T.drop + 0.06 + i * 0.05;
        const k = EASE_LAND(prog(t, a, a + 0.6));
        const from = [(i - 2) * 520, -260];
        css(w.el, {
          opacity: clamp(prog(t, a, a + 0.2) * 0.62).toFixed(3),
          transform: `translate3d(${(f.x - 520 + from[0] * (1 - k)).toFixed(1)}px, ${(f.y - 320 + from[1] * (1 - k)).toFixed(1)}px, ${f.z}px) rotateY(${f.ry}deg) scale(0.62)`,
        });
        w.setEdge(1, 1, 0);
      });
      css(c.back, { filter: `blur(${lerp(2, 5, craneK).toFixed(2)}px)` });
      // stage lights and a single sweep of light on the drop
      css(c.spots, { opacity: (E.out(prog(t, T.drop + 0.15, T.drop + 0.9)) * (1 - 0.35 * prog(t, T.drop + 0.9, T.drop + 2))).toFixed(3) });
      const sw = prog(t, T.drop + 0.05, T.drop + 0.85);
      css(c.sweep, { display: sw > 0 && sw < 1 ? '' : 'none', transform: `translateX(${lerp(-900, 2400, E.inOut(sw)).toFixed(1)}px) skewX(-18deg)`, opacity: (Math.sin(Math.PI * sw) * 0.75).toFixed(3) });
      // the island drops in from the top edge
      {
        const k = E.spring(prog(t, T.drop + 0.1, T.drop + 0.62));
        css(c.islWrap, { transform: `translate(-50%, ${lerp(-140, 0, k).toFixed(2)}px) scale(2.3)` });
        c.isl.sync(t);
      }
      // the name: slams down onto the beat, everything else steps back a touch
      {
        const k = EASE_LAND(prog(t, T.slam, T.slam + 0.42));
        css(c.lock, { opacity: clamp(prog(t, T.slam, T.slam + 0.12)).toFixed(3), transform: `translate(-50%, -50%) scale(${lerp(1.5, 1, k).toFixed(4)})`, filter: k < 0.98 ? `blur(${((1 - clamp(k)) * 10).toFixed(2)}px)` : 'none' });
        if (!c.leader._mv) {
          c.leader._mv = true;
          c.leader.move(T.slam + 0.3, 'ready');
        }
        c.leader.sync(t);
        // a breath of letter-spacing as it settles
        const br = Math.sin(Math.PI * clamp(prog(t, T.slam + 0.25, T.slam + 1.2)));
        css(c.word, { letterSpacing: `${(-0.055 + 0.008 * br).toFixed(4)}em` });
      }
      c.line.sync(t, T.line, { stagger: 0.07, dur: 0.75 });
      // the flock lands on the stage, one after another on sixteenths
      c.pets.forEach((p, i) => {
        const a = T.drop + 0.12 + i * 0.115;
        const k = EASE_LAND(prog(t, a, a + 0.5));
        const dir = [-1, -0.5, 0, 0.5, 1][i];
        css(p.slot, { opacity: clamp(prog(t, a, a + 0.12)).toFixed(3), transform: `translate(${(dir * 220 * (1 - k)).toFixed(1)}px, ${(260 * (1 - k)).toFixed(1)}px) rotate(${(dir * 14 * (1 - k)).toFixed(2)}deg)` });
        css(p.pool, { opacity: E.out(prog(t, a + 0.3, a + 0.9)).toFixed(3) });
        if (!p.m._mv) {
          p.m._mv = true;
          p.m.move(a + 0.42, 'ready');
        }
        p.m.sync(t);
      });
      // footer
      const fk = E.out(prog(t, T.foot, T.foot + 0.7));
      css(c.foot, { opacity: fk.toFixed(3), transform: `translate(-50%, ${(10 * (1 - fk)).toFixed(2)}px)` });
      css(c.legal, { opacity: E.out(prog(t, T.foot + 0.25, T.foot + 0.95)).toFixed(3) });
      // dust drifting up through the light
      c.motes.forEach((m) => {
        const life = t - T.drop;
        const y = m.y - life * m.v;
        const x = m.x + Math.sin(life * 0.6 + m.ph) * 14;
        css(m.d, { transform: `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`, width: `${m.s.toFixed(1)}px`, height: `${m.s.toFixed(1)}px`, opacity: (m.a * E.out(prog(t, T.drop + 0.4, T.drop + 1.6))).toFixed(3) });
      });
      // out
      css(c.fade, { opacity: E.easeInOut(prog(t, T.fadeOut, T.end - 0.15)).toFixed(3) });
      void local;
    },
  });
})();
