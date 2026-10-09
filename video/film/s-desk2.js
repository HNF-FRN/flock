// S8–S10 — second take on the desktop:
// Add account (name, colour, its own ~/.claude) → sign in once (the e-mail
// link comes back to the waiting window, not Main) → out of the way (the
// island steps aside for a browser's tabs; rest on the edge to bring it back).
(function () {
  'use strict';
  const F = window.Film;
  const { h, css, cls, text, E, prog, lerp, clamp, transit, at } = F;
  const { Mascot, Island, Settings, INK, I } = window.FlockUI;
  const D = window.Desk;
  const C = window.Cast;
  const { B, BAR } = C;

  const IDS = ['main', 'work', 'client', 'research', 'side'];
  const TILE = {
    client: [14, 44, 940, 481],
    work: [966, 44, 940, 481],
    main: [14, 537, 940, 481],
    research: [966, 537, 940, 481],
  };
  const SIDE = [410, 150, 1100, 660];
  const ISL_X = 560;
  const NAME = 'Side project';

  const T = {
    start: BAR(32), // 59.25
    setOpen: 59.3,
    clickAdd: B(130), // 60.17
    clickName: B(132), // 61.10
    type0: 61.27,
    rate: 0.082,
    clickPink: B(135), // 62.48
    clickYellow: B(136), // 62.94
    clickOwn: B(138), // 63.87
    clickSave: B(142), // 65.71
    setClose: 66.25,
    sideLand: B(145), // 67.10
    clickEmail: B(148), // 68.48
    mailIn: B(149), // 68.95
    clickSignIn: B(153), // 70.79
    linkUp: B(153) + 0.08,
    linkCatch: B(155), // 71.72
    linkLand: B(157), // 72.64
    build: BAR(40), // 74.02
    mailOut: BAR(40) + 0.6,
    browserIn: BAR(42), // 77.72
    tuck: B(170) + 0.08, // 78.72: once the camera has settled on the tabs
    clickTab: B(172), // 79.56
    dwell: 80.32,
    back: 80.97,
    leave: 82.15,
    end: BAR(45) + 0.25,
  };
  C.T_DESK2 = T;

  const CAM = [
    [T.start, { zoom: 1 }],
    [T.setOpen + 0.05, { zoom: 1 }],
    [T.clickAdd - 0.05, { zoom: 1.24, y: 520 }],
    [T.clickAdd + 0.1, { zoom: 1.24, y: 520 }],
    [T.clickAdd + 0.85, { zoom: 1.72, y: 548 }],
    [T.clickOwn - 0.45, { zoom: 1.72, y: 548 }],
    [T.clickOwn + 0.25, { zoom: 2.3, x: 916, y: 620 }],
    [T.clickSave - 0.85, { zoom: 2.3, x: 916, y: 620 }],
    [T.clickSave - 0.2, { zoom: 1.72, y: 560 }],
    [T.clickSave + 0.2, { zoom: 1.72, y: 560 }],
    [T.clickSave + 1.1, { zoom: 1 }],
    [T.sideLand + 0.15, { zoom: 1 }],
    [T.sideLand + 0.95, { zoom: 1.55, x: 960, y: 474 }],
    [T.mailIn - 0.05, { zoom: 1.55, x: 960, y: 474 }],
    [T.mailIn + 0.6, { zoom: 1.22, x: 800, y: 428, radius: 10 }],
    [T.linkLand + 0.1, { zoom: 1.22, x: 800, y: 428, radius: 10 }],
    [T.linkLand + 0.95, { zoom: 1.34, x: 960, y: 420, radius: 10 }],
    [T.build + 0.5, { zoom: 1.34, x: 960, y: 420, radius: 10 }],
    [T.build + 1.5, { zoom: 2.9, x: 960, y: 186.2, radius: 0 }],
    [T.browserIn - 0.35, { zoom: 2.9, x: 960, y: 186.2 }],
    [T.browserIn + 0.15, { zoom: 1 }],
    [T.browserIn + 1.0, { zoom: 2.05, y: 263.4 }],
  ];

  const S = (o) => ({ signedIn: true, running: true, since: '20m', ...o });
  const STATES = {
    main: [[0, S({})]],
    work: [[0, S({})]],
    client: [[0, S({ since: '25m' })]],
    research: [[0, S({})]],
    side: [[0, { running: false, signedIn: false }], [T.clickSave, { launching: true, signedIn: false }], [T.sideLand, { running: true, signedIn: false, capturing: { scope: 'signin' } }], [T.linkLand + 0.05, { running: true, signedIn: true, since: 'just now' }]],
  };
  const FOCUS = [[0, 'work'], [T.sideLand, 'side'], [T.mailIn, 'side'], [T.browserIn, null]];
  const TYPED = (t) => NAME.slice(0, clamp(Math.floor((t - T.type0) / T.rate) + 1, 0, NAME.length));

  F.scene({
    id: 'desk2',
    start: T.start,
    end: T.end,
    z: 6,
    build(el) {
      const d = D.Desktop({ wall: D.WALL });
      el.append(d.stage);
      const W = {};
      for (const id of ['client', 'work', 'main', 'research']) {
        const a = C.byId[id];
        const variants = id === 'work'
          ? [{ side: ['New session', 'Auth middleware refactor', 'Pricing table redesign', 'Dashboard charts'], heading: 'New session', empty: 'What should we work on?', emptySub: 'client-portal · Code' }]
          : [C.CONTENT[id]];
        const w = D.AppWindow({ title: `${a.name} — Claude`, color: a.color, variants, initial: 'Y', me: 'You' });
        w.place(...TILE[id]);
        d.windows.append(w.el);
        W[id] = w;
      }
      // the new account's window: a sign-in screen, then a fresh session
      const side = D.AppWindow({ title: `${NAME} — Claude`, color: C.byId.side.color, variants: [{ side: [], heading: 'New session', empty: 'What should we work on?', emptySub: 'Code' }], initial: 'Y', me: 'You' });
      side.place(...SIDE);
      const gBtn = h('div', { class: 'sx-btn' }, h('i', { class: 'sx-g' }), h('span', { text: 'Continue with Google' }));
      const eBtn = h('div', { class: 'sx-btn' }, h('i', { class: 'sx-e', html: '<svg viewBox="0 0 16 16" width="16" height="16"><rect x="2" y="3.5" width="12" height="9" rx="1.8" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="m2.6 4.4 5.4 4.2 5.4-4.2" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>' }), h('span', { text: 'Continue with email' }));
      const signA = h('div', { class: 'sx-step' }, h('div', { class: 'sx-title', text: 'Sign in' }), h('div', { class: 'sx-sub', text: 'to start using this account' }), gBtn, eBtn);
      const signB = h('div', { class: 'sx-step' }, h('div', { class: 'sx-mail', html: '<svg viewBox="0 0 48 48" width="56" height="56"><rect x="5" y="11" width="38" height="27" rx="5" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="m7 14 17 13 17-13" fill="none" stroke="currentColor" stroke-width="2.2"/></svg>' }), h('div', { class: 'sx-title', text: 'Check your inbox' }), h('div', { class: 'sx-sub', text: 'We sent you a sign-in link.' }));
      const signScreen = h('div', { class: 'sx-screen' }, signA, signB);
      side.main.append(signScreen);
      d.windows.append(side.el);

      // Flock's settings window
      const set = Settings({
        newColor: '#FACC15',
        accounts: [
          { id: 'main', name: 'Main', note: 'Claude’s own data folder', color: C.byId.main.color, sub: 'Claude (default) · ~\\.claude (shared)', auto: true },
          { id: 'work', name: 'Work', note: 'Team account', color: C.byId.work.color, sub: 'Claude-Work · ~\\.claude-work (own)', auto: true },
          { id: 'client', name: 'Client A', color: C.byId.client.color, sub: 'Claude-Client-A · ~\\.claude (shared)' },
          { id: 'research', name: 'Research', color: C.byId.research.color, sub: 'Claude-Research · ~\\.claude-work (with Work)' },
          { id: 'side', name: NAME, color: C.byId.side.color, sub: 'Claude-Side-project · ~\\.claude-side-project (own)' },
        ],
      });
      css(set.el, { left: '640px', top: '118px' });
      d.windows.append(set.el);

      // mail window (generic)
      const mail = h('div', { class: 'mailwin' },
        h('div', { class: 'mw-bar' }, h('span', { text: 'Mail' }), h('span', { class: 'aw-ctrls', html: '<span>—</span><span>▢</span><span>✕</span>' })),
        h('div', { class: 'mw-body' },
          h('div', { class: 'mw-list' },
            h('div', { class: 'mw-item on' }, h('b', { text: 'Sign-in' }), h('span', { text: 'Your sign-in link' })),
            h('div', { class: 'mw-item' }, h('b', { text: 'Design weekly' }), h('span', { text: 'Five layouts worth stealing' })),
            h('div', { class: 'mw-item' }, h('b', { text: 'Client A' }), h('span', { text: 'Re: onboarding copy' }))),
          h('div', { class: 'mw-read' },
            h('div', { class: 'mw-subject', text: 'Your sign-in link' }),
            h('div', { class: 'mw-from', text: 'Sign-in · just now' }),
            h('p', { text: 'Click the button to finish signing in on this device.' }),
            h('div', { class: 'mw-btn', text: 'Sign in' }))));
      d.overlay.append(mail);
      // the link travelling home
      const pill = h('div', { class: 'link-pill' }, h('i', { html: I.link }), h('span', { text: 'sign-in link' }));
      const trail = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      trail.setAttribute('class', 'link-trail');
      trail.setAttribute('width', '1920');
      trail.setAttribute('height', '1080');
      const trailPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      trail.append(trailPath);
      d.overlay.append(trail, pill);

      // a browser, maximised (generic)
      const tabs = ['Design tokens — Docs', 'Pricing page draft', 'Launch checklist', 'Analytics', 'Release notes', 'Inbox'];
      const tabEls = tabs.map((tt, i) => h('div', { class: `bw-tab${i === 2 ? ' on' : ''}` }, h('i'), h('span', { text: tt })));
      const browser = h('div', { class: 'browser' },
        h('div', { class: 'bw-tabs' }, ...tabEls, h('span', { class: 'bw-plus', text: '+' })),
        h('div', { class: 'bw-bar' }, h('span', { class: 'bw-nav', text: '←  →  ⟳' }), h('div', { class: 'bw-url', text: 'notes.local/launch-checklist' })),
        h('div', { class: 'bw-page' },
          h('div', { class: 'bw-pa' }, h('h1', { text: 'Launch checklist' }), h('p', { text: 'Twelve things to ship before Friday.' }), ...[1, 2, 3, 4, 5].map((k) => h('div', { class: 'bw-line', style: { width: `${92 - k * 9}%` } }))),
          h('div', { class: 'bw-pb' }, h('h1', { text: 'Analytics' }), h('p', { text: 'Weekly active, by plan.' }), h('div', { class: 'bw-chart' }, ...[38, 52, 46, 61, 58, 72, 80, 76, 88].map((v) => h('i', { style: { height: `${v}%` } }))))));
      d.windows.append(browser);

      // taskbar
      const tb = D.Taskbar({ time: '10:31', date: '08/10/2026' });
      d.taskbarLayer.append(tb.el);
      const flockTray = new Mascot(INK, { calm: true, seed: 78 });
      tb.flockTray.append(flockTray.el);
      const TB = {};
      for (const id of IDS) TB[id] = tb.addAccount(id, C.byId[id].color, C.byId[id].initial);

      const ptr = D.Pointer([1300, 760]);
      const isl = Island({
        accounts: IDS.map((id) => C.byId[id]),
        sessions: C.SESSIONS,
        states: STATES,
        open: [[T.back, T.leave + 0.38]],
        hero: [[0, 'side'], [T.back - 0.05, 'work']],
        focus: FOCUS,
        shown: [[0, 4], [T.clickSave + 0.1, 5]],
        tuck: [[0, false], [T.tuck, true], [T.back - 0.01, false], [T.leave + 0.38 + 0.32, true]],
        pointer: (t) => {
          const [x, y] = ptr.pos(t);
          return [x - ISL_X, y];
        },
      });
      d.islandLayer.append(isl.el);
      d.pointer.append(ptr.el);

      // positions from layout
      const P = (elx, fx = 0.5, fy = 0.5) => d.pointOf(elx, fx, fy);
      css(set.backdrop, { display: 'grid' });
      const pAdd = P(set.addBtn);
      // before "Its own" is chosen the sheet is shorter (and centred): name, swatches and the mode control
      css(set.dShared, { display: 'flex' });
      css(set.dOwn, { display: 'none' });
      const pName = P(set.nameIn, 0.3, 0.5);
      const pPink = P(set.swEls[3]);
      const pYellow = P(set.swEls[1]);
      const pOwn = P(set.modeBtns[1]);
      // …after it, the sheet is taller: Save
      css(set.dOwn, { display: 'flex' });
      css(set.dShared, { display: 'none' });
      const pSave = P(set.saveBtn);
      const pEmail = P(eBtn);
      const pMailBtn = P(mail.querySelector('.mw-btn'));
      css(set.dOwn, { display: '' });
      css(set.dShared, { display: '' });
      css(set.backdrop, { display: '' });
      const pTab = [930, 18];

      ptr.to(T.setOpen + 0.2, 0.62, pAdd)
        .click(T.clickAdd)
        .to(T.clickAdd + 0.28, 0.6, pName)
        .click(T.clickName)
        .to(T.clickName + 0.3, 0.22, [pName[0] + 6, pName[1] + 26], { flick: false })
        .to(T.clickPink - 0.42, 0.38, pPink)
        .click(T.clickPink)
        .to(T.clickYellow - 0.3, 0.26, pYellow, { arc: 0 })
        .click(T.clickYellow)
        .to(T.clickOwn - 0.6, 0.5, pOwn)
        .click(T.clickOwn)
        .to(T.clickSave - 0.65, 0.55, pSave)
        .click(T.clickSave)
        .to(T.clickSave + 0.3, 0.9, [1180, 900], { flick: false })
        .to(T.clickEmail - 0.85, 0.75, pEmail)
        .click(T.clickEmail)
        .to(T.mailIn + 0.55, 0.65, pMailBtn)
        .click(T.clickSignIn)
        .to(T.clickSignIn + 0.4, 0.8, [640, 860], { flick: false })
        .to(T.clickTab - 0.75, 0.55, pTab, { arc: -0.1 })
        .click(T.clickTab)
        .to(T.clickTab + 0.3, 0.45, [962, 1], { arc: 0.1 })
        .dwell(T.dwell, T.back, 'Rest on the top edge')
        .to(T.leave, 0.7, [1040, 430], { flick: false });

      const lookers = [...isl.minis, isl.logo, ...isl.rows.map((r) => r.pet), ...isl.heroes, set.sheetMascot];
      lookers.forEach((m) => {
        m.lookAt = (t) => {
          const c = m._center;
          if (!c) return [0, 0];
          const [px, py] = ptr.pos(t);
          return [(px - c[0]) / 90, (py - c[1]) / 110];
        };
      });

      const caps = [
        [T.clickAdd + 0.1, T.clickSave + 0.85, D.Caption('Add an account', ['Name', 'it,', 'colour', 'it,', 'choose', 'its', '~/.claude.'], { color: C.byId.side.color })],
        [T.sideLand + 0.1, T.build - 0.12, D.Caption('Sign in once', ['Sign-in', 'links', 'skip', 'Main', 'and', 'reach', 'the', 'right', 'window.'], { color: C.byId.side.color })],
        [T.build + 0.1, T.browserIn - 0.15, D.Caption('Remembered', ['Signed', 'in', 'once', '—', 'and', 'it', 'stays', 'that', 'way.'], { color: C.byId.side.color })],
        [T.browserIn + 0.4, T.end - 0.1, D.Caption('Out of your way', ['It', 'steps', 'aside', 'for', 'your', 'tabs.'], { color: '#f5f6f8' })],
      ];
      caps.forEach(([, , cp]) => el.append(cp.el));

      return { d, W, side, signA, signB, signScreen, eBtn, set, mail, pill, trail, trailPath, browser, tabEls, tb, TB, flockTray, ptr, isl, lookers, caps, pEmail, pMailBtn };
    },

    update(_, c, t) {
      const { d, W, isl, set } = c;
      d.camera(D.drift(D.camAt(t, CAM), t));
      const focusId = at(t, FOCUS);
      const fev = FOCUS.map(([x]) => x);

      // ── the four windows from before, then the new one
      for (const id of ['client', 'work', 'main', 'research']) {
        const fk = transit(t, fev, (x) => (at(x, FOCUS) === id ? 1 : 0), 0.25, E.ease);
        W[id].setEdge(1, fk, 0);
        if (id === 'work') W.work.setComposer(false, t);
      }
      {
        const land = T.sideLand;
        const k = prog(t, land - 0.75, land);
        const [x, y, ww, hh] = SIDE;
        const cx = x + ww / 2;
        const cy = y + hh / 2;
        const e = E.out(k);
        css(c.side.el, {
          display: t >= land - 0.75 ? '' : 'none',
          opacity: clamp(k * 6).toFixed(3),
          transform: `translate(${(lerp(960, cx, e) - cx).toFixed(2)}px, ${(lerp(26, cy, e) - Math.sin(Math.PI * e) * 40 - cy).toFixed(2)}px) scale(${lerp(0.07, 1, e).toFixed(4)})`,
          transformOrigin: '50% 50%',
        });
        const ek = E.out(prog(t, land, land + 0.35));
        const fk = transit(t, fev, (x2) => (at(x2, FOCUS) === 'side' ? 1 : 0), 0.25, E.ease);
        let pulse = 0;
        if (t >= T.linkLand && t < T.linkLand + 0.7) pulse = 1 - E.easeOut(prog(t, T.linkLand, T.linkLand + 0.7));
        c.side.setEdge(ek, fk, pulse);
        css(c.side.edge, { clipPath: `inset(0 ${(50 - 50 * ek).toFixed(2)}% 0 ${(50 - 50 * ek).toFixed(2)}%)` });
        // sign-in screen: choose → check inbox → signed in (fades to a fresh session)
        const aOut = E.easeIn(prog(t, T.clickEmail + 0.08, T.clickEmail + 0.24));
        const bIn = E.out(prog(t, T.clickEmail + 0.26, T.clickEmail + 0.6));
        css(c.signA, { opacity: (1 - aOut).toFixed(3), transform: `translateY(${(-8 * aOut).toFixed(2)}px)`, display: aOut < 0.999 ? '' : 'none' });
        css(c.signB, { opacity: bIn.toFixed(3), transform: `translateY(${(10 * (1 - bIn)).toFixed(2)}px)`, display: bIn > 0.001 ? '' : 'none' });
        // the sign-in screen clears first, then the fresh session rises in under it
        const kDone = E.easeIn(prog(t, T.linkLand + 0.05, T.linkLand + 0.28));
        css(c.signScreen, { opacity: (1 - kDone).toFixed(3), display: kDone < 0.999 ? '' : 'none' });
        const sIn = E.out(prog(t, T.linkLand + 0.3, T.linkLand + 0.75));
        css(c.side.convo, { opacity: (t < T.linkLand ? 1 : sIn).toFixed(3), transform: `translateY(${(t < T.linkLand ? 0 : 10 * (1 - sIn)).toFixed(2)}px)` });
        c.side.setComposer(t > T.linkLand + 0.5, t, 'Describe a task…');
      }

      // ── settings window + sheet
      {
        const open = E.out(prog(t, T.setOpen, T.setOpen + 0.28));
        const close = E.easeIn(prog(t, T.setClose, T.setClose + 0.3));
        css(set.el, {
          display: t >= T.setOpen && t < T.setClose + 0.32 ? '' : 'none',
          opacity: (open * (1 - close)).toFixed(3),
          transform: `translateY(${(close * 60).toFixed(2)}px) scale(${(lerp(0.97, 1, open) * lerp(1, 0.94, close)).toFixed(4)})`,
          transformOrigin: '50% 100%',
        });
        set.brandM.sync(t);
        // sheet: fade 0.18s + rise 0.34s spring (settings.css), closes on save
        const sOn = t >= T.clickAdd && t < T.clickSave + 0.2;
        const fadeIn = E.ease(prog(t, T.clickAdd, T.clickAdd + 0.18));
        const rise = E.spring(prog(t, T.clickAdd, T.clickAdd + 0.34));
        const shut = E.easeIn(prog(t, T.clickSave + 0.02, T.clickSave + 0.18));
        css(set.backdrop, { display: sOn ? 'grid' : 'none', opacity: (fadeIn * (1 - shut)).toFixed(3) });
        // keep the sheet's top steady when the mode detail grows (the app re-centres it)
        const grown = t >= T.clickOwn + 0.05;
        css(set.dShared, { display: grown ? 'none' : 'flex' });
        css(set.dOwn, { display: grown ? 'flex' : 'none' });
        const dh = c._dh || (c._dh = (() => { css(set.backdrop, { display: 'grid' }); const a2 = set.sheet.offsetHeight; css(set.dShared, { display: 'none' }); css(set.dOwn, { display: 'flex' }); const b2 = set.sheet.offsetHeight; css(set.dShared, { display: grown ? 'none' : 'flex' }); css(set.dOwn, { display: grown ? 'flex' : 'none' }); return b2 - a2; })());
        const slide = grown ? (1 - E.out(prog(t, T.clickOwn + 0.05, T.clickOwn + 0.35))) * (dh / 2) : 0;
        css(set.sheet, { transform: `translateY(${((1 - rise) * 14 + slide).toFixed(2)}px) scale(${lerp(0.98, 1, rise).toFixed(4)})`, opacity: clamp(rise * 1.6).toFixed(3) });
        // name typed at a person's pace
        const focus = t >= T.clickName && t < T.clickPink - 0.05;
        set.setName(t >= T.type0 ? TYPED(t) : '', focus, t);
        // colour: yellow (suggested) → pink → yellow; the mascot recolours live
        const col = t >= T.clickYellow ? '#FACC15' : t >= T.clickPink ? '#E879F9' : '#FACC15';
        set.swEls.forEach((s2, i) => cls(s2, 'on', set.PALETTE[i] === col));
        set.sheetMascot.colors.length = 0;
        set.sheetMascot.colors.push([-1e9, '#FACC15'], [T.clickPink, '#E879F9'], [T.clickYellow, '#FACC15']);
        if (!set.sheetMascot._mv) {
          set.sheetMascot._mv = true;
          set.sheetMascot.move(T.clickPink, 'jump').move(T.clickYellow, 'squish').move(T.clickAdd + 0.25, 'enter');
        }
        if (sOn) set.sheetMascot.sync(t);
        // ~/.claude: the thumb slides from Shared to Its own (segmented-thumb-hero: 8 frames, ease-out)
        const [b0, b1] = set.modeBtns;
        const k = E.outCubic(prog(t, T.clickOwn, T.clickOwn + 0.27));
        const x0 = b0.offsetLeft;
        const x1 = b1.offsetLeft;
        css(set.thumb, { left: `${lerp(x0, x1, k).toFixed(2)}px`, width: `${lerp(b0.offsetWidth, b1.offsetWidth, k).toFixed(2)}px` });
        cls(b0, 'lit', k < 0.5);
        cls(b1, 'lit', k >= 0.5);
        // the list gains the new account
        set.rows.forEach((r) => {
          const isNew = r.a.id === 'side';
          const on = !isNew || t >= T.clickSave + 0.1;
          css(r.r, { display: on ? '' : 'none' });
          if (isNew && on) {
            const ap = E.out(prog(t, T.clickSave + 0.1, T.clickSave + 0.5));
            css(r.r, { opacity: ap.toFixed(3), transform: `translateY(${(8 * (1 - ap)).toFixed(2)}px)` });
            r.pet.states.length = 0;
            r.pet.states.push([-100, 'launching', true]);
            text(r.tag, 'Opening…');
            r.tag.className = 'tag st warn';
            text(r.act, 'Show');
          } else {
            text(r.tag, 'Open');
            r.tag.className = 'tag st ok';
            text(r.act, 'Show');
          }
          r.pet.sync(t);
          if (r.chipM) r.chipM.sync(t);
          css(r.chip, { display: on ? '' : 'none' });
        });
        text(set.count, t >= T.clickSave + 0.1 ? '5' : '4');
        cls(set.addBtn, 'fx-hover', t > T.clickAdd - 0.25 && t < T.clickAdd + 0.1);
        cls(set.saveBtn, 'fx-hover', t > T.clickSave - 0.2 && t < T.clickSave + 0.1);
      }

      // ── mail and the link's journey home
      {
        const kIn = E.out(prog(t, T.mailIn, T.mailIn + 0.5));
        const kOut = E.inOut(prog(t, T.mailOut, T.mailOut + 0.5));
        css(c.mail, { display: kIn > 0.001 && kOut < 0.999 ? '' : 'none', opacity: (kIn * (1 - kOut)).toFixed(3), transform: `translate(${(-80 * (1 - kIn) - 120 * kOut).toFixed(2)}px, 0)` });
        cls(c.mail.querySelector('.mw-btn'), 'fx-hover', t > T.clickSignIn - 0.2 && t < T.clickSignIn + 0.15);
        const A = c.pMailBtn;
        cls(c.eBtn, 'fx-hover', t > T.clickEmail - 0.25 && t < T.clickEmail + 0.12);
        const M = [962, 18];
        const Z = [SIDE[0] + SIDE[2] / 2 + 100, SIDE[1] + SIDE[3] / 2];
        const up = E.inOut(prog(t, T.linkUp, T.linkCatch));
        const down = E.inOut(prog(t, T.linkCatch + 0.12, T.linkLand));
        let p;
        const bez = (a, b, cc, k) => [(1 - k) * (1 - k) * a[0] + 2 * (1 - k) * k * cc[0] + k * k * b[0], (1 - k) * (1 - k) * a[1] + 2 * (1 - k) * k * cc[1] + k * k * b[1]];
        if (t < T.linkCatch) p = bez(A, M, [560, 140], up);
        else if (t < T.linkCatch + 0.12) p = M;
        else p = bez(M, Z, [1320, 60], down);
        const on = t >= T.linkUp && t < T.linkLand + 0.2;
        const fade = 1 - E.easeIn(prog(t, T.linkLand - 0.05, T.linkLand + 0.15));
        const pop = E.back(prog(t, T.linkUp, T.linkUp + 0.3));
        css(c.pill, { display: on ? '' : 'none', opacity: fade.toFixed(3), transform: `translate(${p[0].toFixed(1)}px, ${p[1].toFixed(1)}px) translate(-50%, -50%) scale(${(pop * lerp(1, 0.6, prog(t, T.linkLand - 0.2, T.linkLand))).toFixed(4)})` });
        // a fading trail behind it
        const pts = [];
        for (let j = 0; j <= 16; j++) {
          const tt = t - j * 0.018;
          if (tt < T.linkUp) break;
          let q;
          if (tt < T.linkCatch) q = bez(A, M, [560, 140], E.inOut(prog(tt, T.linkUp, T.linkCatch)));
          else if (tt < T.linkCatch + 0.12) q = M;
          else q = bez(M, Z, [1320, 60], E.inOut(prog(tt, T.linkCatch + 0.12, T.linkLand)));
          pts.push(q);
        }
        c.trailPath.setAttribute('d', pts.length > 1 ? `M${pts.map((q) => `${q[0].toFixed(1)} ${q[1].toFixed(1)}`).join(' L')}` : '');
        css(c.trail, { display: on ? '' : 'none', opacity: fade.toFixed(3) });
      }
      // the island's own mascot catches the link
      if (!isl.logo._caught) {
        isl.logo._caught = true;
        isl.logo.move(T.linkCatch, 'twirl');
      }

      // ── browser (maximised): rises in, the island steps aside
      {
        const k = E.out(prog(t, T.browserIn, T.browserIn + 0.45));
        css(c.browser, { display: t >= T.browserIn ? '' : 'none', opacity: clamp(k * 3).toFixed(3), transform: `translateY(${(60 * (1 - k)).toFixed(2)}px) scale(${lerp(0.97, 1, k).toFixed(4)})` });
        c.tabEls.forEach((tb2, i) => cls(tb2, 'on', t >= T.clickTab ? i === 3 : i === 2));
        const pageB = t >= T.clickTab;
        css(c.browser.querySelector('.bw-pa'), { display: pageB ? 'none' : '' });
        css(c.browser.querySelector('.bw-pb'), { display: pageB ? '' : 'none' });
        text(c.browser.querySelector('.bw-url'), pageB ? 'notes.local/analytics' : 'notes.local/launch-checklist');
      }

      // ── taskbar
      for (const id of IDS) {
        const b = c.TB[id];
        const show = id !== 'side' || t >= T.sideLand - 0.1;
        css(b, { display: show ? '' : 'none' });
        cls(b, 'focused', focusId === id);
      }
      c.flockTray.sync(t);

      // ── island
      isl.sync(t);
      for (const m of c.lookers) {
        if (m.el.offsetParent) {
          m._center = d.pointOf(m.el);
          m.sync(t);
        }
      }

      // ── captions + pointer
      c.caps.forEach(([a, b, cp]) => {
        const on = t >= a - 0.3 && t < b + 0.4;
        css(cp.el, { display: on ? '' : 'none' });
        if (on) cp.sync(t, a, b);
      });
      c.ptr.sync(t, 1);
    },
  });
})();
