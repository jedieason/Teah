const VERSION = 'teah-shell-v3';
const base = new URL('./', self.location.href);
const shell = ['index.html', 'manifest.webmanifest', 'Images/logo.png', 'styles/learning.css'];
self.addEventListener('install', event => event.waitUntil(caches.open(VERSION).then(cache => cache.addAll(shell.map(p => new URL(p, base).href)))));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('teah-shell-') && k !== VERSION).map(k => caches.delete(k))))));
self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);
    // Never cache database, authentication, AI responses, exports, or user data.
    if (event.request.method !== 'GET') return;
    const local = url.origin === base.origin && (url.pathname === base.pathname || /\/(src|styles|Images|fonts)\//.test(url.pathname) || /\/(index\.html|support\.html|privacy\.html|manifest\.webmanifest)$/.test(url.pathname));
    const vendor = ['https://www.gstatic.com', 'https://cdn.jsdelivr.net', 'https://cdnjs.cloudflare.com'].includes(url.origin) && /\.(js|css|woff2?)(\?|$)/.test(url.href);
    if (!local && !vendor) return;
    event.respondWith(fetch(event.request).then(response => {
        if (response.ok && response.type !== 'opaque') { const copy = response.clone(); event.waitUntil(caches.open(VERSION).then(cache => cache.put(event.request, copy))); }
        return response;
    }).catch(async () => (await caches.match(event.request)) || (event.request.mode === 'navigate' ? await caches.match(new URL('index.html', base).href) : Response.error())));
});
