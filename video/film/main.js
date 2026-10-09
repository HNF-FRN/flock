// Boot: wait for fonts, mount the scenes, then either play in the browser
// (preview: ?t=12.5 to start there, space to play, ← → to step) or wait to be
// driven frame by frame by tools/capture.mjs (?capture).
(function () {
  'use strict';
  const F = window.Film;
  const params = new URLSearchParams(location.search);
  const capture = params.has('capture');
  const film = document.getElementById('film');

  // Film grain: one seeded noise tile, shifted every frame.
  function grainTile() {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    const img = g.createImageData(256, 256);
    const rnd = F.mulberry32(1234);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.floor(rnd() * 255);
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return c.toDataURL('image/png');
  }

  async function boot() {
    await document.fonts.ready;
    // make sure the faces the film uses are loaded before anything is measured
    await Promise.all([
      '600 20px "Segoe UI Variable Display"', '700 20px "Segoe UI Variable Display"',
      '400 20px "Segoe UI Variable Text"', '500 20px "Segoe UI Variable Text"', '600 20px "Segoe UI Variable Text"',
      '400 20px "Cascadia Mono"', '500 20px "Cascadia Mono"',
    ].map((f) => document.fonts.load(f).catch(() => null)));
    F.mount(film);
    const grain = F.h('div', { id: 'grain' });
    grain.style.backgroundImage = `url(${grainTile()})`;
    film.appendChild(grain);
    F.after((t) => {
      const fr = Math.floor(t * 24); // grain moves at 24 fps, like film
      F.css(grain, { backgroundPosition: `${Math.floor(F.hash(fr, 5) * 256)}px ${Math.floor(F.hash(fr, 9) * 256)}px` });
    });

    window.__film = {
      ready: true,
      duration: F.duration,
      fps: F.fps,
      cues: F.cues(),
      scenes: F.scenesList(),
      /** Renders time t and resolves once it is painted. */
      seek(t) {
        F.seek(t);
        return new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(() => res(true))));
      },
    };

    if (capture) {
      document.documentElement.classList.add('capture');
      F.seek(0);
      return;
    }
    if (window.FilmPreview) window.FilmPreview(params);
    else F.seek(Number(params.get('t') || 0));
  }

  boot();
})();
