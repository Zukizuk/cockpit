// Cockpit's service worker: only one job. When the server isn't running, opening the app shows a page saying
// how to start it instead of the browser's error page. Everything else goes straight to the network.
const CACHE = 'cockpit-shell-v1'
const SHELL = ['/offline.html', '/icons/icon-192.png']

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', event => {
  event.waitUntil(
    caches
      .keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', event => {
  if (event.request.mode !== 'navigate') return
  event.respondWith(fetch(event.request).catch(() => caches.match('/offline.html')))
})
