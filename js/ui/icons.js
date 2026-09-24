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
  undo: svg('<path d="M9 7 5 11l4 4"/><path d="M5.5 11H14a5 5 0 0 1 0 10h-2"/>')
};
