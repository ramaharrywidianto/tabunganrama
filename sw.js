/**
 * ════════════════════════════════════════════════════════════════════
 *  RECAP TABUNGAN RAMA — Service Worker v18.2
 *  Strategi: App Shell + Runtime Cache + Offline-first
 * ════════════════════════════════════════════════════════════════════
 *  ⚠️ Naikkan CACHE_VERSION setiap kali deploy index.html baru,
 *     supaya user dapat versi terbaru (bukan cache lama).
 * ════════════════════════════════════════════════════════════════════
 */

const CACHE_VERSION = 'rama-v18.2.0';
const CACHE_NAME    = `app-shell-${CACHE_VERSION}`;
const RUNTIME_CACHE = `runtime-${CACHE_VERSION}`;

// ─── Asset inti yang WAJIB tersedia offline ──────────────────────
const PRECACHE_URLS = [
  './',
  './index.html',
  './sw.js',
  './manifest.json',      // opsional — abaikan error kalau tidak ada
  './icon-192.png',       // opsional
  './icon-512.png'        // opsional
];

// ─── Origin yang TIDAK boleh di-cache (API sync) ─────────────────
const NEVER_CACHE_ORIGINS = [
  'script.google.com',
  'script.googleusercontent.com',
  'docs.google.com',
  'sheets.googleapis.com',
  'www.googleapis.com'
];

// ─── Install: precache app shell ─────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      // addAll gagal total kalau SATU file 404 → pakai loop per-file
      await Promise.all(
        PRECACHE_URLS.map(async (url) => {
          try {
            const res = await fetch(url, { cache: 'no-store' });
            if (res.ok) await cache.put(url, res);
          } catch (_) {
            /* file opsional tidak ada — abaikan */
          }
        })
      );
      // Aktifkan SW baru segera (skip waiting) — cocok untuk app personal
      await self.skipWaiting();
    })()
  );
});

// ─── Activate: bersihkan cache versi lama ────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k !== CACHE_NAME && k !== RUNTIME_CACHE)
          .map((k) => caches.delete(k))
      );
      await self.clients.claim();
      // Beri tahu semua tab bahwa versi baru aktif
      const clients = await self.clients.matchAll({ type: 'window' });
      clients.forEach((client) =>
        client.postMessage({ type: 'SW_ACTIVATED', version: CACHE_VERSION })
      );
    })()
  );
});

// ─── Fetch: strategi per jenis request ───────────────────────────
self.addEventListener('fetch', (event) => {
  const req = event.request;

  // (a) Hanya handle GET — POST/PUT ke Sheets WAJIB lewat network
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // (b) Jangan cache API sync / lintas origin
  if (NEVER_CACHE_ORIGINS.some((o) => url.hostname.includes(o))) return;

  // (c) Jangan cache endpoint dengan query action= (mis. /exec?action=ping)
  if (url.searchParams.has('action')) return;

  // (d) Navigation request (buka halaman) → Network-first, fallback cache
  if (req.mode === 'navigate') {
    event.respondWith(networkFirst(req, './index.html'));
    return;
  }

  // (e) Asset same-origin (html/css/js/icon) → Cache-first
  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(req));
    return;
  }

  // (f) Cross-origin lain (font, CDN) → Stale-while-revalidate
  event.respondWith(staleWhileRevalidate(req));
});

// ─── Strategi ────────────────────────────────────────────────────

/** Cache-first: cepat, fallback network; simpan hasil network. */
async function cacheFirst(req) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(req, { ignoreSearch: true });
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    // Offline & tidak ada cache → kembalikan halaman utama
    const fallback = await cache.match('./index.html');
    if (fallback) return fallback;
    return new Response('Offline — halaman tidak tersedia', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }
}

/** Network-first: selalu coba network dulu (navigasi HTML). */
async function networkFirst(req, fallbackUrl) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const res = await fetch(req);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch (_) {
    const cached = await cache.match(req, { ignoreSearch: true });
    if (cached) return cached;
    const fb = await cache.match(fallbackUrl);
    if (fb) return fb;
    return new Response('Offline', { status: 503 });
  }
}

/** Stale-while-revalidate: serve cache, update background. */
async function staleWhileRevalidate(req) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(req);
  const networkPromise = fetch(req)
    .then((res) => {
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    })
    .catch(() => cached);
  return cached || networkPromise;
}

// ─── Message: handle update / clear cache dari app ───────────────
self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'SKIP_WAITING') self.skipWaiting();
  if (data.type === 'CLEAR_CACHE') {
    event.waitUntil(
      (async () => {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
        event.source && event.source.postMessage({ type: 'CACHE_CLEARED' });
      })()
    );
  }
});
