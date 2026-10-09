'use strict';
// Sign-in link routing.
//
// Signing in finishes in the browser, which hands the result back with a
// claude:// link (Google: claude://login/google-auth…, e-mail: claude://claude.ai/
// magic-link…). Windows always gives claude:// links to Claude's own package,
// which starts a short-lived Claude.exe "<link>" that passes the link to the
// Main window — never to the extra account that is waiting for it.
//
// While an account waits for sign-in, Flock watches for that short-lived
// process, reads the link from its command line and hands it to the waiting
// window with  claude-desktop.exe --user-data-dir=<that account> <link>.
//  - Google links are state-checked by Claude (a window ignores a sign-in it
//    didn't start), so they are offered to every waiting window and Main still
//    gets its copy — Main may be the one signing in.
//  - E-mail and SSO links are not checked: Main would open them and show a
//    "use verification code" page. Flock stops the short-lived process before
//    it reaches Main (Claude needs over a second to boot; Flock sees it in ~0.1 s)
//    and sends the link only to the waiting account.
// Nothing is changed in the registry.

const { log, safeUrl } = require('./log');

const POLL_MS = 1000; // fallback scan when the process-start watcher is unavailable
const SEEN_TTL = 60 * 1000;

/** 'google' (state-checked, safe to offer to every waiting window), 'signin' (one recipient), or 'other'. */
function classify(url) {
  let u;
  try { u = new URL(url); } catch { return 'other'; }
  const host = u.host.toLowerCase();
  if (host === 'login') return 'google';
  const first = u.pathname.replace(/^\/+/, '').split('/')[0].toLowerCase();
  if (host === 'claude.ai' && (first === 'magic-link' || first === 'sso-callback')) return 'signin';
  return 'other';
}

/**
 * @param watchLinks (onLink) => watcher        fast path: reports { pid, url } as the process starts
 * @param scanLinks  async () => [{ pid, url }]  fallback when the watcher is unavailable
 * @param suppress   (pid) => boolean            stops Windows' copy before it reaches Main
 * @param deliver    async (profileId, url) => void
 * @param onRouted   (kind, url, profileIds, keptFromMain) => void
 * @param onChange   (snapshot) => void
 */
function createRouter({ watchLinks, scanLinks, suppress, deliver, onRouted, onChange }) {
  const waiting = new Map(); // profileId -> { scope: 'signin' | 'all', until, armedAt }
  const seen = new Map(); // "pid|url" -> time first seen
  let watcher = null;
  let timer = null;
  let busy = false;

  function snapshot() {
    const out = {};
    for (const [id, w] of waiting) out[id] = { scope: w.scope, until: w.until };
    return out;
  }

  function changed() {
    onChange(snapshot());
  }

  function startWatcher() {
    try {
      watcher = watchLinks((link) => { consider(link.pid, link.url).catch(() => {}); });
    } catch (e) {
      watcher = null;
      log('link watcher failed to start', e.message);
    }
  }

  function start() {
    if (!watcher || !watcher.isAlive()) startWatcher();
    if (!timer) timer = setInterval(() => { tick().catch(() => {}); }, POLL_MS);
  }

  function stop() {
    if (watcher) { watcher.stop(); watcher = null; }
    if (timer) { clearInterval(timer); timer = null; }
  }

  async function tick() {
    if (busy) return;
    busy = true;
    try {
      const now = Date.now();
      let expired = false;
      for (const [id, w] of waiting) {
        if (now > w.until) { waiting.delete(id); expired = true; log('stopped waiting (timed out) in', id); }
      }
      if (expired) changed();
      if (!waiting.size) { stop(); return; }
      for (const [k, t] of seen) if (now - t > SEEN_TTL) seen.delete(k);
      if (watcher && watcher.isReady()) return; // the watcher sees links first
      if (!watcher || !watcher.isAlive()) startWatcher();
      for (const { pid, url } of await scanLinks()) await consider(pid, url);
    } finally {
      busy = false;
    }
  }

  async function consider(pid, url) {
    const key = `${pid}|${url}`;
    if (seen.has(key) || !waiting.size) return;
    seen.set(key, Date.now());

    const kind = classify(url);
    const queue = [...waiting.entries()].sort((a, b) => b[1].armedAt - a[1].armedAt);
    let targets = [];
    let keepFromMain = false;
    if (kind === 'google') {
      targets = queue.map(([id]) => id);
    } else if (kind === 'signin') {
      if (queue.length) {
        targets = [queue[0][0]];
        keepFromMain = true;
      }
    } else {
      const any = queue.find(([, w]) => w.scope === 'all');
      if (any) {
        targets = [any[0]];
        keepFromMain = true;
        waiting.delete(any[0]);
        changed();
      }
    }
    if (!targets.length) return;

    // First stop Windows' copy, while it is still booting, then deliver.
    const kept = keepFromMain ? suppress(pid) : false;
    for (const id of targets) {
      try { await deliver(id, url); } catch (e) { log('deliver failed', id, e.message); }
    }
    log('link', kind, safeUrl(url), '->', targets.join(', '), kept ? '(kept from Main)' : '');
    onRouted(kind, url, targets, kept);
    if (!waiting.size) stop();
  }

  /** Remember links already in flight when routing starts, so only new ones are routed. */
  async function primeSeen() {
    try {
      for (const { pid, url } of await scanLinks()) seen.set(`${pid}|${url}`, Date.now());
    } catch {}
  }

  async function arm(profileId, scope, ttlMs) {
    const fresh = waiting.size === 0;
    waiting.set(profileId, { scope, until: Date.now() + ttlMs, armedAt: Date.now() });
    log('waiting for', scope === 'signin' ? 'sign-in' : 'the next link', 'in', profileId);
    changed();
    if (fresh) await primeSeen();
    start();
  }

  function disarm(profileId) {
    if (!waiting.delete(profileId)) return;
    changed();
    if (!waiting.size) stop();
  }

  return {
    arm,
    disarm,
    stop,
    isWaiting: (id) => waiting.has(id),
    snapshot,
  };
}

module.exports = { createRouter, classify };
