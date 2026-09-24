// Service worker: precached app shell, runtime cache for Google Fonts.
// Bump VERSION on every release (keep js/version.js in sync).
const VERSION = '1.2.0';
const CACHE = 'setline-' + VERSION;
const FONTS = 'setline-fonts';
const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/tokens.css',
  'css/app.css',
  'data/exercises.js',
  'js/app.js',
  'js/audio.js',
  'js/commands.js',
  'js/keys.js',
  'js/parser.js',
  'js/stats.js',
  'js/stt.js',
  'js/tts.js',
  'js/voice.js',
  'js/catalog.js',
  'js/db.js',
  'js/format.js',
  'js/haptics.js',
  'js/i18n.js',
  'js/pr.js',
  'js/routines.js',
  'js/settings.js',
  'js/store.js',
  'js/units.js',
  'js/version.js',
  'js/wakelock.js',
  'js/workout.js',
  'js/ui/dom.js',
  'js/ui/icons.js',
  'js/ui/sheet.js',
  'js/ui/toast.js',
  'js/ui/today.js',
  'js/ui/workout.js',
  'js/ui/picker.js',
  'js/ui/history.js',
  'js/ui/settings.js',
  'js/ui/voice.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.map(p => new Request(p, { cache: 'reload' })))));
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE && k !== FONTS) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('message', e => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith((async () => {
      const cache = await caches.open(FONTS);
      const hit = await cache.match(req);
      const net = fetch(req).then(r => { if (r.ok || r.type === 'opaque') cache.put(req, r.clone()); return r; }).catch(() => hit);
      return hit || net;
    })());
    return;
  }

  if (url.origin !== self.location.origin) return;

  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (req.mode === 'navigate') {
      return (await cache.match('index.html')) || fetch(req);
    }
    return (await cache.match(req, { ignoreSearch: true })) || fetch(req);
  })());
});
