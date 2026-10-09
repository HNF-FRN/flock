// S3–S7 — one continuous take on a desktop:
// the flock lands in the island → hover through accounts → open Client A →
// open them all (dealt into a 2×2) → telling windows apart (edge, island,
// Alt+Tab, taskbar) → session peek (open a session, start a new one).
(function () {
  'use strict';
  const F = window.Film;
  const { h, css, cls, text, E, prog, lerp, clamp, transit, at } = F;
  const { Mascot, Island, INK } = window.FlockUI;
  const D = window.Desk;
  const C = window.Cast;
  const { B, BAR } = C;

  const IDS = ['main', 'work', 'client', 'research'];
  const TILE = {
    client: [14, 44, 940, 481],
    work: [966, 44, 940, 481],
    main: [14, 537, 940, 481],
    research: [966, 537, 940, 481],
  };
  const ISL_X = 560; // the island window's left edge on the desktop (800 px wide, centred)
  const ISL_TOP = [962, 15];

  const T = {
    start: BAR(8), // 14.925
    end: BAR(32),
    jump: (i) => BAR(8) + 0.07 * i, // i = 0 leader, 1..4 minis
    fly: 0.62,
    openIsl1: B(39), // 18.157
    heroWork: B(42),
    heroClient: B(44),
    heroResearch: B(46),
    heroClient2: B(48), // 22.313
    clickOpen: B(50), // 23.236
    clientRun: B(54), // 25.08
    closeIsl1: 24.1,
    openIsl2: 28.65,
    clickAll: BAR(16), // 29.70
    closeIsl2: 30.0,
    run: { main: 30.12, work: 30.45, research: 30.67 }, // the deal accelerates: 0.33 s, then 0.22 s
    focusWork: B(73), // 33.856
    pullBack: 37.55, // the edge close-up holds ~2.6 s
    atIn: B(84), // 38.93
    atSel: [B(84), B(85), B(86)],
    atOut: B(87), // 40.32
    tbHover: 41.75,
    tbClick: B(93), // 43.09
    openIsl3: 46.95,
    heroWork3: B(103), // 47.70
    clickSession: B(107), // 49.555
    closeIsl3: 49.75,
    openIsl4: 52.2,
    clickNew: B(115), // 53.25
    closeIsl4: 53.45,
  };
  C.T_DESK1 = T;

  const CAM = [
    [T.start, { zoom: 0.84, y: 548, radius: 22 }],
    [T.start + 1.5, { zoom: 2.8, y: 193, radius: 0 }],
    [T.openIsl1 - 0.1, { zoom: 2.8, y: 193 }],
    [T.openIsl1 + 0.9, { zoom: 1.85, y: 292 }],
    [T.clickOpen + 0.25, { zoom: 1.85, y: 292 }],
    [T.clickOpen + 1.25, { zoom: 1 }],
    [T.clientRun + 0.3, { zoom: 1 }],
    [T.clientRun + 1.7, { zoom: 1.3, x: 760, y: 420 }], // a closer look: its own chats, signed in
    [T.openIsl2 - 0.95, { zoom: 1.3, x: 760, y: 420 }],
    [T.openIsl2 + 0.6, { zoom: 1.42, y: 380 }],
    [T.clickAll + 0.05, { zoom: 1.42, y: 380 }],
    [T.clickAll + 0.9, { zoom: 0.9, y: 548, rx: 5, radius: 16 }],
    [T.clickAll + 2.1, { zoom: 1 }],
    [T.focusWork + 0.15, { zoom: 1 }],
    [T.focusWork + 1.0, { zoom: 3.0, x: 1012, y: 180 }],
    [T.pullBack, { zoom: 3.0, x: 1012, y: 180 }],
    [T.pullBack + 0.8, { zoom: 1 }],
    [T.atOut + 0.25, { zoom: 1 }],
    [T.atOut + 1.05, { zoom: 2.3, y: 845 }],
    [T.tbClick + 0.25, { zoom: 2.3, y: 845 }],
    [T.tbClick + 1.1, { zoom: 1 }],
    [T.openIsl3 - 0.05, { zoom: 1 }],
    [T.openIsl3 + 0.85, { zoom: 1.85, y: 292 }],
    [T.clickSession + 0.05, { zoom: 1.85, y: 292 }],
    [T.clickSession + 1.05, { zoom: 1.6, x: 1320, y: 340 }],
    [T.openIsl4 - 0.6, { zoom: 1.6, x: 1320, y: 340 }],
    [T.openIsl4 + 0.3, { zoom: 1.85, x: 960, y: 292 }],
    [T.clickNew + 0.1, { zoom: 1.85, x: 960, y: 292 }],
    [T.clickNew + 1.0, { zoom: 1.6, x: 1320, y: 340 }],
    [T.clickNew + 2.0, { zoom: 1.6, x: 1320, y: 340 }],
    [T.clickNew + 3.0, { zoom: 1 }],
  ];

  // Account states over time
  const S = (o) => ({ signedIn: true, running: false, ...o });
  const STATES = {
    main: [[0, S({})], [T.clickAll + 0.08, S({ launching: true })], [T.run.main, S({ running: true, since: 'just now' })], [44, S({ running: true, since: '14m' })]],
    work: [[0, S({})], [T.clickAll + 0.18, S({ launching: true })], [T.run.work, S({ running: true, since: 'just now' })], [44, S({ running: true, since: '14m' })]],
    client: [[0, S({})], [T.clickOpen + 0.2, S({ launching: true })], [T.clientRun, S({ running: true, since: 'just now' })], [44, S({ running: true, since: '19m' })]],
    research: [[0, S({})], [T.clickAll + 0.28, S({ launching: true })], [T.run.research, S({ running: true, since: 'just now' })], [44, S({ running: true, since: '14m' })]],
  };
  const FOCUS = [
    [0, null],
    [T.clientRun, 'client'],
    [T.run.research, 'research'],
    [T.focusWork, 'work'],
    [T.atOut, 'main'],
    [T.tbClick, 'client'],
    [T.clickSession + 0.3, 'work'],
  ];
  const landAt = { client: T.clientRun, main: T.run.main, work: T.run.work, research: T.run.research };

  F.scene({
    id: 'desk1',
    start: T.start,
    end: T.end,
    z: 5,
    build(el) {
      const d = D.Desktop({ wall: D.WALL });
      el.append(d.stage);

      // Claude windows (stand-ins), one per account
      const W = {};
      for (const id of IDS) {
        const a = C.byId[id];
        const variants = id === 'work'
          ? [C.CONTENT.work, C.CONTENT.workAuth, { side: ['New session', 'Auth middleware refactor', 'Pricing table redesign', 'Dashboard charts'], heading: 'New session', empty: 'What should we work on?', emptySub: 'New Code session' }]
          : [C.CONTENT[id]];
        const w = D.AppWindow({ title: `${a.name} — Claude`, color: a.color, variants, initial: 'Y', me: 'You' });
        w.place(...TILE[id]);
        d.windows.append(w.el);
        W[id] = w;
      }

      // Taskbar with a button per account (Flock gives each its own)
      const tb = D.Taskbar({ time: '10:24', date: '08/10/2026' });
      d.taskbarLayer.append(tb.el);
      const flockTray = new Mascot(INK, { calm: true, seed: 77 });
      tb.flockTray.append(flockTray.el);
      const TB = {};
      for (const id of ['main', 'work', 'client', 'research']) TB[id] = tb.addAccount(id, C.byId[id].color, C.byId[id].initial);
      // taskbar hover preview (Client A)
      const prevClone = W.client.el.cloneNode(true);
      prevClone.classList.add('tbp-clone');
      prevClone.style.left = '0px';
      prevClone.style.top = '0px';
      const tbPrev = h('div', { class: 'tb-preview' },
        h('div', { class: 'tbp-title' }, h('i', { class: 'at-icon', text: 'C', style: { '--c': C.byId.client.color } }), h('span', { text: 'Client A — Claude' })),
        h('div', { class: 'tbp-thumb' }, prevClone));
      d.overlay.append(tbPrev);

      // The island
      const ptr = D.Pointer([1540, 1180]);
      const isl = Island({
        accounts: IDS.map((id) => C.byId[id]),
        sessions: C.SESSIONS,
        states: STATES,
        open: [[T.openIsl1, T.closeIsl1], [T.openIsl2, T.closeIsl2], [T.openIsl3, T.closeIsl3], [T.openIsl4, T.closeIsl4]],
        hero: [[0, 'main'], [T.heroWork, 'work'], [T.heroClient, 'client'], [T.heroResearch, 'research'], [T.heroClient2, 'client'], [T.openIsl3 + 0.1, 'client'], [T.heroWork3, 'work']],
        focus: FOCUS,
        pointer: (t) => {
          const [x, y] = ptr.pos(t);
          return [x - ISL_X, y];
        },
      });
      d.islandLayer.append(isl.el);

      // Alt+Tab, in most-recently-used order
      const at2 = D.AltTab(['work', 'research', 'client', 'main'].map((id) => ({ title: `${C.byId[id].name} — Claude`, color: C.byId[id].color, initial: C.byId[id].initial, node: W[id].el })));
      d.overlay.append(at2.el);
      const keys = h('div', { class: 'mini-keys' }, h('span', { class: 'mini-key', text: 'Alt' }), h('b', { text: '+' }), h('span', { class: 'mini-key tab', text: 'Tab' }));
      d.overlay.append(keys);

      d.pointer.append(ptr.el);

      // Positions measured from the real layout (desktop px)
      const deskPt = (elx, fx = 0.5, fy = 0.5) => d.pointOf(elx, fx, fy);
      const rowPt = {};
      isl.rows.forEach((r) => { rowPt[r.a.id] = deskPt(r.el, 0.42, 0.5); });
      isl.sync(T.heroClient2 + 0.02);
      const openBtn = deskPt(isl.actionBtns.main, 0.42, 0.55);
      const allBtn = deskPt(isl.openAllBtn, 0.5, 0.5);
      isl.sync(T.heroWork3 + 0.02);
      const sessPt = deskPt(isl.sessionEls.work[1], 0.3, 0.5);
      const newBtn = deskPt(isl.actionBtns.new, 0.5, 0.55);
      const tbPt = {};
      for (const id of IDS) tbPt[id] = deskPt(TB[id], 0.5, 0.5);
      isl.sync(T.start);
      // minis and logo in the compact island (before anyone has focus)
      const miniPt = isl.minis.map((m) => deskPt(m.el));
      const logoPt = deskPt(isl.logo.el);

      // The pointer's path
      ptr.to(17.15, 0.85, ISL_TOP, { arc: -0.14 })
        .to(T.openIsl1 + 0.3, 0.55, rowPt.main)
        .to(T.heroWork - 0.32, 0.3, rowPt.work, { arc: 0 })
        .to(T.heroClient - 0.32, 0.3, rowPt.client, { arc: 0 })
        .to(T.heroResearch - 0.32, 0.3, rowPt.research, { arc: 0 })
        .to(T.heroClient2 - 0.32, 0.3, rowPt.client, { arc: 0 })
        .to(T.heroClient2 + 0.25, 0.55, openBtn)
        .click(T.clickOpen)
        .to(T.clickOpen + 0.35, 0.9, [1180, 760], { flick: false })
        .to(T.openIsl2 - 0.95, 0.75, ISL_TOP, { arc: 0.12 })
        .to(T.openIsl2 + 0.25, 0.55, allBtn)
        .click(T.clickAll)
        .to(T.clickAll + 0.12, 0.9, [1560, 760], { flick: false })
        .to(T.focusWork - 0.75, 0.6, [1520, 330])
        .click(T.focusWork)
        .to(T.atOut + 0.55, 0.7, tbPt.client.map((v, i) => v + (i ? -2 : 0)), { arc: 0.05 })
        .click(T.tbClick)
        .to(T.tbClick + 0.4, 0.8, [1180, 700], { flick: false })
        .to(T.openIsl3 - 0.75, 0.55, ISL_TOP, { arc: -0.1 })
        .to(T.heroWork3 - 0.45, 0.45, rowPt.work)
        .to(T.clickSession - 0.95, 0.6, sessPt)
        .click(T.clickSession)
        .to(T.clickSession + 0.35, 0.8, [1610, 470], { flick: false })
        .to(T.openIsl4 - 0.75, 0.55, ISL_TOP, { arc: 0.12 })
        .to(T.openIsl4 + 0.3, 0.5, newBtn)
        .click(T.clickNew)
        .to(T.clickNew + 0.3, 0.9, [1640, 520], { flick: false });

      // Mascots follow the pointer with their eyes (island.js lookAtPointer)
      const lookers = [...isl.minis, isl.logo, ...isl.rows.map((r) => r.pet), ...isl.heroes];
      lookers.forEach((m) => {
        m.lookAt = (t) => {
          const c = m._center;
          if (!c) return [0, 0];
          const [px, py] = ptr.pos(t);
          return [(px - c[0]) / 90, (py - c[1]) / 110];
        };
      });

      // The flock arrives: overlay flyers from the brand lockup into the island
      // (on the film root, above the brand scene that is still fading out)
      const fly = h('div', { class: 'flyers' });
      document.getElementById('film').append(fly);
      // it lives outside this scene's section, so it is shown/hidden for every frame
      F.after((t) => css(fly, { display: t >= T.start && t < T.start + 3 ? '' : 'none' }));
      const flyers = [C.LOCK.white, ...C.LOCK.row].map((L, i) => {
        const color = i === 0 ? INK : C.byId[IDS[i - 1]].color;
        const m = new Mascot(color, { seed: 1200 + i, shadow: false, size: 100 });
        m.move(T.jump(i), 'jump');
        if (i > 0) m.state(T.jump(i) + T.fly + 0.05, 'asleep');
        css(m.el, { position: 'absolute', left: '0', top: '0', width: '100px', height: '100px', display: 'none' });
        fly.append(m.el);
        return { m, L, i };
      });

      // Callouts and captions (screen space)
      const coEdge = D.Callout('Accent edge', 'the account’s colour, never over Claude', { color: C.byId.work.color, inline: true });
      const coIsl = D.Callout('Island', 'says which one you’re in', { color: C.byId.work.color, inline: true });
      el.append(coEdge.el, coIsl.el);
      const caps = [
        [16.0, T.heroClient2 - 0.2, D.Caption('The island', ['Every', 'account,', 'one', 'hover', 'away.'], { color: '#f5f6f8' })],
        [T.clickOpen + 0.2, T.clickAll - 0.15, D.Caption('Open an account', ['Its', 'own', 'Claude', 'window,', 'already', 'signed', 'in.'], { color: C.byId.client.color })],
        [T.clickAll + 0.25, T.focusWork - 0.1, D.Caption('Side by side', ['Or', 'open', 'them', 'all', 'at', 'once.'], { color: '#f5f6f8' })],
        [T.focusWork + 0.15, T.atIn - 0.2, D.Caption('Always know where you are', ['Each', 'window', 'wears', 'its', 'account’s', 'colour.'], { color: C.byId.work.color })],
        [T.atIn + 0.1, 44.1, D.Caption('Named everywhere', ['In', 'Alt+Tab,', 'on', 'the', 'taskbar,', 'on', 'the', 'island.'], { color: C.byId.main.color })],
        [T.openIsl3 + 0.2, T.clickSession + 1.4, D.Caption('Session peek', ['Your', 'recent', 'Code', 'sessions,', 'per', 'account.'], { color: C.byId.work.color })],
        [T.clickSession + 1.6, 56.9, D.Caption('In the right window', ['Jump', 'back', 'in,', 'or', 'start', 'fresh.'], { color: C.byId.work.color })],
      ];
      caps.forEach(([, , cp]) => el.append(cp.el));
      const fade = h('div', { class: 'desk-fade' });
      d.stage.after(fade);

      return { d, W, tb, TB, tbPrev, flockTray, isl, at2, keys, ptr, miniPt, logoPt, flyers, coEdge, coIsl, caps, fade, lookers };
    },

    update(_, c, t) {
      const { d, W, isl } = c;
      const cam = D.drift(D.camAt(t, CAM), t);
      d.camera(cam);

      // ── windows: arrive (grow out of the island / dealt), then wear focus
      const focusId = at(t, FOCUS);
      const focusEvents = FOCUS.map(([ft]) => ft);
      for (const id of IDS) {
        const w = W[id];
        const land = landAt[id];
        const [x, y, ww, hh] = TILE[id];
        const cx = x + ww / 2;
        const cy = y + hh / 2;
        const dur = id === 'client' ? 0.75 : 0.36;
        const k = prog(t, land - dur, land);
        if (t < land - dur) {
          css(w.el, { display: 'none' });
          continue;
        }
        let px;
        let py;
        let s;
        let rot = 0;
        if (id === 'client') {
          const e = E.out(k);
          px = lerp(960, cx, e);
          py = lerp(26, cy, e) - Math.sin(Math.PI * e) * 40;
          s = lerp(0.07, 1, e);
        } else {
          // deck-deal: a hard throw, then a small settle past the slot and back
          const e = F.bezier(0.3, 0, 0.2, 1)(k);
          px = lerp(960, cx, e);
          py = lerp(26, cy, e) - Math.sin(Math.PI * e) * 90;
          s = lerp(0.08, 1.03, e);
          rot = lerp(id === 'main' ? -7 : id === 'work' ? 6 : 4, 0, e);
          const settle = E.out(prog(t, land, land + 0.18));
          if (t >= land) s = lerp(1.03, 1, settle);
        }
        const op = clamp(k * 6);
        css(w.el, {
          display: '',
          opacity: op.toFixed(3),
          transform: `translate(${(px - cx).toFixed(2)}px, ${(py - cy).toFixed(2)}px) rotate(${rot.toFixed(3)}deg) scale(${s.toFixed(4)})`,
          transformOrigin: '50% 50%',
        });
        // the accent edge draws from the middle out once it lands, then wears focus
        const ek = E.out(prog(t, land, land + 0.35));
        const fk = transit(t, focusEvents, (x2) => (at(x2, FOCUS) === id ? 1 : 0), 0.25, E.ease);
        let pulse = 0;
        for (const [ft, fid] of FOCUS) if (fid === id && t >= ft && t < ft + 0.7) pulse = 1 - E.easeOut(prog(t, ft, ft + 0.7));
        w.setEdge(ek, fk, pulse);
        css(w.edge, { clipPath: `inset(0 ${(50 - 50 * ek).toFixed(2)}% 0 ${(50 - 50 * ek).toFixed(2)}%)` });
      }
      // Work window: open a session, then a new one
      {
        const w = W.work;
        const k1 = E.inOut(prog(t, T.clickSession + 0.3, T.clickSession + 0.7));
        const k2 = E.inOut(prog(t, T.clickNew + 0.25, T.clickNew + 0.6));
        if (t < T.clickNew + 0.25) w.showVariant(1, k1, 0);
        else w.showVariant(2, k2, 1);
        w.setComposer(t >= T.clickNew + 0.45, t, t >= T.clickNew + 0.25 ? 'Describe a task…' : 'Reply…');
      }

      // ── session peek: Work's rows embed one by one when it takes the stage
      isl.sessionEls.work.forEach((row, i) => {
        const a0 = T.heroWork3 + 0.04 + i * 0.075;
        const k = prog(t, a0, a0 + 0.42);
        const on = t >= T.heroWork3 - 0.01 && t < T.heroWork3 + 1.4;
        if (!on) {
          css(row, { transform: '', opacity: '' });
          css(row.querySelector('.row-seam'), { opacity: '0' });
          return;
        }
        const e = E.out(k);
        css(row, { transform: `perspective(600px) translateY(${(-16 * (1 - e)).toFixed(2)}px) rotateX(${(18 * (1 - e)).toFixed(2)}deg)`, opacity: clamp(k * 2.2).toFixed(3) });
        const sk = E.outCubic(prog(t, a0 + 0.3, a0 + 0.47));
        const so = 1 - prog(t, a0 + 0.47, a0 + 0.75);
        css(row.querySelector('.row-seam'), { transform: `scaleX(${sk.toFixed(3)})`, opacity: (t < a0 + 0.3 ? 0 : 0.9 * so).toFixed(3) });
      });

      // ── taskbar
      for (const id of IDS) {
        const b = c.TB[id];
        const k = E.back(prog(t, landAt[id] - 0.1, landAt[id] + 0.25));
        css(b, { display: t >= landAt[id] - 0.1 ? '' : 'none', transform: `scale(${k.toFixed(4)})`, opacity: clamp(k * 2).toFixed(3) });
        cls(b, 'focused', focusId === id);
      }
      c.flockTray.sync(t);
      {
        const k = E.out(prog(t, T.tbHover + 0.2, T.tbHover + 0.45)) * (1 - E.easeIn(prog(t, T.tbClick + 0.05, T.tbClick + 0.2)));
        const [bx] = d.pointOf(c.TB.client);
        css(c.tbPrev, { display: k > 0.002 ? '' : 'none', opacity: k.toFixed(3), transform: `translate(${(bx - 130).toFixed(1)}px, ${(1032 - 182 - 10 * (1 - k)).toFixed(1)}px)` });
      }

      // ── island
      isl.sync(t);
      // the flock hands over to the real minis once they have dozed off
      const minisOn = (i) => t >= T.jump(i + 1) + T.fly + 1.3;
      isl.minis.forEach((m, i) => css(m.el, { visibility: minisOn(i) ? 'visible' : 'hidden' }));
      css(isl.logo.el, { visibility: t >= T.jump(0) + T.fly ? 'visible' : 'hidden' });
      // the island shape grows in before they land
      const grow = E.spring(prog(t, T.start + 0.05, T.start + 0.5));
      css(isl.islandEl.parentElement, { opacity: clamp(grow * 2).toFixed(3), transform: `scale(${lerp(0.3, 1, grow).toFixed(4)})`, transformOrigin: '50% 0' });
      // eyes follow the pointer
      for (const m of c.lookers) {
        if (m.el.offsetParent) {
          m._center = d.pointOf(m.el);
          m.sync(t);
        }
      }

      // ── flyers: lockup → island (frame space, tracking the camera)
      c.flyers.forEach(({ m, L, i }) => {
        const t0 = T.jump(i);
        const t1 = t0 + T.fly;
        const target = i === 0 ? c.logoPt : c.miniPt[i - 1];
        const handover = i === 0 ? t1 : t1 + 1.3;
        const on = t >= T.start && t < handover; // waiting in the lockup until its turn to jump
        css(m.el, { display: on ? '' : 'none' });
        if (!on) return;
        const [fx, fy] = d.toFrame(target[0], target[1]);
        const endS = (i === 0 ? 21 : 16) * cam.zoom;
        const k = E.inOut(prog(t, t0 + 0.06, t1));
        const SC = C.LOCK_SCALE || 1;
        const lx = 960 + (L.x - 960) * SC;
        const ly = 540 + (L.y - 540) * SC;
        const x = (1 - k) * (1 - k) * lx + 2 * (1 - k) * k * lerp(lx, fx, 0.5) + k * k * fx;
        const cyy = fy + 30;
        const y = (1 - k) * (1 - k) * ly + 2 * (1 - k) * k * cyy + k * k * fy;
        const sz = lerp(L.s * SC, endS, E.inOut(prog(t, t0 + 0.06, t1)));
        css(m.el, { transform: `translate(${(x - sz / 2).toFixed(2)}px, ${(y - sz / 2).toFixed(2)}px) scale(${(sz / 100).toFixed(4)})`, transformOrigin: '0 0' });
        m.sync(t);
      });

      // ── Alt+Tab
      const atK = E.out(prog(t, T.atIn, T.atIn + 0.18)) * (1 - E.easeIn(prog(t, T.atOut, T.atOut + 0.14)));
      let sel = 1;
      T.atSel.forEach((st, i) => { if (t >= st) sel = i + 1; });
      c.at2.sync(atK, sel);
      const kk = E.out(prog(t, T.atIn - 0.25, T.atIn + 0.05)) * (1 - E.easeIn(prog(t, T.atOut, T.atOut + 0.25)));
      css(c.keys, { display: kk > 0.002 ? '' : 'none', opacity: kk.toFixed(3), transform: `translate(-50%, ${(12 * (1 - kk)).toFixed(1)}px)` });
      let tabPress = 0;
      for (const st of T.atSel) if (t >= st - 0.04 && t < st + 0.16) tabPress = 1 - Math.abs((t - st - 0.04) / 0.12);
      css(c.keys.querySelector('.tab'), { transform: `translateY(${(3 * clamp(tabPress)).toFixed(2)}px)`, filter: `brightness(${(1 + 0.5 * clamp(tabPress)).toFixed(3)})` });

      // ── callouts (identity close-up)
      {
        const kIn = prog(t, T.focusWork + 1.0, T.focusWork + 1.7);
        const kOut = prog(t, T.pullBack - 0.3, T.pullBack - 0.05);
        const a = d.toFrame(1075, 44.5);
        c.coEdge.sync(a, [a[0] + 40, 66], kIn, kOut);
        const kIn2 = prog(t, T.focusWork + 1.3, T.focusWork + 2.0);
        const left = isl.islandEl.getBoundingClientRect();
        const fr = document.getElementById('film').getBoundingClientRect();
        const zf = fr.width / 1920 || 1;
        const b2 = [(left.left - fr.left) / zf - 2, 50];
        c.coIsl.sync(b2, [b2[0] - 34, 66], kIn2, kOut);
      }

      // ── captions
      c.caps.forEach(([a, b, cp]) => {
        const on = t >= a - 0.3 && t < b + 0.4;
        css(cp.el, { display: on ? '' : 'none' });
        if (on) cp.sync(t, a, b);
      });

      // ── pointer (hidden until it enters)
      c.ptr.sync(t, 1);
      css(c.ptr.el, { display: t > 17.1 ? '' : 'none' });

      // fade in from the brand
      css(c.fade, { opacity: (1 - E.easeOut(prog(t, T.start, T.start + 0.5))).toFixed(3) });
    },
  });
})();
