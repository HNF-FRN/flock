// Design preview only: when a Flock page is opened in a normal browser (no
// Electron preload), fake the bridge with sample accounts. Inside Flock this
// file does nothing.
(function () {
  if (window.flock) return;
  const params = new URLSearchParams(location.search);
  const listeners = {};
  const emit = (ch, p) => (listeners[ch] || []).forEach((cb) => cb(p));
  const now = Date.now();
  const iso = (minsAgo) => new Date(now - minsAgo * 60000).toISOString();
  const home = 'C:\\Users\\you';
  const state = {
    version: '0.1.0',
    packaged: false,
    claude: { found: true, kind: 'store', launcher: `${home}\\AppData\\Local\\Microsoft\\WindowsApps\\claude-desktop.exe` },
    settings: { launchAtLogin: true, islandMode: 'compact', sound: true, hotkey: 'Control+Alt+F', autoRouteSignIn: true, staggerMs: 1200, windowNames: true, windowEdge: 'all', islandFocus: true, islandYield: true },
    unmanaged: 0,
    hotkeyOk: true,
    focused: params.get('focus') || 'p1',
    accounts: [
      { id: 'main', kind: 'default', name: 'Main', note: 'personal@gmail.com', color: '#D97757', openOnStart: true, config: { mode: 'shared' }, dataDir: `${home}\\AppData\\Roaming\\Claude`, dataDirShort: '~\\AppData\\Roaming\\Claude', configDir: `${home}\\.claude`, configShort: '~\\.claude', configShared: true, running: true, pids: [1], since: iso(134), launching: false, signedIn: true, accountId: 'a', capturing: null, dupOf: null, error: null },
      { id: 'p1', kind: 'profile', name: 'Work', note: 'me@studio.co', color: '#38BDF8', openOnStart: true, config: { mode: 'own', dir: `${home}\\.claude-work` }, dataDir: `${home}\\AppData\\Roaming\\Claude-Work`, dataDirShort: '~\\AppData\\Roaming\\Claude-Work', configDir: `${home}\\.claude-work`, configShort: '~\\.claude-work', configShared: false, running: true, pids: [2], since: iso(47), launching: false, signedIn: true, accountId: 'b', capturing: null, dupOf: null, error: null },
      { id: 'p2', kind: 'profile', name: 'Client A', note: '', color: '#4ADE80', openOnStart: false, config: { mode: 'shared' }, dataDir: `${home}\\AppData\\Roaming\\Claude-Client-A`, dataDirShort: '~\\AppData\\Roaming\\Claude-Client-A', configDir: `${home}\\.claude`, configShort: '~\\.claude', configShared: true, running: false, pids: [], since: null, launching: false, signedIn: true, accountId: 'c', capturing: null, dupOf: null, error: null },
      { id: 'p3', kind: 'profile', name: 'Research', note: '', color: '#C084FC', openOnStart: false, config: { mode: 'link', profileId: 'p1' }, dataDir: `${home}\\AppData\\Roaming\\Claude-Research`, dataDirShort: '~\\AppData\\Roaming\\Claude-Research', configDir: `${home}\\.claude-work`, configShort: '~\\.claude-work', configShared: false, running: false, pids: [], since: null, launching: false, signedIn: true, accountId: 'd', capturing: null, dupOf: null, error: null },
      { id: 'p4', kind: 'profile', name: 'Side project', note: '', color: '#FACC15', openOnStart: false, config: { mode: 'shared' }, dataDir: `${home}\\AppData\\Roaming\\Claude-Side-project`, dataDirShort: '~\\AppData\\Roaming\\Claude-Side-project', configDir: `${home}\\.claude`, configShort: '~\\.claude', configShared: true, running: true, pids: [3], since: iso(1), launching: false, signedIn: false, accountId: null, capturing: { scope: 'signin', until: now + 500000 }, dupOf: null, error: null },
    ],
  };
  if (params.get('empty')) state.accounts = state.accounts.slice(0, 1);
  // Recent Code sessions per account, as the main process lists them: the ones
  // open in a window of their own first, then the newest.
  const ago = (mins) => now - mins * 60000;
  const work = `${home}\\work`;
  const sessions = {
    main: [
      { id: 'local_1b2c3d4e-0003', title: 'Fix image loading on mobile', cwd: `${work}\\studio-site`, at: ago(130), window: true },
      { id: 'local_1b2c3d4e-0001', title: 'Hero scroll animation polish', cwd: `${work}\\studio-site`, at: ago(4) },
      { id: 'local_1b2c3d4e-0002', title: 'Case study page layout', cwd: `${work}\\studio-site`, at: ago(38) },
      { id: 'local_1b2c3d4e-0004', title: 'Newsletter signup with double opt-in and a much longer title', cwd: `${work}\\newsletter`, at: ago(26 * 60) },
      { id: 'local_1b2c3d4e-0005', title: 'Tidy up the README', cwd: `${work}\\cli-tools`, at: ago(3 * 24 * 60) },
      { id: 'local_1b2c3d4e-0006', title: null, cwd: `${work}\\scratch`, at: ago(9 * 24 * 60) },
    ],
    p1: [
      { id: 'local_5e6f7a8b-0002', title: 'Auth middleware refactor', cwd: `${work}\\client-portal`, at: ago(17), window: true },
      { id: 'local_5e6f7a8b-0001', title: 'Pricing table redesign', cwd: `${work}\\client-portal`, at: ago(1) },
      { id: 'local_5e6f7a8b-0003', title: 'Dashboard charts', cwd: `${work}\\analytics`, at: ago(95) },
    ],
    p2: [
      { id: 'local_9c0d1e2f-0001', title: 'Onboarding emails', cwd: `${work}\\client-a`, at: ago(2 * 24 * 60) },
    ],
  };
  const delay = (v) => new Promise((r) => setTimeout(() => r(v), 60));
  window.flock = {
    getState: () => delay(JSON.parse(JSON.stringify(state))),
    on(ch, cb) { (listeners[ch] = listeners[ch] || []).push(cb); return () => {}; },
    launch(id) {
      const a = state.accounts.find((x) => x.id === id);
      if (a && !a.running) {
        a.launching = true;
        emit('state', JSON.parse(JSON.stringify(state)));
        setTimeout(() => { a.launching = false; a.running = true; a.since = new Date().toISOString(); emit('state', JSON.parse(JSON.stringify(state))); }, 1600);
      }
      return delay();
    },
    launchMany(ids) { ids.forEach((id, i) => setTimeout(() => window.flock.launch(id), i * 500)); return delay(); },
    quit(id) { const a = state.accounts.find((x) => x.id === id); a.running = false; emit('state', JSON.parse(JSON.stringify(state))); return delay(); },
    signIn: () => delay(), signInDone: () => delay(), routeNext: () => delay(),
    addProfile: (input) => { emit('toast', { text: `Added ${input.name}`, tone: 'ok' }); return delay('p9'); },
    updateProfile: () => delay(), removeProfile: () => delay(), reveal: () => delay(), reorder: () => delay(),
    sessions: (id) => delay((sessions[id] || []).map((x) => ({ ...x, folder: x.cwd.split('\\').pop() }))),
    openSession(id, sid) {
      const own = (sessions[id] || []).some((x) => x.id === sid && x.window);
      emit('toast', { text: own ? `(would bring ${sid}’s own window to the front)` : `(would open ${sid} in ${id})` });
      return delay(own ? 'window' : 'opened');
    },
    newSession(id, from) { emit('toast', { text: `(would start a new session in ${id}${from ? ', in that folder' : ''})` }); return delay(); },
    searchSessions(id) { emit('toast', { text: `(would open search in ${id})` }); return delay(); },
    setSettings(patch) { Object.assign(state.settings, patch); emit('state', JSON.parse(JSON.stringify(state))); return delay(); },
    openSettings: () => delay(),
    takeGoto: () => delay(null),
    seedInfo: () => delay({ from: `${home}\\.claude`, basics: ['CLAUDE.md', 'settings.json'], skillsBytes: 174063616 }),
    suggestPaths: (name) => delay({ dataDir: `${home}\\AppData\\Roaming\\Claude-${(name || 'Account').replace(/\W+/g, '-')}`, configDir: `${home}\\.claude-${(name || 'account').toLowerCase().replace(/\W+/g, '-')}` }),
    pickFolder: () => delay(null),
    quitApp: () => delay(),
    openExternal: () => delay(),
    islandMouse() {}, islandExpanded() {}, islandWidth() {},
    islandMenu(id) { emit('toast', { text: `(context menu for ${id})` }); },
  };
  window.__flockPreview = { state, emit };
  if (params.get('open')) setTimeout(() => emit('island:expand', 'preview'), 300);
  if (params.get('yield')) setTimeout(() => emit('island:yield', true), 200);
  // The accent edge page: ?edge={"color":"#38BDF8","focused":true,...} draws one edge.
  if (params.get('edge')) setTimeout(() => emit('edge', { w: innerWidth, h: innerHeight, rects: [[0, 0, innerWidth, innerHeight]], radius: 8, ...JSON.parse(params.get('edge')) }), 50);
  document.documentElement.classList.add('preview');
})();
