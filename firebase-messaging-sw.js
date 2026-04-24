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

const APP_CACHE = 'kyniemlop-app-shell-v4';
const APP_SHELL_ASSETS = [
    './',
    './index.html',
    './style.css',
    './script.js',
    './manifest.json',
    './icons/icon-192.svg',
    './icons/icon-512.svg'
];

const DEFAULT_ICON = 'https://www.gstatic.com/mobilesdk/160503_mobilesdk/logo/2x/firebase_28dp.png';
const recentNotificationKeys = new Map();
const DEDUPE_WINDOW_MS = 8000;

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

function normalizeLink(link) {
    const raw = String(link || '').trim();
    if (!raw) return self.location.origin + '/';

    try {
        return new URL(raw, self.location.origin).href;
    } catch (_) {
        return self.location.origin + '/';
    }
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

function extractPayload(rawPayload) {
    const payload = rawPayload || {};
    const data = payload.data || {};
    const notification = payload.notification || {};

    const type = String(data.type || '').trim();
    const title = notification.title || data.title || 'Thông báo mới';
    const body = notification.body || data.body || '';
    const link = normalizeLink(data.link || payload.fcmOptions?.link || '/');
    const icon = notification.icon || data.icon || DEFAULT_ICON;
    const sentAt = Number(data.sentAt || Date.now());

    const defaultOptions = {
        body,
        icon,
        badge: data.badge || icon,
        tag: data.tag || type || 'class-notification',
        renotify: true,
        requireInteraction: type === 'group_chat_new_message',
        timestamp: sentAt,
        vibrate: [180, 80, 180],
        data: { ...data, type, link, sentAt }
    };

    if (type === 'group_chat_new_message') {
        defaultOptions.actions = [
            { action: 'open-group-chat', title: 'Mở chat nhóm' }
        ];
    }

    return { title, options: defaultOptions };
}

function getDedupeKey(title, options = {}) {
    const data = options.data || {};
    return [
        options.tag || '',
        data.type || '',
        data.sentAt || '',
        title || '',
        options.body || ''
    ].join('::');
}

function shouldDisplayNotification(key) {
    const now = Date.now();

    for (const [savedKey, ts] of recentNotificationKeys.entries()) {
        if (now - ts > DEDUPE_WINDOW_MS) {
            recentNotificationKeys.delete(savedKey);
        }
    }

    const last = recentNotificationKeys.get(key);
    if (last && now - last <= DEDUPE_WINDOW_MS) return false;

    recentNotificationKeys.set(key, now);
    return true;
}

async function displayNotificationFromPayload(payload) {
    const { title, options } = extractPayload(payload);
    const dedupeKey = getDedupeKey(title, options);

    if (!shouldDisplayNotification(dedupeKey)) {
        return null;
    }

    return self.registration.showNotification(title, options);
}

self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});

self.addEventListener('push', (event) => {
    const payload = safeParsePushData(event);
    if (!payload || (!payload.data && !payload.notification)) return;
    event.waitUntil(displayNotificationFromPayload(payload));
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();

    const data = event.notification?.data || {};
    const targetUrl = normalizeLink(data.link || data.click_action || data.url || '/');

    event.waitUntil((async () => {
        const allClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });
        const shouldOpenGroupChat = data.type === 'group_chat_new_message' || event.action === 'open-group-chat';

        const matched = allClients.find((client) => {
            if (!client?.url) return false;
            return client.url === targetUrl
                || client.url.startsWith(targetUrl)
                || client.url.includes('/kyniem-lop/');
        });

        if (matched) {
            await matched.focus();
            if ('navigate' in matched) {
                try {
                    await matched.navigate(targetUrl);
                } catch (_) {}
            }

            if (shouldOpenGroupChat) {
                matched.postMessage({ type: 'OPEN_GROUP_CHAT_FROM_PUSH' });
            }
            return;
        }

        const newClient = await clients.openWindow(targetUrl);
        if (newClient && shouldOpenGroupChat) {
            newClient.postMessage({ type: 'OPEN_GROUP_CHAT_FROM_PUSH' });
        }
    })());
});
