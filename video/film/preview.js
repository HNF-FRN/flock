// In-browser player for the film: scales it to the window, plays it in real
// time with its sound (BGM + cue sheet through Web Audio), and lets you scrub.
// Keys: space play/pause · ←/→ one frame · shift+←/→ one second · Home start.
(function () {
  'use strict';
  window.FilmPreview = function (params) {
    const F = window.Film;
    const film = document.getElementById('film');
    document.documentElement.classList.add('preview');
    const bar = F.h('div', { id: 'pv-bar' });
    const play = F.h('button', { id: 'pv-play', text: '▶' });
    const time = F.h('span', { id: 'pv-time' });
    const scrub = F.h('div', { id: 'pv-scrub' });
    const fill = F.h('div', { id: 'pv-fill' });
    const marks = F.h('div', { id: 'pv-marks' });
    scrub.append(marks, fill);
    const mute = F.h('button', { id: 'pv-mute', text: 'sound on' });
    bar.append(play, time, scrub, mute);
    document.body.append(bar);
    for (const s of F.scenesList()) {
      const m = F.h('i', { title: s.id });
      m.style.left = `${(s.start / F.duration) * 100}%`;
      marks.append(m);
    }

    function fit() {
      const k = Math.min(innerWidth / 1920, (innerHeight - 44) / 1080);
      film.style.transform = `scale(${k})`;
      film.style.transformOrigin = '0 0';
      film.style.left = `${(innerWidth - 1920 * k) / 2}px`;
    }
    addEventListener('resize', fit);
    fit();

    let t = Number(params.get('t') || 0);
    let playing = false;
    let t0 = 0;
    let wall0 = 0;

    // ── sound ──
    let ctx = null;
    const buffers = new Map();
    let sources = [];
    let soundOn = true;
    async function load(src) {
      if (buffers.has(src)) return buffers.get(src);
      const p = fetch(`../public/audio/${src}`).then((r) => r.arrayBuffer()).then((b) => ctx.decodeAudioData(b)).catch(() => null);
      buffers.set(src, p);
      return p;
    }
    async function startSound(from) {
      if (!soundOn) return;
      ctx = ctx || new AudioContext();
      await ctx.resume();
      const now = ctx.currentTime + 0.05;
      const cues = F.cues();
      for (const c of cues) {
        const end = c.t + (c.dur || 30);
        if (end < from) continue;
        const buf = await load(c.src);
        if (!buf || !playing) continue;
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const g = ctx.createGain();
        g.gain.value = c.vol;
        if (c.env) {
          // gain automation, scheduled from where playback starts
          const at = (x) => now + Math.max(0, x - from);
          const envAt = (x) => {
            if (x <= c.env[0][0]) return c.env[0][1];
            for (let i = 0; i < c.env.length - 1; i++) {
              const [t0, g0] = c.env[i];
              const [t1, g1] = c.env[i + 1];
              if (x < t1) return g0 + (g1 - g0) * ((x - t0) / (t1 - t0));
            }
            return c.env[c.env.length - 1][1];
          };
          g.gain.setValueAtTime(c.vol * envAt(from), now);
          for (const [x, gx] of c.env) if (x > from) g.gain.linearRampToValueAtTime(c.vol * gx, at(x));
        }
        if (c.fadeOutAt != null && c.fadeOutAt + c.fadeOutDur > from) {
          g.gain.setValueAtTime(c.vol, now + Math.max(0, c.fadeOutAt - from));
          g.gain.linearRampToValueAtTime(0, now + Math.max(0, c.fadeOutAt + c.fadeOutDur - from));
        }
        src.connect(g).connect(ctx.destination);
        const offset = Math.max(0, from - c.t) + (c.offset || 0);
        const when = now + Math.max(0, c.t - from);
        const dur = c.dur ? Math.max(0, c.dur - Math.max(0, from - c.t)) : undefined;
        if (dur !== undefined && dur <= 0) continue;
        src.start(when, offset, dur);
        sources.push(src);
      }
    }
    function stopSound() {
      sources.forEach((s) => { try { s.stop(); } catch {} });
      sources = [];
    }

    function render() {
      F.seek(t);
      time.textContent = `${t.toFixed(2)}s  f${Math.round(t * F.fps)}`;
      fill.style.width = `${(t / F.duration) * 100}%`;
    }
    function frame(now) {
      if (!playing) return;
      t = t0 + (now - wall0) / 1000;
      if (t >= F.duration) { t = F.duration - 1 / F.fps; toggle(false); }
      render();
      requestAnimationFrame(frame);
    }
    function toggle(on = !playing) {
      playing = on;
      play.textContent = playing ? '❚❚' : '▶';
      if (playing) {
        t0 = t;
        wall0 = performance.now();
        startSound(t);
        requestAnimationFrame(frame);
      } else stopSound();
    }
    play.onclick = () => toggle();
    mute.onclick = () => { soundOn = !soundOn; mute.textContent = soundOn ? 'sound on' : 'sound off'; if (!soundOn) stopSound(); };
    scrub.onpointerdown = (e) => {
      const r = scrub.getBoundingClientRect();
      const seek = (ev) => { t = Math.max(0, Math.min(F.duration - 0.001, ((ev.clientX - r.left) / r.width) * F.duration)); render(); };
      const was = playing;
      toggle(false);
      seek(e);
      scrub.onpointermove = seek;
      scrub.onpointerup = () => { scrub.onpointermove = null; if (was) toggle(true); };
      scrub.setPointerCapture(e.pointerId);
    };
    addEventListener('keydown', (e) => {
      if (e.key === ' ') { e.preventDefault(); toggle(); }
      if (e.key === 'ArrowRight') { toggle(false); t = Math.min(F.duration, t + (e.shiftKey ? 1 : 1 / F.fps)); render(); }
      if (e.key === 'ArrowLeft') { toggle(false); t = Math.max(0, t - (e.shiftKey ? 1 : 1 / F.fps)); render(); }
      if (e.key === 'Home') { toggle(false); t = 0; render(); }
    });
    window.__seek = (x) => { toggle(false); t = x; render(); };
    render();
  };
})();
