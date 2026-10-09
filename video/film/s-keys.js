// S11 — the keyboard, on the beat, building into the drop:
// Ctrl · Alt · F drops the island in · 1 · 2 · 3 bring up accounts · A opens
// them all — then everything rushes at the camera (keycap-smash-cut grammar).
(function () {
  'use strict';
  const F = window.Film;
  const { h, css, E, prog, lerp, clamp } = F;
  const { Mascot, Island } = window.FlockUI;
  const D = window.Desk;
  const C = window.Cast;
  const { B, BAR } = C;

  const T = {
    start: BAR(45), // 83.26
    ctrl: B(180),
    alt: B(181),
    f: B(182), // 84.18
    groupB: B(183) + 0.15,
    k1: B(184),
    k2: B(185),
    k3: B(186), // 86.03
    groupC: B(187) + 0.1,
    a: B(188), // 86.95
    rush: B(190) + 0.1, // 87.98
    end: BAR(48) + 0.12, // 88.92
  };
  C.T_KEYS = T;
  const IDS = ['main', 'work', 'client', 'research', 'side'];

  function press(t, at2) {
    // 3-frame squash, a short hold, a springy release
    if (t < at2 - 0.05 || t > at2 + 0.3) return 0;
    if (t < at2) return E.easeOut(prog(t, at2 - 0.05, at2));
    if (t < at2 + 0.08) return 1;
    return 1 - E.out(prog(t, at2 + 0.08, at2 + 0.3));
  }

  F.scene({
    id: 'keys',
    start: T.start,
    end: T.end,
    z: 8,
    build(el) {
      const bg = h('div', { class: 'keys-bg' });
      const stage = h('div', { class: 'keys-stage' });
      el.append(bg, stage);
      const mk = (label, wide) => {
        const k = D.Keycap(label, { wide });
        const ring = h('i', { class: 'key-ring' });
        const wrap = h('div', { class: 'key-wrap' }, ring, k.el);
        return { k, ring, wrap };
      };
      const plus = () => h('span', { class: 'key-plus', text: '+' });
      // group A
      const A = { ctrl: mk('Ctrl', true), alt: mk('Alt', true), f: mk('F') };
      const rowA = h('div', { class: 'key-row' }, A.ctrl.wrap, plus(), A.alt.wrap, plus(), A.f.wrap);
      const labA = h('div', { class: 'key-label', text: 'Open the island' });
      // group B
      const Bk = [mk('1'), mk('2'), mk('3')];
      const rowB = h('div', { class: 'key-row gap' }, ...Bk.map((x) => x.wrap));
      const labB = h('div', { class: 'key-label', text: 'Jump to any account' });
      const petsB = ['main', 'work', 'client'].map((id, i) => {
        const m = new Mascot(C.byId[id].color, { seed: 3000 + i, shadow: true, size: 104, fidget: false });
        css(m.el, { position: 'absolute', left: '0', top: '0' });
        stage.append(m.el);
        return m;
      });
      // group C
      const Ck = mk('A');
      const rowC = h('div', { class: 'key-row' }, Ck.wrap);
      const labC = h('div', { class: 'key-label', text: 'Open them all' });
      const petsC = IDS.map((id, i) => {
        const m = new Mascot(C.byId[id].color, { seed: 3100 + i, shadow: true, size: 112, fidget: false, state: 'asleep' });
        m.state(T.a + 0.04 + i * 0.07, 'awake');
        css(m.el, { position: 'absolute', left: '0', top: '0' });
        stage.append(m.el);
        return m;
      });
      // the island drops in for Ctrl+Alt+F (the real one, compact, scaled up)
      const isl = Island({
        accounts: IDS.map((id) => C.byId[id]),
        sessions: C.SESSIONS,
        states: Object.fromEntries(IDS.map((id, i) => [id, [[0, { running: false, signedIn: true }], [T.f + 0.22 + i * 0.06, { running: true, signedIn: true }]]])),
        open: [],
      });
      const islWrap = h('div', { class: 'keys-island' }, isl.el);
      stage.append(islWrap, rowA, labA, rowB, labB, rowC, labC);
      const flash = h('div', { class: 'keys-flash' });
      el.append(flash);
      return { bg, stage, A, rowA, labA, Bk, rowB, labB, petsB, Ck, rowC, labC, petsC, isl, islWrap, flash };
    },

    update(_, c, t) {
      // ── group A: Ctrl + Alt + F
      const aIn = E.out(prog(t, T.start - 0.05, T.start + 0.35));
      const aOut = E.in(prog(t, T.groupB - 0.2, T.groupB + 0.12));
      css(c.rowA, { opacity: (aIn * (1 - aOut)).toFixed(3), transform: `translate(-50%, -50%) translateY(${(40 * (1 - aIn) - 90 * aOut).toFixed(2)}px)`, display: aOut < 0.999 ? '' : 'none' });
      css(c.labA, { opacity: (E.out(prog(t, T.f, T.f + 0.35)) * (1 - aOut)).toFixed(3), display: aOut < 0.999 ? '' : 'none' });
      [['ctrl', T.ctrl], ['alt', T.alt], ['f', T.f]].forEach(([k, at2]) => {
        const p = press(t, at2);
        // keys held: Ctrl and Alt stay down while F lands
        const held = (k === 'ctrl' && t > T.ctrl && t < T.f + 0.2) || (k === 'alt' && t > T.alt && t < T.f + 0.2) ? 0.82 : 0;
        c.A[k].k.set(Math.max(p, held), Math.max(p, held * 0.6));
        ring(c.A[k].ring, t, at2);
      });
      // the island drops from the top and its flock wakes up
      {
        const k = E.spring(prog(t, T.f, T.f + 0.5));
        const out = E.in(prog(t, T.groupB - 0.2, T.groupB + 0.12));
        css(c.islWrap, { display: t >= T.f - 0.02 && out < 0.999 ? '' : 'none', opacity: (1 - out).toFixed(3), transform: `translate(-50%, ${(lerp(-140, 0, k) - 60 * out).toFixed(2)}px) scale(3.1)` });
        c.isl.sync(t);
      }

      // ── group B: 1 · 2 · 3
      const bIn = E.out(prog(t, T.groupB - 0.1, T.groupB + 0.25));
      const bOut = E.in(prog(t, T.groupC - 0.3, T.groupC - 0.04)); // clears before A arrives
      const bOn = t >= T.groupB - 0.1 && bOut < 0.999;
      css(c.rowB, { display: bOn ? '' : 'none', opacity: (bIn * (1 - bOut)).toFixed(3), transform: `translate(-50%, -50%) translateY(${(70 * (1 - bIn) - 90 * bOut).toFixed(2)}px)` });
      css(c.labB, { display: bOn ? '' : 'none', opacity: (E.out(prog(t, T.k1, T.k1 + 0.35)) * (1 - bOut)).toFixed(3) });
      [T.k1, T.k2, T.k3].forEach((at2, i) => {
        const p = press(t, at2);
        c.Bk[i].k.set(p, p);
        ring(c.Bk[i].ring, t, at2);
        const m = c.petsB[i];
        const pop = E.back(prog(t, at2, at2 + 0.35));
        const x = 960 + (i - 1) * 272;
        css(m.el, { display: bOn && t >= at2 ? '' : 'none', transform: `translate(${(x - 52).toFixed(1)}px, ${(392 - 52 + 30 * (1 - pop) - 90 * bOut).toFixed(1)}px) scale(${pop.toFixed(4)})`, opacity: (1 - bOut).toFixed(3) });
        if (!m._mv) {
          m._mv = true;
          m.move(at2 + 0.02, 'jump');
        }
        if (bOn && t >= at2) m.sync(t);
      });

      // ── group C: A — everyone
      const cIn = E.out(prog(t, T.groupC - 0.02, T.groupC + 0.3));
      const rush = E.inExpo(prog(t, T.rush, T.end - 0.08));
      css(c.rowC, { display: t >= T.groupC - 0.02 ? '' : 'none', opacity: cIn.toFixed(3), transform: `translate(-50%, -50%) translateY(${(70 * (1 - cIn)).toFixed(2)}px)` });
      css(c.labC, { display: t >= T.groupC - 0.02 ? '' : 'none', opacity: E.out(prog(t, T.a, T.a + 0.35)).toFixed(3) });
      {
        const p = press(t, T.a);
        c.Ck.k.set(p, Math.max(p, E.out(prog(t, T.a, T.a + 0.4)) * 0.5));
        ring(c.Ck.ring, t, T.a);
      }
      c.petsC.forEach((m, i) => {
        const at2 = T.a + 0.04 + i * 0.07;
        const pop = E.back(prog(t, at2, at2 + 0.38));
        const ang = (i - 2) * 0.36;
        const x = 960 + Math.sin(ang) * 420;
        const y = 400 - Math.cos(ang) * 120 + 60;
        css(m.el, { display: t >= at2 ? '' : 'none', transform: `translate(${(x - 56).toFixed(1)}px, ${(y - 56 + 40 * (1 - pop)).toFixed(1)}px) scale(${pop.toFixed(4)})` });
        // they hop on the off-beats while the music builds
        if (!m._mv) {
          m._mv = true;
          [0.5, 1, 1.5, 2, 2.25, 2.5, 2.75].forEach((b) => m.move(T.a + b * 0.46171 + i * 0.03, 'jump'));
        }
        if (t >= at2) m.sync(t);
      });
      // ── the rush into the drop
      css(c.stage, { transform: `scale(${lerp(1, 2.6, rush).toFixed(4)})`, filter: rush > 0.01 ? `blur(${(rush * 14).toFixed(2)}px)` : 'none', opacity: (1 - E.easeIn(prog(rush, 0.55, 1))).toFixed(3) });
      const fl = 0.62 * clamp(prog(t, T.end - 0.2, T.end - 0.05));
      css(c.flash, { opacity: fl.toFixed(3) });
    },
  });

  function ring(el, t, at2) {
    const on = t >= at2 && t < at2 + 0.55;
    if (!on) {
      css(el, { opacity: '0' });
      return;
    }
    const r = lerp(70, 260, E.outCubic(prog(t, at2, at2 + 0.45)));
    css(el, { opacity: (0.55 * (1 - prog(t, at2, at2 + 0.55))).toFixed(3), width: `${(2 * r).toFixed(1)}px`, height: `${(2 * r).toFixed(1)}px`, marginLeft: `${(-r).toFixed(1)}px`, marginTop: `${(-r).toFixed(1)}px` });
  }
})();
