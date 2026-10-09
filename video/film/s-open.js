// S1 + S2 — the hook and the brand.
// "Got more than one Claude account?" → one window cycling through sign-outs
// → it clones into a flock of windows, one per account → they fold into the
// flock of mascots → Flock.
(function () {
  'use strict';
  const F = window.Film;
  const { h, css, cls, text, E, prog, lerp, clamp } = F;
  const { Mascot, INK } = window.FlockUI;
  const D = window.Desk;
  const C = window.Cast;

  // Lockup geometry, shared with the island scene (the mascots fly from here into the island).
  const LOCK = {
    white: { x: 712, y: 452, s: 176 },
    row: [0, 1, 2, 3].map((i) => ({ x: 960 + (i - 1.5) * 156, y: 806, s: 96 })),
  };
  C.LOCK = LOCK;
  C.LOCK_SCALE = 1.03; // the lockup's slow push while it holds, reached at the handover
  const T = {
    q: 0.3, // question
    demote: 2.35,
    winIn: 2.45,
    ptrIn: 2.75,
    cycles: [[3.25, 1.2], [4.45, 0.95], [5.4, 0.72]],
    line: 3.6,
    clear: 6.25,
    gather: 6.7,
    echo: 7.15,
    fan: 8.25,
    fold: 9.85,
    leader: 11.05,
    word: 11.45,
    tag: 12.15,
    end: C.BAR(8), // 14.925: the beat comes in
  };
  C.T_OPEN = T;
  const NAMES = ['Personal', 'Work', 'Client', 'Personal'];
  const FAN = ['main', 'work', 'client', 'research'];
  const W = 1040;
  const H = 640;
  // the echo column is centred on the frame: original at the front-left, copies up and to the right
  const ECHO = (i) => ({ x: 960 + (i - 1.5) * 118, y: 572 - (i - 1.5) * 62, z: -150 * i });
  // the fan: a gentle wrap-around arc, outer windows forward and turned in
  const FANP = (i) => ({ x: 960 + (i - 1.5) * 432, y: 560, z: Math.abs(i - 1.5) * 50 - 30, ry: (1.5 - i) * 12, s: 0.385 });

  F.scene({
    id: 'open',
    start: 0,
    end: T.end + 0.6,
    z: 10,
    build(el) {
      const bg = h('div', { class: 'open-bg' });
      const glow = h('div', { class: 'open-glow' });
      const stage = h('div', { class: 'open-stage' });
      const q = D.Words(['Got', 'more', 'than', 'one', 'Claude', 'account?'], { class: 'open-q' });
      const line = D.Words(['One', 'window.', ['One', '#8d929b'], ['account', '#8d929b'], ['at', '#8d929b'], ['a', '#8d929b'], ['time.', '#8d929b']], { class: 'open-line' });

      const wins = FAN.map((id, i) => {
        const a = C.byId[id];
        const w = D.AppWindow({ title: 'Claude', color: a.color, content: C.CONTENT[i === 0 ? 'main' : id], initial: 'Y', me: 'Personal' });
        w.el.classList.add('open-win');
        w.place(0, 0, W, H);
        return w;
      });
      // Sign-in screen over the hook window's main area
      const slotA = h('span', { class: 'si-name' });
      const slotB = h('span', { class: 'si-name' });
      const slot = h('div', { class: 'si-slot' }, slotA, slotB);
      const av = h('div', { class: 'si-av' });
      const spin = h('i', { class: 'si-spin' });
      const check = h('i', { class: 'si-check', html: window.FlockUI.I.check });
      const stText = h('span', { class: 'si-text' });
      const status = h('div', { class: 'si-status' }, spin, check, stText);
      const card = h('div', { class: 'si-screen' }, h('div', { class: 'si-card' }, av, slot, status));
      wins[0].main.append(card);
      const chip = wins[0].side.querySelector('.aw-me span');
      wins.forEach((w) => stage.append(w.el));

      // Mascots: one per account + Flock's own (white).
      const pools = FAN.map((id) => {
        const p = h('div', { class: 'open-pool' });
        p.style.setProperty('--c', C.byId[id].color);
        stage.append(p);
        return p;
      });
      const flashes = FAN.map((id) => {
        const f = h('div', { class: 'open-flash' });
        f.style.setProperty('--c', C.byId[id].color);
        stage.append(f);
        return f;
      });
      const pets = FAN.map((id, i) => {
        const m = new Mascot(C.byId[id].color, { shadow: true, seed: 900 + i, size: LOCK.row[i].s });
        m.el.classList.add('open-pet');
        stage.append(m.el);
        return m;
      });
      const leaderPool = h('div', { class: 'open-pool white' });
      const leader = new Mascot(INK, { shadow: true, seed: 950, size: LOCK.white.s, state: 'asleep' });
      leader.state(T.leader + 0.42, 'awake');
      leader.move(T.leader + 0.42, 'ready');
      leader.el.classList.add('open-pet');
      stage.append(leaderPool, leader.el);
      const word = h('div', { class: 'wordmark' }, ...'Flock'.split('').map((ch) => h('span', { text: ch })));
      const tag = D.Words(['Every', 'Claude', 'account,', ['side', null, 'tag-em'], ['by', null, 'tag-em'], ['side.', null, 'tag-em']], { class: 'open-tag' });
      stage.append(word, tag.el);
      const labels = FAN.map((id) => {
        const a = C.byId[id];
        const l = h('div', { class: 'fan-label' }, h('i'), h('span', { text: a.name }));
        l.style.setProperty('--c', a.color);
        return l;
      });
      const ptr = D.Pointer([1500, 1180]);
      ptr.to(T.ptrIn, 0.5, [512, 901], { arc: 0.12 });
      T.cycles.forEach(([c0]) => ptr.click(c0));
      ptr.to(T.clear - 0.1, 0.6, [700, 1160], { flick: false });
      el.append(bg, glow, stage, ...labels, q.el, line.el, ptr.el);
      pets.forEach((m, i) => {
        m.move(T.fold + i * 0.08 + 1.18, 'jump');
        m.lookAt = (t) => {
          if (t < T.leader - 0.1) return [0, 0.3];
          if (t < T.word + 0.5) return [(LOCK.white.x - LOCK.row[i].x) / 260, -1];
          return [(LOCK.white.x + 300 - LOCK.row[i].x) / 520, -0.55];
        };
      });
      leader.lookAt = (t) => (t < T.word ? [0, 0] : t < T.tag + 0.6 ? [1, 0.15] : [0.25, 0.3]);
      return { bg, glow, stage, q, line, wins, labels, card, slotA, slotB, av, spin, check, status, stText, chip, pets, pools, flashes, leader, leaderPool, word, tag, ptr };
    },

    update(t, c) {
      // the lockup breathes in slowly while it holds
      const hold = F.smooth(prog(t, T.tag, T.end));
      css(c.stage, { transform: `scale(${lerp(1, C.LOCK_SCALE, hold).toFixed(5)})`, transformOrigin: '960px 540px' });
      // ── the question, then demoted to a heading
      c.q.sync(t, T.q, { stagger: 0.085, dur: 0.85, out: T.clear, outDur: 0.4 });
      const dk = E.inOut(prog(t, T.demote, T.demote + 0.7));
      css(c.q.el, { transform: `translate(-50%, -50%) translateY(${lerp(0, -362, dk).toFixed(2)}px) scale(${lerp(1, 0.6, dk).toFixed(4)})` });
      c.line.sync(t, T.line, { stagger: 0.06, dur: 0.7, out: T.clear, outDur: 0.35 });
      c.ptr.sync(t, 1 - E.easeIn(prog(t, T.clear + 0.1, T.clear + 0.5)));
      css(c.ptr.el, { display: t > T.ptrIn - 0.1 && t < T.clear + 0.6 ? '' : 'none' });

      // ── windows: hook → echo column → arc → fold
      const rise = E.spring(prog(t, T.winIn, T.winIn + 0.75));
      const gather = E.inOut(prog(t, T.gather, T.gather + 0.55));
      const turn = E.inOut(prog(t, T.echo, T.echo + 0.7));
      c.wins.forEach((w, i) => {
        let x = 960;
        let y = 600 + (1 - rise) * 520;
        let z = 0;
        let s = 1;
        let ry = 0;
        let op = i === 0 ? clamp(rise * 1.4) : 0;
        if (t >= T.gather) {
          const e0 = ECHO(0);
          x = lerp(960, e0.x, gather);
          y = lerp(600, e0.y, gather);
          s = lerp(1, 0.62, gather);
        }
        if (t >= T.echo) {
          ry = 16 * turn;
          if (i > 0) {
            // cloner echo: copies stream out one after another, fainter with depth
            const k = E.spring(prog(t, T.echo + (i - 1) * 0.11, T.echo + (i - 1) * 0.11 + 0.55));
            const e0 = ECHO(0);
            const ei = ECHO(i);
            x = lerp(e0.x, ei.x, k);
            y = lerp(e0.y, ei.y, k);
            z = lerp(0, ei.z, k);
            s = 0.62;
            op = (1 - 0.22 * i) * clamp(k * 3);
          }
        }
        if (t >= T.fan) {
          const ki = E.inOut(prog(t, T.fan + (3 - i) * 0.06, T.fan + (3 - i) * 0.06 + 1.0));
          const ei = ECHO(i);
          const fi = FANP(i);
          x = lerp(ei.x, fi.x, ki);
          y = lerp(ei.y, fi.y, ki);
          z = lerp(ei.z, fi.z, ki);
          s = lerp(0.62, fi.s, ki);
          ry = lerp(16, fi.ry, ki);
          op = lerp(1 - 0.22 * i, 1, ki);
        }
        let blur = 0;
        const fk = prog(t, T.fold + i * 0.08, T.fold + i * 0.08 + 0.5);
        if (fk > 0) {
          s *= lerp(1, 0.06, E.in(fk));
          op *= 1 - E.easeIn(prog(fk, 0.45, 0.9));
          blur = 5 * fk;
        }
        css(w.el, {
          transform: `translate3d(${(x - W / 2).toFixed(2)}px, ${(y - H / 2).toFixed(2)}px, ${z.toFixed(2)}px) rotateY(${ry.toFixed(3)}deg) scale(${s.toFixed(4)})`,
          opacity: op.toFixed(3),
          filter: blur > 0.05 ? `blur(${blur.toFixed(2)}px)` : 'none',
          zIndex: String(10 - i),
          display: op > 0.002 ? '' : 'none',
          '--edge-w': `${(2 / Math.max(s, 0.3)).toFixed(2)}px`,
        });
        // titles and accent edges light up as the arc opens (drawn from the middle out)
        const lit = E.out(prog(t, T.fan + 0.45 + i * 0.15, T.fan + 0.95 + i * 0.15));
        w.setTitle(lit > 0.05 ? `${C.byId[FAN[i]].name} — Claude` : 'Claude');
        w.setEdge(lit, lit, 0);
        css(w.edge, { clipPath: `inset(0 ${(50 - 50 * lit).toFixed(2)}% 0 ${(50 - 50 * lit).toFixed(2)}%)` });
        cls(w.el, 'showcase', t >= T.fan);
        // name above each window of the arc
        const lk = E.out(prog(t, T.fan + 0.55 + i * 0.15, T.fan + 1.2 + i * 0.15));
        const lo = 1 - E.easeIn(prog(t, T.fold + i * 0.08 - 0.05, T.fold + i * 0.08 + 0.25));
        const fi = FANP(i);
        css(c.labels[i], {
          display: lk * lo > 0.002 ? '' : 'none',
          opacity: (lk * lo).toFixed(3),
          transform: `translate(${fi.x.toFixed(1)}px, ${(fi.y - 178 + 12 * (1 - lk)).toFixed(1)}px) translate(-50%, -50%)`,
          filter: lk < 0.99 ? `blur(${((1 - lk) * 8).toFixed(2)}px)` : 'none',
        });
      });
      // a soft colour wash rises behind the arc
      const wash = E.out(prog(t, T.fan + 0.4, T.fan + 1.6)) * (1 - E.easeIn(prog(t, T.fold, T.fold + 0.8)));
      css(c.glow, { opacity: wash.toFixed(3) });

      // ── the sign-in loop (pill-slot-cycle, accelerating)
      const cardOn = t < T.clear + 0.4;
      css(c.card, { display: cardOn ? '' : 'none', opacity: (1 - E.easeIn(prog(t, T.clear, T.clear + 0.4))).toFixed(3) });
      if (cardOn) {
        let name = 0;
        let roll = 0;
        let phase = 'done';
        T.cycles.forEach(([c0, L], k) => {
          if (t < c0) return;
          const u = (t - c0) / L;
          if (u < 0.4) { phase = 'out'; name = k; roll = 0; }
          else if (u < 0.56) { phase = 'in'; name = k; roll = E.inOut(prog(u, 0.4, 0.56)); }
          else if (u < 0.88) { phase = 'in'; name = k + 1; roll = 0; }
          else { phase = 'done'; name = k + 1; roll = 0; }
        });
        text(c.slotA, NAMES[name]);
        text(c.slotB, NAMES[Math.min(name + 1, 3)]);
        css(c.slotA, { transform: `translateY(${(-130 * roll).toFixed(1)}%)`, opacity: (1 - roll).toFixed(3), filter: roll > 0.02 ? `blur(${(10 * roll).toFixed(1)}px)` : 'none' });
        css(c.slotB, { transform: `translateY(${(120 * (1 - roll)).toFixed(1)}%)`, opacity: roll.toFixed(3), filter: roll > 0 && roll < 0.98 ? `blur(${(14 * (1 - roll)).toFixed(1)}px)` : 'none' });
        const shown = roll > 0.5 ? NAMES[Math.min(name + 1, 3)] : NAMES[name];
        text(c.av, shown[0]);
        text(c.chip, shown);
        text(c.stText, phase === 'out' ? 'Signing out…' : phase === 'in' ? 'Signing in…' : 'Signed in');
        const busy = phase !== 'done';
        css(c.spin, { display: busy ? '' : 'none', transform: `rotate(${((t * 600) % 360).toFixed(1)}deg)` });
        css(c.check, { display: busy ? 'none' : '' });
        cls(c.status, 'ok', !busy);
      }

      // ── fold: each window collapses into a flash of its colour; its mascot pops out
      c.pets.forEach((m, i) => {
        const f0 = T.fold + i * 0.08;
        const fi = FANP(i);
        const pop = E.back(prog(t, f0 + 0.38, f0 + 0.78));
        const travel = E.inOut(prog(t, f0 + 0.62, f0 + 1.3));
        const x = lerp(fi.x, LOCK.row[i].x, travel);
        const y = lerp(fi.y, LOCK.row[i].y, travel) - Math.sin(Math.PI * travel) * 70;
        const s = LOCK.row[i].s;
        const on = t >= f0 + 0.38 && t < T.end;
        css(m.el, { display: on ? '' : 'none', transform: `translate(${(x - s / 2).toFixed(2)}px, ${(y - s / 2).toFixed(2)}px) scale(${pop.toFixed(4)})` });
        if (on) m.sync(t);
        const fl = Math.sin(Math.PI * clamp(prog(t, f0 + 0.2, f0 + 0.85)));
        css(c.flashes[i], { display: fl > 0.003 ? '' : 'none', opacity: (fl * 0.9).toFixed(3), transform: `translate(${(fi.x - 160).toFixed(1)}px, ${(fi.y - 160).toFixed(1)}px) scale(${(0.6 + 0.6 * fl).toFixed(3)})` });
        const pk = E.out(prog(t, f0 + 1.0, f0 + 1.7)) * (1 - E.easeIn(prog(t, T.end - 0.1, T.end + 0.3)));
        css(c.pools[i], { display: t >= f0 + 0.38 && t < T.end + 0.3 ? '' : 'none', opacity: pk.toFixed(3), transform: `translate(${(LOCK.row[i].x - 110).toFixed(1)}px, ${(LOCK.row[i].y + s * 0.34 - 30).toFixed(1)}px)` });
      });

      // ── the leader drops in, the name arrives
      {
        const L = LOCK.white;
        const k = prog(t, T.leader, T.leader + 0.42);
        const y = lerp(L.y - 620, L.y, E.in(k));
        const on = t >= T.leader && t < T.end;
        css(c.leader.el, { display: on ? '' : 'none', transform: `translate(${(L.x - L.s / 2).toFixed(2)}px, ${(y - L.s / 2).toFixed(2)}px)` });
        if (on) c.leader.sync(t);
        const pk = E.out(prog(t, T.leader + 0.4, T.leader + 1.2)) * (1 - E.easeIn(prog(t, T.end - 0.1, T.end + 0.3)));
        css(c.leaderPool, { display: t >= T.leader && t < T.end + 0.3 ? '' : 'none', opacity: pk.toFixed(3), transform: `translate(${(L.x - 160).toFixed(1)}px, ${(L.y + L.s * 0.36 - 40).toFixed(1)}px)` });
      }
      [...c.word.children].forEach((sp, i) => {
        const k = E.out(prog(t, T.word + i * 0.06, T.word + i * 0.06 + 0.8));
        css(sp, { opacity: k.toFixed(3), transform: `translateY(${((1 - k) * 0.28).toFixed(3)}em)`, filter: k < 0.99 ? `blur(${((1 - k) * 12).toFixed(2)}px)` : 'none' });
      });
      c.tag.sync(t, T.tag, { stagger: 0.07, dur: 0.75 });
      // handover: the name and line step back as the beat comes in
      const out = E.easeIn(prog(t, T.end - 0.15, T.end + 0.2));
      css(c.word, { opacity: (1 - out).toFixed(3), transform: `translateY(${(-24 * out).toFixed(2)}px)` });
      css(c.tag.el, { opacity: (1 - out).toFixed(3), transform: `translate(-50%, ${(-18 * out).toFixed(2)}px)` });
      css(c.bg, { opacity: (1 - out).toFixed(3) });
    },
  });

})();
