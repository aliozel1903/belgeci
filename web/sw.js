// PDF Atölyesi servis çalışanı: önce ağ, ağ yoksa önbellek (çevrimdışı kullanım için).
const CACHE = 'pdf-atolyesi-v2';
const CORE = ['./', 'index.html', 'css/app.css', 'js/app.js', 'js/ui.js', 'js/tools.js', 'js/pdfcore.js', 'js/convert.js', 'js/organizer.js', 'js/compare.js',
  'js/doc/layout.js', 'js/doc/udf.js', 'js/doc/docx.js', 'js/doc/pdf2model.js',
  'vendor/pdf-lib.min.js', 'vendor/fontkit.min.js', 'vendor/jszip.min.js', 'vendor/Sortable.min.js', 'vendor/pdfjs/pdf.min.mjs', 'vendor/pdfjs/pdf.worker.min.mjs',
  'icons/icon.svg', 'manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.includes('/api/')) return;
  e.respondWith(
    fetch(e.request).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || Response.error())),
  );
});
