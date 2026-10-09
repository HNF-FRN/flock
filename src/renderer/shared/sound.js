// Tiny synthesized sounds (no audio files): a chirp when a window opens,
// a soft pop when the island opens, a two-note chime when an account signs in.
(function () {
  let ctx = null;
  let enabled = true;

  function audio() {
    if (!ctx) ctx = new AudioContext();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function tone(f0, f1, at, dur, vol, type = 'sine') {
    const c = audio();
    const t = c.currentTime + at;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(c.destination);
    o.start(t);
    o.stop(t + dur + 0.03);
  }

  const SOUNDS = {
    chirp() {
      tone(2300, 3300, 0, 0.07, 0.045);
      tone(2700, 3800, 0.085, 0.06, 0.035);
    },
    pop() {
      tone(520, 780, 0, 0.07, 0.035, 'triangle');
    },
    close() {
      tone(560, 380, 0, 0.08, 0.025, 'triangle');
    },
    done() {
      tone(880, 1320, 0, 0.1, 0.035);
      tone(1320, 1760, 0.11, 0.14, 0.03);
    },
    poke() {
      tone(1900, 2600, 0, 0.05, 0.04);
    },
  };

  window.FlockSound = {
    play(name) {
      if (!enabled || !SOUNDS[name]) return;
      try { SOUNDS[name](); } catch {}
    },
    set(on) {
      enabled = Boolean(on);
    },
  };
})();
