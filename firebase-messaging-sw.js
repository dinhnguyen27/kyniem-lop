importScripts('https://www.gstatic.com/firebasejs/8.10.1/firebase-app.js');
importScripts('https://www.gstatic.com/firebasejs/8.10.1/firebase-messaging.js');

firebase.initializeApp({
    apiKey: "AIzaSyA1lkOgOfvmM49o4G4B8ZgoMglAPjNdD5w",
    authDomain: "kyniemlop-d3404.firebaseapp.com",
    projectId: "kyniemlop-d3404",
    storageBucket: "kyniemlop-d3404.firebasestorage.app",
    messagingSenderId: "824232517330",
    appId: "1:824232517330:web:acf65afe55dac4d38b970b",
    measurementId: "G-XG46M01K89"
});

const messaging = firebase.messaging();


const APP_CACHE = 'kyniemlop-app-shell-v3';
const APP_SHELL_ASSETS = [
  './',
  './index.html',
  './style.css',
  './script.js',
  './manifest.json',
  './icons/icon-192.svg',
  './icons/icon-512.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(APP_CACHE);
    await cache.addAll(APP_SHELL_ASSETS);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== APP_CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  const isAppShell = req.mode === 'navigate'
    || ['/index.html', '/style.css', '/script.js', '/manifest.json'].includes(url.pathname);

  event.respondWith((async () => {
    const cache = await caches.open(APP_CACHE);

    if (isAppShell) {
      try {
        const fresh = await fetch(req, { cache: 'no-cache' });
        cache.put(req, fresh.clone());
        return fresh;
      } catch (e) {
        const cached = await caches.match(req);
        const fallback = await caches.match('./index.html');
        return cached || fallback || Response.error();
      }
    }

    const cached = await caches.match(req);
    if (cached) {
      fetch(req).then((fresh) => cache.put(req, fresh.clone())).catch(() => {});
      return cached;
    }

    try {
      const fresh = await fetch(req);
      cache.put(req, fresh.clone());
      return fresh;
    } catch (e) {
      const fallback = await caches.match('./index.html');
      return fallback || Response.error();
    }
  })());
});

function extractPayload(rawPayload) {
  const payload = rawPayload || {};
  const data = payload.data || {};
  const notification = payload.notification || {};

  const title = notification.title || data.title || 'Thông báo mới';
  const body = notification.body || data.body || '';
  const link = data.link || payload.fcmOptions?.link || '/';
  const icon = notification.icon || data.icon || 'https://www.gstatic.com/mobilesdk/160503_mobilesdk/logo/2x/firebase_28dp.png';

  return {
    title,
    options: {
      body,
      icon,
      badge: data.badge || icon,
      tag: data.tag || data.type || 'class-notification',
      renotify: true,
      data: { ...data, link }
    }
  };
}

function safeParsePushData(event) {
  try {
    return event?.data?.json?.() || {};
  } catch (_) {
    try {
      const text = event?.data?.text?.() || '{}';
      return JSON.parse(text);
    } catch (_) {
      return {};
    }
  }
}

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

messaging.setBackgroundMessageHandler((payload) => {
  const { title, options } = extractPayload(payload);
  return self.registration.showNotification(title, options);
});

self.addEventListener('push', (event) => {
  const payload = safeParsePushData(event);
  const { title, options } = extractPayload(payload);

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const data = event.notification?.data || {};
  const targetUrl = data.link || data.click_action || data.url || '/';

  event.waitUntil((async () => {
    const allClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });

    const matched = allClients.find((client) => {
      if (!client?.url) return false;
      return client.url.includes(targetUrl) || client.url.includes('/kyniem-lop/');
    });

    if (matched) {
      await matched.focus();
      return;
    }

    await clients.openWindow(targetUrl);
  })());
});
