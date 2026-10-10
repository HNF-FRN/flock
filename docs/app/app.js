// Flock on your phone. Pairs with Flock on your PC (scan the code in Flock's
// settings), then lets you start Claude Code there in any of your accounts and
// any project folder, even a new one, and open the session in the Claude app.
// Everything goes through Flock's end-to-end encrypted relay (shared/relay.js);
// the key stays on this phone and your PC.
(function () {
  'use strict';

  const R = window.FlockRelay;
  const B = window.FlockMascot;
  const ANDROID = window.FlockAndroid || null; // inside Flock for Android (android/): a QR scanner and the phone's name
  const app = document.getElementById('app');
  const PAIR_KEY = 'flock.pairing';
  const REQUEST_MS = 25000;
  const PC_SILENT = 'Your PC didn’t answer. It has to be on and awake, with Flock running and phone access on.';

  const S = {
    pairing: null, // { server, topic, key, name }
    link: null,
    linkStatus: 'offline',
    pc: null, // { name, version }
    accounts: [],
    servers: new Map(),
    loaded: false,
    error: null,
    view: { v: 'home' },
  };

  // ── Little helpers ────────────────────────────────────────────────────────

  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'style') el.style.cssText = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false) continue;
      el.appendChild(typeof kid === 'string' ? document.createTextNode(kid) : kid);
    }
    return el;
  }

  const ICON = {
    back: '<path d="M10 3.5 5.5 8l4.5 4.5"/>',
    chev: '<path d="m6 3.5 4.5 4.5L6 12.5"/>',
    folder: '<path d="M2.2 4.6c0-.7.5-1.2 1.2-1.2h2.8l1.4 1.5h5c.7 0 1.2.5 1.2 1.2v5.6c0 .7-.5 1.2-1.2 1.2H3.4c-.7 0-1.2-.5-1.2-1.2z"/>',
    plus: '<path d="M8 3v10M3 8h10"/>',
    up: '<path d="M8 13V3.5M3.8 7.6 8 3.4l4.2 4.2"/>',
    gear: '<circle cx="8" cy="8" r="2"/><path d="M8 1.8v1.6M8 12.6v1.6M1.8 8h1.6M12.6 8h1.6M3.6 3.6l1.1 1.1M11.3 11.3l1.1 1.1M3.6 12.4l1.1-1.1M11.3 4.7l1.1-1.1"/>',
    open: '<path d="M9 2.8h4.2V7M13 3 7.4 8.6M11.6 9.6v2.6c0 .6-.4 1-1 1H3.8c-.6 0-1-.4-1-1V5.4c0-.6.4-1 1-1h2.6"/>',
    refresh: '<path d="M13 8a5 5 0 1 1-1.5-3.6M13 2.8v2.6h-2.6"/>',
    scan: '<path d="M2.5 5.5v-2a1 1 0 0 1 1-1h2M10.5 2.5h2a1 1 0 0 1 1 1v2M13.5 10.5v2a1 1 0 0 1-1 1h-2M5.5 13.5h-2a1 1 0 0 1-1-1v-2M4.8 8h6.4"/>',
    warn: '<path d="M8 2.6 14 13H2z"/><path d="M8 6.6v3M8 11.6v.1"/>',
    chat: '<path d="M2.8 4.3c0-.8.7-1.5 1.5-1.5h7.4c.8 0 1.5.7 1.5 1.5v5c0 .8-.7 1.5-1.5 1.5H7.2L4.4 13v-2.2h-.1c-.8 0-1.5-.7-1.5-1.5z"/>',
  };

  function icon(name) {
    const s = h('span', { class: 'ic', 'aria-hidden': 'true' });
    s.innerHTML = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${ICON[name]}</svg>`;
    return s;
  }

  function mascot(color, state, cls) {
    const m = B.create(color, state);
    if (cls) m.classList.add(cls);
    m.addEventListener('click', () => B.poke(m));
    return m;
  }

  function ago(t) {
    if (!t) return '';
    const m = Math.round((Date.now() - t) / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m} min ago`;
    const hrs = Math.round(m / 60);
    if (hrs < 24) return `${hrs} h ago`;
    const d = Math.round(hrs / 24);
    return d < 30 ? `${d} d ago` : new Date(t).toLocaleDateString();
  }

  function base(p) {
    return String(p || '').split(/[\\/]/).filter(Boolean).pop() || p;
  }

  /** A long path cut from the left, keeping the part that tells folders apart. */
  function short(p, max = 42) {
    const s = String(p || '');
    return s.length <= max ? s : `…${s.slice(s.length - max + 1)}`;
  }

  let toastT = 0;
  function toast(text, tone) {
    const t = document.getElementById('toast');
    t.textContent = text;
    t.className = `show ${tone || ''}`;
    clearTimeout(toastT);
    toastT = setTimeout(() => { t.className = ''; }, 4200);
  }

  function deviceName() {
    if (ANDROID) {
      try { return String(ANDROID.device()).slice(0, 40) || 'Android phone'; } catch {}
    }
    const ua = navigator.userAgent;
    if (/iPhone/.test(ua)) return 'iPhone';
    if (/iPad/.test(ua)) return 'iPad';
    if (/Android/.test(ua)) return /Mobile/.test(ua) ? 'Android phone' : 'Android tablet';
    return 'Browser';
  }

  // ── The link to the PC ────────────────────────────────────────────────────

  const pending = new Map(); // request id -> { resolve, reject, timer }

  function request(t, data, ms) {
    return new Promise((resolve, reject) => {
      if (!S.link) { reject(new Error('This phone isn’t paired with a PC.')); return; }
      const id = R.newId();
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(PC_SILENT)); }, ms || REQUEST_MS);
      pending.set(id, { resolve, reject, timer });
      S.link.send({ ...(data || {}), t, id }).catch((e) => {
        clearTimeout(timer);
        pending.delete(id);
        reject(new Error(/fetch|network/i.test(String(e && e.message)) ? 'No connection. Check your phone’s internet.' : e.message));
      });
    });
  }

  function onMessage(m) {
    if (m.t === 're') {
      const p = pending.get(m.re);
      if (!p) return;
      pending.delete(m.re);
      clearTimeout(p.timer);
      if (m.ok) p.resolve(m.data);
      else p.reject(new Error(m.error || 'Something went wrong on your PC.'));
    } else if (m.t === 'server' && m.server) {
      S.servers.set(m.server.id, m.server);
      render();
    }
  }

  function connect(pairing) {
    if (S.link) S.link.close();
    S.link = R.connect({
      ...pairing,
      role: 'phone',
      onMessage,
      onStatus: (s) => { S.linkStatus = s; paintStatus(); },
    });
    return S.link.ready;
  }

  function takeState(data) {
    S.pc = data.pc;
    S.accounts = data.accounts || [];
    S.servers = new Map((data.servers || []).map((x) => [x.id, x]));
    S.loaded = true;
    S.error = null;
  }

  async function refresh() {
    try {
      takeState(await request('state'));
    } catch (e) {
      S.error = e.message;
    }
    render();
  }

  // ── Pairing ───────────────────────────────────────────────────────────────

  function savedPairing() {
    try { return R.decodePairing(localStorage.getItem(PAIR_KEY) || '') || null; } catch { return null; }
  }

  async function pairWith(text) {
    const p = R.decodePairing(text);
    if (!p) throw new Error('That isn’t a Flock pairing code. Show a new one on your PC.');
    await connect(p);
    const data = await request('hello', { device: { name: deviceName() } }, 20000).catch(() => {
      throw new Error('Your PC didn’t answer. The code works for 10 minutes and only while Flock shows it: show a new one and scan again.');
    });
    localStorage.setItem(PAIR_KEY, text);
    S.pairing = p;
    takeState(data);
    toast(`Paired with ${data.pc && data.pc.name ? data.pc.name : 'your PC'}`, 'ok');
  }

  async function unpair() {
    try { await request('forget', {}, 8000); } catch {}
    localStorage.removeItem(PAIR_KEY);
    if (S.link) S.link.close();
    S.link = null;
    S.pairing = null;
    S.loaded = false;
    S.accounts = [];
    S.servers = new Map();
    go({ v: 'pair' }, true);
  }

  // ── Navigation ────────────────────────────────────────────────────────────

  function go(view, replace) {
    S.view = view;
    if (replace) history.replaceState(view, '');
    else history.pushState(view, '');
    closeSheet();
    render();
    window.scrollTo(0, 0);
  }

  window.addEventListener('popstate', (e) => {
    if (!sheetOpen()) {
      S.view = e.state || { v: S.pairing ? 'home' : 'pair' };
      render();
    } else {
      closeSheet();
      history.pushState(S.view, '');
    }
  });

  // ── Bottom sheet ──────────────────────────────────────────────────────────

  const sheetWrap = document.getElementById('sheet-wrap');
  const sheet = document.getElementById('sheet');

  function sheetOpen() {
    return !sheetWrap.classList.contains('hidden');
  }

  function openSheet(...kids) {
    sheet.innerHTML = '';
    sheet.append(h('div', { class: 'grab' }), ...kids);
    sheetWrap.classList.remove('hidden');
    void sheetWrap.offsetWidth; // lay it out closed first, so opening it slides (no frame callback: paused in the background)
    sheetWrap.classList.add('open');
  }

  function closeSheet() {
    sheetWrap.classList.remove('open');
    sheetWrap.classList.add('hidden');
    sheet.innerHTML = '';
  }

  sheetWrap.addEventListener('click', (e) => { if (e.target === sheetWrap) closeSheet(); });

  // ── Shared pieces ─────────────────────────────────────────────────────────

  function topbar(title, opts) {
    const o = opts || {};
    return h('header', { class: 'topbar' },
      o.back ? h('button', { class: 'iconbtn', 'aria-label': 'Back', onclick: () => history.back() }, icon('back')) : h('span', { class: 'brand' }, mascot(B.INK, 'awake', 'brand-m')),
      h('div', { class: 'tb-title' }, h('b', { text: title }), o.sub ? h('span', { class: 'tb-sub', text: o.sub }) : null),
      o.right || null);
  }

  function statusPill() {
    return h('span', { class: 'pill', id: 'pill' });
  }

  function paintStatus() {
    const p = document.getElementById('pill');
    if (!p) return;
    const s = S.linkStatus === 'online' ? (S.error ? 'away' : 'online') : S.linkStatus;
    p.className = `pill ${s}`;
    p.textContent = { online: 'Online', away: 'Not answering', connecting: 'Connecting', offline: 'Offline' }[s] || s;
  }

  function busy(btn, on, label) {
    if (on) {
      btn.dataset.label = btn.textContent;
      btn.textContent = label || 'Working…';
      btn.disabled = true;
    } else {
      btn.textContent = btn.dataset.label || btn.textContent;
      btn.disabled = false;
    }
  }

  const PROBLEMS = {
    'signed-out': 'Claude Code isn’t signed in for this account on your PC.',
    'other-account': 'Claude Code on your PC is signed in to another Claude account here.',
    renew: 'Claude Code on your PC has to be signed in again here: another account may have taken over its sign-in.',
    'not-claude-ai': 'Claude Code uses an API key here; Remote Control needs a claude.ai sign-in.',
    unsupported: 'It shares ~/.claude, and so its Claude Code sign-in, with another account. Give it its own ~/.claude in Flock.',
    'no-cli': 'Claude Code isn’t installed on your PC.',
    unknown: 'Flock couldn’t check Claude Code for this account.',
  };

  function problemOf(a) {
    const c = a.cli || {};
    if (c.problem === 'unsupported' && c.holder) return `It shares ~/.claude, and so its Claude Code sign-in, with ${c.holder}. Give it its own ~/.claude in Flock.`;
    return PROBLEMS[c.problem] || PROBLEMS.unknown;
  }

  function usageBits(u) {
    if (!u) return null;
    const bit = (label, v) => {
      if (v == null) return null;
      const tone = v >= 90 ? 'hot' : v >= 70 ? 'warm' : '';
      return h('span', { class: `use ${tone}` },
        h('span', { class: 'use-k', text: label }),
        h('span', { class: 'use-bar' }, h('i', { style: `width:${Math.max(3, v)}%` })),
        h('span', { class: 'use-v', text: `${Math.round(v)}%` }));
    };
    // Claude samples usage only while the account's window runs, so say how old it is.
    const old = Date.now() - u.t > 30 * 60000 ? h('span', { class: 'use-age', text: ago(u.t) }) : null;
    return h('div', { class: 'uses' }, bit('5h', u.fh), bit('Week', u.sd), old);
  }

  // ── Views ─────────────────────────────────────────────────────────────────

  function viewPair() {
    const err = h('p', { class: 'note err hidden' });
    const fail = (text) => {
      err.textContent = text;
      err.classList.remove('hidden');
    };
    const pairFrom = async (text, btn) => {
      const m = /#p=([A-Za-z0-9_-]+)/.exec(String(text || '').trim());
      err.classList.add('hidden');
      busy(btn, true, 'Pairing…');
      try {
        await pairWith(m ? m[1] : String(text || '').trim());
        go({ v: 'home' }, true);
      } catch (e) {
        fail(e.message);
      }
      busy(btn, false);
    };
    const input = h('input', { type: 'url', placeholder: 'Or paste the pairing link', autocomplete: 'off', spellcheck: 'false' });
    const pasteBtn = h('button', { class: 'btn secondary', text: 'Pair' });
    pasteBtn.addEventListener('click', () => pairFrom(input.value, pasteBtn));

    // In Flock for Android the app reads the code itself, with Google's scanner.
    let scanBtn = null;
    if (ANDROID) {
      scanBtn = h('button', { class: 'btn primary big' }, icon('scan'), 'Scan the code');
      scanBtn.addEventListener('click', () => {
        err.classList.add('hidden');
        window.flockScanned = (text) => pairFrom(text, scanBtn);
        window.flockScanFailed = (msg) => fail(`The scanner didn’t open${msg ? ` (${msg})` : ''}. Paste the pairing link instead.`);
        window.flockScanCancelled = () => {};
        ANDROID.scan();
      });
      // A pairing link opened with the app (from the camera app) arrives the same way.
      window.flockScanned = (text) => pairFrom(text, scanBtn);
    }

    const trio = h('div', { class: 'trio' },
      mascot('#38BDF8', 'asleep', 't1'), mascot(B.CLAUDE_ORANGE, 'awake', 't2'), mascot('#4ADE80', 'alert', 't3'));
    const steps = ANDROID
      ? [
        h('li', {}, 'On your PC, open ', h('b', { text: 'Flock → Settings → Phone' }), ' and press ', h('b', { text: 'Pair a phone' }), '.'),
        h('li', {}, 'Tap ', h('b', { text: 'Scan the code' }), ' below and point your camera at the code on your PC.')]
      : [
        h('li', {}, 'On your PC, open ', h('b', { text: 'Flock → Settings → Phone' }), ' and press ', h('b', { text: 'Pair a phone' }), '.'),
        h('li', {}, 'Scan the code with your phone’s camera. It opens this page and pairs it.'),
        h('li', {}, 'Add this page to your home screen, so Flock is one tap away.')];
    return h('div', { class: 'page pair' },
      trio,
      h('h1', { text: 'Flock, on your phone' }),
      h('p', { class: 'lead', text: 'Start Claude Code on your PC from here, in any of your accounts and any project folder, and pick it up in the Claude app.' }),
      h('ol', { class: 'steps' }, steps),
      scanBtn,
      h('div', { class: 'paste' }, input, pasteBtn),
      err);
  }

  function serverCard(s) {
    const tone = { ready: 'ok', asking: 'warn', starting: 'warn', failed: 'err', stopped: '' }[s.status];
    const reopened = s.kind === 'session';
    const text = s.status === 'ready'
      ? reopened ? 'Remote Control on' : s.sessions.length ? `Running · ${s.sessions.length} session${s.sessions.length > 1 ? 's' : ''}` : 'Running'
      : { asking: 'Claude Code asks you something', starting: 'Starting…', failed: 'Didn’t start', stopped: 'Stopped' }[s.status];
    return h('button', { class: 'card srv', style: `--c:${s.color}`, onclick: () => go({ v: 'server', id: s.id }) },
      h('span', { class: 'srv-dot' }),
      h('div', { class: 'card-main' },
        h('b', { text: reopened ? s.title || s.name : s.name }),
        h('span', { class: `sub ${tone}`, text: `${s.accountName} · ${text}` })),
      icon('chev'));
  }

  function viewHome() {
    const page = h('div', { class: 'page' });
    page.append(topbar('Flock', {
      sub: S.pc ? S.pc.name : S.pairing && S.pairing.name ? S.pairing.name : 'Your PC',
      right: h('div', { class: 'tb-right' }, statusPill(),
        h('button', { class: 'iconbtn', 'aria-label': 'Settings', onclick: () => go({ v: 'about' }) }, icon('gear'))),
    }));

    if (S.error && !S.loaded) {
      page.append(h('div', { class: 'empty' },
        mascot('#9398A1', 'asleep', 'm-big'),
        h('p', { class: 'lead', text: S.error }),
        h('button', { class: 'btn primary', text: 'Try again', onclick: (e) => { busy(e.currentTarget, true, 'Asking your PC…'); refresh(); } })));
      return page;
    }
    if (!S.loaded) {
      page.append(h('div', { class: 'empty' }, mascot(B.INK, 'launching', 'm-big'), h('p', { class: 'lead', text: 'Asking your PC…' })));
      return page;
    }
    if (S.error) page.append(h('p', { class: 'note warn', text: S.error }));

    const live = [...S.servers.values()].filter((s) => s.status !== 'stopped').sort((a, b) => b.startedAt - a.startedAt);
    if (live.length) {
      page.append(h('h2', { text: 'On your PC' }), h('div', { class: 'cards' }, live.map(serverCard)));
    }

    page.append(h('h2', { text: 'Start a session in…' }));
    const list = h('div', { class: 'cards' });
    for (const a of S.accounts) {
      const ok = a.cli && a.cli.ok;
      const card = h('button', { class: `card acct${ok ? '' : ' off'}`, style: `--c:${a.color}`, onclick: () => pickAccount(a) },
        mascot(a.color, ok ? 'awake' : 'asleep', 'acct-m'),
        h('div', { class: 'card-main' },
          h('b', { text: a.name }),
          ok ? usageBits(a.usage) || h('span', { class: 'sub', text: 'Ready' }) : h('span', { class: 'sub warn', text: problemOf(a) })),
        icon('chev'));
      list.append(card);
    }
    page.append(list);
    page.append(h('p', { class: 'foot', text: 'Sessions run on your PC in Claude Code and open in the Claude app, signed in to the same account. Flock never sends Claude a prompt.' }));
    paintStatus();
    return page;
  }

  function pickAccount(a) {
    if (a.cli && a.cli.ok) { go({ v: 'folders', account: a.id }); return; }
    const problem = problemOf(a);
    const how = a.cli && a.cli.problem === 'no-cli'
      ? 'Install Claude Code on your PC (claude.com/claude-code), then come back.'
      : a.cli && a.cli.problem === 'unsupported'
        ? 'On your PC, edit the account in Flock and give it its own ~/.claude.'
        : `On your PC, open Flock → Settings → Phone and press Sign in next to ${a.name}.`;
    openSheet(
      h('div', { class: 'sheet-head' }, mascot(a.color, 'asleep', 'sheet-m'), h('h3', { text: `${a.name} isn’t ready yet` })),
      h('p', { class: 'lead', text: problem }),
      h('p', { class: 'note', text: how }),
      a.cli && a.cli.email ? h('p', { class: 'note', text: `Signed in as ${a.cli.email}.` }) : null,
      h('div', { class: 'sheet-foot' }, h('button', { class: 'btn primary', text: 'OK', onclick: closeSheet })));
  }

  // Folder picker: recent folders, the account's sessions, or browse the project folders.
  const folderCache = new Map(); // "account|path" -> listing
  const sessionCache = new Map(); // account -> its sessions

  /** A session row: tap to continue it on the phone (or see it, when it already runs for the phone). */
  function sessionRow(a, s, windowOpen) {
    return h('button', { class: 'card folder', onclick: () => (s.server && S.servers.has(s.server) ? go({ v: 'server', id: s.server }) : continueSheet(a, s, windowOpen)) },
      icon('chat'),
      h('div', { class: 'card-main' }, h('b', { text: s.title || 'Untitled session' }), h('span', { class: `sub${s.server ? ' ok' : ''}`, text: s.server ? 'On your phone now' : ago(s.at) })),
      icon('chev'));
  }

  function fillSessions(body, a, data) {
    body.innerHTML = '';
    if (!data.sessions.length) {
      body.append(h('p', { class: 'note', text: `${a.name} has no Code sessions on your PC yet.` }));
      return;
    }
    // Grouped by project, the most recently used first.
    const groups = new Map();
    for (const s of data.sessions) {
      const k = s.cwd.toLowerCase();
      if (!groups.has(k)) groups.set(k, { cwd: s.cwd, name: s.folder, list: [] });
      groups.get(k).list.push(s);
    }
    for (const g of groups.values()) {
      body.append(h('div', { class: 'group' }, h('b', { text: g.name }), h('span', { class: 'mono', text: short(g.cwd, 40) })));
      g.list.slice(0, 8).forEach((s) => body.append(sessionRow(a, s, data.window)));
    }
  }

  function viewFolders(view) {
    const a = S.accounts.find((x) => x.id === view.account);
    if (!a) return viewHome();
    const tab = view.tab || 'recent';
    const page = h('div', { class: 'page' });
    page.append(topbar(a.name, { back: true, sub: view.path ? short(view.path, 46) : 'Start a session or continue one' }));
    page.firstChild.style.setProperty('--c', a.color);

    if (!view.path) {
      const tabBtn = (id, label) => h('button', {
        class: tab === id ? 'on' : '',
        role: 'tab',
        onclick: () => { S.view = { ...view, tab: id }; history.replaceState(S.view, ''); render(); },
      }, label);
      page.append(h('div', { class: 'tabs', role: 'tablist' }, tabBtn('recent', 'Recent'), tabBtn('sessions', 'Sessions'), tabBtn('browse', 'Browse')));
    }

    const body = h('div', { class: 'cards' });
    page.append(body);
    if (!view.path && tab === 'sessions') {
      const cached = sessionCache.get(a.id);
      if (cached) fillSessions(body, a, cached);
      else body.append(h('p', { class: 'note', text: 'Loading…' }));
      request('sessions', { account: a.id })
        .then((data) => {
          sessionCache.set(a.id, data);
          if (S.view === view) fillSessions(body, a, data);
        })
        .catch((e) => { if (S.view === view) { body.innerHTML = ''; body.append(h('p', { class: 'note err', text: e.message })); } });
      return page;
    }
    const key = `${a.id}|${view.path || ''}`;
    const shown = folderCache.get(key);
    const fill = (data) => {
      body.innerHTML = '';
      if (!view.path) {
        const rows = tab === 'recent' ? data.recent : data.roots;
        if (!rows.length) {
          body.append(h('p', { class: 'note', text: tab === 'recent' ? `${a.name} has no recent projects yet. Browse instead.` : 'No project folders are set up. Add one in Flock’s settings on your PC.' }));
        }
        for (const r of rows) {
          body.append(h('button', { class: 'card folder', onclick: () => (tab === 'recent' ? confirmStart(a, r.path) : go({ v: 'folders', account: a.id, path: r.path })) },
            icon('folder'),
            h('div', { class: 'card-main' }, h('b', { text: r.name }), h('span', { class: 'sub mono', text: short(r.path) })),
            tab === 'recent' ? h('span', { class: 'age', text: ago(r.at).replace(' ago', '') }) : null,
            icon('chev')));
        }
        return;
      }
      if (!data.dirs.length) body.append(h('p', { class: 'note', text: 'No folders in here.' }));
      for (const d of data.dirs) {
        const full = `${data.path.replace(/[\\/]+$/, '')}\\${d.name}`;
        body.append(h('button', { class: 'card folder', onclick: () => go({ v: 'folders', account: a.id, path: full }) },
          icon('folder'), h('div', { class: 'card-main' }, h('b', { text: d.name }), h('span', { class: 'sub', text: ago(d.at) })), icon('chev')));
      }
      if (data.more) body.append(h('p', { class: 'note', text: `…and ${data.more} more. Use a more specific folder.` }));
    };
    if (shown) fill(shown);
    else body.append(h('p', { class: 'note', text: 'Loading…' }));
    request('folders', { account: a.id, path: view.path || null })
      .then((data) => {
        folderCache.set(key, data);
        if (S.view === view) fill(data);
        if (view.path && S.view === view) {
          bar.querySelector('.new').disabled = !data.canCreate;
        }
      })
      .catch((e) => { if (S.view === view) { body.innerHTML = ''; body.append(h('p', { class: 'note err', text: e.message })); } });

    // Inside a folder: start here, or make a new folder in it.
    const bar = h('div', { class: 'actionbar' });
    if (view.path) {
      bar.append(
        h('button', { class: 'btn secondary new', onclick: () => newFolder(a, view.path) }, icon('plus'), 'New folder'),
        h('button', { class: 'btn primary grow', onclick: () => confirmStart(a, view.path) }, `Start in ${base(view.path)}`));
      page.append(bar);
    }
    return page;
  }

  function newFolder(a, parent) {
    const name = h('input', { type: 'text', placeholder: 'my-new-project', maxlength: '80', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', enterkeyhint: 'done' });
    const git = h('input', { type: 'checkbox', checked: true });
    const err = h('p', { class: 'note err hidden' });
    const make = h('button', { class: 'btn primary grow', text: 'Create' });
    const submit = async () => {
      err.classList.add('hidden');
      busy(make, true, 'Creating…');
      try {
        const made = await request('mkdir', { account: a.id, parent, name: name.value.trim(), git: git.checked });
        folderCache.clear();
        closeSheet();
        toast(`Created ${base(made.path)}${made.git ? ' (git)' : ''}`, 'ok');
        confirmStart(a, made.path, true);
      } catch (e) {
        err.textContent = e.message;
        err.classList.remove('hidden');
        busy(make, false);
      }
    };
    make.addEventListener('click', submit);
    name.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    openSheet(
      h('div', { class: 'sheet-head' }, icon('folder'), h('h3', { text: 'New folder' })),
      h('p', { class: 'note mono', text: `In ${parent}` }),
      h('label', { class: 'field' }, h('span', { text: 'Name' }), name),
      h('label', { class: 'check' }, git, h('span', { text: 'Make it a git repository' })),
      err,
      h('div', { class: 'sheet-foot' }, h('button', { class: 'btn secondary', text: 'Cancel', onclick: closeSheet }), make));
    setTimeout(() => name.focus(), 250);
  }

  function confirmStart(a, dir, fresh) {
    const go_ = h('button', { class: 'btn primary grow', text: 'Start Claude here' });
    const err = h('p', { class: 'note err hidden' });
    go_.addEventListener('click', async () => {
      err.classList.add('hidden');
      busy(go_, true, 'Starting…');
      try {
        const s = await request('start', { account: a.id, path: dir });
        S.servers.set(s.id, s);
        closeSheet();
        go({ v: 'server', id: s.id });
      } catch (e) {
        err.textContent = e.message;
        err.classList.remove('hidden');
        busy(go_, false);
      }
    });
    // The folder's own sessions, to pick one up instead of starting fresh.
    const more = h('div', { class: 'cards' });
    if (!fresh) {
      request('sessions', { account: a.id, path: dir })
        .then((data) => {
          if (!data.sessions.length || !more.isConnected) return;
          more.append(h('div', { class: 'group' }, h('b', { text: 'Or continue a session here' })));
          data.sessions.slice(0, 4).forEach((s) => more.append(sessionRow(a, s, data.window)));
        })
        .catch(() => {});
    }
    openSheet(
      h('div', { class: 'sheet-head' }, mascot(a.color, 'awake', 'sheet-m'), h('h3', { text: fresh ? `Start Claude in ${base(dir)}?` : base(dir) })),
      h('p', { class: 'note mono', text: dir }),
      h('p', { class: 'lead', text: `Claude Code starts in this folder on your PC with ${a.name}’s account. You’ll get a link that opens it in the Claude app.` }),
      err,
      h('div', { class: 'sheet-foot' }, h('button', { class: 'btn secondary', text: 'Cancel', onclick: closeSheet }), go_),
      more);
  }

  /**
   * Continues one of the account's sessions on the phone: Flock reopens it on
   * the PC with Remote Control on. When the account's Claude window is open,
   * the phone gets a copy, so the two never write to one conversation at once.
   */
  function continueSheet(a, s, windowOpen) {
    const btn = h('button', { class: 'btn primary grow', text: 'Continue on phone' });
    const err = h('p', { class: 'note err hidden' });
    btn.addEventListener('click', async () => {
      err.classList.add('hidden');
      busy(btn, true, 'Starting…');
      try {
        const sv = await request('continue', { account: a.id, session: s.id });
        S.servers.set(sv.id, sv);
        sessionCache.delete(a.id);
        closeSheet();
        go({ v: 'server', id: sv.id });
      } catch (e) {
        err.textContent = e.message;
        err.classList.remove('hidden');
        busy(btn, false);
      }
    });
    openSheet(
      h('div', { class: 'sheet-head' }, mascot(a.color, 'awake', 'sheet-m'), h('h3', { text: s.title || base(s.cwd) })),
      h('p', { class: 'note mono', text: `${short(s.cwd, 36)} · ${ago(s.at)}` }),
      h('p', { class: 'lead', text: windowOpen
        ? `${a.name}’s Claude window is open on your PC and may still be using this session, so your phone carries on with a copy of it, with everything said so far. The window keeps the original.`
        : `Your phone carries on with this session itself, with everything said so far. When you open ${a.name}’s Claude window on your PC again, it goes back there.` }),
      err,
      h('div', { class: 'sheet-foot' }, h('button', { class: 'btn secondary', text: 'Cancel', onclick: closeSheet }), btn));
  }

  function promptCard(s) {
    const p = s.prompt;
    const labels = {
      trust: ['Don’t trust', 'Trust this folder'],
      consent: ['Not now', 'Turn it on'],
      choice: ['Option 2', 'Option 1'],
      question: ['No', 'Yes'],
    }[p.kind] || ['No', 'Yes'];
    const title = { trust: 'Claude Code asks: trust this folder?', consent: 'Claude Code asks: turn on Remote Control?' }[p.kind] || 'Claude Code asks';
    const why = {
      trust: 'Claude Code hasn’t worked in this folder with this account yet. Only trust folders you made or know.',
      consent: 'Claude Code asks this once for this account’s sign-in on your PC.',
    }[p.kind];
    const answer = async (reply, btn) => {
      busy(btn, true, 'Sending…');
      try {
        await request('answer', { server: s.id, prompt: p.id, ...reply });
      } catch (e) {
        toast(e.message, 'err');
        busy(btn, false);
      }
    };
    let buttons;
    if (p.options && p.options.length) {
      // Any other pick-list Claude Code shows: one button per choice, as it lists them.
      buttons = h('div', { class: 'choices' }, p.options.map((label, i) => {
        const b = h('button', { class: `btn ${i === 0 ? 'primary' : 'secondary'} big`, text: label });
        b.addEventListener('click', () => answer({ option: i }, b));
        return b;
      }));
    } else {
      const no = h('button', { class: 'btn secondary grow', text: labels[0] });
      const yes = h('button', { class: 'btn primary grow', text: labels[1] });
      no.addEventListener('click', () => answer({ yes: false }, no));
      yes.addEventListener('click', () => answer({ yes: true }, yes));
      buttons = h('div', { class: 'row2' }, no, yes);
    }
    return h('div', { class: 'ask' },
      h('div', { class: 'ask-head' }, icon('warn'), h('b', { text: title })),
      why ? h('p', { class: 'note', text: why }) : null,
      h('p', { class: 'ask-q', text: p.ask }),
      p.text ? h('pre', { class: 'ask-text', text: p.text }) : null,
      buttons);
  }

  function viewServer(view) {
    const s = S.servers.get(view.id);
    const page = h('div', { class: 'page' });
    if (!s) {
      page.append(topbar('Session', { back: true }), h('p', { class: 'note', text: 'Flock on your PC no longer lists this one.' }));
      return page;
    }
    const a = S.accounts.find((x) => x.id === s.account);
    const reopened = s.kind === 'session';
    page.append(topbar(reopened ? s.title || s.name : s.name, { back: true, sub: `${s.accountName} · ${short(s.folder, 38)}` }));
    const mood = { starting: 'launching', asking: 'alert', ready: 'awake', failed: 'error', stopped: 'asleep' }[s.status];
    const hero = h('div', { class: 'hero', style: `--c:${s.color}` }, mascot(s.color, mood, 'hero-m'));
    page.append(hero);

    if (s.status === 'starting') {
      page.append(h('p', { class: 'lead center', text: reopened ? 'Reopening this session on your PC…' : 'Starting Claude Code on your PC…' }));
    } else if (s.status === 'asking' && s.prompt) {
      page.append(promptCard(s));
    } else if (s.status === 'ready') {
      const first = s.sessions[0];
      page.append(h('p', { class: 'lead center', text: reopened ? 'Remote Control is on. Open it in the Claude app to carry on.' : `Running in ${s.name}. Open it in the Claude app.` }));
      const openBtn = h('a', { class: 'btn primary big', href: first ? first.url : s.envUrl, target: '_blank', rel: 'noopener noreferrer' }, icon('open'), first ? 'Open the session' : 'Open in Claude');
      page.append(openBtn);
      const email = a && a.cli && a.cli.email;
      page.append(h('p', { class: 'note center', text: `It belongs to ${s.accountName}’s Claude account${email ? ` (${email})` : ''}: the Claude app has to be signed in to it.` }));
      if (reopened) {
        page.append(h('p', { class: 'note center', text: s.fork
          ? `This is a copy: ${s.accountName}’s Claude window keeps the original. Back at your PC, Flock’s settings can open the copy in the window.`
          : `When you open ${s.accountName}’s Claude window on your PC, the session goes back there.` }));
      } else if (s.sessions.length) {
        page.append(h('h2', { text: 'Sessions in this folder' }));
        page.append(h('div', { class: 'cards' }, s.sessions.map((x) => h('a', { class: 'card', href: x.url, target: '_blank', rel: 'noopener noreferrer' },
          mascot(s.color, 'awake', 'acct-m'),
          h('div', { class: 'card-main' }, h('b', { text: x.title || 'New session' }), h('span', { class: 'sub', text: 'Opens in the Claude app' })),
          icon('open')))));
      }
      if (s.envUrl) {
        page.append(h('a', { class: 'btn secondary big', href: s.envUrl, target: '_blank', rel: 'noopener noreferrer' }, icon('plus'), 'Start another session here'));
        page.append(h('p', { class: 'note center', text: 'Opens the Claude app ready to start a fresh session in this folder, for when a session’s context is full.' }));
      }
    } else if (s.status === 'failed') {
      page.append(h('p', { class: 'note err', text: s.error || 'Claude Code stopped.' }));
      if (a) page.append(h('button', { class: 'btn primary big', onclick: (e) => retry(e.currentTarget, a, s) }, icon('refresh'), 'Try again'));
    } else {
      page.append(h('p', { class: 'lead center', text: reopened
        ? 'Stopped on your PC. The conversation is saved; carry on with it again any time.'
        : 'Stopped. Its sessions can’t be reached until it runs again.' }));
      if (a) page.append(h('button', { class: 'btn primary big', onclick: (e) => retry(e.currentTarget, a, s) }, icon('refresh'), reopened ? 'Continue it again' : 'Start it again'));
    }

    if (['starting', 'asking', 'ready'].includes(s.status)) {
      page.append(h('button', { class: 'btn danger big', onclick: (e) => stopServer(e.currentTarget, s) }, 'Stop'));
    }
    return page;
  }

  async function retry(btn, a, old) {
    busy(btn, true, 'Starting…');
    try {
      const s = old.kind === 'session'
        ? await request('continue', { account: a.id, session: old.session })
        : await request('start', { account: a.id, path: old.folder });
      S.servers.set(s.id, s);
      go({ v: 'server', id: s.id }, true);
    } catch (e) {
      toast(e.message, 'err');
      busy(btn, false);
    }
  }

  async function stopServer(btn, s) {
    busy(btn, true, 'Stopping…');
    try {
      await request('stop', { server: s.id });
    } catch (e) {
      toast(e.message, 'err');
      busy(btn, false);
    }
  }

  function viewAbout() {
    const page = h('div', { class: 'page' });
    page.append(topbar('Settings', { back: true }));
    page.append(h('div', { class: 'cards' },
      h('div', { class: 'card static' }, mascot(B.INK, 'awake', 'acct-m'),
        h('div', { class: 'card-main' }, h('b', { text: S.pc ? S.pc.name : (S.pairing && S.pairing.name) || 'Your PC' }),
          h('span', { class: 'sub', text: S.pc ? `Flock ${S.pc.version}` : 'Paired' })))));
    if (ANDROID) {
      let v = '';
      try { v = ANDROID.version(); } catch {}
      page.append(h('p', { class: 'note', text: `Flock for Android ${v}` }));
    }
    page.append(h('p', { class: 'note', text: `Messages to your PC go through ${S.pairing ? new URL(S.pairing.server).host : 'the relay'}, end-to-end encrypted with a key only this phone and your PC have.` }));
    const btn = h('button', { class: 'btn danger big', text: 'Unpair this phone' });
    btn.addEventListener('click', () => {
      openSheet(
        h('div', { class: 'sheet-head' }, h('h3', { text: 'Unpair this phone?' })),
        h('p', { class: 'lead', text: 'Your PC forgets this phone and this phone forgets your PC. Folders already running keep running.' }),
        h('div', { class: 'sheet-foot' }, h('button', { class: 'btn secondary', text: 'Cancel', onclick: closeSheet }),
          h('button', { class: 'btn danger grow', text: 'Unpair', onclick: unpair })));
    });
    page.append(btn);
    return page;
  }

  // ── Rendering ─────────────────────────────────────────────────────────────

  function render() {
    const v = S.view;
    let page;
    if (!S.pairing || v.v === 'pair') page = viewPair();
    else if (v.v === 'folders') page = viewFolders(v);
    else if (v.v === 'server') page = viewServer(v);
    else if (v.v === 'about') page = viewAbout();
    else page = viewHome();
    app.replaceChildren(page);
    paintStatus();
  }

  // ── Start ─────────────────────────────────────────────────────────────────

  async function start() {
    const fromQr = /#p=([A-Za-z0-9_-]+)/.exec(location.hash);
    if (fromQr) {
      // Out of the address bar and history before anything else: it holds the key.
      history.replaceState(null, '', location.pathname + location.search);
      S.view = { v: 'pair' };
      render();
      try {
        await pairWith(fromQr[1]);
        go({ v: 'home' }, true);
      } catch (e) {
        render();
        const n = app.querySelector('.note.err');
        if (n) { n.textContent = e.message; n.classList.remove('hidden'); }
      }
    } else {
      S.pairing = savedPairing();
      S.view = S.pairing ? { v: 'home' } : { v: 'pair' };
      history.replaceState(S.view, '');
      render();
      if (S.pairing) {
        await connect(S.pairing);
        refresh();
      }
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && S.pairing && S.link) refresh();
  });

  // The web version keeps itself on the phone for offline starts; the Android app carries its files.
  if (!ANDROID && 'serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  start();
})();
