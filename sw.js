const CACHE = 'tj-v31';
const PRECACHE = [
  './dashboard.html',
  './manifest.json',
  './assets/icon.svg',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/icon-maskable-512.png',
  './assets/apple-touch-icon.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  if (e.request.url.includes('localhost:8282/api/')) return;
  if (e.request.url.startsWith('chrome-extension://')) return;
  if (e.request.url.includes('supabase.co/functions/')) return;

  // Always fetch the app fresh. Match every page navigation (covers /dashboard
  // on Vercel, / on GitHub Pages, and /dashboard.html) plus sw.js — never serve
  // these from cache while online, so deploys ship instantly without a hard refresh.
  const url = new URL(e.request.url);
  if (e.request.mode === 'navigate' || url.pathname.endsWith('/dashboard.html') || url.pathname.endsWith('/sw.js') || url.pathname.endsWith('/')) {
    e.respondWith(
      fetch(e.request, { cache: 'no-cache' })
        .catch(() => caches.match(e.request).then(r => r || caches.match('./dashboard.html')))
    );
    return;
  }

  e.respondWith(
    caches.match(e.request).then(cached => {
      const fresh = fetch(e.request).then(res => {
        if (res && res.status === 200 && res.type !== 'opaque') {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      }).catch(() => null);
      return cached || fresh;
    })
  );
});
