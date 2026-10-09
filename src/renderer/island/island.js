// The island: compact bar of mascots at the top of the screen that opens into
// the account overview on hover, and names the account whose window has focus.
// Open, it lists the accounts on the left and shows the one under the pointer
// on the right: its status, actions and recent Code sessions.
(function () {
  const api = window.flock;
  const B = window.FlockMascot;
  const I = window.FlockIcons;
  const S = window.FlockSound;
  const $ = (id) => document.getElementById(id);

  const OPEN_H = 270;
  const PEEK_FRESH = 5000; // ms a listed account's sessions stay fresh
  const EXPAND_DELAY = 200; // ms on the island before it opens: passing over it does nothing
  const DWELL = 650; // ms resting on the top edge that brings a tucked-away island back
  const AIM_DELAY = 250; // ms an account crossed on the way to the detail must be rested on before it shows
  const AIM_WINDOW = 90; // ms of pointer history that gives its heading
  const AIM_SLACK = 12; // px the detail's corners are widened by, so a near-miss still counts
  const COMPACT_H = 30;
  const MAX_MINIS = 6;

  const islandEl = $('island');
  const wakeEl = $('wake');
  const toastEl = $('toast');

  let state = null;
  let open = false;
  let pinned = false; // opened by the shortcut, the tray or a greeting
  let entered = false; // the pointer has been inside since it opened
  let inside = false;
  let hoverId = null;
  let heroId = null;
  const selected = new Set();
  let expandT = 0;
  let collapseT = 0;
  let autoT = 0;
  let toastT = 0;
  let peekT = 0;
  // Another app's window lies under the island (a browser's tabs): it tucks
  // away and lets every click through; resting on the top edge opens it.
  let yielding = false;
  let dwellT = 0;

  $('openAll').innerHTML = I.playAll;
  $('gear').innerHTML = I.gear;

  // Flock's own mascot; it takes an account's colour while that account's window has focus.
  const logo = B.create(B.INK, 'awake');
  $('cLogo').appendChild(logo);

  // ── Helpers ───────────────────────────────────────────────────────────────

  function needsSignIn(a) {
    return a.kind !== 'default' && !a.signedIn;
  }

  function mascotState(a) {
    if (a.launching) return 'launching';
    if (a.running && (a.capturing || needsSignIn(a))) return 'alert';
    if (a.running) return 'awake';
    if (a.error) return 'error';
    return 'asleep';
  }

  function since(iso) {
    if (!iso) return '';
    const mins = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m ? `${h}h ${m}m` : `${h}h`;
  }

  function nameOf(id) {
    const a = state && state.accounts.find((x) => x.id === id);
    return a ? a.name : 'another account';
  }

  function basename(p) {
    return String(p || '').split(/[\\/]/).filter(Boolean).pop() || p;
  }

  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ── Open / close ──────────────────────────────────────────────────────────

  function setOpen(on, opts = {}) {
    clearTimeout(autoT);
    if (on === open) {
      if (on && opts.pin) pinned = true;
      return;
    }
    open = on;
    pinned = Boolean(on && opts.pin);
    entered = inside;
    islandEl.classList.toggle('open', on);
    api.islandExpanded(on);
    clearInterval(peekT);
    if (on) {
      if (opts.sound !== false) S.play('pop');
      render();
      // Keep the listed sessions and their "5m ago" current while it is open.
      peekT = setInterval(() => {
        if (heroId) loadPeek(heroId);
        renderPeek();
      }, PEEK_FRESH);
    } else {
      selected.clear();
      hoverId = null;
      overId = null;
      stopAim();
      updateSelection();
    }
    applyYield();
    positionToast();
  }

  function onEnter(e) {
    clearTimeout(collapseT);
    clearTimeout(autoT);
    entered = true;
    // Not while a button is held: that is a drag (a browser tab, a window) passing by.
    if (!open && !(e && e.buttons)) {
      clearTimeout(expandT);
      expandT = setTimeout(() => setOpen(true), EXPAND_DELAY);
    }
  }

  function onLeave() {
    clearTimeout(expandT);
    if (open && (!pinned || entered)) {
      clearTimeout(collapseT);
      collapseT = setTimeout(() => setOpen(false), 380);
    }
  }

  function applyYield() {
    islandEl.classList.toggle('yield', yielding && !open);
  }

  /** While tucked away: resting on the top edge, mid-screen, with no button held, opens it. */
  function dwell(e) {
    const atEdge = e.clientY <= 2 && Math.abs(e.clientX - innerWidth / 2) <= 150 && !e.buttons;
    if (!atEdge) {
      clearTimeout(dwellT);
      dwellT = 0;
      return;
    }
    if (dwellT) return;
    dwellT = setTimeout(() => {
      dwellT = 0;
      setOpen(true);
    }, DWELL);
  }

  /** Close a pinned island nobody has touched after a while. */
  function autoClose(ms) {
    clearTimeout(autoT);
    autoT = setTimeout(() => {
      if (open && !inside && !entered) setOpen(false);
    }, ms);
  }

  // The window is click-through except over the island itself (and over the
  // wake strip, unless the island is tucked away for the app below).
  function hit(x, y) {
    const t = document.elementFromPoint(x, y);
    if (!t) return false;
    if (t === wakeEl) return !yielding;
    return Boolean(t.closest('#island')) && !islandEl.classList.contains('yield');
  }

  let lookFrame = 0;
  let lastXY = null;

  window.addEventListener('mousemove', (e) => {
    if (yielding && !open) dwell(e);
    const now = hit(e.clientX, e.clientY);
    if (now !== inside) {
      inside = now;
      api.islandMouse(now);
      if (now) onEnter(e);
      else onLeave();
    }
    lastXY = [e.clientX, e.clientY];
    track(e.clientX, e.clientY);
    if (open) aim(e.target);
    if (!lookFrame) lookFrame = requestAnimationFrame(lookAtPointer);
  });

  document.documentElement.addEventListener('mouseleave', () => {
    if (!inside) return;
    inside = false;
    api.islandMouse(false);
    onLeave();
  });

  function lookAtPointer() {
    lookFrame = 0;
    if (!lastXY) return;
    const [x, y] = lastXY;
    for (const w of document.querySelectorAll('#island .mascot-wrap')) {
      const r = w.getBoundingClientRect();
      if (!r.width) continue;
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height * 0.5;
      B.look(w, (x - cx) / 90, (y - cy) / 110);
    }
  }

  window.addEventListener('keydown', (e) => {
    if (!open || !state) return;
    if (e.key === 'Escape') {
      setOpen(false);
    } else if (/^[1-9]$/.test(e.key)) {
      const a = state.accounts[Number(e.key) - 1];
      if (a) openAccount(a.id);
    } else if (e.key === 'a' || e.key === 'A') {
      openAll();
    } else if (e.key === 'Enter' && heroId) {
      openAccount(heroId);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const ids = state.accounts.map((x) => x.id);
      const i = ids.indexOf(heroId);
      hoverId = ids[(i + (e.key === 'ArrowDown' ? 1 : ids.length - 1)) % ids.length];
      stopAim();
      renderList();
      renderDetail();
    }
  });

  // ── Actions ───────────────────────────────────────────────────────────────

  function openAccount(id) {
    S.play('chirp');
    const r = rows.get(id);
    if (r) B.hop(r.querySelector('.mascot-wrap'));
    if (id === heroId && detailMascot) B.hop(detailMascot);
    api.launch(id).catch(() => {});
  }

  function openAll() {
    const ids = state.accounts.filter((a) => !a.running).map((a) => a.id);
    if (!ids.length) {
      showToast('Every account is already open');
      return;
    }
    S.play('chirp');
    api.launchMany(ids);
  }

  function openSelected() {
    if (!selected.size) return;
    S.play('chirp');
    api.launchMany([...selected]);
    selected.clear();
    updateSelection();
  }

  function toggleSelect(id) {
    if (selected.has(id)) selected.delete(id);
    else selected.add(id);
    updateSelection();
  }

  $('gear').addEventListener('click', () => api.openSettings());
  $('openAll').addEventListener('click', openAll);
  $('openSel').addEventListener('click', openSelected);
  $('snd').addEventListener('click', () => state && api.setSettings({ sound: !state.settings.sound }));

  // ── Rendering ─────────────────────────────────────────────────────────────

  function render() {
    if (!state) return;
    S.set(state.settings.sound);
    islandEl.classList.toggle('mode-hover', state.settings.islandMode === 'hover');
    renderCompact();
    renderHeader();
    renderList();
    renderDetail();
    positionToast();
  }

  const minis = new Map();
  let compactW = 0;

  function renderCompact() {
    const box = $('cMinis');
    const shown = state.accounts.slice(0, MAX_MINIS);
    const keep = new Set(shown.map((a) => a.id));
    for (const [id, w] of minis) {
      if (!keep.has(id)) { w.remove(); minis.delete(id); }
    }
    shown.forEach((a) => {
      let w = minis.get(a.id);
      if (!w) {
        w = B.create(a.color, mascotState(a));
        w.classList.add('mini');
        minis.set(a.id, w);
      }
      B.recolor(w, a.color);
      B.setState(w, mascotState(a));
      w.title = a.name;
    });
    const order = shown.map((a) => minis.get(a.id));
    const current = [...box.querySelectorAll('.mini')];
    if (current.length !== order.length || current.some((c, i) => c !== order[i])) {
      order.forEach((w) => box.appendChild(w));
    }
    let more = box.querySelector('.more');
    const extra = state.accounts.length - shown.length;
    if (extra > 0) {
      if (!more) { more = el('span', 'more'); box.appendChild(more); }
      more.textContent = `+${extra}`;
      box.appendChild(more);
    } else if (more) {
      more.remove();
    }
    // The account you are typing in, by name and colour; otherwise how many are open.
    const running = state.accounts.filter((a) => a.running).length;
    const focus = state.focused ? state.accounts.find((a) => a.id === state.focused) : null;
    const count = $('cCount');
    count.textContent = focus ? focus.name : running ? String(running) : '';
    count.classList.toggle('focus', Boolean(focus));
    count.style.color = focus ? focus.color : '';
    islandEl.classList.toggle('focused', Boolean(focus));
    islandEl.style.setProperty('--focus', focus ? focus.color : 'transparent');
    B.recolor(logo, focus ? focus.color : B.INK);
    const label = focus ? Math.ceil(count.getBoundingClientRect().width) + 4 : running ? 12 : 0;
    const w = 21 + 7 + label + shown.length * 19 + (extra > 0 ? 24 : 0) + 34;
    const cw = Math.max(116, Math.min(360, w));
    islandEl.style.setProperty('--cw', `${cw}px`);
    if (cw !== compactW) {
      compactW = cw;
      api.islandWidth(cw); // the area other apps' windows must stay clear of
    }
    B.setState(logo, state.accounts.some((a) => a.launching) ? 'launching' : 'awake');
  }

  function renderHeader() {
    const n = state.accounts.length;
    const r = state.accounts.filter((a) => a.running).length;
    const waiting = state.accounts.filter((a) => a.capturing).length;
    $('headStatus').innerHTML = `<span><b>${r}</b> of ${n} open</span>`
      + (waiting ? `<span class="wait">Waiting for sign-in</span>` : '');
    $('snd').innerHTML = state.settings.sound ? I.soundOn : I.soundOff;
    $('snd').title = state.settings.sound ? 'Sounds on' : 'Sounds off';
    updateSelection();
  }

  function updateSelection() {
    const b = $('openSel');
    b.classList.toggle('hidden', selected.size === 0);
    b.textContent = `Open ${selected.size}`;
    for (const [id, r] of rows) r.classList.toggle('sel', selected.has(id));
  }

  // ── Account list (left) ───────────────────────────────────────────────────

  const rows = new Map();
  let addRow = null;

  /** 'on' open · 'wait' needs you · 'launch' opening · '' closed */
  function dotClass(a) {
    if (a.launching) return 'launch';
    if (a.capturing || (a.running && needsSignIn(a)) || a.dupOf) return 'wait';
    if (a.running) return 'on';
    return '';
  }

  function tooltip(a) {
    const bits = [a.name];
    if (a.note) bits.push(a.note);
    bits.push(a.running ? 'open' : 'closed');
    if (needsSignIn(a)) bits.push('not signed in yet');
    return `${bits.join(' · ')}\nClick to ${a.running ? 'show' : 'open'} · Ctrl+click to select · Right-click for more`;
  }

  function makeRow(a) {
    const r = el('button', 'acct');
    r.dataset.id = a.id;
    const pet = B.create(a.color, mascotState(a));
    pet.classList.add('mini');
    r.append(el('i', 'bar'), pet, el('span', 'name'), el('span', 'num'), el('i', 'dot'));
    // Hovering shows it on the right (see aim()); a click opens it.
    r.addEventListener('click', (e) => {
      if (e.ctrlKey || e.shiftKey || e.metaKey) toggleSelect(r.dataset.id);
      else openAccount(r.dataset.id);
    });
    r.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      api.islandMenu(r.dataset.id);
    });
    return r;
  }

  function renderList() {
    const box = $('accounts');
    const ids = new Set(state.accounts.map((a) => a.id));
    for (const [id, r] of rows) {
      if (!ids.has(id)) { r.remove(); rows.delete(id); selected.delete(id); }
    }
    const current = heroId || hoverId;
    state.accounts.forEach((a, i) => {
      let r = rows.get(a.id);
      if (!r) { r = makeRow(a); rows.set(a.id, r); }
      r.style.setProperty('--c', a.color);
      r.classList.toggle('off', !a.running && !a.launching);
      r.classList.toggle('cur', a.id === (hoverId || current));
      r.classList.toggle('sel', selected.has(a.id));
      r.querySelector('.name').textContent = a.name;
      r.querySelector('.num').textContent = i < 9 ? String(i + 1) : '';
      r.querySelector('.dot').className = `dot ${dotClass(a)}`;
      const pet = r.querySelector('.mascot-wrap');
      B.recolor(pet, a.color);
      B.setState(pet, mascotState(a));
      r.title = tooltip(a);
    });
    const order = state.accounts.map((a) => rows.get(a.id));
    const shown = [...box.querySelectorAll('.acct:not(.add)')];
    if (shown.length !== order.length || shown.some((c, i) => c !== order[i])) {
      order.forEach((r) => box.appendChild(r));
    }
    if (!addRow) {
      addRow = el('button', 'acct add', `${I.plus}<span class="name">Add account</span>`);
      addRow.addEventListener('click', () => api.openSettings({ add: true }));
    }
    if (box.lastElementChild !== addRow) box.appendChild(addRow);
  }

  // ── Pointer aim ───────────────────────────────────────────────────────────
  // Going from an account to the detail, a hand moves diagonally and cuts
  // across the rows above or below. While the pointer heads for the detail
  // (inside the triangle from where it just was to the detail's left corners),
  // a row it crosses waits; it shows once the pointer rests on it or turns
  // away from the detail. Like a mega menu's submenu.

  const trail = []; // pointer positions of the last AIM_WINDOW ms
  let overId = null; // the account row under the pointer
  let pendingId = null; // ...when it is waiting to be shown
  let aimT = 0;

  function track(x, y) {
    const t = performance.now();
    trail.push({ x, y, t });
    while (t - trail[0].t > AIM_WINDOW) trail.shift();
  }

  /** Whether the pointer is moving toward the detail. */
  function headingForDetail() {
    const now = performance.now();
    const pts = trail.filter((p) => now - p.t <= AIM_WINDOW);
    if (pts.length < 2) return false; // resting
    const a = pts[0];
    const b = pts[pts.length - 1];
    const r = $('detail').getBoundingClientRect();
    const dx = b.x - a.x;
    const run = r.left - a.x;
    if (dx <= 0 || run <= 0 || Math.hypot(dx, b.y - a.y) < 2) return false;
    const slope = (b.y - a.y) / dx;
    return slope >= (r.top - AIM_SLACK - a.y) / run && slope <= (r.bottom + AIM_SLACK - a.y) / run;
  }

  function underPointer() {
    return lastXY ? document.elementFromPoint(lastXY[0], lastXY[1]) : null;
  }

  /** Show the account under the pointer, unless the pointer is only crossing it on its way to the detail. */
  function aim(target) {
    const row = target && target.closest ? target.closest('.acct[data-id]') : null;
    const id = row ? row.dataset.id : null;
    if (id !== overId) {
      overId = id;
      pendingId = id && id !== heroId ? id : null;
    }
    clearTimeout(aimT);
    if (pendingId && headingForDetail()) {
      aimT = setTimeout(() => aim(underPointer()), AIM_DELAY);
    } else if (pendingId) {
      hoverId = pendingId;
      pendingId = null;
      renderList();
      renderDetail();
    }
    $('accounts').classList.toggle('passing', Boolean(pendingId));
  }

  function stopAim() {
    clearTimeout(aimT);
    pendingId = null;
    $('accounts').classList.remove('passing');
  }

  // Rows scrolled under a still pointer show as if it had moved onto them.
  $('accounts').addEventListener('scroll', () => open && aim(underPointer()));

  // ── Session peek ──────────────────────────────────────────────────────────
  // A signed-in account lists its recent Code sessions in the detail panel. A
  // session open in a window of its own comes first and a click brings that
  // window to the front; a click on any other opens it in the account's window.

  const peek = new Map(); // account id -> { at, list (null until first read), busy }
  let peekKey = '';

  /** Whether the detail lists this account's sessions rather than its status. */
  function peeks(a) {
    return a.signedIn && !a.launching && !a.capturing && !a.dupOf && !(a.running && needsSignIn(a)) && !(a.error && !a.running);
  }

  function loadPeek(id) {
    const cur = peek.get(id);
    if (cur && (cur.busy || Date.now() - cur.at < PEEK_FRESH - 500)) return;
    peek.set(id, { at: cur ? cur.at : 0, list: cur ? cur.list : null, busy: true });
    api.sessions(id)
      .catch(() => [])
      .then((list) => {
        peek.set(id, { at: Date.now(), list: Array.isArray(list) ? list : [], busy: false });
        if (heroId === id) renderPeek();
      });
  }

  function ago(ms) {
    const mins = Math.max(0, Math.round((Date.now() - ms) / 60000));
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const h = Math.round(mins / 60);
    return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
  }

  function renderPeek() {
    const a = state && state.accounts.find((x) => x.id === heroId);
    if (!a || !peeks(a)) return;
    const cur = peek.get(a.id);
    const list = cur ? cur.list : null;
    const key = JSON.stringify([a.id, a.name, list && list.map((s) => [s.id, s.title, s.folder, s.window, s.at && ago(s.at)])]);
    if (key === peekKey) return;
    peekKey = key;
    const box = $('dSessions');
    box.innerHTML = '';
    if (!list) return; // still reading
    if (!list.length) {
      box.appendChild(el('div', 'empty', '<b>No Code sessions yet</b><span>Start one with New.</span>'));
      return;
    }
    for (const s of list) {
      const title = s.title || 'Untitled session';
      const row = el('button', s.window ? 'session win' : 'session');
      row.title = `${title}${s.cwd ? `\n${s.cwd}` : ''}\n${s.window
        ? 'Open in a window of its own · click to bring it to the front'
        : `Click to open it in ${a.name}’s window`}`;
      row.append(el('span', 't', esc(title)));
      if (s.folder) row.append(el('span', 'f', esc(s.folder)));
      row.append(s.window ? el('span', 'm w', `${I.window}<span>Window</span>`) : el('span', 'm', s.at ? esc(ago(s.at)) : ''));
      row.append(el('span', 'go', s.window ? 'Show' : 'Open'));
      if (s.cwd) {
        const here = el('span', 'here', I.plus);
        here.title = `New session in ${s.folder}`;
        here.addEventListener('click', (e) => {
          e.stopPropagation();
          startSession(a.id, s.id);
        });
        row.appendChild(here);
      }
      row.addEventListener('click', () => openSession(a.id, s.id));
      box.appendChild(row);
    }
  }

  function openSession(id, sessionId) {
    S.play('chirp');
    if (detailMascot) B.hop(detailMascot);
    api.openSession(id, sessionId).catch(() => {});
  }

  /** A new Code session in that account's window; in a session's folder when given one. */
  function startSession(id, fromSessionId) {
    S.play('chirp');
    if (detailMascot) B.hop(detailMascot);
    api.newSession(id, fromSessionId || null).catch(() => {});
  }

  // ── Detail (right) ────────────────────────────────────────────────────────

  let detailMascot = null;
  let actionsKey = '';

  /** [text, tone] for the caption under the mascot. */
  function status(a) {
    if (a.launching) return ['Opening…', 'busy'];
    if (a.capturing) return ['Waiting for sign-in', 'warn'];
    if (a.running && needsSignIn(a)) return ['Needs sign-in', 'warn'];
    if (a.running) return [`Open · ${since(a.since)}`, 'ok'];
    if (a.error) return ['Couldn’t open', 'err'];
    if (needsSignIn(a)) return ['Not signed in yet', 'warn'];
    return ['Closed', ''];
  }

  function renderDetail() {
    if (!state || !state.accounts.length) return;
    const accts = state.accounts;
    const a = accts.find((x) => x.id === hoverId)
      || accts.find((x) => x.id === heroId)
      || accts.find((x) => x.running)
      || accts[0];
    const changed = heroId !== a.id;
    if (changed) peekKey = '';
    const shown = heroId;
    heroId = a.id;
    const detail = $('detail');
    detail.style.setProperty('--c', a.color);

    // The stage: this account's mascot, large, doing what its account is doing.
    const st = mascotState(a);
    detail.dataset.state = st;
    if (!detailMascot) {
      detailMascot = B.create(a.color, st, { shadow: true });
      $('dMascot').appendChild(detailMascot);
      detailMascot.addEventListener('click', () => {
        B.poke(detailMascot);
        S.play('poke');
      });
    }
    B.recolor(detailMascot, a.color);
    // Another account taking the stage is no change of state: it steps on, it doesn't wake up.
    B.setState(detailMascot, st, { quiet: changed });
    if (changed && shown) B.play(detailMascot, 'enter');
    const [text, tone] = status(a);
    const cap = $('dState');
    cap.className = `d-state ${tone}`;
    cap.innerHTML = `<span>${esc(text)}</span>`;
    cap.title = a.error && !a.running ? a.error : '';

    $('dName').textContent = a.name;
    $('dSub').textContent = a.note || (a.kind === 'default' ? 'Claude’s own data folder' : '');

    // Accounts that need something get the details that matter; the rest list their sessions.
    const listing = peeks(a);
    detail.classList.toggle('peek', listing);
    const facts = [];
    if (a.error && !a.running && !a.launching) facts.push(['warn', a.error, 'warn']);
    if (a.capturing) facts.push(['key', 'Google and e-mail sign-in links are sent to this window', 'warn']);
    else if (a.running && needsSignIn(a)) facts.push(['key', 'Sign in once in its window; Flock remembers it', 'warn']);
    else if (needsSignIn(a)) facts.push(['key', 'Open it and sign in once', 'warn']);
    if (a.dupOf) facts.push(['warn', `Signed in to the same account as ${nameOf(a.dupOf)}`, 'warn']);
    const cfgText = a.configShared ? 'Shared ~/.claude'
      : a.config && a.config.mode === 'link' ? `~/.claude with ${nameOf(a.config.profileId)}` : 'Own ~/.claude';
    facts.push(['folder', cfgText, '', a.configDir]);
    facts.push(['box', a.kind === 'default' ? 'Claude default data' : basename(a.dataDir), 'mono', a.dataDir]);
    $('dFacts').innerHTML = listing ? '' : facts
      .map(([icon, t, cls, tip]) => `<div class="fact ${cls}"${tip ? ` title="${esc(tip)}"` : ''}>${I[icon] || ''}<span>${esc(t)}</span></div>`)
      .join('');
    if (listing) {
      loadPeek(a.id);
      renderPeek();
    } else {
      $('dSessions').innerHTML = '';
      peekKey = '';
    }

    const key = [a.id, a.running, a.launching, Boolean(a.capturing), needsSignIn(a), Boolean(a.error), listing].join('|');
    if (key === actionsKey) return;
    actionsKey = key;
    const box = $('dActions');
    box.innerHTML = '';
    const id = a.id;
    const add = (cls, html, title, fn) => {
      const b = el('button', `btn ${cls}`, html);
      if (title) b.title = title;
      b.addEventListener('click', fn);
      box.appendChild(b);
    };
    if (listing) {
      add('primary', `${a.running ? 'Show' : 'Open'} <span class="kbd">↵</span>`, a.running ? 'Bring its window to the front' : null, () => openAccount(id));
      add('secondary', `${I.plus}New`, 'New Code session in its window', () => startSession(id));
      add('secondary icon', I.search, 'Search its Code sessions', () => {
        S.play('chirp');
        api.searchSessions(id).catch(() => {});
      });
    } else if (a.capturing) {
      add('primary', 'Open', null, () => openAccount(id));
      add('secondary', 'Stop waiting', 'Give claude:// links back to Main', () => api.signInDone(id));
    } else if (needsSignIn(a) && !a.running) {
      add('primary', 'Open &amp; sign in <span class="kbd">↵</span>', 'Opens its window; Google or e-mail sign-in comes back to it', () => openAccount(id));
    } else {
      add('primary', `${a.running ? 'Show' : a.error ? 'Try again' : 'Open'} <span class="kbd">↵</span>`, null, () => openAccount(id));
    }
    add('secondary icon', I.more, 'More', () => api.islandMenu(id));
  }

  // ── Toasts ────────────────────────────────────────────────────────────────

  function positionToast() {
    const hoverMode = state && state.settings.islandMode === 'hover';
    const h = open ? OPEN_H : hoverMode ? 0 : COMPACT_H;
    toastEl.style.setProperty('--ty', `${h + 10}px`);
  }

  function showToast(text, tone) {
    toastEl.textContent = text;
    toastEl.className = `show ${tone || ''}`;
    positionToast();
    clearTimeout(toastT);
    toastT = setTimeout(() => toastEl.classList.remove('show'), 3400);
    if (tone === 'ok') S.play('done');
  }

  // ── Wiring ────────────────────────────────────────────────────────────────

  api.on('state', (s) => {
    state = s;
    render();
  });
  api.on('toast', (t) => showToast(t.text, t.tone));
  api.on('island:toggle', () => {
    setOpen(!open, { pin: true });
    if (open) autoClose(8000);
  });
  api.on('island:expand', (reason) => {
    setOpen(true, { pin: true, sound: reason !== 'hello' });
    if (reason === 'hello') {
      S.play('chirp');
      B.hop(logo);
      autoClose(2600);
    } else if (reason !== 'preview') {
      autoClose(7000);
    }
  });
  api.on('island:blur', () => {
    if (open && !inside) setOpen(false);
  });
  api.on('island:yield', (on) => {
    yielding = Boolean(on);
    applyYield();
  });

  api.islandMouse(false);
  api.getState().then((s) => {
    state = s;
    render();
  });
})();
