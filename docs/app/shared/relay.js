// Flock's phone link: an end-to-end encrypted message channel between Flock on
// a PC and the Flock app on a phone, wherever each of them is. Messages travel
// through an ntfy server (https://ntfy.sh unless set otherwise), a small
// publish/subscribe service both sides reach with ordinary outgoing HTTPS: no
// open ports, no tunnel, no account. The server only ever sees ciphertext.
// Every message is sealed with AES-256-GCM under a key that exists only on the
// PC and the paired phone (it travels once, inside the pairing QR code), and
// carries its own id and time, so a recorded message can't be played back
// later.
//
// The same file runs in Flock's main process (Node) and in the phone app (a
// browser): it only uses fetch, Web Crypto and streams, which both have.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FlockRelay = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DEFAULT_SERVER = 'https://ntfy.sh';
  const MAX_PART = 3000; // ntfy keeps message bodies up to 4 KB; longer ones go in parts
  const MAX_AGE = 10 * 60 * 1000; // older messages are ignored
  const MAX_AHEAD = 2 * 60 * 1000; // clock difference tolerated the other way
  const STALL_MS = 100 * 1000; // ntfy sends a keepalive every 45 s
  const enc = new TextEncoder();

  function b64u(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function unb64u(text) {
    const t = String(text).replace(/-/g, '+').replace(/_/g, '/');
    const s = atob(t + '==='.slice((t.length + 3) % 4));
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }

  const random = (n) => crypto.getRandomValues(new Uint8Array(n));
  const newId = () => b64u(random(9));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /** A fresh pairing: a channel name nobody can guess and a key. */
  function newPairing() {
    return { topic: `flock_${b64u(random(16))}`, key: b64u(random(32)) };
  }

  /** What a pairing QR code carries after "#p=" in the phone app's address. */
  function encodePairing({ server, topic, key, name }) {
    const p = { v: 1, t: topic, k: key, n: name || '' };
    if (server && server !== DEFAULT_SERVER) p.s = server;
    return b64u(enc.encode(JSON.stringify(p)));
  }

  /** { server, topic, key, name } from encodePairing's text, or null. */
  function decodePairing(text) {
    try {
      const p = JSON.parse(new TextDecoder().decode(unb64u(text)));
      if (p.v !== 1 || !/^flock_[A-Za-z0-9_-]{16,40}$/.test(p.t) || unb64u(p.k).length !== 32) return null;
      const server = typeof p.s === 'string' && /^https:\/\/[^\s/]+/.test(p.s) ? p.s : DEFAULT_SERVER;
      return { server, topic: p.t, key: p.k, name: typeof p.n === 'string' ? p.n.slice(0, 60) : '' };
    } catch {
      return null;
    }
  }

  function importKey(key) {
    return crypto.subtle.importKey('raw', unb64u(key), 'AES-GCM', false, ['encrypt', 'decrypt']);
  }

  // The channel name is bound into each message, so one half's messages can't
  // be replayed into the other.
  async function seal(cryptoKey, channel, obj) {
    const iv = random(12);
    const ct = new Uint8Array(await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: enc.encode(channel) }, cryptoKey, enc.encode(JSON.stringify(obj)),
    ));
    const out = new Uint8Array(iv.length + ct.length);
    out.set(iv);
    out.set(ct, iv.length);
    return b64u(out);
  }

  async function unseal(cryptoKey, channel, text) {
    const raw = unb64u(text);
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: raw.slice(0, 12), additionalData: enc.encode(channel) }, cryptoKey, raw.slice(12),
    );
    return JSON.parse(new TextDecoder().decode(pt));
  }

  /**
   * Opens one end of a paired channel. The PC (`role` 'pc') and the phone each
   * listen on their own half and send on the other's.
   *   onMessage(msg)  every authentic, fresh message
   *   onStatus(s)     'connecting' | 'online' | 'offline'
   * Returns { send(msg) -> Promise<id>, ready: Promise, close() }.
   */
  function connect({ server, topic, key, role, onMessage, onStatus }) {
    const base = String(server || DEFAULT_SERVER).replace(/\/+$/, '');
    const inbound = `${topic}-${role === 'pc' ? 'u' : 'd'}`;
    const outbound = `${topic}-${role === 'pc' ? 'd' : 'u'}`;
    const keyP = importKey(key);
    const seen = new Map(); // message id -> when it arrived
    const parts = new Map(); // id of a message sent in parts -> { n, got, at }
    let closed = false;
    let ctrl = null;
    let lastId = null; // the newest ntfy message seen, to catch up after a dropped connection
    let backoff = 0;
    let status = '';
    let markReady;
    const ready = new Promise((r) => { markReady = r; });

    function setStatus(s) {
      if (s === status) return;
      status = s;
      if (onStatus) onStatus(s);
    }

    async function deliver(text) {
      let msg;
      try { msg = await unseal(await keyP, inbound, text); } catch { return; } // not ours, or tampered with
      const now = Date.now();
      if (!msg || typeof msg.id !== 'string' || typeof msg.ts !== 'number') return;
      if (now - msg.ts > MAX_AGE || msg.ts - now > MAX_AHEAD || seen.has(msg.id)) return;
      seen.set(msg.id, now);
      for (const [id, at] of seen) if (now - at > MAX_AGE) seen.delete(id);
      try { onMessage(msg); } catch {}
    }

    function take(body) {
      if (body[0] !== '{') return deliver(body);
      let p;
      try { p = JSON.parse(body); } catch { return null; }
      if (!p || typeof p.c !== 'string' || !(p.n > 1 && p.n <= 64) || !(p.i >= 0 && p.i < p.n)) return null;
      const now = Date.now();
      for (const [id, x] of parts) if (now - x.at > MAX_AGE) parts.delete(id);
      const x = parts.get(p.c) || { n: p.n, got: [], at: now };
      x.got[p.i] = String(p.d || '');
      parts.set(p.c, x);
      if (x.got.filter((s) => s != null).length < x.n) return null;
      parts.delete(p.c);
      return deliver(x.got.join(''));
    }

    function line(text) {
      let m;
      try { m = JSON.parse(text); } catch { return; }
      if (m.event === 'open') {
        backoff = 0;
        setStatus('online');
        markReady();
      } else if (m.event === 'message' && typeof m.message === 'string') {
        lastId = m.id || lastId;
        take(m.message);
      }
    }

    async function listen() {
      while (!closed) {
        ctrl = new AbortController();
        const mine = ctrl;
        let stall = 0;
        const kick = () => {
          clearTimeout(stall);
          stall = setTimeout(() => mine.abort(), STALL_MS);
        };
        try {
          setStatus('connecting');
          const since = lastId ? `?since=${encodeURIComponent(lastId)}` : '';
          const res = await fetch(`${base}/${inbound}/json${since}`, { signal: mine.signal, cache: 'no-store' });
          if (!res.ok || !res.body) throw new Error(`relay answered ${res.status}`);
          kick();
          const reader = res.body.getReader();
          const dec = new TextDecoder();
          let buf = '';
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            kick();
            buf += dec.decode(value, { stream: true });
            let nl;
            while ((nl = buf.indexOf('\n')) !== -1) {
              const l = buf.slice(0, nl).trim();
              buf = buf.slice(nl + 1);
              if (l) line(l);
            }
          }
        } catch {
          // dropped, stalled or refused: try again below
        } finally {
          clearTimeout(stall);
        }
        if (closed) break;
        setStatus('offline');
        backoff = Math.min(60 * 1000, backoff ? backoff * 2 : 2000);
        await sleep(backoff);
      }
    }

    async function send(msg) {
      const full = { ...msg, id: msg.id || newId(), ts: Date.now() };
      const body = await seal(await keyP, outbound, full);
      const pieces = [];
      if (body.length <= MAX_PART) pieces.push(body);
      else {
        const c = newId();
        const n = Math.ceil(body.length / MAX_PART);
        for (let i = 0; i < n; i++) pieces.push(JSON.stringify({ c, i, n, d: body.slice(i * MAX_PART, (i + 1) * MAX_PART) }));
      }
      for (const piece of pieces) {
        const res = await fetch(`${base}/${outbound}`, { method: 'POST', body: piece });
        if (!res.ok) throw new Error(res.status === 429 ? 'The relay is busy; try again in a minute.' : `The relay answered ${res.status}.`);
      }
      return full.id;
    }

    function close() {
      closed = true;
      if (ctrl) ctrl.abort();
    }

    listen();
    return { send, ready, close, status: () => status };
  }

  return { DEFAULT_SERVER, newPairing, encodePairing, decodePairing, connect, newId };
});
