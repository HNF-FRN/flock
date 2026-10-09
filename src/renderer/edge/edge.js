// One account's accent edge along the top of its Claude window. Main sends the
// colour, whether the window has focus, its corner radius and the parts of the
// edge nothing covers, as rectangles. It never takes clicks.
(function () {
  const edge = document.getElementById('edge');
  let focused = null;

  function covers(r, e) {
    return r[0] <= 0.5 && r[1] <= 0.5 && r[2] >= e.w - 0.5 && r[3] >= e.h - 0.5;
  }

  window.flock.on('edge', (e) => {
    edge.style.setProperty('--c', e.color);
    edge.style.setProperty('--r', `${e.radius}px`);
    if (focused === false && e.focused) {
      edge.classList.remove('pulse');
      void edge.offsetWidth;
      edge.classList.add('pulse');
    }
    focused = e.focused;
    edge.classList.toggle('focused', e.focused);
    edge.style.clipPath = e.rects.length === 1 && covers(e.rects[0], e)
      ? ''
      : `path('${e.rects.map(([x, y, w, h]) => `M${x} ${y}h${w}v${h}h${-w}Z`).join(' ')}')`;
    edge.classList.add('on');
  });
})();
