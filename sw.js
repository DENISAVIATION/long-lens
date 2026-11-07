// Serves Spotters' Wall photos at /_blob/<id> by reading them from Firestore (public read).
const PROJECT = new URL(self.location.href).searchParams.get('p') || '';
const CACHE = 'll-blobs-v1';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;
  const m = url.pathname.match(/\/_blob\/([A-Za-z0-9_-]{1,80})$/);
  if (!m) return;
  e.respondWith(serve(m[1], e.request));
});
async function serve(id, req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const api = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(PROJECT)}/databases/(default)/documents/images/${id}`;
  const r = await fetch(api);
  if (!r.ok) return new Response('', { status: 404 });
  const j = await r.json();
  const b64 = j.fields && j.fields.d && j.fields.d.stringValue;
  if (!b64) return new Response('', { status: 404 });
  const bin = atob(b64), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const res = new Response(bytes, { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=31536000' } });
  cache.put(req, res.clone());
  return res;
}
