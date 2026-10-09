// Breathing cards between chapters (paper-title-card grammar, re-skinned in
// Flock's dark tokens): a short line rises word by word next to a mascot that
// reacts, holds, then lifts away.
(function () {
  'use strict';
  const F = window.Film;
  const { h, css, E, prog, lerp } = F;
  const { Mascot } = window.FlockUI;
  const D = window.Desk;
  const C = window.Cast;
  const { BAR } = C;

  function card(id, start, end, parts, o) {
    F.scene({
      id,
      start,
      end,
      z: 40,
      build(el) {
        const bg = h('div', { class: 'card-bg' });
        if (o.color) bg.style.setProperty('--c', o.color);
        const line = D.Words(parts, { class: 'card-line' });
        const pet = new Mascot(o.color, { shadow: true, seed: o.seed, size: 118, state: o.state || 'awake', fidget: false });
        (o.moves || []).forEach(([t, mv]) => pet.move(start + t, mv));
        (o.states || []).forEach(([t, st]) => pet.state(start + t, st));
        pet.lookAt = (t) => (t < start + 0.5 ? [0.2, 0] : [1, 0.15]);
        const pool = h('div', { class: 'card-pool' });
        pool.style.setProperty('--c', o.color);
        const row = h('div', { class: 'card-row' }, h('div', { class: 'card-pet' }, pool, pet.el), line.el);
        el.append(bg, row);
        return { bg, line, pet, row };
      },
      update(local, c, t) {
        const len = end - start;
        const inK = E.easeOut(prog(local, 0, 0.16));
        const outK = E.easeIn(prog(local, len - 0.24, len));
        css(c.bg, { opacity: (inK * (1 - outK)).toFixed(3) });
        c.line.sync(local, 0.12, { stagger: 0.075, dur: 0.6, out: len - 0.34, outDur: 0.26 });
        const pk = E.back(prog(local, 0.05, 0.5));
        css(c.pet.el.parentElement, { transform: `scale(${(pk * (1 - outK)).toFixed(4)})`, opacity: (1 - outK).toFixed(3) });
        c.pet.sync(t);
        css(c.row, { transform: `translate(-50%, -50%) translateY(${(-16 * outK).toFixed(2)}px)` });
        void lerp;
      },
    });
  }

  // C1 — the music dips for one bar: a breath before session peek
  card('card1', BAR(24), BAR(25), ['Where', 'was', ['I?', '#38BDF8']], { color: '#38BDF8', seed: 1500, moves: [[0.45, 'glance']] });
  // C2 — before setting up a new account (its mascot is the new one: Side project)
  card('card2', 57.42, BAR(32), ['One', 'more', ['account?', '#FACC15']], { color: '#FACC15', seed: 1510, moves: [[0.35, 'jump']] });
})();
