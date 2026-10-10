// Inline stroke icons (16px grid), so the windows need no image files.
(function () {
  const s = (d, extra = '') =>
    `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" ${extra}>${d}</svg>`;
  window.FlockIcons = {
    home: s('<path d="M2.5 7.2 8 2.8l5.5 4.4V13a.8.8 0 0 1-.8.8H9.6V10H6.4v3.8H3.3a.8.8 0 0 1-.8-.8V7.2Z"/>'),
    plus: s('<path d="M8 3v10M3 8h10"/>'),
    gear: s('<path d="M6.9 1.8h2.2l.4 1.6c.4.1.8.3 1.1.5l1.4-.8 1.6 1.6-.8 1.4c.2.3.4.7.5 1.1l1.6.4v2.2l-1.6.4c-.1.4-.3.8-.5 1.1l.8 1.4-1.6 1.6-1.4-.8c-.3.2-.7.4-1.1.5l-.4 1.6H6.9l-.4-1.6c-.4-.1-.8-.3-1.1-.5l-1.4.8-1.6-1.6.8-1.4c-.2-.3-.4-.7-.5-1.1L1.8 9.1V6.9l1.6-.4c.1-.4.3-.8.5-1.1l-.8-1.4 1.6-1.6 1.4.8c.3-.2.7-.4 1.1-.5z" stroke-width="1.3"/><circle cx="8" cy="8" r="2"/>'),
    soundOn: s('<path d="M2.8 6.2h2.3L8.3 3.5v9L5.1 9.8H2.8z"/><path d="M10.6 5.6a3.2 3.2 0 0 1 0 4.8M12.3 3.9a5.6 5.6 0 0 1 0 8.2"/>'),
    soundOff: s('<path d="M2.8 6.2h2.3L8.3 3.5v9L5.1 9.8H2.8z"/><path d="m11 6.3 3.2 3.4M14.2 6.3 11 9.7"/>'),
    playAll: s('<path d="M3 3.6v8.8l5.6-4.4zM8.6 3.6v8.8l5.6-4.4z" fill="currentColor" stroke-width="1.1"/>'),
    play: s('<path d="M5 3.4v9.2l7.2-4.6z" fill="currentColor" stroke-width="1.1"/>'),
    power: s('<path d="M8 2.2V8M4.6 4.2a5 5 0 1 0 6.8 0"/>'),
    more: s('<circle cx="3.5" cy="8" r=".9" fill="currentColor"/><circle cx="8" cy="8" r=".9" fill="currentColor"/><circle cx="12.5" cy="8" r=".9" fill="currentColor"/>'),
    window: s('<rect x="2.2" y="3.2" width="11.6" height="9.6" rx="1.8"/><path d="M2.2 6.2h11.6"/>'),
    folder: s('<path d="M2.2 4.6c0-.7.5-1.2 1.2-1.2h2.8l1.4 1.5h5c.7 0 1.2.5 1.2 1.2v5.6c0 .7-.5 1.2-1.2 1.2H3.4c-.7 0-1.2-.5-1.2-1.2z"/>'),
    box: s('<path d="M2.6 5 8 2.4 13.4 5v6L8 13.6 2.6 11z"/><path d="M2.6 5 8 7.6 13.4 5M8 7.6v6"/>'),
    key: s('<circle cx="5.4" cy="10.6" r="2.6"/><path d="m7.3 8.7 5.4-5.4M10.6 5.4l1.6 1.6M11.9 4.1l1.3 1.3"/>'),
    check: s('<path d="m3.4 8.4 3 3 6.2-6.6"/>'),
    search: s('<circle cx="7.2" cy="7.2" r="4.4"/><path d="m10.5 10.5 3.1 3.1"/>'),
    x: s('<path d="m4 4 8 8M12 4l-8 8"/>'),
    link: s('<path d="M6.6 9.4a2.6 2.6 0 0 0 3.7 0l2.2-2.2a2.6 2.6 0 0 0-3.7-3.7l-.9.9M9.4 6.6a2.6 2.6 0 0 0-3.7 0L3.5 8.8a2.6 2.6 0 0 0 3.7 3.7l.9-.9"/>'),
    warn: s('<path d="M8 2.6 14 13H2z"/><path d="M8 6.6v3M8 11.6v.1"/>'),
    dot: s('<circle cx="8" cy="8" r="2.6" fill="currentColor" stroke="none"/>'),
    edit: s('<path d="M10.4 3.2 12.8 5.6 5.6 12.8H3.2v-2.4z"/>'),
    trash: s('<path d="M3 4.4h10M6.4 4.4V3h3.2v1.4M4.4 4.4l.6 8.6h6l.6-8.6"/>'),
    phone: s('<rect x="4.4" y="1.8" width="7.2" height="12.4" rx="1.6"/><path d="M7 11.8h2"/>'),
    drag: s('<circle cx="6" cy="4" r=".8" fill="currentColor"/><circle cx="10" cy="4" r=".8" fill="currentColor"/><circle cx="6" cy="8" r=".8" fill="currentColor"/><circle cx="10" cy="8" r=".8" fill="currentColor"/><circle cx="6" cy="12" r=".8" fill="currentColor"/><circle cx="10" cy="12" r=".8" fill="currentColor"/>'),
  };
})();
