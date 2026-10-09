'use strict';
// The only bridge between Flock's windows and the main process.

const { contextBridge, ipcRenderer } = require('electron');

const EVENTS = new Set(['state', 'toast', 'island:toggle', 'island:expand', 'island:blur', 'island:yield', 'settings:goto', 'edge']);

contextBridge.exposeInMainWorld('flock', {
  getState: () => ipcRenderer.invoke('state:get'),
  on(channel, cb) {
    if (!EVENTS.has(channel)) throw new Error(`Unknown event ${channel}`);
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },

  launch: (id) => ipcRenderer.invoke('profile:launch', id),
  launchMany: (ids) => ipcRenderer.invoke('profile:launchMany', ids),
  quit: (id) => ipcRenderer.invoke('profile:quit', id),
  signIn: (id) => ipcRenderer.invoke('profile:signIn', id),
  signInDone: (id) => ipcRenderer.invoke('profile:signInDone', id),
  routeNext: (id) => ipcRenderer.invoke('profile:routeNext', id),
  addProfile: (input) => ipcRenderer.invoke('profile:add', input),
  updateProfile: (id, patch) => ipcRenderer.invoke('profile:update', id, patch),
  removeProfile: (id, opts) => ipcRenderer.invoke('profile:remove', id, opts),
  reveal: (id, which) => ipcRenderer.invoke('profile:reveal', id, which),
  sessions: (id) => ipcRenderer.invoke('profile:sessions', id),
  openSession: (id, sessionId) => ipcRenderer.invoke('profile:openSession', id, sessionId),
  newSession: (id, fromSessionId) => ipcRenderer.invoke('profile:newSession', id, fromSessionId),
  searchSessions: (id) => ipcRenderer.invoke('profile:searchSessions', id),
  reorder: (ids) => ipcRenderer.invoke('profile:reorder', ids),

  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  openSettings: (goto) => ipcRenderer.invoke('settings:open', goto),
  takeGoto: () => ipcRenderer.invoke('settings:takeGoto'),
  seedInfo: () => ipcRenderer.invoke('seed:info'),
  suggestPaths: (name) => ipcRenderer.invoke('suggest:paths', name),
  pickFolder: (opts) => ipcRenderer.invoke('dialog:folder', opts),
  quitApp: () => ipcRenderer.invoke('app:quit'),
  openExternal: (url) => ipcRenderer.invoke('app:openExternal', url),

  islandMouse: (inside) => ipcRenderer.send('island:mouse', Boolean(inside)),
  islandExpanded: (on) => ipcRenderer.send('island:expanded', Boolean(on)),
  islandWidth: (w) => ipcRenderer.send('island:width', Number(w)),
  islandMenu: (id) => ipcRenderer.send('island:menu', id),
});
