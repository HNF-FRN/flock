// The sound: one cue sheet for the whole film. Every cue is pinned to a
// visual event of a scene (its timeline constants), and shifted by the
// sample's own onset so the attack lands on the frame. Film-trailer
// vocabulary — whoosh for camera, impact for landings, riser for build,
// sparkle for light, click for the pointer — no game UI sounds.
(function () {
  'use strict';
  const F = window.Film;
  const C = window.Cast;
  const { B } = C;

  // measured with ffmpeg + numpy: where each sample's attack begins (s)
  const ONSET = {
    'air-zoom-vacuum.mp3': 0.32, 'bass-hit-futuristic.mp3': 0.03, 'bass-hit-short.mp3': 0.06,
    'click-camera.mp3': 0.14, 'impact-cine.mp3': 0.27, 'impact-zoom-quick.mp3': 0.13,
    'keyboard.mp3': 0.0, 'pop.mp3': 0.03, 'riser-cine.mp3': 0.21, 'riser-trailer.mp3': 1.32,
    'shimmer-sparkle-sweep.mp3': 0.53, 'sparkle.mp3': 1.05, 'sweep-metal-quick.mp3': 0.37,
    'sweep-scifi-fast.mp3': 0.15, 'swoosh-quick.mp3': 0.13, 'transition-snap.mp3': 0.07,
    'transition-soft.mp3': 0.32, 'typewriter.mp3': 0.1, 'whoosh-big.mp3': 0.31, 'whoosh-fast.mp3': 0.42,
  };
  // hit: the attack lands at t · peak: the loudest moment lands at t (for whooshes and risers)
  const PEAK = { 'whoosh-big.mp3': 0.71, 'whoosh-fast.mp3': 0.72, 'swoosh-quick.mp3': 0.33, 'riser-cine.mp3': 1.17, 'riser-trailer.mp3': 2.48, 'sweep-scifi-fast.mp3': 0.34, 'sweep-metal-quick.mp3': 0.61, 'shimmer-sparkle-sweep.mp3': 0.91 };
  const hit = (t, src, vol, o) => F.cue(t - (ONSET[src] || 0), src, vol, o);
  let clickN = 0;
  const click = (t, vol) => F.cue(t - 0.001, clickN++ % 2 ? 'click-b.wav' : 'click-a.wav', vol);
  const peak = (t, src, vol, o) => F.cue(t - (PEAK[src] || ONSET[src] || 0), src, vol, o);

  // the track's intro is ~16 dB under its groove: lift it under the hook and brand,
  // and hand back to the natural level as the beat comes in (bar 8)
  // the track's kicks sit 148–176 ms ahead of the film's grid (measured on the kick band, bars 8–51):
  // it starts 0.162 s late, so every bar cut lands within ±16 ms of its kick
  const MUSIC = 0.162;
  F.cue(MUSIC, 'cat-walk.mp3', 0.46, { bgm: true, fadeIn: 0.5, fadeOutAt: 93.9, fadeOutDur: 1.55, env: [[0, 2.1], [C.BAR(8) - 0.5, 2.1], [C.BAR(8) + 0.25, 1]] });

  // ── S1 hook ──
  const O = C.T_OPEN;
  peak(O.winIn + 0.3, 'swoosh-quick.mp3', 0.12); // the window rises
  O.cycles.forEach(([c0, L], k) => {
    click(c0, 0.075 - k * 0.008); // clicks the account chip
    hit(c0 + L * 0.42, 'transition-snap.mp3', 0.2 - k * 0.025); // the name rolls
  });
  // ── S2 brand ──
  peak(O.echo + 0.15, 'whoosh-fast.mp3', 0.3); // copies stream out
  [0, 1, 2].forEach((i) => hit(O.echo + i * 0.11 + 0.08, 'pop.mp3', 0.13 - i * 0.02));
  peak(O.fan + 0.5, 'whoosh-big.mp3', 0.3); // the arc opens
  peak(O.fan + 0.75, 'shimmer-sparkle-sweep.mp3', 0.26); // edges light up
  peak(O.fold + 0.3, 'transition-soft.mp3', 0.16); // windows fold into mascots
  [0, 1, 2, 3].forEach((i) => hit(O.fold + i * 0.08 + 0.4, 'pop.mp3', 0.11 - i * 0.015));
  hit(O.leader + 0.42, 'bass-hit-short.mp3', 0.1); // the leader lands
  hit(O.word + 0.1, 'sparkle.mp3', 0.26); // the name appears

  // ── S3–S7 desk ──
  const D1 = C.T_DESK1;
  peak(D1.start + 0.3, 'whoosh-fast.mp3', 0.34); // the flock jumps into the island
  [0, 1, 2, 3, 4].forEach((i) => hit(D1.jump(i) + D1.fly, 'pop.mp3', 0.24 - i * 0.025));
  peak(D1.openIsl1 + 0.12, 'swoosh-quick.mp3', 0.32); // the island opens
  click(D1.clickOpen, 0.12);
  peak(D1.clientRun - 0.35, 'whoosh-big.mp3', 0.28); // its window grows out of the island
  hit(D1.clientRun, 'transition-snap.mp3', 0.34);
  peak(D1.openIsl2 + 0.12, 'swoosh-quick.mp3', 0.26);
  click(D1.clickAll, 0.16);
  peak(D1.clickAll + 0.3, 'whoosh-fast.mp3', 0.6); // the deal
  ['main', 'work', 'research'].forEach((id, i) => hit(D1.run[id], i % 2 ? 'transition-snap.mp3' : 'pop.mp3', 0.5 - i * 0.05));
  click(D1.focusWork, 0.15);
  peak(D1.focusWork + 0.8, 'whoosh-big.mp3', 0.42); // push in to the edge
  hit(D1.focusWork + 1.2, 'sparkle.mp3', 0.42); // callouts
  peak(D1.atIn + 0.05, 'sweep-metal-quick.mp3', 0.4); // Alt+Tab
  D1.atSel.slice(1).forEach((t, i) => hit(t, 'typewriter.mp3', 0.95 - i * 0.08));
  hit(D1.atOut, 'transition-snap.mp3', 0.55);
  peak(D1.atOut + 0.75, 'whoosh-big.mp3', 0.4); // down to the taskbar
  click(D1.tbClick, 0.15);
  // C1
  peak(C.BAR(24) + 0.15, 'swoosh-quick.mp3', 0.3);
  peak(D1.openIsl3 + 0.12, 'swoosh-quick.mp3', 0.4);
  click(D1.clickSession, 0.15);
  peak(D1.clickSession + 0.5, 'transition-soft.mp3', 0.36);
  peak(D1.openIsl4 + 0.12, 'swoosh-quick.mp3', 0.36);
  click(D1.clickNew, 0.15);
  // C2
  peak(57.42 + 0.15, 'swoosh-quick.mp3', 0.3);

  // ── S8–S10 desk 2 ──
  const D2 = C.T_DESK2;
  peak(D2.setOpen + 0.15, 'transition-soft.mp3', 0.32);
  click(D2.clickAdd, 0.1);
  peak(D2.clickAdd + 0.15, 'swoosh-quick.mp3', 0.22);
  click(D2.clickName, 0.08);
  hit(D2.type0, 'keyboard.mp3', 0.5, { dur: 12 * D2.rate + 0.05, offset: 0.35 }); // "Side project", typed
  click(D2.clickPink, 0.08);
  hit(D2.clickPink + 0.02, 'pop.mp3', 0.22);
  click(D2.clickYellow, 0.08);
  hit(D2.clickYellow + 0.02, 'pop.mp3', 0.2);
  click(D2.clickOwn, 0.09);
  hit(D2.clickOwn + 0.27, 'transition-snap.mp3', 0.3); // the thumb lands
  click(D2.clickSave, 0.11);
  peak(D2.setClose + 0.15, 'swoosh-quick.mp3', 0.22);
  peak(D2.sideLand - 0.3, 'whoosh-big.mp3', 0.26);
  hit(D2.sideLand, 'transition-snap.mp3', 0.3);
  click(D2.clickEmail, 0.1);
  peak(D2.mailIn + 0.2, 'swoosh-quick.mp3', 0.26);
  click(D2.clickSignIn, 0.11);
  peak(D2.linkUp + 0.45, 'sweep-scifi-fast.mp3', 0.9); // the link flies up
  hit(D2.linkCatch, 'pop.mp3', 0.34); // caught by the island
  hit(D2.linkCatch + 0.05, 'sparkle.mp3', 0.3);
  peak(D2.linkLand - 0.25, 'whoosh-fast.mp3', 0.3); // and home
  hit(D2.linkLand, 'impact-zoom-quick.mp3', 0.26);
  peak(D2.mailOut + 0.25, 'swoosh-quick.mp3', 0.2);
  peak(D2.browserIn + 0.25, 'whoosh-big.mp3', 0.26);
  peak(D2.tuck + 0.15, 'swoosh-quick.mp3', 0.28); // the island steps aside
  click(D2.clickTab, 0.11);
  peak(D2.back + 0.15, 'transition-soft.mp3', 0.22); // and comes back

  // ── S11 keys: build into the drop ──
  const K = C.T_KEYS;
  [K.ctrl, K.alt, K.f, K.k1, K.k2, K.k3, K.a].forEach((t, i) => hit(t, 'typewriter.mp3', i === 6 ? 0.5 : 0.85));
  hit(K.f + 0.05, 'impact-zoom-quick.mp3', 0.3); // the island drops
  [K.k1, K.k2, K.k3].forEach((t, i) => hit(t + 0.03, 'pop.mp3', 0.3 - i * 0.03));
  hit(K.a, 'bass-hit-futuristic.mp3', 0.3);
  peak(C.BAR(48), 'riser-trailer.mp3', 0.85); // builds right into the drop
  peak(C.BAR(48), 'riser-cine.mp3', 0.42);

  // ── S12 finale: riser → impact → sparkle ──
  const FN = C.T_FIN;
  hit(FN.drop, 'impact-cine.mp3', 0.6);
  hit(FN.drop + 0.62, 'sparkle.mp3', 0.46);
  [0, 1, 2, 3, 4].forEach((i) => hit(FN.drop + 0.12 + i * 0.115 + 0.42, 'pop.mp3', 0.2 - i * 0.025));
})();
