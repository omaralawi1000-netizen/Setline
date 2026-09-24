// Inline SVG icons, same stroke style as the design target.
const svg = d => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;

export const I = {
  back: svg('<path d="M14.5 6 8.5 12l6 6"/>'),
  fwd: svg('<path d="M9.5 6l6 6-6 6"/>'),
  up: svg('<path d="M6 14.5l6-6 6 6"/>'),
  close: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
  check: svg('<path d="M5.5 12.5l4.2 4.2L18.5 7.8"/>'),
  settings: svg('<path d="M5 8h9M18 8h1M5 16h1M10 16h9"/><circle cx="16" cy="8" r="2"/><circle cx="8" cy="16" r="2"/>'),
  home: svg('<path d="M4 11.2 12 4.8l8 6.4V19a1 1 0 0 1-1 1h-4.2v-5.2H9.2V20H5a1 1 0 0 1-1-1z"/>'),
  workout: svg('<path d="M7 8v8M4 10v4M17 8v8M20 10v4M7 12h10"/>'),
  history: svg('<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4.5 4.8v3.4h3.4"/><path d="M12 8.2V12l2.6 1.8"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  list: svg('<path d="M9 6.5h10M9 12h10M9 17.5h10"/><circle cx="5" cy="6.5" r=".6"/><circle cx="5" cy="12" r=".6"/><circle cx="5" cy="17.5" r=".6"/>'),
  search: svg('<circle cx="11" cy="11" r="6.2"/><path d="M20 20l-4.4-4.4"/>'),
  trash: svg('<path d="M5 7h14M10 7V5h4v2M7 7l.8 12h8.4L17 7"/>'),
  alert: svg('<path d="M12 7.5v5.5M12 16.4v.1"/><circle cx="12" cy="12" r="8.5"/>'),
  play: svg('<path d="M8 6.5v11l9-5.5z"/>'),
  chat: svg('<path d="M5 18.5V7a2.5 2.5 0 0 1 2.5-2.5h9A2.5 2.5 0 0 1 19 7v6.5a2.5 2.5 0 0 1-2.5 2.5H9.2z"/><path d="M9 9.5h6M9 12.5h3.5"/>'),
  stop: svg('<rect x="7" y="7" width="10" height="10" rx="2.5"/>'),
  chart: svg('<path d="M4 19V5M4 19h16M8 15l3.2-4.2 3 2.2L19 7.5"/>'),
  plates: svg('<rect x="3" y="8" width="3" height="8" rx="1"/><rect x="6.5" y="6" width="3" height="12" rx="1"/><path d="M9.5 12h5"/><rect x="14.5" y="6" width="3" height="12" rx="1"/><rect x="18" y="8" width="3" height="8" rx="1"/>'),
  download: svg('<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>'),
  upload: svg('<path d="M12 20V9M7 14l5-5 5 5M5 4h14"/>'),
  flame: svg('<path d="M12 21c-3.9 0-6.5-2.6-6.5-6.2 0-3.3 2.4-5.4 3.9-7.6.4 1.9 1.5 3 2.6 3.4-.3-2.8.8-5.6 3.3-7.6.4 3 4.2 5.8 4.2 10.6 0 4.1-3 7.4-7.5 7.4z"/>'),
  undo: svg('<path d="M9 7 5 11l4 4"/><path d="M5.5 11H14a5 5 0 0 1 0 10h-2"/>')
};
