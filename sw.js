// Service worker: precached app shell, runtime cache for Google Fonts.
// Bump VERSION on every release (keep js/version.js in sync).
const VERSION = '1.25.0';
const CACHE = 'setline-' + VERSION;
const FONTS = 'setline-fonts';
const SHELL = [
  './',
  'index.html',
  'data/foods-dk.js',
  'js/fooddb.js',
  'js/plateau.js',
  'js/ui/foodsearch.js',
  'manifest.webmanifest',
  'css/tokens.css',
  'css/app.css',
  'data/exercises.js',
  'js/ai.js',
  'js/app.js',
  'js/audio.js',
  'js/backup.js',
  'js/body.js',
  'js/cardio.js',
  'js/coach.js',
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
  'js/goals.js',
  'js/profile.js',
  'js/food.js',
  'js/measures.js',
  'js/checkin.js',
  'js/vad.js',
  'js/tap-worklet.js',
  'js/drive.js',
  'js/gps.js',
  'js/insights.js',
  'js/meals.js',
  'js/haptics.js',
  'js/i18n.js',
  'js/plates.js',
  'js/pr.js',
  'js/progression.js',
  'js/routines.js',
  'js/settings.js',
  'js/store.js',
  'js/units.js',
  'js/version.js',
  'js/wakelock.js',
  'js/warmup.js',
  'js/workout.js',
  'js/ui/body.js',
  'js/ui/cardio.js',
  'js/ui/charts.js',
  'js/ui/coach.js',
  'js/ui/dom.js',
  'js/ui/fx.js',
  'js/ui/icons.js',
  'js/ui/sheet.js',
  'js/ui/toast.js',
  'js/ui/today.js',
  'js/ui/workout.js',
  'js/ui/picker.js',
  'js/ui/plates.js',
  'js/ui/goals.js',
  'js/ui/onboard.js',
  'js/ui/scan.js',
  'js/ui/bodyscreen.js',
  'js/ui/checkin.js',
  'js/ui/handsfree.js',
  'js/ui/drive.js',
  'js/ui/meal.js',
  'js/ui/press.js',
  'js/ui/chrome.js',
  'js/ui/customize.js',
  'js/ui/listen.js',
  'js/ui/interview.js',
  'js/endpoint.js',
  'js/figures.js',
  'js/ui/figure.js',
  'js/nutrition.js',
  'js/ui/food.js',
  'js/highlights.js',
  'js/ui/progress.js',
  'js/ui/routine.js',
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

// Rest alarm. The page hands over when rest ends and the worker waits it out itself: a worker
// stays alive while it handles a message (up to about 5 minutes), so the ping comes even when the
// page is frozen in the background or you're in another app.
let rest = null;
const REST_MAX = 270_000;
self.addEventListener('message', e => {
  const d = e.data;
  if (d === 'skipWaiting') { self.skipWaiting(); return; }
  if (d?.type === 'rest' && Number.isFinite(d.endsAt)) { const r = rest = { ...d }; e.waitUntil(waitRest(r)); }
  else if (d?.type === 'rest-cancel') { rest = null; e.waitUntil(closeRest()); }
});
const sleep = ms => new Promise(res => setTimeout(res, ms));
const clock = ms => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const appInFront = async () => (await self.clients.matchAll({ type: 'window', includeUncontrolled: true })).some(c => c.visibilityState === 'visible' && c.focused);
// While rest runs and the app isn't in front: a quiet notification that counts down on the lock
// screen, updated every second. When it ends: the real alert, with sound and buzz.
async function waitRest(r) {
  if (r.endsAt - Date.now() <= 0 || r.endsAt - Date.now() > REST_MAX) return;
  let shown = false;
  while (Date.now() < r.endsAt - 250) {
    if (rest !== r) { if (shown && rest === null) closeRest(); return; }
    if (r.live && !(await appInFront())) {
      await self.registration.showNotification(`${r.liveTitle || 'Rest'} · ${clock(r.endsAt - Date.now())}`, {
        body: r.body || '', tag: 'setline-rest', renotify: false, silent: true, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', timestamp: r.endsAt, data: { url: './' }
      });
      shown = true;
    } else if (shown) { closeRest(); shown = false; }
    const left = r.endsAt - Date.now();
    await sleep(Math.max(100, Math.min(1000, left % 1000 || 1000)));
  }
  await sleep(Math.max(0, r.endsAt - Date.now()));
  if (rest !== r) return; // skipped, changed or the workout ended
  rest = null;
  if (await appInFront()) { if (shown) closeRest(); return; } // the app is open: it rings itself
  await self.registration.showNotification(r.title, {
    body: r.body || '', tag: 'setline-rest', renotify: true, silent: false, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png',
    vibrate: [260, 110, 260, 110, 420], timestamp: r.endsAt, data: { url: './' }
  });
}
async function closeRest() {
  for (const n of await self.registration.getNotifications({ tag: 'setline-rest' })) n.close();
}

// Tapping a rest alert brings the app back.
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (all[0]) return all[0].focus();
    return self.clients.openWindow('./');
  })());
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
