// Settings window: the account list, the account editor, and preferences.
(function () {
  const api = window.flock;
  const B = window.FlockMascot;
  const I = window.FlockIcons;
  const S = window.FlockSound;
  const $ = (id) => document.getElementById(id);

  const PALETTE = ['#D97757', '#FACC15', '#F4505E', '#E879F9', '#C084FC', '#818CF8', '#38BDF8', '#2DD4BF', '#4ADE80', '#F5F6F8'];

  let state = null;
  let editing = null;
  let seed = null;
  let recording = false;

  // ── Helpers ───────────────────────────────────────────────────────────────

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function basename(p) {
    return String(p || '').split(/[\\/]/).filter(Boolean).pop() || '';
  }

  function nameOf(id) {
    const a = state && state.accounts.find((x) => x.id === id);
    return a ? a.name : 'another account';
  }

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

  function mb(bytes) {
    if (!bytes) return '';
    const v = bytes / (1024 * 1024);
    return v >= 1024 ? `${(v / 1024).toFixed(1)} GB` : `${Math.max(1, Math.round(v))} MB`;
  }

  let toastT = 0;
  function toast(text, tone) {
    const t = $('toast');
    t.textContent = text;
    t.className = `show ${tone || ''}`;
    clearTimeout(toastT);
    toastT = setTimeout(() => t.classList.remove('show'), 3600);
  }

  // ── Static decoration ─────────────────────────────────────────────────────

  $('brandMascot').appendChild(B.create(B.INK, 'awake'));
  [
    ['#38BDF8', 0, 40, 48, 'asleep'],
    [B.CLAUDE_ORANGE, 34, 6, 72, 'awake'],
    ['#4ADE80', 88, 42, 44, 'alert'],
  ].forEach(([c, x, y, s, st]) => {
    const b = B.create(c, st);
    b.style.cssText = `left:${x}px;top:${y}px;width:${s}px;height:${s}px`;
    $('trio').appendChild(b);
  });

  // ── Accounts list ─────────────────────────────────────────────────────────

  const rows = new Map();
  let dragId = null;

  function statusTag(a) {
    if (a.launching) return ['Opening…', 'warn'];
    if (a.dupOf) return [`Same Claude account as ${nameOf(a.dupOf)}`, 'err'];
    if (a.capturing) return ['Waiting for sign-in', 'warn'];
    if (a.running && needsSignIn(a)) return ['Open · not signed in', 'warn'];
    if (a.running) return ['Open', 'ok'];
    if (a.error) return ['Couldn’t open', 'err'];
    if (needsSignIn(a)) return ['Not signed in', 'warn'];
    return ['Closed', ''];
  }

  function configLabel(a) {
    if (a.configShared) return '~\\.claude (shared)';
    if (a.config && a.config.mode === 'link') return `${a.configShort} (with ${nameOf(a.config.profileId)})`;
    return `${a.configShort} (own)`;
  }

  function primary(a) {
    if (a.capturing && !a.running) return ['Stop waiting', () => api.signInDone(a.id)];
    if (a.running) return ['Show', () => api.launch(a.id)];
    if (needsSignIn(a)) return ['Sign in', () => api.signIn(a.id)];
    return ['Open', () => api.launch(a.id)];
  }

  function makeRow(a) {
    const r = document.createElement('div');
    r.className = 'acct';
    r.dataset.id = a.id;
    r.draggable = true;
    r.innerHTML = `
      <span class="grip">${I.drag}</span>
      <span class="avatar"></span>
      <div class="acct-main">
        <div class="acct-name"><b></b><span class="note"></span><span class="tag st"></span></div>
        <div class="acct-sub"></div>
      </div>
      <div class="acct-actions">
        <button class="btn secondary small act"></button>
        <button class="btn secondary icon small edit" title="Edit">${I.edit}</button>
      </div>`;
    const pet = B.create(a.color, mascotState(a));
    r.querySelector('.avatar').appendChild(pet);
    r.querySelector('.act').addEventListener('click', () => {
      const cur = state.accounts.find((x) => x.id === r.dataset.id);
      if (cur) primary(cur)[1]();
    });
    r.querySelector('.edit').addEventListener('click', () => openSheet(r.dataset.id));
    r.addEventListener('dblclick', (e) => {
      if (!e.target.closest('button')) openSheet(r.dataset.id);
    });
    pet.addEventListener('click', () => {
      B.poke(pet);
      S.play('poke');
    });

    r.addEventListener('dragstart', (e) => {
      dragId = r.dataset.id;
      r.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    r.addEventListener('dragend', () => {
      dragId = null;
      r.classList.remove('dragging');
      document.querySelectorAll('.drop-before, .drop-after').forEach((x) => x.classList.remove('drop-before', 'drop-after'));
    });
    r.addEventListener('dragover', (e) => {
      if (!dragId || dragId === r.dataset.id) return;
      e.preventDefault();
      const box = r.getBoundingClientRect();
      const after = e.clientY > box.top + box.height / 2;
      r.classList.toggle('drop-after', after);
      r.classList.toggle('drop-before', !after);
    });
    r.addEventListener('dragleave', () => r.classList.remove('drop-before', 'drop-after'));
    r.addEventListener('drop', (e) => {
      e.preventDefault();
      if (!dragId || dragId === r.dataset.id) return;
      const after = r.classList.contains('drop-after');
      r.classList.remove('drop-before', 'drop-after');
      const ids = state.accounts.map((x) => x.id).filter((id) => id !== dragId);
      const at = ids.indexOf(r.dataset.id) + (after ? 1 : 0);
      ids.splice(at, 0, dragId);
      api.reorder(ids);
    });
    return r;
  }

  function renderAccounts() {
    const list = $('acctList');
    const ids = new Set(state.accounts.map((a) => a.id));
    for (const [id, r] of rows) {
      if (!ids.has(id)) { r.remove(); rows.delete(id); }
    }
    for (const a of state.accounts) {
      let r = rows.get(a.id);
      if (!r) { r = makeRow(a); rows.set(a.id, r); }
      r.style.setProperty('--c', a.color);
      r.querySelector('.acct-name b').textContent = a.name;
      r.querySelector('.note').textContent = a.note || (a.kind === 'default' ? 'Claude’s own data folder' : '');
      const [text, cls] = statusTag(a);
      const tag = r.querySelector('.tag.st');
      tag.textContent = text;
      tag.className = `tag st ${cls}`;
      r.querySelector('.acct-sub').textContent = `${a.kind === 'default' ? 'Claude (default)' : basename(a.dataDir)} · ${configLabel(a)}`;
      r.querySelector('.act').textContent = primary(a)[0];
      const pet = r.querySelector('.avatar .mascot-wrap');
      B.recolor(pet, a.color);
      B.setState(pet, mascotState(a));
    }
    const order = state.accounts.map((a) => rows.get(a.id));
    const current = [...list.children];
    if (current.length !== order.length || current.some((c, i) => c !== order[i])) {
      order.forEach((r) => list.appendChild(r));
    }
    $('acctCount').textContent = String(state.accounts.length);
    $('welcome').classList.toggle('hidden', state.accounts.length > 1);
  }

  $('addBtn').addEventListener('click', () => openSheet(null));
  $('welcomeAdd').addEventListener('click', () => openSheet(null));
  $('openAllBtn').addEventListener('click', () => {
    const ids = state.accounts.filter((a) => !a.running).map((a) => a.id);
    if (!ids.length) return toast('Every account is already open');
    api.launchMany(ids);
  });

  // ── Preferences ───────────────────────────────────────────────────────────

  document.querySelectorAll('.switch[data-setting]').forEach((sw) => {
    sw.addEventListener('click', () => {
      const k = sw.dataset.setting;
      api.setSettings({ [k]: !state.settings[k] });
    });
  });

  $('stagger').addEventListener('change', (e) => api.setSettings({ staggerMs: Number(e.target.value) }));

  $('islandMode').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) api.setSettings({ islandMode: b.dataset.v });
  });

  $('windowEdge').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) api.setSettings({ windowEdge: b.dataset.v });
  });

  function prettyKey(acc) {
    if (!acc) return 'None';
    return acc.replace(/Control/g, 'Ctrl').replace(/Super/g, 'Win').split('+').join(' + ');
  }

  function keyName(e) {
    const c = e.code || '';
    if (/^Key[A-Z]$/.test(c)) return c.slice(3);
    if (/^Digit[0-9]$/.test(c)) return c.slice(5);
    if (/^F([1-9]|1[0-9]|2[0-4])$/.test(c)) return c;
    const map = { Space: 'Space', Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right' };
    return map[c] || null;
  }

  function stopRecording() {
    recording = false;
    $('hotkey').classList.remove('recording');
    renderPrefs();
  }

  $('hotkey').addEventListener('click', () => {
    recording = true;
    $('hotkey').classList.add('recording');
    $('hotkey').textContent = 'Press keys… (Esc cancels)';
  });

  window.addEventListener('keydown', (e) => {
    if (!recording) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') return stopRecording();
    if (e.key === 'Backspace' || e.key === 'Delete') {
      api.setSettings({ hotkey: '' });
      return stopRecording();
    }
    const mods = [];
    if (e.ctrlKey) mods.push('Control');
    if (e.altKey) mods.push('Alt');
    if (e.shiftKey) mods.push('Shift');
    if (e.metaKey) mods.push('Super');
    const k = keyName(e);
    if (!k || !mods.some((m) => m !== 'Shift')) return; // wait for a real combination
    api.setSettings({ hotkey: [...mods, k].join('+') });
    stopRecording();
  }, true);

  function renderPrefs() {
    const s = state.settings;
    document.querySelectorAll('.switch[data-setting]').forEach((sw) => {
      sw.classList.toggle('on', Boolean(s[sw.dataset.setting]));
    });
    $('loginDevNote').classList.toggle('hidden', state.packaged);
    $('stagger').value = String(s.staggerMs);
    if (![...$('stagger').options].some((o) => o.value === String(s.staggerMs))) $('stagger').value = '1200';
    document.querySelectorAll('#islandMode button').forEach((b) => b.classList.toggle('on', b.dataset.v === s.islandMode));
    document.querySelectorAll('#windowEdge button').forEach((b) => b.classList.toggle('on', b.dataset.v === s.windowEdge));
    if (!recording) $('hotkey').textContent = prettyKey(s.hotkey);
    $('hotkeyWarn').classList.toggle('hidden', state.hotkeyOk || !s.hotkey);
    S.set(s.sound);

    const chips = $('autoChips');
    chips.innerHTML = '';
    for (const a of state.accounts) {
      const c = document.createElement('button');
      c.className = `chip${a.openOnStart ? ' on' : ''}`;
      c.style.setProperty('--c', a.color);
      c.appendChild(B.create(a.color, a.openOnStart ? 'awake' : 'asleep'));
      c.appendChild(document.createTextNode(a.name));
      c.title = a.openOnStart ? 'Opens when Flock starts — click to stop' : 'Click to open it when Flock starts';
      c.addEventListener('click', () => api.updateProfile(a.id, { openOnStart: !a.openOnStart }));
      chips.appendChild(c);
    }

    const cl = state.claude;
    $('claudeRow').innerHTML = cl.found
      ? `<span class="dot ok"></span><span>Found — ${cl.kind === 'store' ? 'Microsoft Store / MSIX build' : 'classic installer'}</span><span class="spacer"></span><code>${esc(basename(cl.launcher))}</code>`
      : `<span class="dot err"></span><span>Claude Desktop isn’t installed.</span><span class="spacer"></span><button class="btn secondary small" id="getClaude">Download Claude</button>`;
    const get = $('getClaude');
    if (get) get.addEventListener('click', () => api.openExternal('https://claude.ai/download'));
    $('version').textContent = state.version;
    $('version2').textContent = state.version;
  }

  $('coucouLink').addEventListener('click', () => api.openExternal('https://github.com/Louis-CFM/coucou'));
  $('quitApp').addEventListener('click', () => api.quitApp());

  // ── Account editor ────────────────────────────────────────────────────────

  function swatches() {
    const box = $('fColors');
    box.innerHTML = '';
    for (const c of PALETTE) {
      const s = document.createElement('button');
      s.className = `swatch${c === editing.color ? ' on' : ''}`;
      s.style.background = c;
      s.title = c;
      s.addEventListener('click', () => {
        editing.color = c;
        swatches();
        B.recolor($('sheetMascot').firstChild, c);
      });
      box.appendChild(s);
    }
  }

  function nextColor() {
    const used = new Set(state.accounts.map((a) => a.color));
    return PALETTE.find((c) => !used.has(c)) || PALETTE[state.accounts.length % PALETTE.length];
  }

  function linkTargets() {
    return state.accounts.filter((a) => a.id !== (editing && editing.id) && a.config && a.config.mode === 'own');
  }

  function showMode() {
    document.querySelectorAll('#fMode button').forEach((b) => b.classList.toggle('on', b.dataset.mode === editing.mode));
    document.querySelectorAll('.mode-detail').forEach((d) => d.classList.toggle('on', d.dataset.for === editing.mode));
    $('fOwnDir').textContent = editing.ownDir || '';
    const targets = linkTargets();
    const sel = $('fLink');
    sel.innerHTML = targets.length
      ? targets.map((t) => `<option value="${esc(t.id)}"${t.id === editing.linkTo ? ' selected' : ''}>${esc(t.name)} — ${esc(t.configShort)}</option>`).join('')
      : '<option value="" disabled selected>No account has its own ~/.claude yet</option>';
    sel.disabled = !targets.length;
    $('fLinkHint').textContent = targets.length
      ? 'Shares that account’s own ~/.claude folder — handy for several work accounts.'
      : 'Give one account its own ~/.claude first, then others can share it.';
    const keepingOwn = !editing.isNew && editing.origMode === 'own' && editing.ownDir === editing.origOwnDir;
    $('fSeedBasics').checked = editing.isNew || !keepingOwn ? $('fSeedBasics').checked : false;
  }

  function notice(text, tone) {
    const n = $('fNotice');
    n.textContent = text || '';
    n.className = `notice ${tone || 'warn'}${text ? '' : ' hidden'}`;
  }

  async function refreshSuggestions() {
    if (!editing || !editing.isNew) return;
    const sug = await api.suggestPaths($('fName').value.trim() || 'Account');
    if (!editing) return;
    if (!editing.customData) editing.dataDir = sug.dataDir;
    if (!editing.customOwn) editing.ownDir = sug.configDir;
    $('fDataDir').textContent = editing.dataDir;
    $('fOwnDir').textContent = editing.ownDir;
  }

  let suggestT = 0;
  $('fName').addEventListener('input', () => {
    clearTimeout(suggestT);
    suggestT = setTimeout(refreshSuggestions, 180);
    notice('');
  });

  $('fMode').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    editing.mode = b.dataset.mode;
    if (editing.mode === 'link' && !editing.linkTo) editing.linkTo = (linkTargets()[0] || {}).id || null;
    showMode();
  });

  $('fLink').addEventListener('change', (e) => { editing.linkTo = e.target.value; });

  $('fOpenOnStart').addEventListener('click', () => {
    editing.openOnStart = !editing.openOnStart;
    $('fOpenOnStart').classList.toggle('on', editing.openOnStart);
  });

  $('fOwnPick').addEventListener('click', async () => {
    const dir = await api.pickFolder({ title: 'Folder for this account’s ~/.claude', defaultPath: editing.ownDir });
    if (!dir) return;
    editing.ownDir = dir;
    editing.customOwn = true;
    $('fOwnDir').textContent = dir;
  });

  $('fDataPick').addEventListener('click', async () => {
    const dir = await api.pickFolder({ title: 'Data folder for this account’s Claude', defaultPath: editing.dataDir });
    if (!dir) return;
    editing.dataDir = dir;
    editing.customData = true;
    $('fDataDir').textContent = dir;
    notice('If that folder already holds a signed-in Claude, this account reuses it. Keep it directly inside AppData\\Roaming so Cowork keeps working.', 'warn');
  });

  async function openSheet(id) {
    if (!state) return;
    if (!seed) seed = await api.seedInfo().catch(() => null);
    const a = id ? state.accounts.find((x) => x.id === id) : null;
    if (id && !a) return;
    const cfg = (a && a.config) || { mode: 'shared' };
    editing = {
      id: a ? a.id : null,
      isNew: !a,
      isMain: Boolean(a && a.kind === 'default'),
      color: a ? a.color : nextColor(),
      mode: cfg.mode || 'shared',
      origMode: cfg.mode || 'shared',
      ownDir: cfg.mode === 'own' ? cfg.dir : null,
      origOwnDir: cfg.mode === 'own' ? cfg.dir : null,
      linkTo: cfg.mode === 'link' ? cfg.profileId : null,
      openOnStart: a ? a.openOnStart : false,
      dataDir: a ? a.dataDir : null,
      customData: false,
      customOwn: false,
    };
    $('sheetTitle').textContent = a ? `Edit ${a.name}` : 'Add an account';
    $('fName').value = a ? a.name : '';
    $('fNote').value = a ? a.note : '';
    $('fSave').textContent = a ? 'Save' : 'Add & sign in';
    $('fSave').disabled = false;
    $('fRemove').classList.toggle('hidden', !a || editing.isMain);
    $('fAdv').classList.toggle('hidden', editing.isMain);
    $('fAdv').open = false;
    $('fDataPick').classList.toggle('hidden', !editing.isNew);
    $('fDataDir').textContent = editing.dataDir || '';
    $('fOpenOnStart').classList.toggle('on', editing.openOnStart);
    $('confirm').classList.add('hidden');
    $('fSeedBasics').checked = !a || cfg.mode !== 'own';
    $('fSeedSkills').checked = false;
    if (seed) {
      $('basicsList').textContent = seed.basics.length ? seed.basics.join(', ') : 'CLAUDE.md and settings.json';
      $('skillsSize').textContent = seed.skillsBytes ? `(${mb(seed.skillsBytes)})` : '(none yet)';
      $('fSeedSkills').disabled = !seed.skillsBytes;
    }
    const sb = $('sheetMascot');
    sb.innerHTML = '';
    sb.appendChild(B.create(editing.color, 'awake'));
    swatches();
    notice(a && a.running ? 'Changes to ~/.claude apply the next time this account opens.' : '');
    if (!editing.ownDir || editing.isNew) await refreshSuggestions();
    if (!editing.ownDir) {
      const sug = await api.suggestPaths(a ? a.name : 'Account');
      editing.ownDir = sug.configDir;
    }
    showMode();
    $('sheetWrap').classList.remove('hidden');
    setTimeout(() => $('fName').focus(), 30);
  }

  function closeSheet() {
    editing = null;
    $('sheetWrap').classList.add('hidden');
  }

  $('fCancel').addEventListener('click', closeSheet);
  $('sheetWrap').addEventListener('mousedown', (e) => {
    if (e.target === $('sheetWrap')) closeSheet();
  });
  window.addEventListener('keydown', (e) => {
    if (recording || !editing) return;
    if (e.key === 'Escape') closeSheet();
    if (e.key === 'Enter' && e.target.tagName === 'INPUT') save();
  });

  async function save() {
    if (!editing) return;
    const name = $('fName').value.trim();
    if (!name) {
      notice('Give the account a name.', 'err');
      $('fName').focus();
      return;
    }
    let config;
    if (editing.mode === 'own') {
      config = { mode: 'own', dir: editing.ownDir, seedBasics: $('fSeedBasics').checked, seedSkills: $('fSeedSkills').checked };
    } else if (editing.mode === 'link') {
      if (!editing.linkTo) {
        notice('Pick which account’s ~/.claude to share, or choose Shared / Its own.', 'err');
        return;
      }
      config = { mode: 'link', profileId: editing.linkTo };
    } else {
      config = { mode: 'shared' };
    }
    const payload = {
      name,
      note: $('fNote').value.trim(),
      color: editing.color,
      openOnStart: editing.openOnStart,
      config,
    };
    const btn = $('fSave');
    btn.disabled = true;
    btn.textContent = config.seedSkills ? 'Copying skills…' : 'Saving…';
    try {
      if (editing.isNew) {
        const id = await api.addProfile({ ...payload, dataDir: editing.customData ? editing.dataDir : null });
        closeSheet();
        S.play('chirp');
        toast(`Opening ${name} — sign in once in its window`, 'info');
        await api.signIn(id);
      } else {
        await api.updateProfile(editing.id, payload);
        closeSheet();
        toast('Saved', 'ok');
      }
    } catch (e) {
      btn.disabled = false;
      btn.textContent = editing && editing.isNew ? 'Add & sign in' : 'Save';
      notice(String((e && e.message) || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), 'err');
    }
  }

  $('fSave').addEventListener('click', save);

  $('fRemove').addEventListener('click', () => {
    const a = state.accounts.find((x) => x.id === editing.id);
    $('confirmText').textContent = `Remove “${a.name}” from Flock?${a.running ? ' Its Claude window will be closed.' : ''} Keeping its data means you can add it back later and still be signed in.`;
    $('confirm').classList.remove('hidden');
  });
  $('cBack').addEventListener('click', () => $('confirm').classList.add('hidden'));
  const remove = async (deleteData) => {
    const id = editing.id;
    const name = $('fName').value.trim();
    closeSheet();
    await api.removeProfile(id, { deleteData });
    toast(deleteData ? `Removed ${name} and moved its data to the Recycle Bin` : `Removed ${name}`, 'ok');
  };
  $('cKeep').addEventListener('click', () => remove(false));
  $('cTrash').addEventListener('click', () => remove(true));

  // ── Wiring ────────────────────────────────────────────────────────────────

  function render() {
    if (!state) return;
    renderAccounts();
    renderPrefs();
  }

  api.on('state', (s) => {
    state = s;
    render();
  });
  api.on('toast', (t) => toast(t.text, t.tone));
  // A request to open the editor can arrive before the first state does (the
  // window was just created); keep it until there is something to edit.
  let pendingGoto = null;

  function goTo(g) {
    if (!g) return;
    if (!state) {
      pendingGoto = g;
      return;
    }
    if (g.add) openSheet(null);
    else if (g.edit) openSheet(g.edit);
  }

  api.on('settings:goto', goTo);
  api.getState()
    .then((s) => {
      state = s;
      render();
      return api.takeGoto();
    })
    .then((fromMain) => {
      const q = new URLSearchParams(location.search);
      const g = fromMain
        || pendingGoto
        || (q.get('add') ? { add: true } : q.get('edit') ? { edit: q.get('edit') } : null);
      pendingGoto = null;
      goTo(g);
    });
})();
