// Ghi chú tối ưu hiệu năng (2026-04-27): quản lý listener tập trung, dọn VanillaTilt, quản lý interval và pause animation khi tab ẩn.
const { auth, db, storage } = window.firebaseServices;
const UNLOCK_NOTIFY_KEY = 'class_capsule_notified_unlocks';
const CHAT_READ_KEY = 'class_chat_read_state';
const GROUP_CHAT_READ_KEY = 'class_group_chat_last_read';
const GROUP_CHAT_AVATAR_KEY = 'class_group_chat_avatar';
const THEME_MODE_KEY = 'class_theme_mode';
const INTRO_SETTINGS_DOC = 'intro';
const INTRO_SEEN_AT_KEY = 'class_intro_seen_at_by_user_v1';
const DEFAULT_INTRO_SETTINGS = {
    introEnabled: true,
    introTitle: 'Chào mừng đến với trang kỷ niệm lớp',
    introDescription: 'Nơi lưu giữ hình ảnh, video và những mảnh ghép đẹp nhất của tập thể chúng mình.',
    introVideoUrl: '',
    introRepeatDays: 30
};

let unlockWatcherInitialized = false;
let notifiedUnlockIds = new Set(JSON.parse(localStorage.getItem(UNLOCK_NOTIFY_KEY) || '[]'));

const ONLINE_ACTIVE_WINDOW_MS = 120000;
const PRIVATE_CHAT_LIMIT = 120;
const GROUP_CHAT_LIMIT = 180;
let presenceInterval = null;
let countdownIntervalId = null;
let letterCountdownInterval = null;
const activeListeners = new Map();
const tiltInstances = [];
let usersUnsubscribe = null;
let recentMessagesUnsubscribe = null;
let chatUnsubscribe = null;
let chatConversationUnsubscribe = null;
let galleryUnsubscribe = null;
let selectedChatUser = null;
let chatUsersCache = [];
let allChatUsers = [];
let lastMessageAtByEmail = {};
let latestMessagePreviewByEmail = {};
let unreadCountsByEmail = {};
let lastRemoteReadSyncByEmail = {};
let chatReadState = JSON.parse(localStorage.getItem(CHAT_READ_KEY) || '{}');
let chatUserSearchKeyword = '';
let hasUserTypedChatSearch = false;
let currentOpenedLetter = null;
let memoryMap = null;
let pendingScrollPostId = null;
let groupChatUnsubscribe = null;
let groupChatLastRead = Number(localStorage.getItem(GROUP_CHAT_READ_KEY) || 0);
let groupChatNotifiedUpToTs = 0;
let currentMainTab = 'feed';
let replyingPrivateMessage = null;
let replyingGroupMessage = null;
let privateSearchKeyword = '';
let groupSearchKeyword = '';
let lastPrivateMessageSentAt = 0;
let lastGroupMessageSentAt = 0;
let privateTypingDebounce = null;
let groupTypingDebounce = null;
let privateTypingUnsubscribe = null;
let groupTypingUnsubscribe = null;
let latestPrivateMessages = [];
let latestGroupMessages = [];
const commentCooldownByPost = new Map();
const commentSpamLockUntilByPost = new Map();
const lastCommentByPost = new Map();
let galleryMediaItems = [];
let lightboxActiveItems = [];
let galleryIntersectionObserver = null;
let galleryResizeObserver = null;
let galleryCardQueue = [];
let galleryVirtualScrollBound = false;
let galleryVirtualTicking = false;
const galleryCacheByYear = new Map();
const GALLERY_CACHE_DB_NAME = 'kyniem_gallery_cache_v1';
const GALLERY_CACHE_STORE = 'gallery_by_year';
const GALLERY_MAX_DOM_CARDS = 90;
const GALLERY_PRUNE_TARGET = 65;
let currentLightboxIndex = -1;
let lightboxZoom = 1;
let lightboxRotation = 0;
let deferredInstallPrompt = null;
let pendingSWRegistration = null;
let swUpdateAvailable = false;
let groupChatUnreadCount = 0;
let pushNudgeTimer = null;
let notificationCenterUnsubscribe = null;
let notificationsUnreadCount = 0;
let storiesUnsubscribe = null;
let hasEnteredMainSite = false;
let splashBootStartedAt = Date.now();
let splashHidden = false;

function showBootSplash() {
    splashBootStartedAt = Date.now();
    splashHidden = false;
    const splash = document.getElementById('app-splash-screen');
    if (!splash) return;
    splash.classList.remove('hidden');
}

function hideBootSplash(minDurationMs = 650) {
    if (splashHidden) return;
    const splash = document.getElementById('app-splash-screen');
    if (!splash) {
        splashHidden = true;
        return;
    }
    const elapsed = Date.now() - splashBootStartedAt;
    const delay = Math.max(0, minDurationMs - elapsed);
    setTimeout(() => {
        splash.classList.add('hidden');
        splashHidden = true;
    }, delay);
}

// === Tối ưu hiệu năng: quản lý listener/interval/tilt tập trung ===
function setListener(key, unsub) {
    const oldUnsub = activeListeners.get(key);
    if (typeof oldUnsub === 'function') {
        try { oldUnsub(); } catch (_) {}
    }

    if (typeof unsub === 'function') {
        activeListeners.set(key, unsub);
        return;
    }

    activeListeners.delete(key);
}

function clearAllListeners() {
    activeListeners.forEach((unsub) => {
        if (typeof unsub === 'function') {
            try { unsub(); } catch (_) {}
        }
    });
    activeListeners.clear();

    // Đồng bộ lại các biến unsubscribe cũ để không đổi hành vi hiện có.
    usersUnsubscribe = null;
    recentMessagesUnsubscribe = null;
    chatUnsubscribe = null;
    chatConversationUnsubscribe = null;
    galleryUnsubscribe = null;
    groupChatUnsubscribe = null;
    groupTypingUnsubscribe = null;
    notificationCenterUnsubscribe = null;
    storiesUnsubscribe = null;
    destroyGalleryObservers();
}

function destroyAllTilts() {
    while (tiltInstances.length) {
        const instance = tiltInstances.pop();
        if (instance && typeof instance.destroy === 'function') {
            try { instance.destroy(); } catch (_) {}
        }
    }
}

function destroyGalleryObservers() {
    if (galleryIntersectionObserver) {
        try { galleryIntersectionObserver.disconnect(); } catch (_) {}
        galleryIntersectionObserver = null;
    }
    if (galleryResizeObserver) {
        try { galleryResizeObserver.disconnect(); } catch (_) {}
        galleryResizeObserver = null;
    }
    detachGalleryVirtualization();
    galleryCardQueue = [];
}

function handleGalleryVirtualScroll() {
    if (galleryVirtualTicking) return;
    galleryVirtualTicking = true;
    requestAnimationFrame(() => {
        galleryVirtualTicking = false;
        pruneOffscreenGalleryCards();
    });
}

function attachGalleryVirtualization() {
    if (galleryVirtualScrollBound) return;
    window.addEventListener('scroll', handleGalleryVirtualScroll, { passive: true });
    galleryVirtualScrollBound = true;
}

function detachGalleryVirtualization() {
    if (!galleryVirtualScrollBound) return;
    window.removeEventListener('scroll', handleGalleryVirtualScroll);
    galleryVirtualScrollBound = false;
}

function pruneOffscreenGalleryCards() {
    const gallery = document.getElementById('galleryGrid');
    if (!gallery) return;
    const cards = Array.from(gallery.querySelectorAll('.card'));
    if (cards.length <= GALLERY_MAX_DOM_CARDS) return;
    const removable = cards.filter((card) => {
        const rect = card.getBoundingClientRect();
        return rect.bottom < -900;
    });
    const needRemove = Math.max(0, cards.length - GALLERY_PRUNE_TARGET);
    removable.slice(0, needRemove).forEach((card) => {
        if (galleryIntersectionObserver) {
            try { galleryIntersectionObserver.unobserve(card); } catch (_) {}
        }
        card.remove();
    });
}

function ensureGalleryIntersectionObserver() {
    if (galleryIntersectionObserver || typeof window.IntersectionObserver === 'undefined') return;
    galleryIntersectionObserver = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            const target = entry.target;
            const deferred = target?.querySelector?.('[data-src]');
            if (deferred) {
                deferred.setAttribute('src', deferred.dataset.src || '');
                deferred.removeAttribute('data-src');
                if (deferred.tagName === 'VIDEO' && deferred.dataset.poster) {
                    deferred.setAttribute('poster', deferred.dataset.poster);
                    deferred.removeAttribute('data-poster');
                }
            }
            galleryIntersectionObserver?.unobserve(target);
        });
    }, { rootMargin: '240px 0px', threshold: 0.02 });
}

function observeGalleryCard(card) {
    ensureGalleryIntersectionObserver();
    if (galleryIntersectionObserver) {
        galleryIntersectionObserver.observe(card);
        galleryCardQueue.push(card);
        return;
    }
    const deferred = card.querySelector('[data-src]');
    if (deferred) {
        deferred.setAttribute('src', deferred.dataset.src || '');
        deferred.removeAttribute('data-src');
    }
}

async function openGalleryCacheDb() {
    if (typeof window.indexedDB === 'undefined') return null;
    return new Promise((resolve) => {
        const req = window.indexedDB.open(GALLERY_CACHE_DB_NAME, 1);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(GALLERY_CACHE_STORE)) {
                db.createObjectStore(GALLERY_CACHE_STORE, { keyPath: 'key' });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
    });
}

async function readGalleryCacheByYear(yearKey) {
    const mem = galleryCacheByYear.get(yearKey);
    if (mem) return mem;
    const dbConn = await openGalleryCacheDb();
    if (!dbConn) return null;
    return new Promise((resolve) => {
        try {
            const tx = dbConn.transaction(GALLERY_CACHE_STORE, 'readonly');
            const store = tx.objectStore(GALLERY_CACHE_STORE);
            const req = store.get(yearKey);
            req.onsuccess = () => {
                const payload = req.result?.payload || null;
                if (payload) galleryCacheByYear.set(yearKey, payload);
                resolve(payload);
            };
            req.onerror = () => resolve(null);
            tx.oncomplete = () => dbConn.close();
        } catch (_) {
            dbConn.close();
            resolve(null);
        }
    });
}

async function writeGalleryCacheByYear(yearKey, payload) {
    galleryCacheByYear.set(yearKey, payload);
    const dbConn = await openGalleryCacheDb();
    if (!dbConn) return;
    try {
        const tx = dbConn.transaction(GALLERY_CACHE_STORE, 'readwrite');
        tx.objectStore(GALLERY_CACHE_STORE).put({
            key: yearKey,
            payload: { ...payload, savedAt: Date.now() }
        });
        tx.oncomplete = () => dbConn.close();
        tx.onerror = () => dbConn.close();
    } catch (_) {
        dbConn.close();
    }
}

const MESSAGE_COOLDOWN_MS = 1200;
const TYPING_EXPIRE_MS = 5000;
const TRUSTED_LINK_HOSTS = ['youtube.com', 'youtu.be', 'drive.google.com', 'facebook.com', 'fb.com', 'cloudinary.com', 'firebasestorage.googleapis.com'];


const CHAT_EMOJIS = ['😀','😁','😂','🤣','😊','😍','🥰','😘','😎','🤩','😢','😭','😡','👍','👏','🙏','🔥','🎉','💖','💬','🌸','🎓','🫶','✨'];
let currentUserState = null;
let authStateReady = false;

const MEMORY_SPOTS = [
    {
        name: 'Quán trà sữa sau giờ học',
        address: 'Khu vực gần cổng trường',
        coords: [21.0289, 105.8522],
        note: 'Nơi cả lớp hay tụ tập làm bài nhóm rồi tám chuyện tới tối.',
        photo: 'https://picsum.photos/seed/kyniem-tra-sua/420/250'
    },
    {
        name: 'Công viên cuối tuần',
        address: 'Điểm dã ngoại quen thuộc',
        coords: [21.0368, 105.8342],
        note: 'Những buổi chụp ảnh và đá bóng mini của lớp vào cuối tuần.',
        photo: 'https://picsum.photos/seed/kyniem-cong-vien/420/250'
    },
    {
        name: 'Địa điểm dã ngoại năm cuối',
        address: 'Chuyến đi kỷ yếu',
        coords: [21.0181, 105.8198],
        note: 'Buổi đi chơi đông đủ nhất, lưu lại rất nhiều ảnh kỷ niệm.',
        photo: 'https://picsum.photos/seed/kyniem-da-ngoai/420/250'
    }
];

function applyTheme(mode) {
    const body = document.body;
    if (!body) return;

    const isDark = mode === 'dark';
    body.classList.toggle('dark-mode', isDark);

    const toggleBtn = document.getElementById('dark-mode-toggle');
    if (toggleBtn) {
        toggleBtn.textContent = isDark ? '☀️ Chế độ sáng' : '🌙 Chế độ tối';
    }

    const themeColor = isDark ? '#12151d' : '#ff7e5f';
    document.querySelectorAll('meta[name="theme-color"]').forEach((metaTheme) => {
        metaTheme.setAttribute('content', themeColor);
    });

    const iosStatusMeta = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
    if (iosStatusMeta) {
        iosStatusMeta.setAttribute('content', isDark ? 'black-translucent' : 'default');
    }
}

function initThemeMode() {
    const savedMode = localStorage.getItem(THEME_MODE_KEY);
    const systemPrefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const mode = savedMode || (systemPrefersDark ? 'dark' : 'light');
    applyTheme(mode);
}

function toggleDarkMode() {
    const isDark = document.body.classList.contains('dark-mode');
    const nextMode = isDark ? 'light' : 'dark';
    localStorage.setItem(THEME_MODE_KEY, nextMode);
    applyTheme(nextMode);
}


function parseFirestoreTimestampToMillis(value) {
    if (!value) return 0;
    if (typeof value === 'number') return value;
    if (typeof value?.toMillis === 'function') return Number(value.toMillis() || 0);
    const seconds = Number(value?.seconds || 0);
    const nanos = Number(value?.nanoseconds || 0);
    if (!seconds) return 0;
    return (seconds * 1000) + Math.floor(nanos / 1e6);
}

function formatMemoryDateLabel(ts) {
    const millis = Number(ts || 0);
    if (!millis) return '';
    const d = new Date(millis);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString('vi-VN');
}


function distanceMetersBetweenCoords(a = [], b = []) {
    const [lat1, lng1] = a.map(Number);
    const [lat2, lng2] = b.map(Number);
    if (![lat1, lng1, lat2, lng2].every(Number.isFinite)) return Number.POSITIVE_INFINITY;

    const toRad = (deg) => (deg * Math.PI) / 180;
    const R = 6371000;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const q = Math.sin(dLat / 2) ** 2
        + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(q));
}

function mergeNearbyMemorySpots(spots = [], thresholdMeters = 80) {
    const merged = [];

    spots.forEach((spot) => {
        const coords = Array.isArray(spot?.coords) ? spot.coords : [];
        if (coords.length !== 2) return;

        const found = merged.find((item) => {
            const dist = distanceMetersBetweenCoords(item.coords, coords);
            return Number.isFinite(dist) && dist <= thresholdMeters;
        });

        if (!found) {
            merged.push({
                ...spot,
                photos: Array.isArray(spot.photos) ? [...spot.photos] : [],
                count: Number(spot.count || 1)
            });
            return;
        }

        const existingCount = Number(found.count || 1);
        const incomingCount = Number(spot.count || 1);
        const total = existingCount + incomingCount;

        found.coords = [
            ((Number(found.coords[0]) * existingCount) + (Number(coords[0]) * incomingCount)) / total,
            ((Number(found.coords[1]) * existingCount) + (Number(coords[1]) * incomingCount)) / total
        ];

        found.count = total;
        found.photos = [...(found.photos || []), ...(Array.isArray(spot.photos) ? spot.photos : [])];

        if (Number(spot.takenAt || 0) > Number(found.takenAt || 0)) {
            found.takenAt = spot.takenAt;
        }

        if ((!found.name || found.name === 'Địa điểm kỷ niệm') && spot.name) {
            found.name = spot.name;
        }
        if ((!found.address || found.address === 'Địa điểm do lớp thêm từ ảnh kỷ niệm') && spot.address) {
            found.address = spot.address;
        }
        if ((!found.note || found.note === 'Khoảnh khắc đáng nhớ của lớp.') && spot.note) {
            found.note = spot.note;
        }
    });

    return merged;
}

async function getMemorySpotsFromPosts() {
    try {
        const snap = await db.collection('posts').get();
        const grouped = {};

        snap.forEach((doc) => {
            const data = doc.data() || {};
            const lat = Number(data.locationLat);
            const lng = Number(data.locationLng);
            if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

            const key = `${lat.toFixed(6)}__${lng.toFixed(6)}`;
            const takenAtMs = Number(data.takenAt || parseFirestoreTimestampToMillis(data.createdAt));
            const item = {
                id: doc.id,
                title: data.locationName || data.caption || 'Địa điểm kỷ niệm',
                address: data.locationAddress || 'Địa điểm do lớp thêm từ ảnh kỷ niệm',
                note: data.memoryNote || data.caption || 'Khoảnh khắc đáng nhớ của lớp.',
                photo: data.url || 'https://picsum.photos/seed/kyniem-default/420/250',
                takenAt: takenAtMs
            };

            if (!grouped[key]) {
                grouped[key] = {
                    name: item.title,
                    address: item.address,
                    coords: [lat, lng],
                    note: item.note,
                    photos: [item],
                    takenAt: item.takenAt,
                    count: 1,
                    fromPost: true
                };
                return;
            }

            grouped[key].photos.push(item);
            grouped[key].count += 1;
            if (item.takenAt > Number(grouped[key].takenAt || 0)) {
                grouped[key].takenAt = item.takenAt;
            }
            if (grouped[key].name === 'Địa điểm kỷ niệm' && item.title) {
                grouped[key].name = item.title;
            }
        });

        return mergeNearbyMemorySpots(Object.values(grouped), 80);
    } catch (error) {
        console.warn('Không tải được dữ liệu ảnh kỷ niệm để đưa lên bản đồ:', error);
        return [];
    }
}



const FCM_TOKEN_KEY = 'class_fcm_token';
const AUTO_PUSH_PROMPT_KEY = 'class_auto_push_prompted';
const FCM_VAPID_PUBLIC_KEY = 'BFrdIOzjpU5hTbLY7PrS5LBZUZTFobgNH3jXd5CYu1akplI9gjZOx-gHMiadLZojTlY2sYMyveEApLRppP_yJq0';

let messaging = null;
let swRegistration = null;
let messagingSdkLoadPromise = null;

let fcmSupportCache = null;

function getSiteBasePath() {
    const pathname = window.location.pathname || '/';
    if (pathname.endsWith('.html')) {
        return pathname.slice(0, pathname.lastIndexOf('/') + 1) || '/';
    }
    return pathname.endsWith('/') ? pathname : `${pathname}/`;
}

function getPushUnsupportedReason() {
    const ua = navigator.userAgent || '';
    const isIOS = /iPhone|iPad|iPod/i.test(ua);
    const isSafari = /^((?!chrome|crios|android).)*safari/i.test(ua);
    const isStandalone = window.matchMedia?.('(display-mode: standalone)')?.matches || window.navigator.standalone === true;

    if (isIOS && isSafari && !isStandalone) {
        return 'Safari iPhone chỉ hỗ trợ thông báo đẩy khi web được thêm vào Màn hình chính (Add to Home Screen).';
    }

    if (!window.isSecureContext) {
        return 'Thông báo đẩy chỉ hoạt động trên HTTPS (hoặc localhost).';
    }

    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        return 'Trình duyệt hiện tại chưa hỗ trợ đầy đủ Service Worker/Push API.';
    }

    return 'Thiết bị/trình duyệt chưa hỗ trợ Firebase Cloud Messaging.';
}

function ensureFirebaseMessagingSdkLoaded() {
    if (firebase.messaging && firebase.messaging.isSupported) return Promise.resolve(true);
    if (messagingSdkLoadPromise) return messagingSdkLoadPromise;
    messagingSdkLoadPromise = new Promise((resolve) => {
        const script = document.createElement('script');
        script.src = 'https://www.gstatic.com/firebasejs/8.10.1/firebase-messaging.js';
        script.async = true;
        script.onload = () => resolve(!!(firebase.messaging && firebase.messaging.isSupported));
        script.onerror = () => resolve(false);
        document.head.appendChild(script);
    });
    return messagingSdkLoadPromise;
}

async function isFCMSupported() {
    if (fcmSupportCache !== null) return fcmSupportCache;
    const sdkReady = await ensureFirebaseMessagingSdkLoaded();
    if (!sdkReady) {
        fcmSupportCache = false;
        return false;
    }

    if (!firebase.messaging || !firebase.messaging.isSupported) {
        fcmSupportCache = false;
        return false;
    }

    try {
        const supportResult = firebase.messaging.isSupported();
        fcmSupportCache = typeof supportResult?.then === 'function'
            ? Boolean(await supportResult)
            : Boolean(supportResult);
    } catch (error) {
        fcmSupportCache = false;
        console.warn('FCM không được hỗ trợ trên trình duyệt này:', error);
    }

    return fcmSupportCache;
}

async function waitForServiceWorkerReady(timeoutMs = 10000) {
    if (!('serviceWorker' in navigator)) return null;

    try {
        return await Promise.race([
            navigator.serviceWorker.ready,
            new Promise((resolve) => setTimeout(() => resolve(null), timeoutMs))
        ]);
    } catch (error) {
        console.warn('Service Worker chưa sẵn sàng:', error);
        return null;
    }
}

function notifyServiceWorkerUpdateReady(registration = null) {
    if (registration) pendingSWRegistration = registration;
    if (swUpdateAvailable) return;
    swUpdateAvailable = true;
    const updateBtn = document.getElementById('sw-update-btn');
    if (updateBtn) updateBtn.style.display = 'block';
    showSystemToast('Có cập nhật mới, nhấn để tải lại phiên bản mới.', { icon: '⬆️', title: 'Cập nhật ứng dụng' });
}

async function applyServiceWorkerUpdate() {
    if (!('serviceWorker' in navigator)) return;
    const registration = pendingSWRegistration || await navigator.serviceWorker.getRegistration().catch(() => null);
    const waitingWorker = registration?.waiting;
    if (!waitingWorker) {
        showSystemToast('Hiện chưa có bản cập nhật mới.', { icon: 'ℹ️', title: 'Không có cập nhật' });
        return;
    }

    showSystemToast('Đang áp dụng phiên bản mới...', { icon: '⏳', title: 'Đang cập nhật' });
    const onControllerChange = () => {
        navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
        window.location.reload();
    };
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
    waitingWorker.postMessage({ type: 'SKIP_WAITING' });
}

async function registerMessagingServiceWorker() {
    if (!('serviceWorker' in navigator)) return null;

    const basePath = getSiteBasePath();
    const candidates = basePath === '/'
        ? ['/firebase-messaging-sw.js']
        : [`${basePath}firebase-messaging-sw.js`, '/firebase-messaging-sw.js'];

    for (const swUrl of candidates) {
        try {
            const registration = await navigator.serviceWorker.register(swUrl, { scope: basePath });
            const readyRegistration = await waitForServiceWorkerReady();
            pendingSWRegistration = registration;

            if (registration.waiting && navigator.serviceWorker.controller) {
                notifyServiceWorkerUpdateReady(registration);
            }

            registration.addEventListener('updatefound', () => {
                const worker = registration.installing;
                if (!worker) return;
                worker.addEventListener('statechange', () => {
                    if (worker.state === 'installed' && navigator.serviceWorker.controller) {
                        notifyServiceWorkerUpdateReady(registration);
                    }
                });
            });

            if (registration.update) {
                setTimeout(() => registration.update().catch(() => {}), 3000);
                setInterval(() => registration.update().catch(() => {}), 5 * 60 * 1000);
            }

            console.info(`FCM Service Worker đã đăng ký: ${swUrl}`);
            return readyRegistration || registration;
        } catch (error) {
            console.warn(`Không đăng ký được SW tại ${swUrl}:`, error);
        }
    }
                                                 
    return null;
}

async function setupFirebaseMessaging() {
    await ensureFirebaseMessagingSdkLoaded();
    if (!(await isFCMSupported())) return;
    if (messaging) return;

    try {
        messaging = firebase.messaging();
    } catch (error) {
        console.warn('Không thể khởi tạo Firebase Messaging:', error);
        return;
    }

    swRegistration = await registerMessagingServiceWorker();
    if (!swRegistration) {
        console.warn('FCM chưa hoạt động vì không đăng ký được Service Worker.');
    }

    messaging.onMessage((payload) => {
        const type = payload?.data?.type || '';
        const title = payload?.notification?.title || payload?.data?.title || 'Thông báo mới';
        const body = payload?.notification?.body || payload?.data?.body || '';
       const senderName = payload?.data?.senderName || payload?.data?.sender || parseChatSenderFromTitle(title);
        const sentAt = Number(payload?.data?.sentAt || Date.now());

        if (body) {
            if (type === 'chat_new_message') {
                showSystemToast(body, {
                    icon: '💬',
                    title: senderName ? `Tin nhắn từ ${senderName}` : 'Tin nhắn mới',
                    meta: formatChatTime(sentAt)
                });
            } else if (type === 'group_chat_new_message') {
                const groupTitle = senderName
                    ? `${senderName} đã nhắn tin vào nhóm chat`
                    : 'Có tin nhắn mới trong nhóm chat';
                showSystemToast(body, {
                    icon: '👥',
                    title: groupTitle,
                    meta: formatChatTime(sentAt)
                });
            } else {
                showSystemToast(body, { icon: '🔔', title });
            }
        }

        if ('Notification' in window && Notification.permission === 'granted') {
            if (swRegistration?.showNotification) {
                swRegistration.showNotification(title, { body }).catch((error) => {
                    console.warn('Không hiển thị được foreground notification qua SW:', error);
                });
            } else {
                new Notification(title, { body });
            }
        }
    });
}

async function saveFcmTokenForCurrentUser(token) {
    const user = getCurrentUser();
    if (!user?.email || !token) return;

    const normalizedEmail = String(user.email || '').trim().toLowerCase();
    if (!normalizedEmail) return;

    let targetDocRef = null;

    const exactSnap = await db.collection('users').where('email', '==', normalizedEmail).limit(1).get();
    if (!exactSnap.empty) {
        targetDocRef = exactSnap.docs[0].ref;
    } else {
        // Fallback cho dữ liệu cũ lưu email chưa normalize (viết hoa/thường lẫn lộn).
        const allUsersSnap = await db.collection('users').limit(500).get();
        const matched = allUsersSnap.docs.find((doc) => {
            const email = String(doc.data()?.email || '').trim().toLowerCase();
            return email === normalizedEmail;
        });
        if (matched) targetDocRef = matched.ref;
    }
    const payload = {
        fcmTokens: firebase.firestore.FieldValue.arrayUnion(token),
        // Giữ thêm field legacy để các Cloud Function/phiên bản cũ vẫn lấy được token.
        fcmToken: token,
        fcmUpdatedAt: Date.now(),
        email: normalizedEmail
    };

    if (!targetDocRef) {
        const sessionUser = getCurrentUser() || {};
        await db.collection('users').add({
            name: sessionUser.name || normalizedEmail,
            phone: sessionUser.phone || '',
            avatar: sessionUser.avatar || buildAvatarUrl(sessionUser.name || normalizedEmail),
            password: sessionUser.password || '',
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            ...payload
        });
        return;
    }

    await targetDocRef.set(payload, { merge: true });
}

function parseChatSenderFromTitle(title = '') {
    const normalized = String(title || '').trim();
    const match = normalized.match(/^💬\s*(.+?)\s+vừa\s+nhắn\s+tin/i);
    return match ? match[1].trim() : '';
}

function updatePushButtonState(enabled) {
    const btn = document.getElementById('enable-push-btn');
    if (!btn) return;

    if (enabled) {
        btn.textContent = 'Thông báo đẩy: Đã bật';
        btn.disabled = true;
    } else {
        btn.textContent = 'Bật thông báo đẩy';
        btn.disabled = false;
    }
}

function prepareMessagingCompat() {
    if (!messaging) return;

    try {
        if (swRegistration && typeof messaging.useServiceWorker === 'function') {
            messaging.useServiceWorker(swRegistration);
        }

        if (FCM_VAPID_PUBLIC_KEY && typeof messaging.usePublicVapidKey === 'function') {
            messaging.usePublicVapidKey(FCM_VAPID_PUBLIC_KEY);
        }
    } catch (error) {
        console.warn('Không cấu hình được messaging compat API:', error);
    }
}

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getFcmTokenWithFallback() {
    if (!messaging) return null;

    prepareMessagingCompat();

    const strategies = [
        async () => messaging.getToken({ vapidKey: FCM_VAPID_PUBLIC_KEY, serviceWorkerRegistration: swRegistration }),
        async () => messaging.getToken({ vapidKey: FCM_VAPID_PUBLIC_KEY }),
        async () => messaging.getToken()
    ];

    let lastError = null;

    for (let i = 0; i < strategies.length; i++) {
        for (let attempt = 1; attempt <= 2; attempt++) {
            try {
                const token = await strategies[i]();
                if (token) return token;
            } catch (error) {
                lastError = error;
                console.warn(`Lấy FCM token thất bại ở chiến lược ${i + 1}, lần ${attempt}:`, error);
            }

            if (attempt < 2) {
                await delay(400 * attempt);
            }
        }
    }

    if (lastError) throw lastError;
    return null;
}

function buildPushErrorMessage(error) {
    const code = String(error?.code || '');
    const message = String(error?.message || '');
    const lower = `${code} ${message}`.toLowerCase();

    if (code.includes('unsupported-browser') || lower.includes('unsupported-browser')) {
        return getPushUnsupportedReason();
    }

    if (code.includes('permission-blocked')) {
        return 'Trình duyệt đang chặn thông báo. Hãy mở Site Settings và cho phép Notifications.';
    }

    if (lower.includes('api key not valid') || lower.includes('installations/request-failed')) {
        return 'Firebase API key đang không hợp lệ hoặc bị chặn theo domain. Đây KHÔNG phải lỗi VAPID. Hãy kiểm tra lại apiKey trong firebaseConfig và phần API key restrictions trên Google Cloud Console.';
    }

    if (lower.includes('standalone') || lower.includes('add to home screen')) {
        return 'Trên iPhone, hãy thêm web vào Màn hình chính rồi mở từ icon đó trước khi bật thông báo.';
    }

    if (code.includes('token-subscribe-failed') || message.includes('create-installation-request')) {
        return 'Không đăng ký được token push (FI 400). Thường do VAPID key không khớp project Firebase hoặc cấu hình app web chưa đúng.';
    }

    return 'Không thể bật thông báo đẩy. Kiểm tra Service Worker, domain HTTPS và cấu hình Firebase.';
}

async function enablePushNotifications(options = {}) {
    const silent = !!options.silent;
    if (!(await isFCMSupported())) {
        if (!silent) showSystemToast(getPushUnsupportedReason(), { icon: '⚠️', title: 'Không hỗ trợ thông báo' });
        return;
    }

    await setupFirebaseMessaging();

    if (!swRegistration) {
        if (!silent) showSystemToast(`Không đăng ký được Service Worker cho FCM. Hãy kiểm tra file firebase-messaging-sw.js có tồn tại ở ${getSiteBasePath()}firebase-messaging-sw.js`, { icon: '⚠️', title: 'Lỗi Service Worker' });
        return;
    }

    try {
        if ('Notification' in window && Notification.permission !== 'granted') {
            const permission = await Notification.requestPermission();
            if (permission !== 'granted') {
                if (!silent) showSystemToast('Bạn cần cho phép thông báo để nhận tin khi không mở tab web.', { icon: '🔔', title: 'Cần cấp quyền thông báo' });
                updatePushButtonState(false);
                return;
            }
        }

        const token = await getFcmTokenWithFallback();
        if (!token) {
            if (!silent) showSystemToast('Chưa lấy được FCM token. Vui lòng thử lại.', { icon: '⚠️', title: 'Lỗi token thông báo' });
            return;
        }

        localStorage.setItem(FCM_TOKEN_KEY, token);
        await saveFcmTokenForCurrentUser(token);
        updatePushButtonState(true);
        showSystemToast('Đã bật thông báo thông minh qua FCM.');
    } catch (error) {
        console.error('Bật thông báo đẩy thất bại:', error);
        if (!silent) showSystemToast(buildPushErrorMessage(error), { icon: '⚠️', title: 'Không bật được thông báo' });
    }
}

async function autoEnablePushIfPossible() {
    if (!(await isFCMSupported())) return;
    if (!getCurrentUser()?.email) return;

    await setupFirebaseMessaging();
    if (!swRegistration) {
        updatePushButtonState(false);
        return;
    }

    if ('Notification' in window && Notification.permission !== 'granted') {
        updatePushButtonState(false);
        return;
    }

    try {
        const token = await getFcmTokenWithFallback();
        if (!token) {
            updatePushButtonState(false);
            return;
        }

        const oldToken = localStorage.getItem(FCM_TOKEN_KEY);
        if (oldToken !== token) {
            localStorage.setItem(FCM_TOKEN_KEY, token);
            await saveFcmTokenForCurrentUser(token);
        }

        updatePushButtonState(true);
    } catch (error) {
        console.warn('Không tự kích hoạt được FCM:', error);
        updatePushButtonState(false);
    }
}


async function autoEnablePushFromFirstGesture() {
    if (localStorage.getItem(AUTO_PUSH_PROMPT_KEY) === '1') return;
    if (!getCurrentUser()?.email) return;

    localStorage.setItem(AUTO_PUSH_PROMPT_KEY, '1');

    try {
        await enablePushNotifications({ silent: true });
    } catch (error) {
        console.warn('Không tự bật được push từ tương tác đầu tiên:', error);
    }
}

function initAutoPushEnableOnFirstGesture() {
    if (localStorage.getItem(AUTO_PUSH_PROMPT_KEY) === '1') return;

    const trigger = () => {
        document.removeEventListener('click', trigger, true);
        document.removeEventListener('touchstart', trigger, true);
        autoEnablePushFromFirstGesture();
    };

    document.addEventListener('click', trigger, true);
    document.addEventListener('touchstart', trigger, true);
}

function schedulePushPermissionNudge(delayMs = 25000) {
    if (pushNudgeTimer) clearTimeout(pushNudgeTimer);
    pushNudgeTimer = setTimeout(() => ensurePushPermissionNudge(), Math.max(5000, Number(delayMs || 0)));
}

async function ensurePushPermissionNudge() {
    const user = getCurrentUser();
    if (!user?.email) return;
    if (!('Notification' in window)) return;
    if (Notification.permission === 'granted') return;

    const shouldOpen = await showConfirmModal({
        title: 'Bật thông báo',
        message: 'Để không bỏ lỡ tin nhắn/thông báo mới, bạn nên bật thông báo ngay bây giờ. Bật luôn chứ?',
        okText: 'Bật ngay',
        cancelText: 'Để sau'
    });
    if (shouldOpen) {
        enablePushNotifications().finally(() => {
            if (Notification.permission !== 'granted') {
                schedulePushPermissionNudge(45000);
            }
        });
        return;
    }

    schedulePushPermissionNudge(45000);
}

async function queueNotificationEvent(eventId, payload) {
    if (!eventId || !payload) return;

    try {
        await db.collection('notification_events').doc(eventId).set({
            ...payload,
            createdAt: Date.now()
        }, { merge: true });
    } catch (error) {
        console.warn('Không thể tạo sự kiện thông báo:', error);
    }
}


function buildAvatarUrl(name = 'Thành viên lớp') {
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=ff7e5f&color=fff`;
}

function normalizeUserAvatar(user) {
    if (!user) return null;
    return { ...user, avatar: user.avatar || buildAvatarUrl(user.name) };
}

function getCurrentUser() {
    return currentUserState ? { ...currentUserState } : null;
}

function setCurrentUser(user) {
    currentUserState = user ? normalizeUserAvatar(user) : null;
}

async function getUserProfileByEmail(email = '') {
    const normalizedEmail = String(email || '').trim().toLowerCase();
    if (!normalizedEmail) return null;
    const snap = await db.collection('users').where('email', '==', normalizedEmail).limit(1).get();
    if (snap.empty) return null;
    return snap.docs[0].data() || null;
}

async function cleanupLegacyPasswordField(email = '') {
    const normalizedEmail = String(email || '').trim().toLowerCase();
    if (!normalizedEmail) return;
    try {
        const snap = await db.collection('users').where('email', '==', normalizedEmail).limit(1).get();
        if (snap.empty) return;
        const doc = snap.docs[0];
        if (typeof doc.data()?.password === 'undefined') return;
        await doc.ref.update({
            password: firebase.firestore.FieldValue.delete()
        });
    } catch (error) {
        console.warn('Không thể dọn trường password cũ:', error);
    }
}

async function migrateLegacyUserPasswords(batchSize = 200) {
    const size = Math.max(20, Number(batchSize || 200));
    let migrated = 0;
    let scanned = 0;
    let lastDoc = null;

    while (true) {
        let query = db.collection('users').orderBy('email').limit(size);
        if (lastDoc) query = query.startAfter(lastDoc);
        const snap = await query.get();
        if (snap.empty) break;

        const batch = db.batch();
        let hasWrite = false;

        snap.docs.forEach((doc) => {
            scanned += 1;
            const data = doc.data() || {};
            if (typeof data.password !== 'undefined') {
                batch.update(doc.ref, { password: firebase.firestore.FieldValue.delete() });
                migrated += 1;
                hasWrite = true;
            }
        });

        if (hasWrite) {
            await batch.commit();
        }

        lastDoc = snap.docs[snap.docs.length - 1];
        if (snap.size < size) break;
    }

    const result = { scanned, migrated };
    console.info('Migration result:', result);
    return result;
}

function mapFirebaseAuthError(error) {
    const code = String(error?.code || '');
    if (code === 'auth/email-already-in-use') return 'Email này đã được đăng ký trước đó.';
    if (code === 'auth/invalid-email') return 'Email chưa đúng định dạng.';
    if (code === 'auth/weak-password') return 'Mật khẩu cần ít nhất 6 ký tự.';
    if (code === 'auth/missing-password') return 'Vui lòng nhập mật khẩu.';
    if (code === 'auth/missing-email') return 'Vui lòng nhập email.';
    if (code === 'auth/user-disabled') return 'Tài khoản này đã bị vô hiệu hóa.';
    if (code === 'auth/user-not-found' || code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
        return 'Sai email hoặc mật khẩu. Vui lòng thử lại.';
    }
    if (code === 'auth/requires-recent-login') {
        return 'Vui lòng xác thực lại bằng mật khẩu hiện tại trước khi đổi mật khẩu.';
    }
    if (code === 'auth/network-request-failed') return 'Mất kết nối mạng. Vui lòng thử lại.';
    if (code === 'auth/operation-not-allowed') return 'Chức năng xác thực này chưa được bật trên Firebase.';
    if (code === 'auth/invalid-action-code') return 'Liên kết đặt lại mật khẩu không hợp lệ hoặc đã hết hạn.';
    if (code === 'auth/expired-action-code') return 'Liên kết đặt lại mật khẩu đã hết hạn.';
    if (code === 'auth/too-many-requests') return 'Bạn thử đăng nhập quá nhiều lần. Vui lòng đợi ít phút.';
    return 'Không thể xác thực tài khoản lúc này. Vui lòng thử lại.';
}

function openForgotPasswordDialog() {
    const modal = document.getElementById('forgot-password-modal');
    if (!modal) return;
    modal.style.display = 'flex';
    const emailInput = document.getElementById('forgot-password-email');
    if (emailInput) {
        emailInput.value = String(document.getElementById('login-identifier')?.value || '').trim();
        emailInput.focus();
    }
    syncOverlayUIState();
}

function closeForgotPasswordDialog() {
    const modal = document.getElementById('forgot-password-modal');
    if (!modal) return;
    modal.style.display = 'none';
    syncOverlayUIState();
}

async function submitForgotPassword() {
    const email = String(document.getElementById('forgot-password-email')?.value || '').trim().toLowerCase();
    if (!email) {
        showSystemToast('Vui lòng nhập email để đặt lại mật khẩu.', { icon: '⚠️', title: 'Thiếu thông tin' });
        return;
    }

    try {
        await auth.sendPasswordResetEmail(email);
        closeForgotPasswordDialog();
        showSystemToast('Đã gửi email đặt lại mật khẩu. Hãy kiểm tra hộp thư của bạn.', { icon: '📧', title: 'Gửi thành công' });
    } catch (error) {
        console.error('Không gửi được email reset mật khẩu:', error);
        showSystemToast(mapFirebaseAuthError(error), { icon: '⚠️', title: 'Đặt lại mật khẩu thất bại' });
    }
}

function openChangePasswordDialog() {
    const me = auth.currentUser;
    if (!me?.email) {
        showSystemToast('Bạn cần đăng nhập trước khi đổi mật khẩu.', { icon: '🔒', title: 'Chưa đăng nhập' });
        return;
    }
    const modal = document.getElementById('change-password-modal');
    if (!modal) return;
    ['change-password-old', 'change-password-new', 'change-password-confirm'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    modal.style.display = 'flex';
    document.getElementById('change-password-old')?.focus();
    closeNavMenuModal();
    syncOverlayUIState();
}

function closeChangePasswordDialog() {
    const modal = document.getElementById('change-password-modal');
    if (!modal) return;
    modal.style.display = 'none';
    syncOverlayUIState();
}

async function submitChangePassword() {
    const me = auth.currentUser;
    if (!me?.email) {
        showSystemToast('Phiên đăng nhập đã hết. Vui lòng đăng nhập lại.', { icon: '⚠️', title: 'Không thể đổi mật khẩu' });
        return;
    }

    const oldPassword = String(document.getElementById('change-password-old')?.value || '');
    const newPassword = String(document.getElementById('change-password-new')?.value || '');
    const confirmPassword = String(document.getElementById('change-password-confirm')?.value || '');

    if (!oldPassword || !newPassword || !confirmPassword) {
        showSystemToast('Vui lòng nhập đầy đủ mật khẩu cũ, mật khẩu mới và xác nhận.', { icon: '⚠️', title: 'Thiếu thông tin' });
        return;
    }
    if (newPassword.length < 6) {
        showSystemToast('Mật khẩu mới cần ít nhất 6 ký tự.', { icon: '⚠️', title: 'Mật khẩu chưa hợp lệ' });
        return;
    }
    if (newPassword !== confirmPassword) {
        showSystemToast('Xác nhận mật khẩu mới chưa khớp.', { icon: '⚠️', title: 'Mật khẩu không khớp' });
        return;
    }

    try {
        const credential = firebase.auth.EmailAuthProvider.credential(me.email, oldPassword);
        await me.reauthenticateWithCredential(credential);
        await me.updatePassword(newPassword);
        closeChangePasswordDialog();
        showSystemToast('Đổi mật khẩu thành công.', { icon: '✅', title: 'Thành công' });
    } catch (error) {
        console.error('Không đổi được mật khẩu:', error);
        showSystemToast(mapFirebaseAuthError(error), { icon: '⚠️', title: 'Đổi mật khẩu thất bại' });
    }
}

function buildMemoryPopupHtml(spot) {
    const title = escapeHtml(spot.name || 'Địa điểm kỷ niệm');
    const address = escapeHtml(spot.address || '');
    const note = escapeHtml(spot.note || '');
    const dateLabel = escapeHtml(formatMemoryDateLabel(spot.takenAt));
    const photos = Array.isArray(spot.photos) && spot.photos.length
        ? spot.photos
        : [{ photo: spot.photo || '', note: spot.note || '', takenAt: spot.takenAt || 0 }];

    const safeCount = Number(spot.count || photos.length || 1);
    const displayPhotos = photos.slice(0, 2);
    const galleryHtml = displayPhotos.map((item) => {
        const safePhoto = escapeHtml(item.photo || '');
        const safeItemNote = escapeHtml(item.note || '');
        const safeItemDate = escapeHtml(formatMemoryDateLabel(item.takenAt));
        const safePostId = escapeHtml(item.id || '');
        const jumpHandler = safePostId ? `onclick="focusGalleryPost('${safePostId}')"` : '';
        return `<div class="memory-popup-card">
            <img src="${safePhoto}" alt="${title}" loading="lazy" ${jumpHandler}>
            <div class="memory-popup-note">${safeItemNote || note}</div>
            ${safeItemDate ? `<div class="memory-popup-time">🗓️ ${safeItemDate}</div>` : ''}
        </div>`;
    }).join('');

    const moreButtonHtml = safeCount > 2
        ? `<button class="memory-popup-more-btn" onclick="openMemorySpotModal('${encodeURIComponent(JSON.stringify(photos))}', '${encodeURIComponent(spot.name || '')}', '${encodeURIComponent(spot.address || '')}', '${encodeURIComponent(spot.note || '')}')">Xem thêm (${safeCount - 2})</button>`
        : '';

    return `
        <div class="memory-popup">
            <div class="memory-popup-title">${title} ${safeCount > 1 ? `(${safeCount} ảnh)` : ''}</div>
            <div class="memory-popup-address">📍 ${address}</div>
            ${dateLabel ? `<div class="memory-popup-time">🗓️ Cập nhật gần nhất: ${dateLabel}</div>` : ''}
            <div class="memory-popup-gallery">${galleryHtml}</div>
            ${moreButtonHtml}
        </div>
    `;
}

function ensureMemorySpotModal() {
    if (document.getElementById('memory-spot-modal')) return;
    const modal = document.createElement('div');
    modal.id = 'memory-spot-modal';
    modal.className = 'memory-spot-modal';
    modal.innerHTML = `
        <div class="memory-spot-modal-overlay" onclick="closeMemorySpotModal()"></div>
        <div class="memory-spot-modal-content">
            <button class="memory-spot-close" onclick="closeMemorySpotModal()">✕</button>
            <h3 id="memory-spot-modal-title"></h3>
            <p id="memory-spot-modal-address"></p>
            <div id="memory-spot-modal-grid" class="memory-spot-modal-grid"></div>
        </div>
    `;
    document.body.appendChild(modal);
}

function openMemorySpotModal(rawPhotos = '[]', rawTitle = '', rawAddress = '', rawNote = '') {
    ensureMemorySpotModal();
    const modal = document.getElementById('memory-spot-modal');
    const grid = document.getElementById('memory-spot-modal-grid');
    const titleEl = document.getElementById('memory-spot-modal-title');
    const addressEl = document.getElementById('memory-spot-modal-address');
    if (!modal || !grid || !titleEl || !addressEl) return;

    let photos = [];
    try {
        photos = JSON.parse(decodeURIComponent(rawPhotos));
    } catch (error) {
        photos = [];
    }

    const title = decodeURIComponent(rawTitle || '');
    const address = decodeURIComponent(rawAddress || '');
    const note = decodeURIComponent(rawNote || '');

    titleEl.textContent = title;
    addressEl.textContent = address || note;
    grid.innerHTML = photos.map((item) => {
        const safePhoto = escapeHtml(item.photo || '');
        const safeNote = escapeHtml(item.note || note || 'Khoảnh khắc đáng nhớ của lớp.');
        const safeDate = escapeHtml(formatMemoryDateLabel(item.takenAt));
        const safePostId = escapeHtml(item.id || '');
        const actionBtn = safePostId
            ? `<button class="memory-jump-btn" onclick="focusGalleryPost('${safePostId}'); closeMemorySpotModal();">Đến bài viết</button>`
            : '';
        return `<div class="memory-popup-card">
            <img src="${safePhoto}" alt="${escapeHtml(title)}" loading="lazy">
            <div class="memory-popup-note">${safeNote}</div>
            ${safeDate ? `<div class="memory-popup-time">🗓️ ${safeDate}</div>` : ''}
            ${actionBtn}
        </div>`;
    }).join('');

    modal.classList.add('show');
}

function closeMemorySpotModal() {
    document.getElementById('memory-spot-modal')?.classList.remove('show');
}

function focusGalleryPost(postId) {
    if (!postId) return;
    const target = document.querySelector(`[data-post-id="${postId}"]`);

    if (!target && currentYearFilter !== 'all') {
        pendingScrollPostId = postId;
        filterByYear('all');
        return;
    }

    if (!target) return;

    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target.classList.add('map-post-highlight');
    setTimeout(() => target.classList.remove('map-post-highlight'), 2000);
}

async function initMemoryMap() {
    const mapEl = document.getElementById('memory-map');
    if (!mapEl) return;

    if (typeof window.L === 'undefined') {
        console.warn('Leaflet chưa tải xong, bỏ qua khởi tạo bản đồ kỷ niệm.');
        return;
    }

    const dynamicSpots = await getMemorySpotsFromPosts();
    const fallbackSpots = mergeNearbyMemorySpots(MEMORY_SPOTS, 80);
    const spots = dynamicSpots.length ? dynamicSpots : fallbackSpots;

    if (memoryMap) {
        memoryMap.eachLayer((layer) => {
            if (layer instanceof L.Marker) {
                memoryMap.removeLayer(layer);
            }
        });
    } else {
        memoryMap = L.map(mapEl, {
            zoomControl: true,
            scrollWheelZoom: false
        }).setView([21.0285, 105.8542], 13);

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '&copy; OpenStreetMap contributors'
        }).addTo(memoryMap);

        mapEl.addEventListener('mouseenter', () => memoryMap?.scrollWheelZoom.enable());
        mapEl.addEventListener('mouseleave', () => memoryMap?.scrollWheelZoom.disable());
    }

    const bounds = [];
    spots.forEach((spot) => {
        if (!Array.isArray(spot.coords) || spot.coords.length !== 2) return;

        bounds.push(spot.coords);
        const markerLabel = Number(spot.count || 1) > 1 ? `${spot.name || 'Địa điểm kỷ niệm'} (${spot.count} ảnh)` : (spot.name || 'Địa điểm kỷ niệm');
        const marker = L.marker(spot.coords, { title: markerLabel }).addTo(memoryMap);
        marker.bindPopup(buildMemoryPopupHtml(spot), {
            maxWidth: 260,
            className: 'memory-leaflet-popup'
        });
    });

    if (bounds.length > 1) {
        memoryMap.fitBounds(bounds, { padding: [28, 28] });
    } else if (bounds.length === 1) {
        memoryMap.setView(bounds[0], 15);
    }

    setTimeout(() => memoryMap?.invalidateSize(), 160);
}

function updateCurrentUserDisplay() {
    const user = normalizeUserAvatar(getCurrentUser());
    const chip = document.getElementById('current-user-display');
    const avatar = document.getElementById('current-user-avatar');

    if (chip) {
        chip.innerText = user ? `${user.name} • ${user.phone} • ${user.email}` : 'Bạn chưa đăng nhập';
    }

    if (avatar) {
        avatar.src = user?.avatar || buildAvatarUrl('Khách');
        avatar.style.display = 'block';
    }

    const senderInput = document.getElementById('capsule-sender');
    if (senderInput && user) {
        senderInput.value = user.name;
    }
}

function saveNotifiedUnlockIds() {
    localStorage.setItem(UNLOCK_NOTIFY_KEY, JSON.stringify([...notifiedUnlockIds]));
}

function showSystemToast(message, options = {}) {
    const toast = document.getElementById('music-toast');
    if (!toast) return;

    const icon = options.icon || '🔔';
    const title = options.title || 'Thông báo mới';
    const meta = options.meta ? `<span class="toast-meta">${options.meta}</span>` : '';

    toast.innerHTML = `
        <div class="toast-top">
            <span class="toast-icon">${icon}</span>
            <span class="toast-title">${title}</span>
            ${meta}
        </div>
        <div class="toast-body">${message}</div>
    `;
    
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 5200);
}

function setButtonLoading(button, loading, loadingText = 'Đang gửi...') {
    if (!button) return;
    if (loading) {
        if (!button.dataset.originalText) {
            button.dataset.originalText = button.innerHTML;
        }
        button.disabled = true;
        button.classList.add('btn-loading');
        button.textContent = loadingText;
        return;
    }
    button.disabled = false;
    button.classList.remove('btn-loading');
    if (button.dataset.originalText) {
        button.innerHTML = button.dataset.originalText;
        delete button.dataset.originalText;
    }
}

function setNetworkOfflineBanner(offline) {
    const banner = document.getElementById('network-offline-banner');
    if (!banner) return;
    banner.style.display = offline ? 'block' : 'none';
}

function showConfirmModal({
    title = 'Xác nhận',
    message = 'Bạn có chắc chắn muốn tiếp tục?',
    okText = 'Đồng ý',
    cancelText = 'Hủy'
} = {}) {
    return new Promise((resolve) => {
        const modal = document.getElementById('confirm-modal');
        const titleEl = document.getElementById('confirm-modal-title');
        const messageEl = document.getElementById('confirm-modal-message');
        const okBtn = document.getElementById('confirm-modal-ok-btn');
        const cancelBtn = document.getElementById('confirm-modal-cancel-btn');
        if (!modal || !titleEl || !messageEl || !okBtn || !cancelBtn) {
            resolve(window.confirm(message));
            return;
        }

        titleEl.textContent = title;
        messageEl.textContent = message;
        okBtn.textContent = okText;
        cancelBtn.textContent = cancelText;
        modal.style.display = 'flex';
        syncOverlayUIState();

        const cleanup = () => {
            okBtn.removeEventListener('click', onOk);
            cancelBtn.removeEventListener('click', onCancel);
            modal.removeEventListener('click', onBackdrop);
            modal.style.display = 'none';
            syncOverlayUIState();
        };
        const onOk = () => {
            cleanup();
            resolve(true);
        };
        const onCancel = () => {
            cleanup();
            resolve(false);
        };
        const onBackdrop = (event) => {
            if (event.target !== modal) return;
            onCancel();
        };

        okBtn.addEventListener('click', onOk);
        cancelBtn.addEventListener('click', onCancel);
        modal.addEventListener('click', onBackdrop);
    });
}

function refreshDataAfterReconnect() {
    if (currentMainTab === 'feed') loadGallery(true);
    if (currentMainTab === 'capsule') loadTimeCapsuleMessages();
    if (isPrivateChatOpen() && selectedChatUser?.email) loadPrivateMessages();
    if (isGroupChatOpen()) initGroupChat();
}

function nowMs() {
    return Date.now();
}

function canSendComment(postId, text = '') {
    const key = String(postId || '');
    if (!key) return { ok: false, message: 'Không xác định được bài viết.' };
    const now = nowMs();
    const lockUntil = Number(commentSpamLockUntilByPost.get(key) || 0);
    if (lockUntil > now) {
        const left = Math.ceil((lockUntil - now) / 1000);
        return { ok: false, message: `Bạn đang bị giới hạn bình luận do spam. Vui lòng thử lại sau ${left}s.` };
    }
    const lastAt = Number(commentCooldownByPost.get(key) || 0);
    if (now - lastAt < 5000) {
        const left = Math.ceil((5000 - (now - lastAt)) / 1000);
        return { ok: false, message: `Bạn bình luận quá nhanh. Vui lòng chờ ${left}s.` };
    }
    const normalized = String(text || '').trim().toLowerCase();
    const prev = lastCommentByPost.get(key);
    if (prev && prev.text === normalized && (now - prev.at) < 15000) {
        const lockedTo = now + 60000;
        commentSpamLockUntilByPost.set(key, lockedTo);
        return { ok: false, message: 'Phát hiện nội dung lặp lại liên tiếp. Bạn bị khóa bình luận 1 phút.' };
    }
    return { ok: true };
}

function trackCommentSent(postId, text = '') {
    const key = String(postId || '');
    const now = nowMs();
    commentCooldownByPost.set(key, now);
    lastCommentByPost.set(key, { text: String(text || '').trim().toLowerCase(), at: now });
}

function notifyUnlockedMessages(allMessages, today) {
    const unlockedMessages = allMessages.filter((m) => today >= m.unlockDate);

    if (!unlockWatcherInitialized) {
        unlockedMessages.forEach((m) => notifiedUnlockIds.add(m.id));
        saveNotifiedUnlockIds();
        unlockWatcherInitialized = true;
        return;
    }

    const newlyUnlocked = unlockedMessages.filter((m) => !notifiedUnlockIds.has(m.id));
    if (newlyUnlocked.length === 0) return;

    newlyUnlocked.forEach((m) => notifiedUnlockIds.add(m.id));
    saveNotifiedUnlockIds();

    const latest = newlyUnlocked[0];
    const message = newlyUnlocked.length === 1
        ? `Thư của ${latest.sender || 'một bạn'} đã mở khóa!`
        : `Có ${newlyUnlocked.length} bức thư vừa mở khóa!`;

    showSystemToast(message);

    const unlockedIds = newlyUnlocked.map((m) => m.id).filter(Boolean).join('_');
    queueNotificationEvent(`unlock_${unlockedIds}`, {
        type: 'capsule_unlocked',
        unlockMessageIds: newlyUnlocked.map((m) => m.id).filter(Boolean),
        senderName: latest.sender || 'một bạn',
        body: message
    });

    if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('Hộp thư thời gian', { body: message });
    }
}

function getOnlineStateFromTimestamp(lastActiveAt) {
    if (!lastActiveAt) return false;
    return Date.now() - Number(lastActiveAt) <= ONLINE_ACTIVE_WINDOW_MS;
}

function updateOwnOnlineBadge() {
    const badge = document.getElementById('online-status');
    if (!badge) return;

    const isOnline = navigator.onLine;
    badge.textContent = isOnline ? 'Online' : 'Offline';
    badge.classList.toggle('online', isOnline);
    badge.classList.toggle('offline', !isOnline);
}

async function updateMyPresence() {
    const user = getCurrentUser();
    if (!user?.email) return;

    updateOwnOnlineBadge();

    try {
        const snap = await db.collection('users').where('email', '==', user.email).limit(1).get();
        if (!snap.empty) {
            await db.collection('users').doc(snap.docs[0].id).update({
                lastActiveAt: Date.now(),
                isOnline: navigator.onLine
            });
        }
    } catch (e) {
        console.warn('Không cập nhật được trạng thái online:', e);
    }
}

function startPresenceTracking() {
    updateMyPresence();
    if (presenceInterval) clearInterval(presenceInterval);
    presenceInterval = setInterval(updateMyPresence, 45000);
}

function stopPresenceTracking() {
    if (presenceInterval) {
        clearInterval(presenceInterval);
        presenceInterval = null;
    }
}

function getChatKey(emailA, emailB) {
    return [emailA, emailB].map((s) => (s || '').toLowerCase()).sort().join('__');
}

function getPrivateConversationRef(emailA, emailB) {
    return db.collection('private_messages').doc(getChatKey(emailA, emailB));
}

function getPrivateMessagesRef(emailA, emailB) {
    return getPrivateConversationRef(emailA, emailB).collection('tin_nhan');
}

function getReadMarkerKey(email = '') {
    return (email || '').toLowerCase().replace(/\./g, ',');
}

function getReadTimestampFromConversation(data, email) {
    const key = getReadMarkerKey(email);
    return Number(data?.readBy?.[key] || 0);
}

function syncConversationReadState(otherEmail, timestamp = Date.now()) {
    const me = getCurrentUser();
    if (!me?.email || !otherEmail) return Promise.resolve();

    const key = (otherEmail || '').toLowerCase();
    const ts = Number(timestamp || 0);
    if (!ts || ts <= Number(lastRemoteReadSyncByEmail[key] || 0)) {
        return Promise.resolve();
    }

    lastRemoteReadSyncByEmail[key] = ts;

    return getPrivateConversationRef(me.email, otherEmail).set({
        readBy: {
            [getReadMarkerKey(me.email)]: ts
        },
        updatedAt: Date.now()
    }, { merge: true }).catch((error) => {
        console.warn('Không đồng bộ được trạng thái đã xem:', error);
    });
}

function toggleChatPanel() {
    const panel = document.getElementById('chat-panel');
    panel?.classList.toggle('show');
    if (!panel?.classList.contains('show')) {
        teardownChatRealtimeListeners();
        switchMainTab(currentMainTab || 'feed');
    } else {
        closeChatSelectorModal();
        closeTopQuickMenu();
        panel?.classList.remove('in-conversation');
        selectedChatUser = null;
        updatePrivateChatHeader();
        document.getElementById('group-chat-panel')?.classList.remove('show');
        document.querySelectorAll('.bottom-nav-item').forEach((btn) => btn.classList.remove('active'));
        document.querySelector('.bottom-nav-item[data-tab="chat"]')?.classList.add('active');
    }
    syncOverlayUIState();
}

function toggleGroupChatPanel() {
    const panel = document.getElementById('group-chat-panel');
    panel?.classList.toggle('show');
    if (panel?.classList.contains('show')) {
        closeChatSelectorModal();
        closeTopQuickMenu();
        document.getElementById('chat-panel')?.classList.remove('show');
        document.querySelectorAll('.bottom-nav-item').forEach((btn) => btn.classList.remove('active'));
        document.querySelector('.bottom-nav-item[data-tab="chat"]')?.classList.add('active');
    } else {
        teardownChatRealtimeListeners();
        switchMainTab(currentMainTab || 'feed');
    }
    if (panel?.classList.contains('show')) {
        markGroupChatAsRead();
        document.getElementById('group-emoji-picker')?.classList.remove('show');
    }
    syncOverlayUIState();
}

function closeGroupChatPanelToSelector() {
    document.getElementById('group-chat-panel')?.classList.remove('show');
    teardownChatRealtimeListeners();
    openChatSelectorFromTab();
}

function closePrivateChat() {
    const panel = document.getElementById('chat-panel');
    panel?.classList.remove('in-conversation');
    selectedChatUser = null;
    teardownChatRealtimeListeners();
    const box = document.getElementById('chat-messages');
    if (box) box.innerHTML = '';
    clearPrivateReply();
    showTypingIndicator('private-typing-indicator', '');
    updatePrivateTypingIndicator(false);
    document.getElementById('emoji-picker')?.classList.remove('show');
    closeChatActionSheet();
    closeGroupActionSheet();
    updatePrivateChatHeader();
    panel?.classList.add('show');
    document.querySelectorAll('.bottom-nav-item').forEach((btn) => btn.classList.remove('active'));
    document.querySelector('.bottom-nav-item[data-tab="chat"]')?.classList.add('active');
    syncOverlayUIState();
}

function isPrivateChatOpen() {
    return !!document.getElementById('chat-panel')?.classList.contains('show');
}

function isGroupChatOpen() {
    return !!document.getElementById('group-chat-panel')?.classList.contains('show');
}

function teardownChatRealtimeListeners() {
    setListener('private_chat_messages', null);
    setListener('private_chat_conversation', null);
    setListener('group_chat_messages', null);
    setListener('group_chat_typing', null);
    chatUnsubscribe = null;
    chatConversationUnsubscribe = null;
    groupChatUnsubscribe = null;
    groupTypingUnsubscribe = null;
}

function saveChatReadState() {
    localStorage.setItem(CHAT_READ_KEY, JSON.stringify(chatReadState));
}

function updateGlobalChatUnreadBadge() {
    const tabBadge = document.getElementById('chat-tab-unread-badge');
    if (!tabBadge) return;

    const senders = Object.values(unreadCountsByEmail).filter((c) => Number(c) > 0).length;
    const total = senders + Number(groupChatUnreadCount || 0);
    if (total <= 0) {
        tabBadge.style.display = 'none';
        tabBadge.textContent = '0';
        return;
    }

    tabBadge.style.display = 'inline-flex';
    tabBadge.textContent = total > 99 ? '99+' : String(total);
}

function saveGroupChatReadState() {
    localStorage.setItem(GROUP_CHAT_READ_KEY, String(groupChatLastRead || 0));
}

function markGroupChatAsRead(timestamp = Date.now()) {
    const ts = Number(timestamp || 0);
    if (!ts) return;
    groupChatLastRead = Math.max(groupChatLastRead, ts);
    saveGroupChatReadState();
    updateGroupChatUnreadBadge(0);
}

function updateGroupChatUnreadBadge(count = 0) {
    const safeCount = Math.max(0, Number(count || 0));
    groupChatUnreadCount = safeCount;
    updateGlobalChatUnreadBadge();
}

function markChatAsRead(otherEmail, timestamp = Date.now()) {
    if (!otherEmail) return;
    const key = otherEmail.toLowerCase();
    chatReadState[key] = Math.max(Number(chatReadState[key] || 0), Number(timestamp || 0));
    unreadCountsByEmail[key] = 0;
    saveChatReadState();
    updateGlobalChatUnreadBadge();
}

function sortChatUsersByLatest(users) {
    return [...users].sort((a, b) => {
        const aTs = Number(lastMessageAtByEmail[(a.email || '').toLowerCase()] || 0);
        const bTs = Number(lastMessageAtByEmail[(b.email || '').toLowerCase()] || 0);
        if (bTs !== aTs) return bTs - aTs;
        return (a.name || '').localeCompare(b.name || '');
    });
}

function initRecentMessagesRanking() {
    const me = getCurrentUser();
    if (!me?.email) return;

    setListener('recent_messages_ranking', null);

    recentMessagesUnsubscribe = db.collection('private_messages')
        .where('participants', 'array-contains', me.email.toLowerCase())
        .onSnapshot((snap) => {
            const latest = {};
            const latestPreview = {};
            const unread = {};
            const myEmail = me.email.toLowerCase();

            snap.forEach((doc) => {
                const data = doc.data();
                const participants = Array.isArray(data.participants)
                    ? data.participants.map((value) => (value || '').toLowerCase())
                    : [];
                const other = participants.find((email) => email && email !== myEmail);
                if (!other) return;

                const ts = Number(data.lastMessageAt || 0);
                if (!latest[other] || ts > latest[other]) {
                    latest[other] = ts;
                    latestPreview[other] = {
                        text: data.lastMessageText || '',
                        senderName: data.lastSenderName || '',
                        isFromMe: (data.lastSenderEmail || '').toLowerCase() === myEmail
                    };
                }

                const lastRead = Number(chatReadState[other] || 0);
                const isIncoming = (data.lastSenderEmail || '').toLowerCase() === other;
                const isInOpenChat = selectedChatUser && other === (selectedChatUser.email || '').toLowerCase();

                if (isIncoming && ts > lastRead && !isInOpenChat) {
                    unread[other] = 1;
                }
            });

            lastMessageAtByEmail = latest;
            latestMessagePreviewByEmail = latestPreview;
            unreadCountsByEmail = unread;
            updateGlobalChatUnreadBadge();
            if (allChatUsers.length) renderChatUsers(allChatUsers);
        }, (error) => {
            console.warn('Không tải được xếp hạng tin nhắn mới nhất:', error);
        });
    setListener('recent_messages_ranking', recentMessagesUnsubscribe);
}

function filterChatUsersByKeyword(users) {
    const keyword = (chatUserSearchKeyword || "").trim().toLowerCase();
    if (!keyword) return users;

    return users.filter((u) => {
        const name = (u.name || "").toLowerCase();
        return name.includes(keyword);
    });
}

function clearChatSearchAutofill(chatUserSearchInput) {
    if (!chatUserSearchInput || hasUserTypedChatSearch) return;
    if (!chatUserSearchInput.value) return;

    chatUserSearchInput.value = '';
    chatUserSearchKeyword = '';
    if (allChatUsers.length) renderChatUsers(allChatUsers);
}

function setupMobileChatKeyboardBehavior() {
    const panel = document.getElementById('chat-panel');
    const chatInput = document.getElementById('chat-input');
    const viewport = window.visualViewport;
    if (!panel || !chatInput || !viewport) return;

    const resetPanelPosition = () => {
        panel.classList.remove('keyboard-open');
        panel.style.removeProperty('--chat-keyboard-offset');
    };

    const applyPanelPosition = () => {
        const isTyping = document.activeElement === chatInput;
        if (!isTyping) {
            resetPanelPosition();
            return;
        }

        const keyboardHeight = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
        if (keyboardHeight < 80) {
            resetPanelPosition();
            return;
        }

        panel.classList.add('keyboard-open');
        panel.style.setProperty('--chat-keyboard-offset', `${keyboardHeight + 10}px`);
    };

    viewport.addEventListener('resize', applyPanelPosition);
    viewport.addEventListener('scroll', applyPanelPosition);
    chatInput.addEventListener('focus', () => setTimeout(applyPanelPosition, 60));
    chatInput.addEventListener('blur', resetPanelPosition);
}

function setupViewportKeyboardGuard() {
    const viewport = window.visualViewport;
    if (!viewport) return;

    const applyKeyboardState = () => {
        const keyboardHeight = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
        const opened = keyboardHeight > 90;
        document.body.classList.toggle('keyboard-open', opened);
        document.body.style.setProperty('--keyboard-offset', opened ? `${keyboardHeight}px` : '0px');
    };

    viewport.addEventListener('resize', applyKeyboardState);
    viewport.addEventListener('scroll', applyKeyboardState);
    window.addEventListener('focusin', applyKeyboardState);
    window.addEventListener('focusout', () => setTimeout(applyKeyboardState, 80));
    applyKeyboardState();
}

function initAOSWhenIdle() {
    const boot = () => {
        if (!window.AOS || typeof window.AOS.init !== 'function') return;
        window.AOS.init({
            duration: 800,
            once: true,
            offset: 40
        });
    };
    if ('requestIdleCallback' in window) {
        window.requestIdleCallback(boot, { timeout: 1200 });
    } else {
        setTimeout(boot, 700);
    }
}

function renderChatUsers(users) {
    const list = document.getElementById('chat-users');
    const me = getCurrentUser();
    if (!list || !me?.email) return;

    const others = users
        .filter((u) => (u.email || '').toLowerCase() !== me.email.toLowerCase());

    const sortedUsers = sortChatUsersByLatest(others);
    const filteredUsers = filterChatUsersByKeyword(sortedUsers);

    chatUsersCache = filteredUsers;

    list.innerHTML = filteredUsers.map((u) => {
        const online = getOnlineStateFromTimestamp(u.lastActiveAt) && !!u.isOnline;
        const avatar = u.avatar || buildAvatarUrl(u.name || 'Bạn');
        const email = (u.email || '').replace(/'/g, "\'");
        const emailLower = (u.email || '').toLowerCase();
        const unreadCount = Number(unreadCountsByEmail[emailLower] || 0);
        const preview = latestMessagePreviewByEmail[emailLower];
        const previewPrefix = preview ? (preview.isFromMe ? 'Bạn: ' : '') : '';
        const previewText = preview?.text ? `${previewPrefix}${preview.text}` : 'Chưa có tin nhắn gần đây';
        const recencyLabel = formatChatRecencyLabel(lastMessageAtByEmail[emailLower]);
        const safePreview = escapeHtml(recencyLabel ? `${previewText} • ${recencyLabel}` : previewText);
        const lastSeen = online ? '' : formatLastSeenLabel(u.lastActiveAt);
        const statusText = online ? 'Online' : (lastSeen || 'Offline');
        const statusClass = online ? 'online' : (lastSeen && lastSeen !== 'Offline' ? 'recent' : 'long-offline');

        return `<div class="chat-user-item ${online ? 'online' : ''}" onclick="openPrivateChatByEmail('${email}')">
            <span class="dot"></span>
            <img class="comment-avatar" src="${avatar}" alt="avatar" onclick="event.stopPropagation(); openProfileByEmail('${email}')">
            <div class="chat-user-texts">
                <div class="chat-user-head">
                    <span class="chat-user-label">${u.name || u.email}</span>
                    <span class="chat-user-status ${statusClass}">${statusText}</span>
                </div>
                <span class="chat-user-preview">${safePreview}</span>
            </div>
            <span class="chat-user-unread ${unreadCount > 0 ? 'show' : ''}">${unreadCount > 99 ? '99+' : unreadCount}</span>
        </div>`;
    }).join('');

    if (!filteredUsers.length) {
        list.innerHTML = '<p style="color:#888;padding:8px 6px;">Không tìm thấy người phù hợp.</p>';
    }
}

function renderMembersDirectory(users = []) {
    const list = document.getElementById('members-list');
    if (!list) return;
    if (!users.length) {
        list.innerHTML = '<p class="members-empty">Chưa có thành viên nào.</p>';
        return;
    }

    list.innerHTML = users.map((u) => {
        const online = getOnlineStateFromTimestamp(u.lastActiveAt) && !!u.isOnline;
        const status = online ? '🟢 Đang online' : escapeHtml(formatLastSeenLabel(u.lastActiveAt) || 'Offline');
        return `<div class="member-item">
            <img class="comment-avatar" src="${escapeHtml(u.avatar || buildAvatarUrl(u.name || 'Bạn'))}" alt="avatar" onclick="openProfileByEmail('${escapeHtml((u.email || '').toLowerCase())}')">
            <div>
                <strong>${escapeHtml(u.name || u.email || 'Thành viên')}</strong>
                <div class="meta">${escapeHtml(u.classRole || 'Thành viên')} • ${status}</div>
            </div>
        </div>`;
    }).join('');
}

function openPrivateChatWithUser(user) {
    if (!user?.email) return false;

    selectedChatUser = user;
    const panel = document.getElementById('chat-panel');
    panel?.classList.add('show');
    panel?.classList.add('in-conversation');
    document.getElementById('group-chat-panel')?.classList.remove('show');
    teardownChatRealtimeListeners();
    document.getElementById('emoji-picker')?.classList.remove('show');
    updatePrivateChatHeader();
    markChatAsRead(selectedChatUser.email);
    if (allChatUsers.length) renderChatUsers(allChatUsers);
    loadPrivateMessages();
    return true;
}

function updatePrivateChatHeader() {
    const nameEl = document.getElementById('chat-target-name');
    const statusEl = document.getElementById('chat-target-status');
    const avatarEl = document.getElementById('chat-target-avatar');
    const dotEl = document.getElementById('chat-target-presence-dot');
    const user = selectedChatUser;

    if (!nameEl || !statusEl || !avatarEl || !dotEl) return;
    if (!user) {
        nameEl.textContent = 'Chọn người để chat';
        statusEl.textContent = 'Chưa chọn cuộc trò chuyện';
        avatarEl.src = buildAvatarUrl('Bạn');
        dotEl.classList.remove('online');
        dotEl.classList.add('offline');
        return;
    }

    const isOnline = getOnlineStateFromTimestamp(user.lastActiveAt) && !!user.isOnline;
    nameEl.textContent = user.name || user.email || 'Thành viên';
    statusEl.textContent = isOnline ? 'Đang hoạt động' : `Hoạt động ${formatLastSeenLabel(user.lastActiveAt) || 'không xác định'}`;
    avatarEl.src = user.avatar || buildAvatarUrl(user.name || user.email || 'Bạn');
    dotEl.classList.toggle('online', isOnline);
    dotEl.classList.toggle('offline', !isOnline);
}

function openPrivateChatByEmail(email) {
    const user = chatUsersCache.find((u) => (u.email || '').toLowerCase() === (email || '').toLowerCase())
        || allChatUsers.find((u) => (u.email || '').toLowerCase() === (email || '').toLowerCase())
        || null;
    if (!user) return;

    openPrivateChatWithUser(user);
}

function initPrivateChatUsers() {
    initRecentMessagesRanking();

    setListener('users', null);
    usersUnsubscribe = db.collection('users').onSnapshot((snap) => {
        const users = [];
        snap.forEach((doc) => users.push(doc.data()));
        allChatUsers = users;
        if (selectedChatUser?.email) {
            const refreshed = users.find((u) => (u.email || '').toLowerCase() === selectedChatUser.email.toLowerCase());
            if (refreshed) selectedChatUser = refreshed;
            updatePrivateChatHeader();
        }
        renderChatUsers(users);
        renderMembersDirectory(users);
    });
    setListener('users', usersUnsubscribe);
}

function loadPrivateMessages() {
    const me = getCurrentUser();
    if (!selectedChatUser || !me?.email || !isPrivateChatOpen()) return;

    const messagesBox = document.getElementById('chat-messages');
    const conversationRef = getPrivateConversationRef(me.email, selectedChatUser.email);

    setListener('private_chat_messages', null);
    setListener('private_chat_conversation', null);

    let latestDocs = [];
    let otherReadTs = 0;

    const renderMessages = () => {
        if (!messagesBox) return;

        const docs = [...latestDocs].sort((a, b) => {
            const tsDiff = Number(a.createdAt || 0) - Number(b.createdAt || 0);
            if (tsDiff !== 0) return tsDiff;
            return String(a.id || '').localeCompare(String(b.id || ''));
        });

        latestPrivateMessages = docs;
        const keyword = (privateSearchKeyword || '').trim().toLowerCase();
        const visibleDocs = keyword
            ? docs.filter((d) => String(d.text || '').toLowerCase().includes(keyword) || String(d.senderName || '').toLowerCase().includes(keyword))
            : docs;

        let html = '';
        let latestIncomingTs = 0;
        let latestOutgoingTs = 0;
        let lastRenderedDateKey = '';
        const pinned = visibleDocs.filter((d) => !!d.pinned).slice(-1)[0] || null;
        const pinnedEl = document.getElementById('private-chat-pinned');
        if (pinnedEl) {
            if (pinned) {
                pinnedEl.style.display = 'block';
                pinnedEl.innerHTML = `📌 ${escapeHtml(pinned.senderName || 'Thành viên')}: ${escapeHtml(String(pinned.text || '').slice(0, 110))}`;
            } else {
                pinnedEl.style.display = 'none';
                pinnedEl.innerHTML = '';
            }
        }

        visibleDocs.forEach((data) => {
            const isMe = (data.senderEmail || '').toLowerCase() === me.email.toLowerCase();
            const isRevoked = !!data.revoked;
            const safeText = isRevoked
                ? '<em style="opacity:.85;">Tin nhắn đã được thu hồi</em>'
                : formatChatBodyHtml(data.text || '');
            const senderName = escapeHtml(data.senderName || (isMe ? (me.name || 'Bạn') : (selectedChatUser?.name || 'Bạn ấy')));
            const timeText = formatChatTime(data.createdAt);
            const ts = Number(data.createdAt || 0);
            const dateKey = getChatDateKey(ts);

            if (dateKey && dateKey !== lastRenderedDateKey) {
                html += `<div class="chat-time-separator">${escapeHtml(formatChatCenterDateTime(ts))}</div>`;
                lastRenderedDateKey = dateKey;
            }

            if (!isMe && ts > latestIncomingTs) latestIncomingTs = ts;
            if (isMe && ts > latestOutgoingTs) latestOutgoingTs = ts;
            const replySnippet = renderReplySnippet(data.replyTo);
            const imageHtml = (!isRevoked && data.imageUrl) ? `<img class="chat-image" src="${escapeHtml(data.imageUrl)}" alt="chat-image" onclick="openLightbox('${escapeHtml(data.imageUrl)}', false)">` : '';
            const otherAvatar = escapeHtml(selectedChatUser?.avatar || buildAvatarUrl(selectedChatUser?.name || 'Bạn ấy'));
            html += `<div class="chat-row ${isMe ? 'me' : 'other'}">
                ${isMe ? '' : `<img class="chat-peer-avatar" src="${otherAvatar}" alt="avatar ${senderName}" loading="lazy" decoding="async">`}
                <div class="chat-bubble ${isMe ? 'me' : 'other'}">
                    ${replySnippet}${safeText || ''}${imageHtml}
                    <span class="meta">${senderName} • ${timeText}</span>
                    <div class="chat-message-actions">
                        <button class="chat-message-action-btn" title="Trả lời" onclick="replyToPrivateMessage('${data.id}')"><i class="fa-solid fa-reply"></i></button>
                        ${isMe && !isRevoked ? `<button class="chat-message-action-btn" title="Thu hồi" onclick="revokePrivateMessage('${data.id}')"><i class="fa-solid fa-rotate-left"></i></button>` : ''}
                        <button class="chat-message-action-btn" title="${data.pinned ? 'Bỏ ghim' : 'Ghim'}" onclick="togglePinPrivateMessage('${data.id}', ${data.pinned ? 'true' : 'false'})"><i class="fa-solid fa-thumbtack"></i></button>
                    </div>
                </div>
            </div>`;
        });

        if (latestOutgoingTs && otherReadTs >= latestOutgoingTs) {
            html += '<div class="chat-read-receipt" style="text-align:right;color:#9aa2ff;font-size:12px;margin-top:6px;">Đã xem</div>';
        }

        if (latestIncomingTs && selectedChatUser?.email) {
            markChatAsRead(selectedChatUser.email, latestIncomingTs);
            syncConversationReadState(selectedChatUser.email, latestIncomingTs);
            if (allChatUsers.length) renderChatUsers(allChatUsers);
        }

        messagesBox.innerHTML = html || '<p style="color:#888">Chưa có tin nhắn nào.</p>';
        messagesBox.scrollTop = messagesBox.scrollHeight;
    };

    if (messagesBox) {
        messagesBox.innerHTML = '<p style="color:#888">Đang tải tin nhắn...</p>';
    }

    chatConversationUnsubscribe = conversationRef.onSnapshot((doc) => {
        const data = doc.data() || {};
        otherReadTs = getReadTimestampFromConversation(data, selectedChatUser?.email || '');
        const otherTypingTs = Number(data?.typingBy?.[getReadMarkerKey(selectedChatUser?.email || '')] || 0);
        if (otherTypingTs && (Date.now() - otherTypingTs) < TYPING_EXPIRE_MS) {
            showTypingIndicator('private-typing-indicator', `${selectedChatUser?.name || 'Bạn ấy'} đang nhập...`);
        } else {
            showTypingIndicator('private-typing-indicator', '');
        }
        renderMessages();
    }, (error) => {
        console.warn('Không tải được trạng thái đã xem của cuộc trò chuyện:', error);
    });
    setListener('private_chat_conversation', chatConversationUnsubscribe);

    chatUnsubscribe = getPrivateMessagesRef(me.email, selectedChatUser.email)
        .orderBy('createdAt', 'desc')
        .limit(PRIVATE_CHAT_LIMIT)
        .onSnapshot((snap) => {
            latestDocs = [];
            snap.forEach((doc) => latestDocs.push({ id: doc.id, ...doc.data() }));
            renderMessages();
        }, (error) => {
            console.error('Lỗi tải tin nhắn riêng:', error);
            if (messagesBox) {
                messagesBox.innerHTML = '<p style="color:#d33">Không tải được tin nhắn. Kiểm tra Firestore rules/index.</p>';
            }
        });
    setListener('private_chat_messages', chatUnsubscribe);
}

async function sendPrivateMessage(extra = {}) {
    const me = getCurrentUser();
    const input = document.getElementById('chat-input');
    const sendBtn = document.querySelector('#chat-panel .chat-conversation-view .chat-send-btn');
    const text = input?.value.trim() || '';
    const imageUrl = extra?.imageUrl || '';
    if (!me?.email || !selectedChatUser?.email || (!text && !imageUrl)) return;
    if (Date.now() - lastPrivateMessageSentAt < MESSAGE_COOLDOWN_MS) {
        return showSystemToast('Bạn gửi hơi nhanh, chờ 1 giây nhé.', { icon: '⏱️', title: 'Chống spam' });
    }
    if (hasUntrustedLink(text)) {
        return showSystemToast('Tin nhắn có link lạ. Hiện chỉ cho phép một số link tin cậy.', { icon: '⚠️', title: 'Link không hợp lệ' });
    }

    try {
        setButtonLoading(sendBtn, true, 'Đang gửi...');
        const now = Date.now();
        lastPrivateMessageSentAt = now;
        const conversationRef = getPrivateConversationRef(me.email, selectedChatUser.email);
        const docRef = getPrivateMessagesRef(me.email, selectedChatUser.email).doc();

        const payload = {
            chatKey: getChatKey(me.email, selectedChatUser.email),
            participants: [me.email.toLowerCase(), selectedChatUser.email.toLowerCase()],
            senderEmail: me.email.toLowerCase(),
            senderName: me.name || me.email,
            senderAvatar: me.avatar || buildAvatarUrl(me.name || me.email),
            receiverEmail: selectedChatUser.email.toLowerCase(),
            text,
            imageUrl,
            pinned: false,
            replyTo: replyingPrivateMessage ? {
                id: replyingPrivateMessage.id || '',
                senderName: replyingPrivateMessage.senderName || '',
                text: String(replyingPrivateMessage.text || '').slice(0, 120)
            } : null,
            createdAt: now
        };

        const batch = db.batch();
        batch.set(docRef, payload);
        batch.set(conversationRef, {
            chatKey: payload.chatKey,
            participants: payload.participants,
            lastSenderEmail: payload.senderEmail,
            lastSenderName: payload.senderName,
            lastMessageText: text || '🖼️ Ảnh',
            lastMessageAt: now,
            updatedAt: now,
            messagesPath: `private_messages/${payload.chatKey}/tin_nhan`,
            readBy: {
                [getReadMarkerKey(payload.senderEmail)]: now
            },
            typingBy: {
                [getReadMarkerKey(payload.senderEmail)]: 0
            }
        }, { merge: true });
        await batch.commit();

        await queueNotificationEvent(`chat_${docRef.id}`, {
            type: 'chat_new_message',
            messageId: docRef.id,
            senderEmail: me.email.toLowerCase(),
            senderName: me.name || me.email,
            receiverEmail: selectedChatUser.email.toLowerCase(),
            textPreview: (text || '🖼️ Ảnh').slice(0, 120),
            sentAt: now
        });
        const otherEmail = selectedChatUser.email.toLowerCase();
        lastMessageAtByEmail[otherEmail] = now;
        latestMessagePreviewByEmail[otherEmail] = {
            text: text || '🖼️ Ảnh',
            senderName: me.name || me.email,
            isFromMe: true
        };
        if (allChatUsers.length) renderChatUsers(allChatUsers);

        input.value = '';
        clearPrivateReply();
        document.getElementById('emoji-picker')?.classList.remove('show');
    } catch (e) {
        console.error('Không gửi được tin nhắn riêng:', e);
        showSystemToast('Gửi tin nhắn thất bại. Vui lòng thử lại.', { icon: '⚠️', title: 'Lỗi gửi tin nhắn' });
    } finally {
        setButtonLoading(sendBtn, false);
    }
}


function initGroupChat() {
    const box = document.getElementById('group-chat-messages');
    if (!box || !isGroupChatOpen()) return;

    setListener('group_chat_messages', null);
    setListener('group_chat_typing', null);
    groupChatUnsubscribe = null;
    groupTypingUnsubscribe = null;

    box.innerHTML = '<p style="color:#888">Đang tải chat chung...</p>';
    groupTypingUnsubscribe = db.collection('group_meta').doc('typing').onSnapshot((doc) => {
        const me = getCurrentUser();
        const typingBy = doc.data()?.typingBy || {};
        const activeTypers = Object.entries(typingBy)
            .filter(([email, ts]) => email !== (me?.email || '').toLowerCase() && (Date.now() - Number(ts || 0) < TYPING_EXPIRE_MS))
            .map(([email]) => {
                const found = allChatUsers.find((u) => (u.email || '').toLowerCase() === email);
                return found?.name || email;
            });
        showTypingIndicator('group-typing-indicator', activeTypers.length ? `${activeTypers.slice(0, 2).join(', ')} đang nhập...` : '');
    });
    setListener('group_chat_typing', groupTypingUnsubscribe);

    groupChatUnsubscribe = db.collection('group_messages')
        .orderBy('createdAt', 'desc')
        .limit(GROUP_CHAT_LIMIT)
        .onSnapshot((snap) => {
            const docs = snap.docs.slice().reverse();
            if (!docs.length) {
                box.innerHTML = '<p style="color:#888">Chưa có tin nhắn nào.</p>';
                updateGroupChatUnreadBadge(0);
                return;
            }

            const me = getCurrentUser();
            let unread = 0;
            let latestIncomingTs = 0;
            let lastRenderedDateKey = '';
            latestGroupMessages = docs.map((doc) => ({ id: doc.id, ...(doc.data() || {}) }));
            const keyword = (groupSearchKeyword || '').trim().toLowerCase();
            const filteredDocs = !keyword
                ? docs
                : docs.filter((doc) => {
                    const data = doc.data() || {};
                    return String(data.text || '').toLowerCase().includes(keyword)
                        || String(data.senderName || '').toLowerCase().includes(keyword);
                });
            const pinned = filteredDocs.map((doc) => ({ id: doc.id, ...(doc.data() || {}) })).filter((m) => !!m.pinned).slice(-1)[0] || null;
            const pinnedEl = document.getElementById('group-chat-pinned');
            if (pinnedEl) {
                if (pinned) {
                    pinnedEl.style.display = 'block';
                    pinnedEl.innerHTML = `📌 ${escapeHtml(pinned.senderName || 'Thành viên')}: ${escapeHtml(String(pinned.text || '').slice(0, 100))}`;
                } else {
                    pinnedEl.style.display = 'none';
                    pinnedEl.innerHTML = '';
                }
            }

            const html = filteredDocs.map((doc) => {
                const data = doc.data() || {};
                const isMe = (data.senderEmail || '').toLowerCase() === (me?.email || '').toLowerCase();
                const isRevoked = !!data.revoked;
                const senderName = escapeHtml(data.senderName || data.senderEmail || 'Thành viên');
                const text = isRevoked
                    ? '<em style="opacity:.85;">Tin nhắn đã được thu hồi</em>'
                    : formatChatBodyHtml(data.text || '');
                const time = escapeHtml(formatChatTime(data.createdAt));
                const ts = Number(data.createdAt || 0);
                const dateKey = getChatDateKey(ts);
                if (!isMe && ts > groupChatLastRead) unread += 1;
                if (!isMe && ts > latestIncomingTs) latestIncomingTs = ts;

                let block = '';
                if (dateKey && dateKey !== lastRenderedDateKey) {
                    block += `<div class="chat-time-separator">${escapeHtml(formatChatCenterDateTime(ts))}</div>`;
                    lastRenderedDateKey = dateKey;
                }

                const senderAvatar = escapeHtml(data.senderAvatar || buildAvatarUrl(data.senderName || data.senderEmail || "Thành viên"));
                const bubbleClass = isMe ? 'me' : 'other';
                const replySnippet = renderReplySnippet(data.replyTo);
                const imageHtml = (!isRevoked && data.imageUrl) ? `<img class="chat-image" src="${escapeHtml(data.imageUrl)}" alt="chat-image" onclick="openLightbox('${escapeHtml(data.imageUrl)}', false)">` : '';
                block += `<div class="group-chat-message ${bubbleClass}">
                    ${isMe ? '' : `<img class="group-chat-avatar" src="${senderAvatar}" alt="avatar ${senderName}" loading="lazy" decoding="async">`}
                    <div class="chat-bubble ${bubbleClass}">
                        ${replySnippet}${text || ''}${imageHtml}
                        <span class="meta">${senderName} • ${time}</span>
                        <div class="chat-message-actions">
                            <button class="chat-message-action-btn" title="Trả lời" onclick="replyToGroupMessage('${doc.id}')"><i class="fa-solid fa-reply"></i></button>
                            ${isMe && !isRevoked ? `<button class="chat-message-action-btn" title="Thu hồi" onclick="revokeGroupMessage('${doc.id}')"><i class="fa-solid fa-rotate-left"></i></button>` : ''}
                            <button class="chat-message-action-btn" title="${data.pinned ? 'Bỏ ghim' : 'Ghim'}" onclick="togglePinGroupMessage('${doc.id}', ${data.pinned ? 'true' : 'false'})"><i class="fa-solid fa-thumbtack"></i></button>
                        </div>
                    </div>
                </div>`;
                return block;
            }).join('');

            box.innerHTML = html;

            const latestDoc = docs[docs.length - 1];
            const latestData = latestDoc?.data?.() || {};
            const latestTs = Number(latestData.createdAt || 0);

            if (!groupChatNotifiedUpToTs) {
                groupChatNotifiedUpToTs = latestTs;
            } else if (latestTs > groupChatNotifiedUpToTs) {
                const meEmail = (me?.email || '').toLowerCase();
                const incomingNewMessages = docs
                    .map((doc) => doc.data() || {})
                    .filter((msg) => {
                        const senderEmail = String(msg.senderEmail || '').toLowerCase();
                        const ts = Number(msg.createdAt || 0);
                        return senderEmail && senderEmail !== meEmail && ts > groupChatNotifiedUpToTs;
                    });

                if (incomingNewMessages.length) {
                    const newestIncoming = incomingNewMessages[incomingNewMessages.length - 1];
                    const senderName = newestIncoming.senderName || newestIncoming.senderEmail || 'Thành viên';
                    const toastTitle = `${senderName} đã nhắn tin vào nhóm chat`;
                    const previewText = String(newestIncoming.text || '').trim() || 'Mở ứng dụng để xem chi tiết tin nhắn mới.';
                    const sentAt = Number(newestIncoming.createdAt || Date.now());

                    showSystemToast(previewText, {
                        icon: '👥',
                        title: toastTitle,
                        meta: formatChatTime(sentAt)
                    });

                    if ('Notification' in window && Notification.permission === 'granted') {
                        try {
                            if (swRegistration?.showNotification) {
                                swRegistration.showNotification(toastTitle, { body: previewText }).catch(() => {});
                            } else {
                                new Notification(toastTitle, { body: previewText });
                            }
                        } catch (_) {}
                    }
                }

                groupChatNotifiedUpToTs = latestTs;
            }

            box.scrollTop = box.scrollHeight;

            const panel = document.getElementById('group-chat-panel');
            if (panel?.classList.contains('show') && latestIncomingTs) {
                markGroupChatAsRead(latestIncomingTs);
            } else {
                updateGroupChatUnreadBadge(unread);
            }
        }, (error) => {
            console.warn('Không tải được chat nhóm chung:', error);
            box.innerHTML = '<p style="color:#d33">Không tải được chat chung. Kiểm tra Firestore rules/index.</p>';
        });
    setListener('group_chat_messages', groupChatUnsubscribe);
}

async function sendGroupMessage(extra = {}) {
    const me = getCurrentUser();
    const input = document.getElementById('group-chat-input');
    const sendBtn = document.querySelector('#group-chat-panel .chat-send-btn');
    const text = input?.value.trim() || '';
    const imageUrl = extra?.imageUrl || '';
    if (!me?.email || (!text && !imageUrl) || !input) return;
    if (Date.now() - lastGroupMessageSentAt < MESSAGE_COOLDOWN_MS) {
        return showSystemToast('Bạn gửi hơi nhanh, chờ 1 giây nhé.', { icon: '⏱️', title: 'Chống spam' });
    }
    if (hasUntrustedLink(text)) {
        return showSystemToast('Tin nhắn có link lạ. Hiện chỉ cho phép một số link tin cậy.', { icon: '⚠️', title: 'Link không hợp lệ' });
    }

    try {
        setButtonLoading(sendBtn, true, 'Đang gửi...');
        const senderName = me.name || me.email;

        const sentAt = Date.now();
        lastGroupMessageSentAt = sentAt;
        const docRef = await db.collection('group_messages').add({
            senderEmail: me.email.toLowerCase(),
            senderName,
            senderAvatar: me.avatar || buildAvatarUrl(me.name || me.email),
            text,
            imageUrl,
            pinned: false,
            replyTo: replyingGroupMessage ? {
                id: replyingGroupMessage.id || '',
                senderName: replyingGroupMessage.senderName || '',
                text: String(replyingGroupMessage.text || '').slice(0, 120)
            } : null,
            createdAt: sentAt
        });

        // Đường dự phòng: nếu trigger group_messages ở backend chưa deploy đồng bộ,
        // event này vẫn giúp luồng push nhóm chạy qua sendPushFromEvent.
        await queueNotificationEvent(`group_chat_${docRef.id}`, {
            type: 'group_chat_new_message',
            senderEmail: me.email.toLowerCase(),
            senderName,
            body: `${senderName} đã nhắn tin vào nhóm chat`,
            textPreview: (text || '🖼️ Ảnh').length > 140 ? `${(text || '🖼️ Ảnh').slice(0, 140)}…` : (text || '🖼️ Ảnh'),
            sentAt,
            link: '/'
        });

        input.value = '';
        clearGroupReply();
        db.collection('group_meta').doc('typing').set({ typingBy: { [me.email.toLowerCase()]: 0 } }, { merge: true }).catch(() => {});
        document.getElementById('group-emoji-picker')?.classList.remove('show');
    } catch (error) {
        console.error('Không gửi được tin nhắn nhóm chung:', error);
        showSystemToast('Gửi chat chung thất bại. Vui lòng thử lại.', { icon: '⚠️', title: 'Lỗi gửi tin nhắn nhóm' });
    } finally {
        setButtonLoading(sendBtn, false);
    }
}

function escapeHtml(value = '') {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function isSameLocalDate(a, b) {
    return a.getFullYear() === b.getFullYear()
        && a.getMonth() === b.getMonth()
        && a.getDate() === b.getDate();
}

function getChatDateKey(timestamp) {
    const ts = Number(timestamp || 0);
    if (!ts) return '';
    const d = new Date(ts);
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function formatChatCenterDateTime(timestamp) {
    const ts = Number(timestamp || 0);
    if (!ts) return '';
    const d = new Date(ts);
    const timeText = d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
    return `${timeText} ${d.getDate()} Tháng ${d.getMonth() + 1}, ${d.getFullYear()}`;
}

function formatChatRecencyLabel(timestamp) {
    const ts = Number(timestamp || 0);
    if (!ts) return '';

    const now = new Date();
    const d = new Date(ts);
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);

    if (isSameLocalDate(d, now)) return 'Hôm nay';
    if (isSameLocalDate(d, yesterday)) return 'Hôm qua';

    return `${d.getDate()} Tháng ${d.getMonth() + 1}, ${d.getFullYear()}`;
}

function formatLastSeenLabel(lastActiveAt) {
    const ts = Number(lastActiveAt || 0);
    if (!ts) return '';

    const diff = Date.now() - ts;
    if (diff < 0) return 'Offline';

    const minute = 60 * 1000;
    const hour = 60 * minute;
    const day = 24 * hour;
    const week = 7 * day;
    const month = 30 * day;

    if (diff < minute) return 'Vừa hoạt động';
    if (diff < hour) return `${Math.max(1, Math.floor(diff / minute))} phút trước`;
    if (diff < day) return `${Math.max(1, Math.floor(diff / hour))} giờ trước`;
    if (diff < 2 * day) return 'Hôm qua';
    if (diff < week) return `${Math.floor(diff / day)} ngày trước`;
    if (diff < month) return `${Math.floor(diff / week)} tuần trước`;

    return 'Offline';
}

function formatChatTime(timestamp) {
    if (!timestamp) return '';
    const d = new Date(Number(timestamp));
    return d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function initEmojiPicker() {
    const picker = document.getElementById('emoji-picker');
    const groupPicker = document.getElementById('group-emoji-picker');
    if (!picker) return;

    picker.innerHTML = CHAT_EMOJIS
        .map((emoji) => `<button class="emoji-item" onclick="appendEmoji('${emoji}')">${emoji}</button>`)
        .join('');

    if (groupPicker) {
        groupPicker.innerHTML = CHAT_EMOJIS
            .map((emoji) => `<button class="emoji-item" onclick="appendGroupEmoji('${emoji}')">${emoji}</button>`)
            .join('');
    }
}

function toggleEmojiPicker() {
    const picker = document.getElementById('emoji-picker');
    picker?.classList.toggle('show');
}

function appendEmoji(emoji) {
    const input = document.getElementById('chat-input');
    if (!input) return;
    input.value += emoji;
    input.focus();
}

function toggleGroupEmojiPicker() {
    const picker = document.getElementById('group-emoji-picker');
    picker?.classList.toggle('show');
}

function appendGroupEmoji(emoji) {
    const input = document.getElementById('group-chat-input');
    if (!input) return;
    input.value += emoji;
    input.focus();
}

function showAuthMessage(message, isError = true) {
    const err = document.getElementById('error-msg');
    const ok = document.getElementById('auth-success');
    if (!err || !ok) return;

    if (isError) {
        err.innerText = message;
        err.style.display = 'block';
        ok.style.display = 'none';
    } else {
        ok.innerText = message;
        ok.style.display = 'block';
        err.style.display = 'none';
    }
}

function switchAuthTab(tab) {
    const isLogin = tab === 'login';
    document.getElementById('tab-login')?.classList.toggle('active', isLogin);
    document.getElementById('tab-register')?.classList.toggle('active', !isLogin);
    document.getElementById('auth-login')?.classList.toggle('active', isLogin);
    document.getElementById('auth-register')?.classList.toggle('active', !isLogin);
    showAuthMessage('', false);
    document.getElementById('error-msg').style.display = 'none';
    document.getElementById('auth-success').style.display = 'none';
}

function bindPasswordToggle(toggleId, passwordId) {
    const toggle = document.getElementById(toggleId);
    const passwordInput = document.getElementById(passwordId);
    if (!toggle || !passwordInput) return;

    toggle.addEventListener('change', () => {
        passwordInput.type = toggle.checked ? 'text' : 'password';
    });
}   

function initPasswordToggles() {
    bindPasswordToggle('toggle-login-password', 'login-password');
    bindPasswordToggle('toggle-register-password', 'register-password');
}

async function registerAccount() {
    const name = document.getElementById('register-name').value.trim();
    const phone = document.getElementById('register-phone').value.trim();
    const email = document.getElementById('register-email').value.trim().toLowerCase();
    const password = document.getElementById('register-password').value;

    const phoneRegex = /^0\d{9,10}$/;
    if (!name || !phone || !email || !password) return showAuthMessage('Vui lòng nhập đầy đủ họ tên, số điện thoại, email và mật khẩu.');
    if (!phoneRegex.test(phone)) return showAuthMessage('Số điện thoại chưa đúng định dạng (VD: 09xxxxxxxx).');
    if (password.length < 6) return showAuthMessage('Mật khẩu cần ít nhất 6 ký tự.');

    try {
        const phoneSnap = await db.collection('users').where('phone', '==', phone).limit(1).get();
        if (!phoneSnap.empty) {
            return showAuthMessage('Email hoặc số điện thoại đã được đăng ký.');
        }

        const cred = await auth.createUserWithEmailAndPassword(email, password);
        const avatar = buildAvatarUrl(name);
        await db.collection('users').doc(cred.user.uid).set({
            uid: cred.user.uid,
            name,
            phone,
            email,
            avatar,
            nickname: '',
            classRole: '',
            birthYear: null,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        await cleanupLegacyPasswordField(email);
        setCurrentUser({ name, phone, email, avatar, nickname: '', classRole: '', birthYear: null });

        document.getElementById('register-name').value = '';
        document.getElementById('register-phone').value = '';
        document.getElementById('register-email').value = '';
        document.getElementById('register-password').value = '';

        showAuthMessage('Tạo tài khoản thành công!', false);
    } catch (error) {
        console.error('Lỗi đăng ký Firebase:', error);
        showAuthMessage(mapFirebaseAuthError(error));
    }
}

function enterMainSite() {
    if (hasEnteredMainSite) return;
    hasEnteredMainSite = true;
    document.getElementById('password-screen').style.display = 'none';
    document.getElementById('main-content').style.display = 'block';

    const container = document.getElementById('music-container');
    container.style.display = 'block';
    playSong(currentSongIndex, { showToast: false, fromLogin: true });

    confetti({
        particleCount: 150,
        spread: 70,
        origin: { y: 0.6 },
        colors: ['#ff4d4d', '#ffffff', '#ff7e5f']
    });

    loadGallery();
    initMemoryMap();
    startCountdown();
    createLeaves();
    loadTimeCapsuleMessages();
    updateCurrentUserDisplay();
    startPresenceTracking();
    initPrivateChatUsers();
    initGroupChat();
    updateGroupChatHeaderAvatar();
    autoEnablePushIfPossible();
    initAutoPushEnableOnFirstGesture();
    ensurePushPermissionNudge();
    initNotificationCenter();
    initStoriesStrip();
    switchMainTab(currentMainTab || 'feed');
    handleShortcutNavigation();
}

function replyToGroupMessage(messageId) {
    const target = latestGroupMessages.find((m) => m.id === messageId);
    if (!target) return;
    replyingGroupMessage = {
        id: target.id,
        senderName: target.senderName || target.senderEmail || 'Thành viên',
        text: target.text || (target.imageUrl ? '🖼️ Ảnh' : '')
    };
    renderReplyPreview('group-reply-preview', replyingGroupMessage);
    document.getElementById('group-chat-input')?.focus();
}

function clearGroupReply() {
    replyingGroupMessage = null;
    renderReplyPreview('group-reply-preview', null);
}

async function togglePinGroupMessage(messageId, pinned) {
    if (!messageId) return;
    await db.collection('group_messages').doc(messageId).set({ pinned: !pinned }, { merge: true })
        .catch((error) => console.warn('Không thể cập nhật ghim nhóm:', error));
}

async function revokeGroupMessage(messageId) {
    const me = getCurrentUser();
    if (!me?.email || !messageId) return;
    if (!(await showConfirmModal('Thu hồi tin nhắn nhóm này?'))) return;
    await db.collection('group_messages').doc(messageId).set({
        revoked: true,
        text: '',
        imageUrl: '',
        revokedAt: Date.now(),
        revokedBy: me.email.toLowerCase()
    }, { merge: true }).catch((error) => {
        console.warn('Không thể thu hồi tin nhắn nhóm:', error);
        showSystemToast('Thu hồi tin nhắn nhóm thất bại.', { icon: '⚠️', title: 'Lỗi thu hồi' });
    });
}

async function uploadImageToStorage(file, folder = 'chat_images') {
    if (!storage) throw new Error('Storage chưa sẵn sàng.');
    if (!file) throw new Error('Thiếu file ảnh cần tải lên.');
    const ext = (String(file.name || '').split('.').pop() || 'jpg').toLowerCase();
    const safeExt = ext.replace(/[^a-z0-9]/gi, '') || 'jpg';
    const fileName = `${Date.now()}_${Math.random().toString(36).slice(2)}.${safeExt}`;
    const ref = storage.ref(`${folder}/${fileName}`);
    await ref.put(file);
    return ref.getDownloadURL();
}

function triggerGroupImagePicker() {
    document.getElementById('group-chat-image-input')?.click();
}

async function handleGroupImagePicked(event) {
    const file = event?.target?.files?.[0];
    if (!file) return;
    try {
        const imageUrl = await uploadImageToStorage(file, 'chat_images/group');
        await sendGroupMessage({ imageUrl });
    } catch (error) {
        console.error('Upload ảnh nhóm thất bại:', error);
        showSystemToast('Không tải được ảnh chat nhóm lên Storage.', { icon: '⚠️', title: 'Upload thất bại' });
    } finally {
        event.target.value = '';
    }
}

function replyToPrivateMessage(messageId) {
    const target = latestPrivateMessages.find((m) => m.id === messageId);
    if (!target) return;
    replyingPrivateMessage = {
        id: target.id,
        senderName: target.senderName || target.senderEmail || 'Thành viên',
        text: target.text || (target.imageUrl ? '🖼️ Ảnh' : '')
    };
    renderReplyPreview('private-reply-preview', replyingPrivateMessage);
    document.getElementById('chat-input')?.focus();
}

function clearPrivateReply() {
    replyingPrivateMessage = null;
    renderReplyPreview('private-reply-preview', null);
}

async function togglePinPrivateMessage(messageId, pinned) {
    const me = getCurrentUser();
    if (!me?.email || !selectedChatUser?.email || !messageId) return;
    await getPrivateMessagesRef(me.email, selectedChatUser.email).doc(messageId).set({ pinned: !pinned }, { merge: true })
        .catch((error) => console.warn('Không thể cập nhật ghim tin nhắn:', error));
}

async function revokePrivateMessage(messageId) {
    const me = getCurrentUser();
    if (!me?.email || !selectedChatUser?.email || !messageId) return;
    if (!(await showConfirmModal('Thu hồi tin nhắn riêng này?'))) return;
    await getPrivateMessagesRef(me.email, selectedChatUser.email).doc(messageId).set({
        revoked: true,
        text: '',
        imageUrl: '',
        revokedAt: Date.now(),
        revokedBy: me.email.toLowerCase()
    }, { merge: true }).catch((error) => {
        console.warn('Không thể thu hồi tin nhắn riêng:', error);
        showSystemToast('Thu hồi tin nhắn riêng thất bại.', { icon: '⚠️', title: 'Lỗi thu hồi' });
    });
}

function triggerPrivateImagePicker() {
    document.getElementById('private-chat-image-input')?.click();
}

async function handlePrivateImagePicked(event) {
    const file = event?.target?.files?.[0];
    if (!file) return;
    try {
        const imageUrl = await uploadImageToStorage(file, 'chat_images/private');
        await sendPrivateMessage({ imageUrl });
    } catch (error) {
        console.error('Upload ảnh chat riêng thất bại:', error);
        showSystemToast('Không tải được ảnh chat lên Storage. Vui lòng thử lại.', { icon: '⚠️', title: 'Upload thất bại' });
    } finally {
        event.target.value = '';
    }
}

async function updatePrivateTypingIndicator(isTyping) {
    const me = getCurrentUser();
    if (!me?.email || !selectedChatUser?.email) return;
    const conversationRef = getPrivateConversationRef(me.email, selectedChatUser.email);
    await conversationRef.set({
        typingBy: {
            [getReadMarkerKey(me.email)]: isTyping ? Date.now() : 0
        },
        updatedAt: Date.now()
    }, { merge: true }).catch(() => {});
}

function switchMainTab(tab = 'feed') {
    currentMainTab = tab;
    // Tối ưu hiệu năng: chỉ giữ listener cho tab đang cần.
    if (tab !== 'feed') {
        setListener('gallery', null);
        galleryUnsubscribe = null;
        destroyAllTilts();
        destroyGalleryObservers();
    } else {
        loadGallery();
    }
    if (tab !== 'chat') {
        teardownChatRealtimeListeners();
    } else {
        if (isPrivateChatOpen() && selectedChatUser?.email) loadPrivateMessages();
        if (isGroupChatOpen()) initGroupChat();
    }
    if (tab !== 'capsule') {
        setListener('capsule_messages', null);
    } else {
        loadTimeCapsuleMessages();
    }

    document.getElementById('chat-panel')?.classList.remove('show');
    document.getElementById('group-chat-panel')?.classList.remove('show');
    closeChatSelectorModal();
    document.querySelectorAll('.app-screen[data-screen]').forEach((el) => {
        const isVisible = el.dataset.screen === tab;
        el.classList.toggle('is-visible', isVisible);
        if (!isVisible) {
            el.style.display = 'none';
            return;
        }
        if (el.id === 'time-capsule-section') {
            el.style.display = 'flex';
        } else {
            el.style.display = 'block';
        }
    });
    document.querySelectorAll('.bottom-nav-item').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.tab === tab);
    });
    if (tab === 'map') {
        setTimeout(() => memoryMap?.invalidateSize?.(), 180);
    }
    syncOverlayUIState();
}

function openChatSelectorFromTab() {
    document.querySelectorAll('.bottom-nav-item').forEach((btn) => btn.classList.remove('active'));
    document.querySelector('.bottom-nav-item[data-tab="chat"]')?.classList.add('active');
    const chooser = document.getElementById('chat-selector-modal');
    if (chooser) chooser.style.display = 'flex';
    closeChatActionSheet();
    closeGroupActionSheet();
    closeTopQuickMenu();
    syncOverlayUIState();
}

function openProfileByEmail(email) {
    const normalizedEmail = String(email || '').trim().toLowerCase();
    if (!normalizedEmail) return;
    window.location.href = `profile.html?id=${encodeURIComponent(normalizedEmail)}`;
}

function openOwnProfilePage() {
    const me = getCurrentUser();
    if (!me?.email) {
        showSystemToast('Bạn cần đăng nhập để xem trang cá nhân.', { icon: '🔒', title: 'Chưa đăng nhập' });
        return;
    }
    openProfileByEmail(me.email);
}

function openNavMenuFromTab() {
    document.querySelectorAll('.bottom-nav-item').forEach((btn) => btn.classList.remove('active'));
    document.querySelector('.bottom-nav-item[data-tab="menu"]')?.classList.add('active');
    const menuModal = document.getElementById('nav-menu-modal');
    if (menuModal) menuModal.style.display = 'flex';
    closeChatSelectorModal();
    closeChatActionSheet();
    closeGroupActionSheet();
    syncOverlayUIState();
}

function closeNavMenuModal() {
    const menuModal = document.getElementById('nav-menu-modal');
    if (!menuModal) return;
    menuModal.style.display = 'none';
    syncOverlayUIState();
}

function openChatActionSheet() {
    if (!selectedChatUser) return;
    const sheet = document.getElementById('chat-action-sheet');
    if (!sheet) return;
    sheet.style.display = 'flex';
    syncOverlayUIState();
}

function closeChatActionSheet() {
    const sheet = document.getElementById('chat-action-sheet');
    if (!sheet) return;
    sheet.style.display = 'none';
    syncOverlayUIState();
}

function openGroupActionSheet() {
    const sheet = document.getElementById('group-action-sheet');
    if (!sheet) return;
    sheet.style.display = 'flex';
    syncOverlayUIState();
}

function closeGroupActionSheet() {
    const sheet = document.getElementById('group-action-sheet');
    if (!sheet) return;
    sheet.style.display = 'none';
    syncOverlayUIState();
}

function searchCurrentPrivateChat() {
    closeChatActionSheet();
    if (!selectedChatUser?.email) return;
    const keyword = prompt('Nhập từ khóa cần tìm trong cuộc trò chuyện riêng:') || '';
    privateSearchKeyword = keyword.trim();
    loadPrivateMessages();
}

function searchGroupChatFromMenu() {
    closeGroupActionSheet();
    const keyword = prompt('Nhập từ khóa cần tìm trong chat chung:') || '';
    groupSearchKeyword = keyword.trim();
    initGroupChat();
}

function changeGroupAvatar() {
    closeGroupActionSheet();
    const link = prompt('Dán link ảnh nhóm mới (https://...) hoặc để trống để hủy:') || '';
    const next = link.trim();
    if (!next) return;
    localStorage.setItem(GROUP_CHAT_AVATAR_KEY, next);
    updateGroupChatHeaderAvatar();
}

function updateGroupChatHeaderAvatar() {
    const avatar = document.getElementById('group-chat-avatar');
    if (!avatar) return;
    avatar.src = localStorage.getItem(GROUP_CHAT_AVATAR_KEY) || buildAvatarUrl('Nhóm lớp');
}

function toggleMuteGroupChat() {
    const key = 'mute_group_chat';
    const muted = localStorage.getItem(key) === '1';
    localStorage.setItem(key, muted ? '0' : '1');
    closeGroupActionSheet();
    showSystemToast(muted ? 'Đã bật lại thông báo nhóm.' : 'Đã tắt thông báo nhóm.', { icon: '🔔', title: 'Thông báo nhóm' });
}

function viewChatTargetProfile() {
    if (!selectedChatUser?.email) return;
    closeChatActionSheet();
    openProfileByEmail(selectedChatUser.email);
}

function toggleChatThemeAccent() {
    document.body.classList.toggle('chat-accent-alt');
    closeChatActionSheet();
}

function showSharedMediaStub() {
    closeChatActionSheet();
    showSystemToast('Tính năng Ảnh & File đã gửi sẽ hiển thị ở bản cập nhật kế tiếp.', { icon: 'ℹ️', title: 'Sắp ra mắt' });
}

function toggleMutePrivateChat() {
    if (!selectedChatUser?.email) return;
    const key = `mute_private_${selectedChatUser.email.toLowerCase()}`;
    const currentlyMuted = localStorage.getItem(key) === '1';
    localStorage.setItem(key, currentlyMuted ? '0' : '1');
    closeChatActionSheet();
    showSystemToast(currentlyMuted ? 'Đã bật lại thông báo cuộc trò chuyện này.' : 'Đã tắt thông báo cuộc trò chuyện này.', { icon: '🔔', title: 'Thông báo chat riêng' });
}

function closeChatSelectorModal() {
    const chooser = document.getElementById('chat-selector-modal');
    if (!chooser) return;
    chooser.style.display = 'none';
    syncOverlayUIState();
}

function openChatFromTab() {
    document.querySelectorAll('.bottom-nav-item').forEach((btn) => btn.classList.remove('active'));
    document.querySelector('.bottom-nav-item[data-tab="chat"]')?.classList.add('active');
    closeChatSelectorModal();
    closeChatActionSheet();
    closeGroupActionSheet();
    closeTopQuickMenu();
    document.getElementById('group-chat-panel')?.classList.remove('show');
    const panel = document.getElementById('chat-panel');
    panel?.classList.add('show');
    panel?.classList.remove('in-conversation');
    selectedChatUser = null;
    updatePrivateChatHeader();
    teardownChatRealtimeListeners();
    syncOverlayUIState();
}

function openGroupChatFromTab() {
    document.querySelectorAll('.bottom-nav-item').forEach((btn) => btn.classList.remove('active'));
    document.querySelector('.bottom-nav-item[data-tab="chat"]')?.classList.add('active');
    closeChatSelectorModal();
    closeChatActionSheet();
    closeGroupActionSheet();
    closeTopQuickMenu();
    document.getElementById('chat-panel')?.classList.remove('show');
    document.getElementById('group-chat-panel')?.classList.add('show');
    teardownChatRealtimeListeners();
    initGroupChat();
    markGroupChatAsRead();
    syncOverlayUIState();
}

function hasUntrustedLink(text = '') {
    const raw = String(text || '').trim();
    const links = raw.match(/https?:\/\/[^\s]+/gi) || [];
    if (!links.length) return false;
    return links.some((link) => {
        try {
            const host = new URL(link).hostname.toLowerCase();
            return !TRUSTED_LINK_HOSTS.some((trusted) => host === trusted || host.endsWith(`.${trusted}`));
        } catch (_) {
            return true;
        }
    });
}

function formatChatBodyHtml(text = '') {
    const safe = escapeHtml(String(text || ''));
    return safe.replace(/(^|\s)@([^\s@]{2,24})/g, '$1<span class="mention-chip">@$2</span>');
}

function renderReplySnippet(replyTo) {
    if (!replyTo?.text) return '';
    const sender = escapeHtml(replyTo.senderName || 'Thành viên');
    const msg = escapeHtml(String(replyTo.text || '').slice(0, 90));
    return `<div class="chat-reply-snippet">↪ ${sender}: ${msg}</div>`;
}

function getIntroSeenMap() {
    try {
        const raw = localStorage.getItem(INTRO_SEEN_AT_KEY) || '{}';
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (_) {
        return {};
    }
}

function setIntroSeenAtForUser(email, seenAt = Date.now()) {
    const key = String(email || '').toLowerCase();
    if (!key) return;
    const map = getIntroSeenMap();
    map[key] = Number(seenAt) || Date.now();
    localStorage.setItem(INTRO_SEEN_AT_KEY, JSON.stringify(map));
}

function shouldShowIntroForUser(email, settings) {
    if (!settings?.introEnabled) return false;
    const key = String(email || '').toLowerCase();
    if (!key) return true;
    const map = getIntroSeenMap();
    const lastSeenAt = Number(map[key] || 0);
    if (!lastSeenAt) return true;

    const repeatDays = Math.max(1, Number(settings.introRepeatDays || DEFAULT_INTRO_SETTINGS.introRepeatDays));
    const repeatMs = repeatDays * 24 * 60 * 60 * 1000;
    return (Date.now() - lastSeenAt) >= repeatMs;
}

function renderReplyPreview(elId, replyPayload) {
    const el = document.getElementById(elId);
    if (!el) return;
    if (!replyPayload) {
        el.style.display = 'none';
        el.innerHTML = '';
        return;
    }
    el.style.display = 'block';
    el.innerHTML = `Đang trả lời <strong>${escapeHtml(replyPayload.senderName || 'Thành viên')}</strong>: ${escapeHtml(String(replyPayload.text || '').slice(0, 90))} <button class="chat-message-action-btn" onclick="${elId.includes('group') ? 'clearGroupReply()' : 'clearPrivateReply()'}">Hủy</button>`;
}

function showTypingIndicator(elId, text = '') {
    const el = document.getElementById(elId);
    if (!el) return;
    if (!text) {
        el.style.display = 'none';
        el.textContent = '';
        return;
    }
    el.style.display = 'block';
    el.textContent = text;
}

function handleShortcutNavigation() {
    const shortcut = new URLSearchParams(window.location.search).get('shortcut');
    if (!shortcut) return;

    const scrollToEl = (el) => {
        if (!el) return;
        setTimeout(() => {
            el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 240);
    };

    if (shortcut === 'chat') {
        setTimeout(() => {
            document.getElementById('chat-panel')?.classList.add('show');
            const input = document.getElementById('chat-user-search');
            input?.focus();
        }, 260);
    } else if (shortcut === 'map') {
        switchMainTab('map');
        scrollToEl(document.getElementById('memory-map-section'));
    } else if (shortcut === 'capsule') {
        switchMainTab('capsule');
        scrollToEl(document.getElementById('time-capsule-section'));
    }
}

async function fetchIntroSettings() {
    try {
        const snap = await db.collection('siteSettings').doc(INTRO_SETTINGS_DOC).get();
        const data = snap.exists ? snap.data() || {} : {};
        return {
            introEnabled: data.introEnabled !== false,
            introTitle: String(data.introTitle || DEFAULT_INTRO_SETTINGS.introTitle),
            introDescription: String(data.introDescription || DEFAULT_INTRO_SETTINGS.introDescription),
            introVideoUrl: String(data.introVideoUrl || ''),
            introRepeatDays: Number(data.introRepeatDays || DEFAULT_INTRO_SETTINGS.introRepeatDays)
        };
    } catch (error) {
        console.warn('Không tải được intro settings, dùng mặc định:', error);
        return { ...DEFAULT_INTRO_SETTINGS };
    }
}

function extractGoogleDriveFileId(rawUrl = '') {
    const url = String(rawUrl || '').trim();
    if (!url) return '';
    const driveMatch = url.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/i)
        || url.match(/[?&]id=([a-zA-Z0-9_-]+)/i);
    return driveMatch?.[1] || '';
}

function resolveIntroMedia(rawUrl = '') {
    const url = String(rawUrl || '').trim();
    if (!url) return { kind: 'none', url: '' };

    const driveId = extractGoogleDriveFileId(url);
    if (driveId) {
        return {
            kind: 'drive',
            url: `https://drive.google.com/file/d/${driveId}/preview`
        };
    }

    return { kind: 'video', url };
}

async function startIntroExperienceAfterLogin() {
    const settings = await fetchIntroSettings();
    const me = getCurrentUser();
    const meEmail = String(me?.email || '').toLowerCase();
    if (!shouldShowIntroForUser(meEmail, settings)) {
        enterMainSite();
        return;
    }
    const passwordScreen = document.getElementById('password-screen');
    const mainContent = document.getElementById('main-content');
    const musicContainer = document.getElementById('music-container');
    const introOverlay = document.getElementById('intro-overlay');
    const introCard = introOverlay?.querySelector('[data-step="intro"]');
    const videoCard = introOverlay?.querySelector('[data-step="video"]');
    const titleEl = document.getElementById('intro-title');
    const descEl = document.getElementById('intro-description');
    const videoEl = document.getElementById('intro-video-player');
    const driveEl = document.getElementById('intro-drive-player');
    const emptyNoteEl = document.getElementById('intro-video-empty-note');
    const skeletonEl = document.getElementById('intro-media-skeleton');

    if (!introOverlay || !introCard || !videoCard || !titleEl || !descEl || !videoEl || !driveEl || !emptyNoteEl) {
        enterMainSite();
        return;
    }

    hasEnteredMainSite = false;
    if (passwordScreen) passwordScreen.style.display = 'none';
    if (mainContent) mainContent.style.display = 'none';
    if (musicContainer) musicContainer.style.display = 'none';

    titleEl.textContent = settings.introTitle;
    descEl.textContent = settings.introDescription;
    introCard.style.display = 'block';
    videoCard.style.display = 'none';
    introOverlay.style.display = 'flex';
    introOverlay.classList.remove('is-visible');
    introCard.classList.remove('is-active');
    videoCard.classList.remove('is-active');
    requestAnimationFrame(() => {
        introOverlay.classList.add('is-visible');
        introCard.classList.add('is-active');
    });

    const media = resolveIntroMedia(settings.introVideoUrl);
    if (media.kind === 'video' || media.kind === 'drive') {
        // Chỉ hiển thị placeholder, chưa nạp media ngay để tránh kéo LCP trên mobile.
        if (skeletonEl) skeletonEl.style.display = 'none';
        videoEl.pause();
        videoEl.removeAttribute('src');
        videoEl.preload = 'none';
        videoEl.load();
        videoEl.style.display = media.kind === 'video' ? 'block' : 'none';
        driveEl.src = '';
        driveEl.style.display = media.kind === 'drive' ? 'block' : 'none';
        emptyNoteEl.style.display = 'none';
    } else {
        if (skeletonEl) skeletonEl.style.display = 'none';
        driveEl.src = '';
        driveEl.style.display = 'none';
        videoEl.removeAttribute('src');
        videoEl.load();
        videoEl.style.display = 'none';
        emptyNoteEl.style.display = 'block';
    }

    document.body.style.overflow = 'hidden';
    window.__introSettings = settings;
}

function goToIntroVideoStep() {
    const introOverlay = document.getElementById('intro-overlay');
    const introCard = introOverlay?.querySelector('[data-step="intro"]');
    const videoCard = introOverlay?.querySelector('[data-step="video"]');
    const videoEl = document.getElementById('intro-video-player');
    const driveEl = document.getElementById('intro-drive-player');
    const skeletonEl = document.getElementById('intro-media-skeleton');
    const emptyNoteEl = document.getElementById('intro-video-empty-note');
    if (!introOverlay || !introCard || !videoCard) return;

    introCard.classList.remove('is-active');
    setTimeout(() => {
        introCard.style.display = 'none';
        videoCard.style.display = 'block';
        requestAnimationFrame(() => videoCard.classList.add('is-active'));
    }, 180);

    const media = resolveIntroMedia(window.__introSettings?.introVideoUrl || '');
    if (media.kind === 'video' && videoEl) {
        if (skeletonEl) skeletonEl.style.display = 'block';
        videoEl.preload = 'metadata';
        videoEl.onloadeddata = () => {
            if (skeletonEl) skeletonEl.style.display = 'none';
        };
        videoEl.onerror = () => {
            if (skeletonEl) skeletonEl.style.display = 'none';
        };
        if (videoEl.src !== media.url) {
            videoEl.src = media.url;
            videoEl.load();
        }
        videoEl.style.display = 'block';
        if (driveEl) {
            driveEl.src = '';
            driveEl.style.display = 'none';
        }
        if (emptyNoteEl) emptyNoteEl.style.display = 'none';
    } else if (media.kind === 'drive' && driveEl) {
        if (skeletonEl) skeletonEl.style.display = 'block';
        driveEl.onload = () => {
            if (skeletonEl) skeletonEl.style.display = 'none';
        };
        driveEl.src = media.url;
        driveEl.style.display = 'block';
        if (videoEl) {
            videoEl.pause();
            videoEl.removeAttribute('src');
            videoEl.load();
            videoEl.style.display = 'none';
        }
        if (emptyNoteEl) emptyNoteEl.style.display = 'none';
    } else if (emptyNoteEl) {
        if (skeletonEl) skeletonEl.style.display = 'none';
        emptyNoteEl.style.display = 'block';
    }

    if (videoEl?.src && videoEl.style.display !== 'none') {
        videoEl.currentTime = 0;
        videoEl.play().catch(() => {});
    }
    if (driveEl && driveEl.style.display !== 'none') {
        driveEl.focus();
    }
}

function finishIntroExperience() {
    const introOverlay = document.getElementById('intro-overlay');
    const videoEl = document.getElementById('intro-video-player');
    const driveEl = document.getElementById('intro-drive-player');
    if (videoEl) {
        videoEl.pause();
    }
    if (driveEl) {
        driveEl.src = '';
    }
    if (introOverlay) {
        introOverlay.classList.remove('is-visible');
        introOverlay.querySelectorAll('.intro-card').forEach((card) => card.classList.remove('is-active'));
        setTimeout(() => {
            introOverlay.style.display = 'none';
        }, 220);
    }
    document.body.style.overflow = '';
    const me = getCurrentUser();
    setIntroSeenAtForUser(me?.email || '');
    enterMainSite();
}

function openDeleteAccountDialog() {
    const me = getCurrentUser();
    if (!me?.email) {
        showSystemToast('Bạn cần đăng nhập để xóa tài khoản.', { icon: '🔒', title: 'Chưa đăng nhập' });
        return;
    }
    const modal = document.getElementById('delete-account-modal');
    const input = document.getElementById('delete-account-password');
    if (!modal || !input) return;
    input.value = '';
    modal.style.display = 'flex';
    syncOverlayUIState();
    setTimeout(() => input.focus(), 50);
}

function closeDeleteAccountDialog() {
    const modal = document.getElementById('delete-account-modal');
    const input = document.getElementById('delete-account-password');
    if (input) input.value = '';
    if (modal) modal.style.display = 'none';
    syncOverlayUIState();
}

async function deleteDocsByQuery(query, batchSize = 200) {
    if (!query) return 0;
    let total = 0;
    while (true) {
        const snap = await query.limit(batchSize).get().catch(() => null);
        if (!snap || snap.empty) break;
        const batch = db.batch();
        snap.docs.forEach((doc) => batch.delete(doc.ref));
        await batch.commit();
        total += snap.size;
        if (snap.size < batchSize) break;
    }
    return total;
}

async function deletePostSubcollections(postRef) {
    const subcollections = ['comments', 'reactions'];
    for (const name of subcollections) {
        const subSnap = await postRef.collection(name).limit(400).get().catch(() => null);
        if (!subSnap || subSnap.empty) continue;
        const batch = db.batch();
        subSnap.forEach((doc) => batch.delete(doc.ref));
        await batch.commit().catch(() => {});
    }
}

async function purgeUserRelatedData(userEmail) {
    const email = String(userEmail || '').toLowerCase();
    if (!email) return;

    const postSnap = await db.collection('posts').where('email', '==', email).get().catch(() => null);
    if (postSnap && !postSnap.empty) {
        for (const postDoc of postSnap.docs) {
            await deletePostSubcollections(postDoc.ref);
        }
        const batch = db.batch();
        postSnap.forEach((doc) => batch.delete(doc.ref));
        await batch.commit();
    }

    await deleteDocsByQuery(db.collection('stories').where('userEmail', '==', email), 150);
    await deleteDocsByQuery(db.collectionGroup('tin_nhan').where('senderEmail', '==', email), 200);
    await deleteDocsByQuery(db.collection('notifications').where('targetEmail', '==', email), 200);
    await deleteDocsByQuery(db.collection('notifications').where('actorEmail', '==', email), 200);
    await deleteDocsByQuery(db.collection('users').where('email', '==', email), 50);
}

async function submitDeleteAccount() {
    const me = getCurrentUser();
    const authUser = auth.currentUser;
    const password = (document.getElementById('delete-account-password')?.value || '').trim();
    if (!me?.email || !authUser) {
        showSystemToast('Phiên đăng nhập đã hết. Vui lòng đăng nhập lại.', { icon: '⚠️', title: 'Không thể xóa' });
        closeDeleteAccountDialog();
        return;
    }
    if (!password) {
        showSystemToast('Vui lòng nhập mật khẩu hiện tại để xác nhận.', { icon: '⚠️', title: 'Thiếu mật khẩu' });
        return;
    }

    try {
        const credential = firebase.auth.EmailAuthProvider.credential(me.email.toLowerCase(), password);
        await authUser.reauthenticateWithCredential(credential);
        await purgeUserRelatedData(me.email);
        await authUser.delete();
        closeDeleteAccountDialog();
        showSystemToast('Tài khoản đã được xóa thành công.', { icon: '✅', title: 'Đã xóa tài khoản' });
        await logoutUser();
    } catch (error) {
        console.error('Lỗi xóa tài khoản:', error);
        showSystemToast(mapFirebaseAuthError(error), { icon: '⚠️', title: 'Không thể xóa tài khoản' });
    }
}

async function logoutUser() {
    await updateMyPresence().catch(() => {});
    stopPresenceTracking();
    clearAllListeners();
    destroyAllTilts();
    if (countdownIntervalId) {
        clearInterval(countdownIntervalId);
        countdownIntervalId = null;
    }
    if (letterCountdownInterval) {
        clearInterval(letterCountdownInterval);
        letterCountdownInterval = null;
    }
    const current = getCurrentUser();
    if (current?.email) {
        try {
            const snap = await db.collection('users').where('email', '==', current.email).limit(1).get();
            if (!snap.empty) {
                await db.collection('users').doc(snap.docs[0].id).update({ isOnline: false, lastActiveAt: Date.now() });
            }
        } catch (e) {}
    }
    await auth.signOut().catch(() => {});
    hasEnteredMainSite = false;
    setCurrentUser(null);
    if (pushNudgeTimer) {
        clearTimeout(pushNudgeTimer);
        pushNudgeTimer = null;
    }
    updatePushButtonState(false);
    document.getElementById('main-content').style.display = 'none';
    document.getElementById('password-screen').style.display = 'flex';
    if (audio) {
        audio.pause();
        syncMusicUI(false);
    }
    showAuthMessage('Bạn đã đăng xuất.', false);
    switchAuthTab('login');
    closeTopQuickMenu();
    document.body.classList.remove('ui-overlay-active', 'lightbox-open');
}

// 2. Hàm Tải Ảnh từ Firebase (Quan trọng nhất)
let currentYearFilter = 'all';
const GALLERY_PAGE_SIZE = 10;
let galleryLastVisibleDoc = null;
let galleryHasMore = false;
let isGalleryLoading = false;

// 1. Danh sách nhạc
const playlist = [
    { name: "Nụ cười 18 20", url: "https://www.dropbox.com/scl/fi/x9ecysqp7f524j5viynqp/nhac_nen.mp3?rlkey=bm731mxowol5lb03z94dzi1bt&st=bbswnyv7&raw=1" },
    { name: "Mình cùng nhau đóng băng", url: "https://www.dropbox.com/scl/fi/cjnpiialmlipbm6thf6se/M-nh-C-ng-Nhau-ng-B-ng-Th-y-Chi-FPT-Polytechnic-TH-Y-CHI-OFFICIAL-youtube.mp3?rlkey=xumdtk05j58w5kmrlj59fnhmn&st=8a7bju1w&raw=1" },
    { name: "Tháng 5 không trở lại", url: "https://www.dropbox.com/scl/fi/5j58xxq4mesripdpc8nv7/Th-ng-5-kh-ng-tr-l-i..-Tom-HiddleTom-youtube.mp3?rlkey=4sjno87kko61ogi8fwseak7t7&st=04ih5dk7&raw=1" },
    { name: "Người gieo mầm xanh", url: "https://www.dropbox.com/scl/fi/o0mlxit7ff4nh4u1msprh/NG-I-GIEO-M-M-XANH-H-A-KIM-TUY-N-x-HO-NG-D-NG-OFFICIAL-MV-H-a-Kim-Tuy-n-youtube.mp3?rlkey=3ouz5ydq09ad2p87lqn851kqq&st=vsraqvur&raw=1" }
];
let currentSongIndex = 0;
const audio = document.getElementById('bg-music');

function syncMusicUI(isPlaying) {
    const playPauseIcon = document.getElementById('play-pause-icon');
    const musicIcon = document.getElementById('music-icon');
    if (playPauseIcon) {
        playPauseIcon.className = isPlaying ? 'fas fa-pause' : 'fas fa-play';
    }
    if (musicIcon) {
        musicIcon.classList.toggle('rotating', isPlaying);
    }
}


let shouldResumeMusicOnGesture = false;

function requestMusicResumeOnGesture() {
    if (shouldResumeMusicOnGesture) return;
    shouldResumeMusicOnGesture = true;

    const resume = () => {
        if (!audio) return;
        audio.play().then(() => {
            shouldResumeMusicOnGesture = false;
            document.removeEventListener('click', resume, true);
            document.removeEventListener('touchstart', resume, true);
        }).catch(() => {});
    };

    document.addEventListener('click', resume, true);
    document.addEventListener('touchstart', resume, true);
}

if (audio) {
    audio.loop = false;
    audio.removeEventListener('ended', changeMusic);
    audio.addEventListener('ended', changeMusic);
    audio.addEventListener('play', () => syncMusicUI(true));
    audio.addEventListener('pause', () => syncMusicUI(false));
}

// 2. Hàm mở Menu nhạc
function toggleMusicMenu() {
    const btn = document.getElementById('main-music-btn');
    const options = document.getElementById('music-options');
    const panel = document.getElementById('playlist-panel'); // Lấy thêm bảng danh sách

    btn.classList.toggle('active');
    options.classList.toggle('show');

    // NẾU menu chính đóng lại (không còn class active)
    if (!btn.classList.contains('active')) {
        // Thì ẩn luôn bảng danh sách nhạc nếu nó đang mở
        if (panel) panel.style.display = 'none';
    }
}

// Hàm hiển thị thông báo bài hát
function showMusicToast(songName) {
    const toast = document.getElementById('music-toast');
    toast.innerHTML = `🎵 Đang phát: ${songName}`;
    toast.classList.add('show');

    // Tự động ẩn sau 3 giây
    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

// 3. Hàm ẩn hiện danh sách bài hát
function togglePlaylistMenu() {
    const panel = document.getElementById('playlist-panel');
    panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    if(panel.style.display === 'block') renderPlaylist();
}

function renderPlaylist() {
    const listUI = document.getElementById('song-list');
    listUI.innerHTML = playlist.map((song, i) => 
        `<li onclick="playSong(${i})">${i === currentSongIndex ? '▶ ' : ''}${song.name}</li>`
    ).join('');
}

function playSong(index, options = {}) {
    if (!audio || !playlist[index]) return;

    const { showToast = true, fromLogin = false } = options;
    currentSongIndex = index;

    const nextUrl = playlist[index].url;
    if (audio.src !== nextUrl) {
        audio.pause();
        audio.src = nextUrl;
        audio.load();
    } else {
        audio.currentTime = 0;
    }

    audio.play().then(() => {
        if (showToast) showMusicToast(playlist[index].name);
    }).catch((e) => {
        console.log('Nhạc bị chặn:', e);
        if (fromLogin) requestMusicResumeOnGesture();
    });

    renderPlaylist();
}

function toggleMusic() {
    if (!audio) return;

    if (!audio.src) {
        playSong(currentSongIndex);
        return;
    }

    if (audio.paused) {
        audio.play().catch((e) => console.log('Nhạc bị chặn:', e));
    } else {
        audio.pause();
    }
}

function pauseMusicForBackground({ reset = false } = {}) {
    if (!audio) return;
    const wasPlaying = !audio.paused;

    audio.pause();
    if (reset) audio.currentTime = 0;
    if (wasPlaying || reset) syncMusicUI(false);
}

function changeMusic() {
    currentSongIndex = (currentSongIndex + 1) % playlist.length;
    playSong(currentSongIndex);
}

function filterByYear(year) {
    currentYearFilter = year;
    // Cập nhật giao diện nút bấm
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.classList.remove('active');
        if(btn.innerText.includes(year) || (year === 'all' && btn.innerText === 'Tất cả')) {
            btn.classList.add('active');
        }
    });
    loadGallery(true); // Tải lại ảnh theo năm đã chọn
}

function renderGalleryStatus(html) {
    const gallery = document.getElementById('galleryGrid');
    if (!gallery) return;

    gallery.classList.add('gallery-has-status');
    gallery.innerHTML = `<div class="gallery-status-card">${html}</div>`;
}

function renderGallerySkeleton() {
    const skeletonItems = Array.from({ length: 6 }, () => '<div class="gallery-skeleton-item"></div>').join('');
    renderGalleryStatus(`<strong>Đang tải bảng tin...</strong><div class="gallery-skeleton-grid">${skeletonItems}</div>`);
}

function renderGalleryEmptyState() {
    renderGalleryStatus('<strong>Chưa có ảnh/video nào trong bộ lọc này.</strong><span>Thử chuyển năm khác hoặc đăng bài mới để làm đầy kỷ niệm nhé.</span>');
}

function renderGalleryErrorState(error) {
    console.error('Không tải được gallery:', error);
    renderGalleryStatus('<strong>Tải gallery thất bại.</strong><span>Mạng có thể đang chậm hoặc mất kết nối.</span><br><button type="button" onclick="retryGalleryLoad()">Thử tải lại</button>');
}

function retryGalleryLoad() {
    loadGallery(true);
}

function toggleGalleryLoadMoreButton(visible) {
    const btn = document.getElementById('gallery-load-more-btn');
    const spinner = document.getElementById('gallery-load-more-spinner');
    if (!btn) return;
    btn.style.display = visible ? 'inline-flex' : 'none';
    btn.disabled = false;
    btn.textContent = 'Xem thêm';
    if (spinner) spinner.style.display = 'none';
}

function showGalleryLoadMoreExhausted() {
    const btn = document.getElementById('gallery-load-more-btn');
    const spinner = document.getElementById('gallery-load-more-spinner');
    if (!btn) return;
    btn.style.display = 'inline-flex';
    btn.disabled = true;
    btn.textContent = 'Đã hết';
    btn.classList.add('btn-loading');
    if (spinner) spinner.style.display = 'none';
}

function serializeGalleryDoc(docLike) {
    const raw = typeof docLike?.data === 'function' ? (docLike.data() || {}) : (docLike?.data || {});
    return {
        id: String(docLike?.id || ''),
        data: {
            ...raw,
            createdAt: Number(raw.createdAt || 0),
            takenAt: Number(raw.takenAt || 0)
        }
    };
}

function createGalleryCard(docLike) {
    const data = typeof docLike?.data === 'function' ? (docLike.data() || {}) : (docLike?.data || {});
    const docId = docLike?.id || '';
    const fileUrl = data.url || "";
    const thumbnailUrl = data.thumbnailUrl || fileUrl;
    const isVideo = fileUrl.toLowerCase().includes('.mp4')
        || fileUrl.toLowerCase().includes('video/upload')
        || fileUrl.toLowerCase().includes('cloudinary');

    galleryMediaItems.push({
        url: fileUrl,
        isVideo,
        postId: docId
    });

    let mediaHtml = "";
    if (isVideo) {
        const posterUrl = fileUrl.replace("/upload/", "/upload/so_0/").replace(/\.[^/.]+$/, ".jpg");
        mediaHtml = `
        <div class="video-preview-container" onclick="openLightboxByIndex(-1, this)">
            <video 
                data-src="${fileUrl}" 
                data-poster="${posterUrl}"
                preload="metadata" 
                playsinline
                muted
                loop>
                style="width:100%; height:250px; object-fit: cover; border-radius: 8px;">
            </video>
            <div class="play-button-overlay">▶</div>
        </div>`;
    } else {
        mediaHtml = `<img data-src="${thumbnailUrl}" data-full-src="${fileUrl}" onclick="openLightboxByIndex(-1, this)" loading="lazy" decoding="async" fetchpriority="low" alt="Kỷ niệm">`;
    }

    const heartUsers = data.heartUsers || [];
    const hahaUsers = data.hahaUsers || [];
    const comments = data.comments || [];
    const postOwner = escapeHtml(data.user || data.userName || data.email || 'Thành viên lớp');
    const takenAt = Number(data.takenAt || parseFirestoreTimestampToMillis(data.createdAt));
    const takenAtLabel = takenAt ? new Date(takenAt).toLocaleDateString('vi-VN') : '';
    const locationLabel = escapeHtml(data.locationName || data.locationAddress || 'Chưa gắn địa điểm');
    const tagLabel = escapeHtml(`${data.year || ''}${data.semester ? ` • ${data.semester}` : ''}`.trim() || 'Kỷ niệm lớp');
    const commentHtml = comments.map(c => {
        const avatar = c.avatar || buildAvatarUrl(c.user || 'Thành viên');
        return `
            <div class="each-comment">
                <img class="comment-avatar" src="${avatar}" alt="avatar">
                <div class="comment-text"><b>${c.user}:</b> ${c.text}</div>
            </div>
        `;
    }).join('');

    const heartListHtml = heartUsers.length > 0 ? heartUsers.join("<br>") : "Chưa có ai thả tim";
    const hahaListHtml = hahaUsers.length > 0 ? hahaUsers.join("<br>") : "Chưa có ai haha";

    const card = document.createElement('div');
    card.className = 'card';
    card.setAttribute('data-aos', 'fade-up');
    card.setAttribute('data-post-id', docId);
    card.id = `post-${docId}`;
    card.innerHTML = `
        <div class="media-wrap">
            ${mediaHtml}
        </div>
        <div class="comment-area">
            <p class="post-meta">👤 ${postOwner} • 🗓️ ${takenAtLabel || 'Không rõ ngày'} • 📍 ${locationLabel}</p>
            <p class="post-tag">#${tagLabel.replace(/\s+/g, '-')}</p>
            <div class="reactions">
                <button class="react-btn" onclick="handleReact('${docId}', 'hearts', this)">
                    ❤️ <span class="count">${heartUsers.length}</span>
                    <span class="tooltip-list">${heartListHtml}</span>
                </button>
                <button class="react-btn" onclick="handleReact('${docId}', 'hahas', this)">
                    😆 <span class="count">${hahaUsers.length}</span>
                    <span class="tooltip-list">${hahaListHtml}</span>
                </button>
            </div>
            <p><strong>Kỷ niệm:</strong> ${data.caption || "Không có chú thích"}</p>

            <div class="comment-list" id="comments-${docId}">
                ${commentHtml}
            </div>

            <div class="comment-input-group">
                <input type="text" placeholder="Viết bình luận..." id="input-${docId}" onkeypress="checkCommentEnter(event, '${docId}')">
                <button onclick="addComment('${docId}')">Gửi</button>
            </div>
        </div>
    `;

    const shouldEnableTilt = window.matchMedia?.('(pointer:fine)')?.matches;
    if (shouldEnableTilt && window.VanillaTilt) {
        VanillaTilt.init(card, {
            max: 15,
            speed: 400,
            glare: true,
            "max-glare": 0.5,
            gyroscope: true,
            scale: 1.05
        });
        if (card.vanillaTilt) {
            tiltInstances.push(card.vanillaTilt);
        }
    }

    if (pendingScrollPostId && pendingScrollPostId === docId) {
        setTimeout(() => focusGalleryPost(docId), 150);
        pendingScrollPostId = null;
    }

    observeGalleryCard(card);
    return card;
}

async function loadGallery(reset = true) {
    const gallery = document.getElementById('galleryGrid');
    if (!gallery) return;

    setListener('gallery', null);
    galleryUnsubscribe = null;
    const loadMoreBtn = document.getElementById('gallery-load-more-btn');
    const loadMoreSpinner = document.getElementById('gallery-load-more-spinner');
    const yearCacheKey = String(currentYearFilter || 'all');
    if (isGalleryLoading) return;
    isGalleryLoading = true;
    if (!reset && loadMoreBtn) {
        loadMoreBtn.disabled = true;
        loadMoreBtn.textContent = 'Đang tải';
        if (loadMoreSpinner) loadMoreSpinner.style.display = 'inline-block';
    }

    if (reset) {
        galleryLastVisibleDoc = null;
        galleryHasMore = false;
        galleryMediaItems = [];
        renderGallerySkeleton();
        toggleGalleryLoadMoreButton(false);
        destroyGalleryObservers();
        attachGalleryVirtualization();
        const cachedPayload = await readGalleryCacheByYear(yearCacheKey);
        if (cachedPayload?.items?.length) {
            gallery.classList.remove('gallery-has-status');
            gallery.innerHTML = '';
            destroyAllTilts();
            cachedPayload.items.forEach((item) => gallery.appendChild(createGalleryCard(item)));
            galleryHasMore = !!cachedPayload.hasMore;
            toggleGalleryLoadMoreButton(galleryHasMore);
            galleryLastVisibleDoc = cachedPayload.cursorCreatedAt
                ? { __cachedCursor: true, createdAt: cachedPayload.cursorCreatedAt }
                : null;
        }
    }
    // Dọn sạch toàn bộ instance tilt cũ trước khi render lại để tránh rò rỉ bộ nhớ/sự kiện.
    if (reset) destroyAllTilts();

    let query = db.collection("posts").orderBy("createdAt", "desc");
    if (currentYearFilter !== 'all') {
        query = query.where("year", "==", currentYearFilter);
    }
    if (!reset && galleryLastVisibleDoc) {
        if (galleryLastVisibleDoc.__cachedCursor) {
            query = query.startAfter(galleryLastVisibleDoc.createdAt);
        } else {
            query = query.startAfter(galleryLastVisibleDoc);
        }
    }

    try {
        const snapshot = await query.limit(GALLERY_PAGE_SIZE).get();
        if (reset) {
            gallery.classList.remove('gallery-has-status');
            gallery.innerHTML = "";
        }

        if (snapshot.empty && reset) {
            renderGalleryEmptyState();
            toggleGalleryLoadMoreButton(false);
            return;
        }

        const freshItems = [];
        snapshot.forEach((doc) => {
            gallery.appendChild(createGalleryCard(doc));
            freshItems.push(serializeGalleryDoc(doc));
        });
        pruneOffscreenGalleryCards();

        galleryLastVisibleDoc = snapshot.docs.length ? snapshot.docs[snapshot.docs.length - 1] : galleryLastVisibleDoc;
        galleryHasMore = snapshot.docs.length === GALLERY_PAGE_SIZE;
        if (galleryHasMore) {
            toggleGalleryLoadMoreButton(true);
        } else {
            showGalleryLoadMoreExhausted();
        }
        if (reset || snapshot.docs.length) {
            const previousItems = reset ? [] : ((await readGalleryCacheByYear(yearCacheKey))?.items || []);
            const items = reset ? freshItems : [...previousItems, ...freshItems];
            await writeGalleryCacheByYear(yearCacheKey, {
                items,
                hasMore: galleryHasMore,
                cursorCreatedAt: Number(galleryLastVisibleDoc?.data?.()?.createdAt || galleryLastVisibleDoc?.createdAt || 0)
            });
        }
    } catch (error) {
        renderGalleryErrorState(error);
        showSystemToast('Tải thêm gallery thất bại, vui lòng thử lại.', { icon: '⚠️', title: 'Lỗi tải dữ liệu' });
        if (loadMoreBtn) {
            loadMoreBtn.style.display = 'inline-flex';
            loadMoreBtn.disabled = false;
            loadMoreBtn.textContent = 'Thử lại';
        }
    } finally {
        isGalleryLoading = false;
        if (loadMoreBtn) {
            loadMoreBtn.disabled = false;
            if (galleryHasMore) loadMoreBtn.textContent = 'Xem thêm';
        }
        if (loadMoreSpinner) loadMoreSpinner.style.display = 'none';
    }
}

function loadMoreGallery() {
    if (!galleryHasMore || isGalleryLoading) return;
    loadGallery(false);
}

window.openMemorySpotModal = openMemorySpotModal;
window.closeMemorySpotModal = closeMemorySpotModal;
window.focusGalleryPost = focusGalleryPost;
window.sendGroupMessage = sendGroupMessage;
window.toggleGroupChatPanel = toggleGroupChatPanel;
window.toggleGroupEmojiPicker = toggleGroupEmojiPicker;
window.switchMainTab = switchMainTab;
window.openChatSelectorFromTab = openChatSelectorFromTab;
window.closeChatSelectorModal = closeChatSelectorModal;
window.openNavMenuFromTab = openNavMenuFromTab;
window.openOwnProfilePage = openOwnProfilePage;
window.openProfileByEmail = openProfileByEmail;
window.closeNavMenuModal = closeNavMenuModal;
window.openChatActionSheet = openChatActionSheet;
window.closeChatActionSheet = closeChatActionSheet;
window.openGroupActionSheet = openGroupActionSheet;
window.closeGroupActionSheet = closeGroupActionSheet;
window.searchCurrentPrivateChat = searchCurrentPrivateChat;
window.searchGroupChatFromMenu = searchGroupChatFromMenu;
window.changeGroupAvatar = changeGroupAvatar;
window.toggleMuteGroupChat = toggleMuteGroupChat;
window.closeGroupChatPanelToSelector = closeGroupChatPanelToSelector;
window.viewChatTargetProfile = viewChatTargetProfile;
window.toggleChatThemeAccent = toggleChatThemeAccent;
window.showSharedMediaStub = showSharedMediaStub;
window.toggleMutePrivateChat = toggleMutePrivateChat;
window.openChatFromTab = openChatFromTab;
window.openGroupChatFromTab = openGroupChatFromTab;
window.replyToPrivateMessage = replyToPrivateMessage;
window.replyToGroupMessage = replyToGroupMessage;
window.clearPrivateReply = clearPrivateReply;
window.clearGroupReply = clearGroupReply;
window.togglePinPrivateMessage = togglePinPrivateMessage;
window.togglePinGroupMessage = togglePinGroupMessage;
window.revokePrivateMessage = revokePrivateMessage;
window.revokeGroupMessage = revokeGroupMessage;
window.triggerPrivateImagePicker = triggerPrivateImagePicker;
window.triggerGroupImagePicker = triggerGroupImagePicker;
window.openLightboxByIndex = openLightboxByIndex;
window.changeZoom = changeZoom;
window.doRotate = doRotate;
window.closeLightbox = closeLightbox;
window.showInstallGuide = showInstallGuide;
window.toggleTopQuickMenu = toggleTopQuickMenu;
window.showAccountDataSummary = showAccountDataSummary;
window.openForgotPasswordDialog = openForgotPasswordDialog;
window.closeForgotPasswordDialog = closeForgotPasswordDialog;
window.submitForgotPassword = submitForgotPassword;
window.openChangePasswordDialog = openChangePasswordDialog;
window.closeChangePasswordDialog = closeChangePasswordDialog;
window.submitChangePassword = submitChangePassword;
window.openDeleteAccountDialog = openDeleteAccountDialog;
window.closeDeleteAccountDialog = closeDeleteAccountDialog;
window.submitDeleteAccount = submitDeleteAccount;
window.retryGalleryLoad = retryGalleryLoad;
window.loadMoreGallery = loadMoreGallery;
window.migrateLegacyUserPasswords = migrateLegacyUserPasswords;
window.toggleNotificationCenter = toggleNotificationCenter;
window.openNotification = openNotification;
window.markAllNotificationsRead = markAllNotificationsRead;
window.openStoryComposer = openStoryComposer;
window.closeStoryComposerModal = closeStoryComposerModal;
window.submitStoryPost = submitStoryPost;
window.openStoryViewer = openStoryViewer;
window.openStoryViewersModal = openStoryViewersModal;
window.closeStoryViewersModal = closeStoryViewersModal;
window.deleteStory = deleteStory;
window.applyServiceWorkerUpdate = applyServiceWorkerUpdate;
window.triggerInstallPrompt = triggerInstallPrompt;
window.closeInstallGuide = closeInstallGuide;



async function createNotification(targetEmail, type, message, link = '', meta = {}) {
    const toEmail = String(targetEmail || '').trim().toLowerCase();
    if (!toEmail) return;

    const actor = getCurrentUser();
    const payload = {
        targetEmail: toEmail,
        type: String(type || 'general'),
        message: String(message || ''),
        link: String(link || ''),
        actorEmail: (actor?.email || '').toLowerCase(),
        actorName: actor?.name || actor?.email || 'Thành viên',
        actorAvatar: actor?.avatar || '',
        createdAt: Date.now(),
        read: false,
        ...meta
    };

    await db.collection('notifications').add(payload).catch(() => {});
    await queueNotificationEvent(`notify_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, {
        type: 'general_notification',
        title: 'Thông báo mới',
        body: payload.message,
        link: payload.link
    }).catch(() => {});
}

async function updateAppBadge(unreadCount = 0) {
    const count = Math.max(0, Number(unreadCount) || 0);
    try {
        if ('setAppBadge' in navigator) {
            if (count > 0) {
                await navigator.setAppBadge(count);
            } else if ('clearAppBadge' in navigator) {
                await navigator.clearAppBadge();
            } else {
                await navigator.setAppBadge(0);
            }
        }
    } catch (_) {}

    const baseTitle = 'Kỷ Niệm Lớp Chúng Mình';
    document.title = count > 0 ? `(${count}) ${baseTitle}` : baseTitle;
}

function renderNotificationCenter(items = []) {
    const list = document.getElementById('notification-list');
    const badge = document.getElementById('notification-badge');
    if (!list || !badge) return;

    notificationsUnreadCount = items.filter((it) => !it.read).length;
    badge.style.display = notificationsUnreadCount > 0 ? 'grid' : 'none';
    badge.textContent = notificationsUnreadCount > 99 ? '99+' : String(notificationsUnreadCount);
    updateAppBadge(notificationsUnreadCount);

    if (!items.length) {
        list.innerHTML = '<p class="members-empty">Chưa có thông báo mới.</p>';
        return;
    }

    list.innerHTML = items.map((item) => {
        const text = escapeHtml(item.message || 'Thông báo');
        const time = formatChatRecencyLabel(item.createdAt);
        return `<div class="notification-item ${item.read ? '' : 'unread'}" onclick="openNotification('${item.id}')">
            <strong>${text}</strong>
            <div style="font-size:12px;color:#6b7280;">${escapeHtml(time || 'vừa xong')}</div>
        </div>`;
    }).join('');
}

function toggleNotificationCenter() {
    const panel = document.getElementById('notification-center');
    if (!panel) return;
    panel.style.display = panel.style.display === 'none' || !panel.style.display ? 'block' : 'none';
}

async function openNotification(notificationId) {
    if (!notificationId) return;
    const ref = db.collection('notifications').doc(notificationId);
    const snap = await ref.get().catch(() => null);
    if (snap?.exists) {
        const data = snap.data() || {};
        await ref.set({ read: true }, { merge: true }).catch(() => {});
        if (data.link) {
            window.location.href = data.link;
        }
    }
}

async function markAllNotificationsRead() {
    const me = getCurrentUser();
    if (!me?.email) return;
    const snap = await db.collection('notifications')
        .where('targetEmail', '==', me.email.toLowerCase())
        .where('read', '==', false)
        .limit(120)
        .get()
        .catch(() => null);
    if (!snap || snap.empty) return;
    const batch = db.batch();
    snap.forEach((doc) => batch.set(doc.ref, { read: true }, { merge: true }));
    await batch.commit().catch(() => {});
}

function initNotificationCenter() {
    const me = getCurrentUser();
    if (!me?.email) return;
    setListener('notifications', null);
    notificationCenterUnsubscribe = null;

    notificationCenterUnsubscribe = db.collection('notifications')
        .where('targetEmail', '==', me.email.toLowerCase())
        .orderBy('createdAt', 'desc')
        .limit(40)
        .onSnapshot((snap) => {
            const items = snap.docs.map((doc) => ({ id: doc.id, ...(doc.data() || {}) }));
            renderNotificationCenter(items);
        }, () => {});
    setListener('notifications', notificationCenterUnsubscribe);
}

function openStoryComposer() {
    const me = getCurrentUser();
    if (!me?.email) {
        showSystemToast('Vui lòng đăng nhập để đăng story.', { icon: '🔒', title: 'Chưa đăng nhập' });
        return;
    }

    const modal = document.getElementById('story-composer-modal');
    const preview = document.getElementById('story-preview-box');
    const caption = document.getElementById('story-caption-input');
    const input = document.getElementById('story-media-input');
    if (!modal || !preview || !caption || !input) return;

    caption.value = '';
    input.value = '';
    preview.innerHTML = '<span>Chưa chọn ảnh/video</span>';
    modal.style.display = 'flex';
}

function closeStoryComposerModal() {
    const modal = document.getElementById('story-composer-modal');
    if (modal) modal.style.display = 'none';
}

function previewStoryMediaFile(file) {
    const preview = document.getElementById('story-preview-box');
    if (!preview || !file) return;
    const url = URL.createObjectURL(file);
    if (String(file.type || '').startsWith('video/')) {
        preview.innerHTML = `<video src="${url}" controls playsinline></video>`;
    } else {
        preview.innerHTML = `<img src="${url}" alt="story preview">`;
    }
}

async function uploadStoryFileToStorage(file) {
    if (!storage || !file) return '';
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
    const ref = storage.ref(`stories/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`);
    await ref.put(file);
    return ref.getDownloadURL();
}

async function submitStoryPost() {
    const me = getCurrentUser();
    if (!me?.email) return;

    const input = document.getElementById('story-media-input');
    const captionInput = document.getElementById('story-caption-input');
    const file = input?.files?.[0] || null;
    const caption = (captionInput?.value || '').trim();
    if (!file) {
        showSystemToast('Bạn cần chọn ảnh hoặc video để đăng story.', { icon: '⚠️', title: 'Thiếu dữ liệu' });
        return;
    }

    try {
        const mediaUrl = await uploadStoryFileToStorage(file);
        if (!mediaUrl) throw new Error('missing_story_media_url');

        const now = Date.now();
        await db.collection('stories').add({
            userEmail: me.email.toLowerCase(),
            userName: me.name || me.email,
            userAvatar: me.avatar || buildAvatarUrl(me.name || me.email),
            mediaUrl,
            caption,
            viewedBy: [],
            createdAt: now,
            expiresAt: now + (24 * 60 * 60 * 1000)
        });

        const usersSnap = await db.collection('users').get().catch(() => null);
        if (usersSnap) {
            const actorName = me.name || me.email;
            const tasks = [];
            usersSnap.forEach((doc) => {
                const u = doc.data() || {};
                const email = (u.email || '').toLowerCase();
                if (!email || email === me.email.toLowerCase()) return;
                tasks.push(createNotification(email, 'story', `${actorName} vừa đăng story mới`, `index.html?story=${encodeURIComponent(me.email.toLowerCase())}`));
            });
            await Promise.allSettled(tasks);
        }

        closeStoryComposerModal();
    } catch (error) {
        showSystemToast('Đăng story thất bại. Vui lòng thử lại.', { icon: '⚠️', title: 'Lỗi đăng story' });
    }
}


function openStoryViewer(mediaUrl, ownerName = 'Story', storyId = '') {
    if (!mediaUrl) return;
    markStoryViewed(storyId);
    const isVideo = /\.mp4|\.webm|video/i.test(String(mediaUrl || ''));
    openLightbox(String(mediaUrl || ''), isVideo);
}

async function markStoryViewed(storyId) {
    const me = getCurrentUser();
    if (!storyId || !me?.email) return;
    await db.collection('stories').doc(storyId).set({
        viewedBy: firebase.firestore.FieldValue.arrayUnion(me.email.toLowerCase())
    }, { merge: true }).catch(() => {});
}

async function openStoryViewersModal(storyId, ownerName = 'Story') {
    if (!storyId) return;
    const modal = document.getElementById('story-viewers-modal');
    const title = document.getElementById('story-viewers-title');
    const list = document.getElementById('story-viewers-list');
    if (!modal || !title || !list) return;
    title.textContent = `Người đã xem story của ${ownerName}`;
    list.innerHTML = '<p class="members-empty">Đang tải danh sách người xem...</p>';
    modal.style.display = 'flex';
    syncOverlayUIState();

    const snap = await db.collection('stories').doc(storyId).get().catch(() => null);
    const data = snap?.exists ? (snap.data() || {}) : {};
    const viewers = Array.isArray(data.viewedBy) ? data.viewedBy : [];
    if (!viewers.length) {
        list.innerHTML = '<p class="members-empty">Chưa có ai xem story này.</p>';
        return;
    }
    list.innerHTML = viewers.map((email) => `<div class="notification-item"><strong>${escapeHtml(email)}</strong></div>`).join('');
}

async function deleteStory(storyId) {
    const me = getCurrentUser();
    if (!storyId || !me?.email) return;
    if (!(await showConfirmModal('Xóa story này ngay bây giờ?'))) return;
    const ref = db.collection('stories').doc(storyId);
    const snap = await ref.get().catch(() => null);
    const data = snap?.exists ? (snap.data() || {}) : null;
    if (!data) return;
    const ownerEmail = String(data.userEmail || '').toLowerCase();
    if (ownerEmail !== me.email.toLowerCase()) {
        showSystemToast('Bạn chỉ có thể xóa story của chính mình.', { icon: '🔒', title: 'Không có quyền' });
        return;
    }
    await ref.delete().catch((error) => {
        console.warn('Không thể xóa story:', error);
        showSystemToast('Xóa story thất bại.', { icon: '⚠️', title: 'Lỗi story' });
    });
}

function closeStoryViewersModal() {
    const modal = document.getElementById('story-viewers-modal');
    if (!modal) return;
    modal.style.display = 'none';
    syncOverlayUIState();
}

function initStoriesStrip() {
    document.getElementById('story-media-input')?.addEventListener('change', (event) => {
        const file = event.target.files?.[0];
        if (file) previewStoryMediaFile(file);
    });
    setListener('stories', null);
    storiesUnsubscribe = null;

    const container = document.getElementById('story-items');
    if (!container) return;

    const now = Date.now();
    storiesUnsubscribe = db.collection('stories')
        .where('expiresAt', '>', now)
        .orderBy('expiresAt', 'asc')
        .onSnapshot((snap) => {
            const stories = snap.docs.map((doc) => ({ id: doc.id, ...(doc.data() || {}) }));
            if (!stories.length) {
                container.innerHTML = '<div class="story-empty">Chưa có story mới. Hãy tạo story đầu tiên của lớp nhé!</div>';
                return;
            }
            const meEmail = (getCurrentUser()?.email || '').toLowerCase();
            container.innerHTML = stories.map((story) => {
                const cover = escapeHtml(story.mediaUrl || buildAvatarUrl(story.userName || 'Story'));
                const name = escapeHtml((story.userName || 'Story').slice(0, 12));
                const cap = escapeHtml((story.caption || '').slice(0, 22));
                const ownerEmail = String(story.userEmail || '').toLowerCase();
                const viewCount = Array.isArray(story.viewedBy) ? story.viewedBy.length : 0;
                return `<button type="button" class="story-item" onclick="openStoryViewer('${cover}', '${name}', '${story.id}')">
                    <img src="${cover}" alt="story ${name}" loading="lazy" decoding="async" fetchpriority="low">
                    <b>${name}${cap ? `<br><span style=\"font-size:10px;font-weight:500;\">${cap}</span>` : ''}</b>
                    ${ownerEmail === meEmail ? `<span class="story-view-chip" onclick="event.stopPropagation();openStoryViewersModal('${story.id}','${name}')"><i class="fa-regular fa-eye"></i> ${viewCount}</span>` : ''}
                    ${ownerEmail === meEmail ? `<span class="story-delete-btn" onclick="event.stopPropagation();deleteStory('${story.id}')" title="Xóa story"><i class="fa-solid fa-trash"></i></span>` : ''}
                </button>`;
            }).join('');
        }, () => {
            container.innerHTML = '';
        });
    setListener('stories', storiesUnsubscribe);
}

// Đã bỏ cơ chế syncUserAvatarInAllComments để tránh quét toàn bộ posts.
// Avatar của comment được render động từ users/allChatUsers khi hiển thị.

function getUserName() {
    const user = getCurrentUser();
    if (user?.name) return user.name;
    return 'Thành viên ẩn danh';
}

// Hàm gửi bình luận đã nâng cấp
async function addComment(postId) {
    const input = document.getElementById(`input-${postId}`);
    const sendBtn = input?.parentElement?.querySelector('button');
    const text = input.value.trim();
    if (!text) return;

    // Lấy tên người dùng trước khi gửi
    const userName = getUserName();
    const currentUser = normalizeUserAvatar(getCurrentUser());
    const userEmail = (currentUser?.email || '').toLowerCase();

    const postRef = db.collection("posts").doc(postId);
    try {
        setButtonLoading(sendBtn, true, 'Đang gửi...');
        await postRef.update({
            comments: firebase.firestore.FieldValue.arrayUnion({
                user: userName, // Sử dụng tên vừa lấy được
                userEmail,
                text: text,
                time: Date.now(),
                createdAt: Date.now()
            })
        });
        input.value = ""; 

        const postSnap = await postRef.get();
        const postData = postSnap.exists ? (postSnap.data() || {}) : {};
        const ownerEmail = (postData.email || '').toLowerCase();
        const currentEmail = (currentUser?.email || '').toLowerCase();
        if (ownerEmail && ownerEmail !== currentEmail) {
            await createNotification(ownerEmail, 'comment', `${userName} đã bình luận vào bài viết của bạn`, `profile.html?id=${encodeURIComponent(ownerEmail)}&post=${postId}`);
        }
    } catch (error) {
        console.error("Lỗi khi gửi bình luận: ", error);
        showSystemToast('Không thể gửi bình luận, vui lòng thử lại!', { icon: '⚠️', title: 'Lỗi bình luận' });
    } finally {
        setButtonLoading(sendBtn, false);
    }
}

// Thêm tính năng: Nhấn Enter để gửi bình luận nhanh
function checkCommentEnter(e, postId) {
    if (e.key === "Enter") {
        addComment(postId);
    }
}


// Legacy reaction handler (đã thay bằng phiên bản mới ở phía dưới file).
async function handleReactLegacy(postId, type) {
    const postRef = db.collection("posts").doc(postId);
    const increment = firebase.firestore.FieldValue.increment(1);

    if (type === 'hearts') {
        await postRef.update({ hearts: increment });
    } else {
        await postRef.update({ hahas: increment });
    }

    try {
        const me = getCurrentUser();
        const snap = await postRef.get();
        const postData = snap.exists ? (snap.data() || {}) : {};
        const ownerEmail = (postData.email || '').toLowerCase();
        const myEmail = (me?.email || '').toLowerCase();
        if (ownerEmail && ownerEmail !== myEmail) {
            const actorName = me?.name || me?.email || 'Một thành viên';
            await createNotification(ownerEmail, 'reaction', `${actorName} đã bày tỏ cảm xúc về bài viết của bạn`, `profile.html?id=${encodeURIComponent(ownerEmail)}&post=${postId}`);
        }
    } catch (e) {
        console.warn('Không gửi được thông báo reaction:', e);
    }
}

// 4. Đồng hồ đếm ngược (Sửa lỗi không chạy)
function startCountdown() {
    const examDate = new Date("June 11, 2026 00:00:00").getTime();
    if (countdownIntervalId) {
        clearInterval(countdownIntervalId);
        countdownIntervalId = null;
    }

    countdownIntervalId = setInterval(function() {
        const now = new Date().getTime();
        const distance = examDate - now;

        const d = Math.floor(distance / (1000 * 60 * 60 * 24));
        const h = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const m = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
        const s = Math.floor((distance % (1000 * 60)) / 1000);

        // Kiểm tra xem các thẻ ID có tồn tại không trước khi gán giá trị
        if(document.getElementById("days")) {
            document.getElementById("days").innerHTML = d;
            document.getElementById("hours").innerHTML = h < 10 ? "0" + h : h;
            document.getElementById("minutes").innerHTML = m < 10 ? "0" + m : m;
            document.getElementById("seconds").innerHTML = s < 10 ? "0" + s : s;
        }

        if (distance < 0) {
            clearInterval(countdownIntervalId);
            countdownIntervalId = null;
            document.getElementById("timer").innerHTML = "CHÚC CẢ LỚP THI TỐT! 🎓";
        }
    }, 1000);
}

// 5. Kiểm tra mật khẩu và khởi động web
async function checkPassword() {
    const loginIdentifier = document.getElementById('login-identifier').value.trim();
    const normalizedIdentifier = loginIdentifier.toLowerCase();
    const password = document.getElementById('login-password').value;
    if (!loginIdentifier || !password) return showAuthMessage('Vui lòng nhập email hoặc số điện thoại cùng mật khẩu để đăng nhập.');

    try {
        let emailForLogin = normalizedIdentifier;
        if (!normalizedIdentifier.includes('@')) {
            const phoneSnap = await db.collection('users').where('phone', '==', loginIdentifier).limit(1).get();
            if (phoneSnap.empty) {
                return showAuthMessage('Sai email/số điện thoại hoặc mật khẩu. Vui lòng thử lại.');
            }
            emailForLogin = String(phoneSnap.docs[0].data()?.email || '').trim().toLowerCase();
            if (!emailForLogin) {
                return showAuthMessage('Tài khoản chưa có email hợp lệ để đăng nhập.');
            }
        }

        await auth.signInWithEmailAndPassword(emailForLogin, password);
        await cleanupLegacyPasswordField(emailForLogin);
        const account = await getUserProfileByEmail(emailForLogin);
        setCurrentUser(account || { email: emailForLogin });
        showAuthMessage('Đăng nhập thành công!', false);
    } catch (error) {
        console.error('Lỗi đăng nhập Firebase:', error);
        showAuthMessage(mapFirebaseAuthError(error));
    }
}

function createLeaves() {
    const container = document.getElementById('leaf-container');
    if (!container) return;
    container.innerHTML = '';

    const leafCount = 30;
    for (let i = 0; i < leafCount; i++) {
        const leaf = document.createElement('div');
        leaf.className = 'leaf';

        const startLeft = Math.random() * 100;
        const size = Math.random() * 10 + 10;
        const duration = Math.random() * 5 + 5;
        const delay = Math.random() * 5;

        leaf.style.left = `${startLeft}%`;
        leaf.style.width = `${size}px`;
        leaf.style.height = `${size * 0.8}px`;
        leaf.style.animationDuration = `${duration}s, 3s`;
        leaf.style.animationDelay = `${delay}s, 0s`;
        leaf.style.opacity = Math.random() * 0.5 + 0.5;

        container.appendChild(leaf);
    }
}

// 6. Các hàm bổ trợ (Lightbox, Hiệu ứng rơi...)
function updateLightboxTransform() {
    const media = document.querySelector('#lightboxContent img, #lightboxContent video');
    if (!media) return;
    media.style.transform = `scale(${lightboxZoom}) rotate(${lightboxRotation}deg)`;
}

function renderLightboxMedia(item) {
    const content = document.getElementById('lightboxContent');
    if (!content || !item) return;

    content.innerHTML = '';
    if (item.isVideo) {
        content.innerHTML = `<video src="${item.url}" controls autoplay playsinline style="max-width:100%; max-height:80vh;"></video>`;
    } else {
        content.innerHTML = `<img src="${item.url}" alt="Ảnh kỷ niệm" style="max-width:100%; max-height:80vh;">`;
    }

    updateLightboxTransform();
}

function preloadLightboxNeighbors(index) {
    const candidates = [lightboxActiveItems[index - 1], lightboxActiveItems[index + 1]].filter(Boolean);
    candidates.forEach((item) => {
        if (item.isVideo || !item.url) return;
        const img = new Image();
        img.src = item.url;
    });
}

function gatherCurrentMediaItems(clickedElement = null) {
    const mediaElements = Array.from(document.querySelectorAll('.media-wrap img, .media-wrap video'));
    const items = mediaElements.map((el) => {
        const isVideo = el.tagName.toLowerCase() === 'video';
        const srcFromData = isVideo ? (el.getAttribute('data-src') || '') : (el.getAttribute('data-full-src') || '');
        const srcFromNode = isVideo ? (el.currentSrc || el.getAttribute('src') || '') : (el.getAttribute('src') || el.currentSrc || '');
        const url = srcFromData || srcFromNode;
        return { url, isVideo, element: el };
    }).filter((item) => !!item.url);

    const clickedIndex = clickedElement
        ? items.findIndex((item) => item.element === clickedElement || item.element.closest('.video-preview-container') === clickedElement)
        : -1;
    return { items, clickedIndex };
}

function openLightboxByIndex(index, sourceElement = null) {
    const { items, clickedIndex } = gatherCurrentMediaItems(sourceElement);
    if (!items.length) return;
    lightboxActiveItems = items.map(({ url, isVideo }) => ({ url, isVideo }));
    const resolvedIndex = clickedIndex >= 0 ? clickedIndex : index;
    if (!lightboxActiveItems[resolvedIndex]) return;

    currentLightboxIndex = resolvedIndex;
    lightboxZoom = 1;
    lightboxRotation = 0;

    const lightbox = document.getElementById('lightbox');
    if (!lightbox) return;

    renderLightboxMedia(lightboxActiveItems[resolvedIndex]);
    preloadLightboxNeighbors(resolvedIndex);
    lightbox.style.display = 'flex';
    document.body.classList.add('lightbox-open');
    syncOverlayUIState();
}

function openLightbox(url, isVideo, sourceElement = null) {
    if (sourceElement) {
        openLightboxByIndex(-1, sourceElement);
        return;
    }
    lightboxActiveItems = [{ url, isVideo: !!isVideo }];
    currentLightboxIndex = 0;
    const lightbox = document.getElementById('lightbox');
    if (!lightbox) return;
    renderLightboxMedia(lightboxActiveItems[0]);
    preloadLightboxNeighbors(0);
    lightbox.style.display = 'flex';
    document.body.classList.add('lightbox-open');
    syncOverlayUIState();
}

function closeLightbox() {
    const lightbox = document.getElementById('lightbox');
    const content = document.getElementById('lightboxContent');
    if (lightbox) lightbox.style.display = 'none';
    if (content) content.innerHTML = '';
    document.body.classList.remove('lightbox-open');
    currentLightboxIndex = -1;
    lightboxZoom = 1;
    lightboxRotation = 0;
    syncOverlayUIState();
}

function changeZoom(multiplier) {
    lightboxZoom = Math.min(3.5, Math.max(0.6, lightboxZoom * Number(multiplier || 1)));
    updateLightboxTransform();
}

function doRotate() {
    lightboxRotation = (lightboxRotation + 90) % 360;
    updateLightboxTransform();
}

function showSurprise() {
    const allCards = document.querySelectorAll('.media-wrap');
    if (allCards.length === 0) return;

    const randomIndex = Math.floor(Math.random() * allCards.length);
    const randomCard = allCards[randomIndex];
    const media = randomCard.querySelector('img, video');
    if (!media) return;

    const isVideo = media.tagName.toLowerCase() === 'video';
    const sourceUrl = media.getAttribute('src') || media.currentSrc;
    if (!sourceUrl) return;

    openLightbox(sourceUrl, isVideo);
}

// Cho phép nhấn Enter để mở khóa
document.getElementById('login-password')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') checkPassword();
});

function resizeImageToDataUrl(file, maxSize = 640, quality = 0.85) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const img = new Image();
            img.onload = () => {
                let { width, height } = img;
                const scale = Math.min(1, maxSize / Math.max(width, height));
                width = Math.max(1, Math.round(width * scale));
                height = Math.max(1, Math.round(height * scale));

                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                if (!ctx) {
                    reject(new Error('Canvas không khả dụng'));
                    return;
                }

                ctx.drawImage(img, 0, 0, width, height);
                resolve(canvas.toDataURL('image/jpeg', quality));
            };
            img.onerror = () => reject(new Error('Không đọc được ảnh đã chọn'));
            img.src = String(reader.result || '');
        };
        reader.onerror = () => reject(new Error('Không thể đọc file ảnh'));
        reader.readAsDataURL(file);
    });
}

function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('Không thể đọc file ảnh gốc'));
        reader.readAsDataURL(file);
    });
}

async function handleProfileAvatarFileChange(event) {
    const file = event?.target?.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
        showSystemToast('Vui lòng chọn file ảnh hợp lệ.', { icon: '⚠️', title: 'File không hợp lệ' });
        event.target.value = '';
        return;
    }

    try {
        let dataUrl = '';
        try {
            dataUrl = await resizeImageToDataUrl(file);
        } catch (resizeError) {
            // Một số thiết bị/iOS (đặc biệt HEIC) có thể không decode được qua canvas.
            // Fallback: dùng trực tiếp data URL gốc để vẫn upload được.
            console.warn('Resize ảnh thất bại, dùng ảnh gốc:', resizeError);
            dataUrl = await fileToDataUrl(file);
        }

        const avatarInput = document.getElementById('profile-avatar');
        const preview = document.getElementById('profile-avatar-preview');

        if (avatarInput) avatarInput.value = dataUrl;
        if (preview) preview.src = dataUrl;
    } catch (error) {
        console.error('Lỗi xử lý ảnh avatar:', error);
        showSystemToast('Không thể xử lý ảnh. Vui lòng thử ảnh khác hoặc dùng link ảnh.', { icon: '⚠️', title: 'Lỗi ảnh avatar' });
    }
}

function openProfileModal() {
    const user = normalizeUserAvatar(getCurrentUser());
    if (!user) return showSystemToast('Bạn cần đăng nhập để xem hồ sơ.', { icon: '🔒', title: 'Chưa đăng nhập' });

    document.getElementById('profile-name').value = user.name || '';
    document.getElementById('profile-nickname').value = user.nickname || '';
    document.getElementById('profile-birth-year').value = user.birthYear || '';
    document.getElementById('profile-class-role').value = user.classRole || '';
    document.getElementById('profile-phone').value = user.phone || '';
    document.getElementById('profile-email').value = user.email || '';
    document.getElementById('profile-avatar').value = user.avatar || buildAvatarUrl(user.name);
    document.getElementById('profile-avatar-preview').src = user.avatar || buildAvatarUrl(user.name);
    const fileInput = document.getElementById('profile-avatar-file');
    const deleteBtn = document.getElementById('delete-account-btn');
    if (fileInput) fileInput.value = '';
    if (deleteBtn) deleteBtn.style.display = user?.email ? 'block' : 'none';
    document.getElementById('profile-modal').style.display = 'flex';
    closeTopQuickMenu();
    syncOverlayUIState();
}

function closeProfileModal() {
    const modal = document.getElementById('profile-modal');
    if (modal) modal.style.display = 'none';
    syncOverlayUIState();
}

function toggleTopQuickMenu() {
    const menu = document.getElementById('nav-menu-modal');
    if (!menu) return;
    const shouldOpen = menu.style.display !== 'flex';
    menu.style.display = shouldOpen ? 'flex' : 'none';
    syncOverlayUIState();
}

function closeTopQuickMenu() {
    const menu = document.getElementById('nav-menu-modal');
    if (!menu) return;
    menu.style.display = 'none';
    syncOverlayUIState();
}

function showAccountDataSummary() {
    const currentUser = getCurrentUser() || {};
    const text = [
        `Tài khoản hiện tại: ${currentUser.name || currentUser.email || 'Chưa có'}`,
        `Email: ${currentUser.email || '---'}`,
        `SĐT: ${currentUser.phone || '---'}`,
        'Đăng nhập được quản lý bởi Firebase Auth'
    ].join('\n');
    showSystemToast(text, { icon: 'ℹ️', title: 'Thông tin tài khoản' });
}

function syncOverlayUIState() {
    const body = document.body;
    if (!body) return;
    const isLightboxOpen = document.body.classList.contains('lightbox-open');
    const isProfileOpen = document.getElementById('profile-modal')?.style.display === 'flex';
    const isLetterOpen = document.getElementById('letter-modal')?.style.display === 'flex';
    const isChatSelectorOpen = document.getElementById('chat-selector-modal')?.style.display === 'flex';
    const isForgotPasswordOpen = document.getElementById('forgot-password-modal')?.style.display === 'flex';
    const isChangePasswordOpen = document.getElementById('change-password-modal')?.style.display === 'flex';
    const isDeleteAccountOpen = document.getElementById('delete-account-modal')?.style.display === 'flex';
    const isStoryViewersOpen = document.getElementById('story-viewers-modal')?.style.display === 'flex';
    const isInstallGuideOpen = document.getElementById('install-guide-modal')?.style.display === 'flex';
    const isChatActionSheetOpen = document.getElementById('chat-action-sheet')?.style.display === 'flex';
    const isGroupActionSheetOpen = document.getElementById('group-action-sheet')?.style.display === 'flex';
    const isChatOpen = document.getElementById('chat-panel')?.classList.contains('show')
        || document.getElementById('group-chat-panel')?.classList.contains('show');
    const isTopMenuOpen = document.getElementById('nav-menu-modal')?.style.display === 'flex';
    body.classList.toggle('ui-overlay-active', !!(isLightboxOpen || isProfileOpen || isLetterOpen || isChatSelectorOpen || isForgotPasswordOpen || isChangePasswordOpen || isDeleteAccountOpen || isStoryViewersOpen || isInstallGuideOpen || isChatActionSheetOpen || isGroupActionSheetOpen || isChatOpen || isTopMenuOpen));
}

async function refreshWebApp() {
    try {
        if ('serviceWorker' in navigator) {
            const regs = await navigator.serviceWorker.getRegistrations();
            await Promise.all(regs.map((reg) => reg.update().catch(() => {})));
        }

        if ('caches' in window) {
            const keys = await caches.keys();
            await Promise.all(keys.map((key) => caches.delete(key)));
        }

        const nextUrl = new URL(window.location.href);
        nextUrl.searchParams.set('refresh', Date.now().toString());
        window.location.replace(nextUrl.toString());
    } catch (error) {
        console.warn('Làm mới app thất bại, fallback reload:', error);
        window.location.reload();
    }
}

async function saveProfile() {
    const user = normalizeUserAvatar(getCurrentUser());
    if (!user) return;

    const oldName = user.name || '';
    const name = document.getElementById('profile-name').value.trim();
    const nickname = document.getElementById('profile-nickname').value.trim();
    const birthYear = Number(document.getElementById('profile-birth-year').value || 0);
    const classRole = document.getElementById('profile-class-role').value.trim();
    const phone = document.getElementById('profile-phone').value.trim();
    const avatarInput = document.getElementById('profile-avatar').value.trim();
    const avatar = avatarInput || buildAvatarUrl(name || user.name);

    if (!name || !phone) return showSystemToast('Vui lòng nhập đầy đủ họ tên và số điện thoại.', { icon: '⚠️', title: 'Thiếu thông tin' });

    try {
        const snap = await db.collection('users').where('email', '==', user.email).limit(1).get();
        if (!snap.empty) {
            await db.collection('users').doc(snap.docs[0].id).update({
                name,
                phone,
                avatar,
                nickname,
                classRole,
                birthYear: birthYear || null,
                password: firebase.firestore.FieldValue.delete()
            });
        }

        const updated = { ...user, name, phone, avatar, nickname, classRole, birthYear: birthYear || null };
        setCurrentUser(updated);
        updateCurrentUserDisplay();
        closeProfileModal();
        showSystemToast('Đã cập nhật hồ sơ thành công!', { icon: '✅', title: 'Cập nhật thành công' });
    } catch (error) {
        console.error('Lỗi cập nhật hồ sơ:', error);
        showSystemToast('Không thể cập nhật hồ sơ. Vui lòng thử lại.', { icon: '⚠️', title: 'Lỗi cập nhật hồ sơ' });
    }
}

// Hàm xử lý thả cảm xúc (Lưu danh sách tên)
async function handleReact(postId, type, sourceBtn = null) {
    const userName = getUserName(); // Lấy tên người dùng đã lưu hoặc hỏi tên
    const postRef = db.collection("posts").doc(postId);
    
    const field = type === 'hearts' ? 'heartUsers' : 'hahaUsers';

    try {
        setButtonLoading(sourceBtn, true, 'Đang xử lý...');
        const doc = await postRef.get();
        const data = doc.data();
        const userList = data[field] || [];

        if (userList.includes(userName)) {
            // Nếu đã thả rồi thì "Bỏ thích" (Xóa khỏi mảng)
            await postRef.update({
                [field]: firebase.firestore.FieldValue.arrayRemove(userName)
            });
        } else {
            // Nếu chưa thả thì "Thêm vào" (Thêm vào mảng)
            await postRef.update({
                [field]: firebase.firestore.FieldValue.arrayUnion(userName)
            });
        }
    } catch (error) {
        console.error("Lỗi tương tác:", error);
        showSystemToast('Không thể thả cảm xúc lúc này.', { icon: '⚠️', title: 'Lỗi tương tác' });
    } finally {
        setButtonLoading(sourceBtn, false);
    }
}

async function sendTimeCapsule() {
    const user = getCurrentUser();
    const sender = document.getElementById('capsule-sender').value.trim() || user?.name || '';
    const msg = document.getElementById('capsule-message').value.trim();
    const unlockDateValue = document.getElementById('unlock-date-input').value; // Định dạng YYYY-MM-DD
    
    if (!sender || !msg || !unlockDateValue) return showSystemToast('Vui lòng nhập đủ tên, lời nhắn và chọn ngày mở!', { icon: '⚠️', title: 'Thiếu thông tin' });

    try {
        await db.collection("messages").add({
            sender: sender,
            senderEmail: (user?.email || '').toLowerCase(),
            message: msg,
            unlockDate: unlockDateValue, // Lưu ngày người dùng chọn
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        
        showSystemToast(`💌 Thư đã được khóa lại cho đến ngày ${unlockDateValue}`, { icon: '✅', title: 'Gửi thư thành công' });
        document.getElementById('capsule-message').value = '';
        document.getElementById('unlock-date-input').value = '';
    } catch (e) { showSystemToast(`Lỗi: ${e.message}`, { icon: '⚠️', title: 'Không gửi được thư' }); }
}


// Hàm lọc thư ngay trên giao diện
function filterCapsules() {
    const searchText = document.getElementById('search-sender').value.toLowerCase();
    const statusFilter = document.getElementById('filter-status').value;
    const cards = document.querySelectorAll('.capsule-card');

    cards.forEach(card => {
        const sender = card.querySelector('strong').innerText.toLowerCase();
        const isLocked = card.classList.contains('locked');
        
        let matchSearch = sender.includes(searchText);
        let matchStatus = (statusFilter === 'all') || 
                          (statusFilter === 'locked' && isLocked) || 
                          (statusFilter === 'unlocked' && !isLocked);

        if (matchSearch && matchStatus) {
            card.style.display = "flex";
        } else {
            card.style.display = "none";
        }
    });
}

// Khai báo biến giới hạn cho phần Grid bên dưới
let limitCount = 6; 

function getFeaturedCarouselLimit() {
    const width = window.innerWidth || 390;
    if (width <= 420) return 4;
    if (width <= 560) return 5;
    return 6;
}

function loadTimeCapsuleMessages() {
    const today = new Date().toLocaleDateString('sv-SE');
setListener('capsule_messages', null);
    const unsubscribe = db.collection("messages").orderBy("unlockDate", "asc").onSnapshot((snapshot) => {
        const carouselDiv = document.getElementById('capsule-carousel-3d'); // Đảm bảo ID này có trong HTML
        const listDiv = document.getElementById('capsule-messages-list');
        const loadMoreBtn = document.getElementById('btn-load-more');
        
        if (!listDiv) return;
        
        let allMessages = [];
        snapshot.forEach(doc => {
            allMessages.push({ id: doc.id, ...doc.data() });
        });

        notifyUnlockedMessages(allMessages, today);

        // Sắp xếp: Thư đã mở (unlocked) lên đầu
        allMessages.sort((a, b) => {
            const isALocked = today < a.unlockDate;
            const isBLocked = today < b.unlockDate;
            if (isALocked === isBLocked) return 0;
            return isALocked ? 1 : -1;
        });

         // --- PHẦN 1: RENDER VÒNG QUAY (TOP N linh hoạt theo màn hình) ---
        if (carouselDiv) {
            carouselDiv.innerHTML = "";
            const isMobile = window.matchMedia('(max-width: 768px)').matches;
            const featuredCount = isMobile ? getFeaturedCarouselLimit() : 6;
            const featuredMessages = allMessages.slice(0, featuredCount);

            featuredMessages.forEach((data, index) => {
                const isLocked = today < data.unlockDate;
                const card = createCardMarkup(data, isLocked); 
                
                const angleStep = featuredMessages.length ? (360 / featuredMessages.length) : 60;
                const angle = index * angleStep;
                const cardWidth = isMobile ? 128 : 180;
                const containerWidth = carouselDiv.closest('.carousel-3d-container')?.clientWidth || window.innerWidth;
                const maxRadiusByWidth = Math.floor((containerWidth - cardWidth - 18) / 2);
                const radius = Math.max(isMobile ? 78 : 120, Math.min(isMobile ? 108 : 180, maxRadiusByWidth));
                
                card.style.transform = `rotateY(${angle}deg) translateZ(${radius}px)`;       
                carouselDiv.appendChild(card);
            });
        }

        // --- PHẦN 2: RENDER GRID (DANH SÁCH TẤT CẢ) ---
        listDiv.innerHTML = "";
        const displayedMessages = allMessages.slice(0, limitCount);

        displayedMessages.forEach((data, index) => {
            const isLocked = today < data.unlockDate;
            const isNewLoad = index >= (limitCount - 6);
            
            const card = createCardMarkup(data, isLocked);
            card.className += ` ${isNewLoad ? 'fly-in' : ''}`;
            
            if (isNewLoad) {
                card.style.animationDelay = `${(index % 6) * 0.15}s`;
            }

            listDiv.appendChild(card);
        });

        // Điều khiển nút Xem thêm
        if (loadMoreBtn) {
            loadMoreBtn.style.display = (allMessages.length > limitCount) ? "inline-block" : "none";
        }

        updateLetterCountdowns();
    });
    setListener('capsule_messages', unsubscribe);
}

function formatUnlockCountdown(unlockDate) {
    const unlockTime = new Date(`${unlockDate}T00:00:00`).getTime();
    const now = Date.now();
    const distance = unlockTime - now;

    if (distance <= 0) return 'Có thể mở thư rồi 🎉';

    const days = Math.floor(distance / (1000 * 60 * 60 * 24));
    const hours = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((distance % (1000 * 60)) / 1000);

    return `${days} ngày ${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

function updateLetterCountdowns() {
    document.querySelectorAll('.letter-unlock-countdown').forEach((el) => {
        const unlockDate = el.dataset.unlockDate;
        if (!unlockDate) return;
        el.innerText = formatUnlockCountdown(unlockDate);
    });
}

function startLetterCountdownInterval() {
    if (letterCountdownInterval) {
        clearInterval(letterCountdownInterval);
        letterCountdownInterval = null;
    }
    updateLetterCountdowns();
    letterCountdownInterval = setInterval(updateLetterCountdowns, 1000);
}

// HÀM QUAN TRỌNG: Tạo HTML cho thẻ thư (Dùng chung cho cả 2 phần)
function createCardMarkup(data, isLocked) {
    const card = document.createElement('div');
    card.className = `capsule-card ${isLocked ? 'locked' : 'unlocked'}`;
    
    if (!isLocked) {
        card.onclick = () => openLetter(data);
    }

    card.innerHTML = `
        <div class="lock-icon-center">🔒</div>
        <div class="card-header">
            <strong>${data.sender}</strong>
            <span>📅 ${data.unlockDate}</span>
        </div>
        <div class="card-body">
            <p class="msg-text">${isLocked ? 'Thư đang bị khóa bí mật...' : data.message}</p>
        ${isLocked ? `
                <div class="letter-timer-box">
                    <div class="timer-label">Mở sau:</div>
                    <div class="timer-countdown-text letter-unlock-countdown" data-unlock-date="${data.unlockDate}"></div>
                </div>
            ` : `
                <button type="button" class="letter-reply-mini-btn">💬 Nhắn người viết</button>
            `}
        </div>
    `;

    if (!isLocked) {
        const replyBtn = card.querySelector('.letter-reply-mini-btn');
        replyBtn?.addEventListener('click', (event) => {
            event.stopPropagation();
            openLetter(data);
            toggleLetterReplyComposer();
        });
    }
    return card;
}

// Hàm khi nhấn nút Tải thêm
function loadMoreCapsules() {
    limitCount += 10; // Tăng thêm 10 thư mỗi lần nhấn
    loadTimeCapsuleMessages(); // Tải lại danh sách
}

// Hàm mở Modal thư to
function resetLetterReplyComposer() {
    const box = document.getElementById('letter-reply-box');
    const input = document.getElementById('letter-reply-input');
    if (box) box.style.display = 'none';
    if (input) input.value = '';
}

function toggleLetterReplyComposer() {
    const box = document.getElementById('letter-reply-box');
    const input = document.getElementById('letter-reply-input');
    if (!box) return;

    const isVisible = box.style.display === 'block';
    box.style.display = isVisible ? 'none' : 'block';
    if (!isVisible) input?.focus();
}

async function findUserForCapsuleReply(letter) {
    const senderEmail = (letter?.senderEmail || '').toLowerCase();
    const senderName = (letter?.sender || '').trim().toLowerCase();
    const me = getCurrentUser();

    if (senderEmail) {
        const byEmail = allChatUsers.find((u) => (u.email || '').toLowerCase() === senderEmail);
        if (byEmail) return byEmail;
    }

    if (senderName) {
        const byName = allChatUsers.find((u) => (u.name || '').trim().toLowerCase() === senderName);
        if (byName) return byName;
    }

    try {
        if (senderEmail) {
            const snapByEmail = await db.collection('users').where('email', '==', senderEmail).limit(1).get();
            if (!snapByEmail.empty) {
                return normalizeUserAvatar(snapByEmail.docs[0].data());
            }
        }

        if (senderName) {
            const snapByName = await db.collection('users').where('name', '==', letter.sender).limit(1).get();
            if (!snapByName.empty) {
                const found = snapByName.docs.map((d) => normalizeUserAvatar(d.data()))
                    .find((u) => (u.email || '').toLowerCase() !== (me?.email || '').toLowerCase());
                if (found) return found;
            }
        }
    } catch (error) {
        console.warn('Không tìm được người viết thư để nhắn tin:', error);
    }

    return null;
}

function buildCapsuleReplyMessage(letter, replyText) {
    const sender = letter?.sender || 'Bạn';
    const unlockDate = letter?.unlockDate || '';
    const letterBody = (letter?.message || '').trim();
    const myText = (replyText || '').trim();

    const letterPreview = letterBody.length > 220 ? `${letterBody.slice(0, 220)}…` : letterBody;
    return `📨 Phản hồi thư của ${sender} (${unlockDate})
“${letterPreview}”

${myText}`.trim();
}

async function sendReplyToCapsuleAuthor() {
    const me = getCurrentUser();
    if (!me?.email) return showSystemToast('Bạn cần đăng nhập để gửi tin nhắn.', { icon: '🔒', title: 'Chưa đăng nhập' });
    if (!currentOpenedLetter || !currentOpenedLetter.message) return showSystemToast('Không tìm thấy thông tin bức thư để phản hồi.', { icon: '⚠️', title: 'Thiếu dữ liệu' });

    const input = document.getElementById('letter-reply-input');
    const replyText = input?.value.trim() || '';
    if (!replyText) return showSystemToast('Hãy nhập lời nhắn trước khi gửi.', { icon: '⚠️', title: 'Nội dung trống' });

    const targetUser = await findUserForCapsuleReply(currentOpenedLetter);
    if (!targetUser?.email) {
        return showSystemToast('Không tìm thấy tài khoản của người viết thư để mở chat riêng.', { icon: '⚠️', title: 'Không tìm thấy người nhận' });
    }

    if ((targetUser.email || '').toLowerCase() === (me.email || '').toLowerCase()) {
        return showSystemToast('Đây là thư của bạn, không thể tự gửi tin nhắn cho chính mình.', { icon: 'ℹ️', title: 'Không thể gửi' });
    }

    openPrivateChatWithUser(targetUser);
    closeLetter();

    const chatInput = document.getElementById('chat-input');
    if (!chatInput) return;

    chatInput.value = buildCapsuleReplyMessage(currentOpenedLetter, replyText);
    await sendPrivateMessage();
    resetLetterReplyComposer();
    showSystemToast(`Đã gửi phản hồi đến ${targetUser.name || targetUser.email}`, { icon: '📨', title: 'Phản hồi thư thành công' });
}

function openLetter(letter) {
    currentOpenedLetter = letter || null;
    document.getElementById('modal-sender').innerText = "Từ: " + (letter?.sender || 'Không rõ');
    document.getElementById('modal-date').innerText = "Ngày hẹn mở: " + (letter?.unlockDate || '---');
    const msgElement = document.getElementById('modal-message');
    msgElement.innerText = letter?.message || '';
    resetLetterReplyComposer();
    document.getElementById('letter-modal').style.display = 'flex';
    syncOverlayUIState();
}

// Hàm đóng Modal
function closeLetter() {
    document.getElementById('letter-modal').style.display = 'none';
    resetLetterReplyComposer();
    syncOverlayUIState();
}
    
function handleGlobalClick(event) {
    const modal = document.getElementById('letter-modal');
    const profileModal = document.getElementById('profile-modal');
    const lightbox = document.getElementById('lightbox');
    const container = document.getElementById('music-container');
    const btn = document.getElementById('main-music-btn');
    const options = document.getElementById('music-options');
    const panel = document.getElementById('playlist-panel');
    const quickMenu = document.getElementById('nav-menu-modal');
    const chatSelector = document.getElementById('chat-selector-modal');
    const chatActionSheet = document.getElementById('chat-action-sheet');
    const groupActionSheet = document.getElementById('group-action-sheet');
    const deleteAccountModal = document.getElementById('delete-account-modal');
    const storyViewersModal = document.getElementById('story-viewers-modal');
    const installGuideModal = document.getElementById('install-guide-modal');

    if (event.target === modal) closeLetter();
    if (event.target === profileModal) closeProfileModal();
    if (event.target === lightbox) closeLightbox();
    if (event.target === chatSelector) closeChatSelectorModal();
    if (event.target === quickMenu) closeTopQuickMenu();
    if (event.target === chatActionSheet) closeChatActionSheet();
    if (event.target === groupActionSheet) closeGroupActionSheet();
    if (event.target === deleteAccountModal) closeDeleteAccountDialog();
    if (event.target === storyViewersModal) closeStoryViewersModal();
    if (event.target === installGuideModal) closeInstallGuide();

    if (container && !container.contains(event.target)) {
        btn?.classList.remove('active');
        options?.classList.remove('show');
        if (panel) panel.style.display = 'none';
    }

}

document.addEventListener('click', handleGlobalClick);

document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' && event.key.toLowerCase() !== 'x') return;
    if (document.getElementById('lightbox')?.style.display === 'flex') {
        closeLightbox();
        return;
    }
    if (document.getElementById('letter-modal')?.style.display === 'flex') {
        closeLetter();
        return;
    }
    if (document.getElementById('profile-modal')?.style.display === 'flex') {
        closeProfileModal();
        return;
    }
    if (document.getElementById('chat-selector-modal')?.style.display === 'flex') {
        closeChatSelectorModal();
        return;
    }
    if (document.getElementById('forgot-password-modal')?.style.display === 'flex') {
        closeForgotPasswordDialog();
        return;
    }
    if (document.getElementById('delete-account-modal')?.style.display === 'flex') {
        closeDeleteAccountDialog();
        return;
    }
    if (document.getElementById('story-viewers-modal')?.style.display === 'flex') {
        closeStoryViewersModal();
        return;
    }
    if (document.getElementById('install-guide-modal')?.style.display === 'flex') {
        closeInstallGuide();
        return;
    }
    if (document.getElementById('change-password-modal')?.style.display === 'flex') {
        closeChangePasswordDialog();
        return;
    }
    if (document.getElementById('confirm-modal')?.style.display === 'flex') {
        document.getElementById('confirm-modal-cancel-btn')?.click();
        return;
    }
    if (document.getElementById('nav-menu-modal')?.style.display === 'flex') {
        closeNavMenuModal();
    }
});

window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
});

window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    const installGuideBtn = document.querySelector('#profile-modal .profile-refresh-btn');
    if (installGuideBtn) installGuideBtn.style.display = 'none';
    closeInstallGuide();
    showSystemToast('Cài đặt web app thành công. Mở app từ màn hình chính để dùng như ứng dụng riêng.', {
        icon: '✅',
        title: 'Đã cài đặt ứng dụng'
    });
});

async function applyAuthenticatedSession(authUser) {
    if (!authUser?.email) return;
    const email = String(authUser.email || '').toLowerCase();
    const profile = await getUserProfileByEmail(email).catch(() => null);
    setCurrentUser(profile || { email, name: authUser.displayName || 'Thành viên lớp' });
    updatePrivateChatHeader();
    updateGroupChatHeaderAvatar();
    updateCurrentUserDisplay();
    await startIntroExperienceAfterLogin();
    hideBootSplash();
}

function isRunningStandaloneMode() {
    return window.matchMedia?.('(display-mode: standalone)')?.matches || window.navigator.standalone === true;
}

function detectDeviceType() {
    const ua = navigator.userAgent || '';
    if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
    if (/Android/i.test(ua)) return 'android';
    return 'desktop';
}

function getInstallGuideMessage() {
    const mode = detectDeviceType();
    if (mode === 'ios') {
        return 'iPhone/iPad: mở Safari → nút Chia sẻ → chọn "Add to Home Screen" để cài app.';
    }
    if (mode === 'android') {
        return 'Android: mở menu trình duyệt (⋮) → chọn "Install app" hoặc "Add to Home screen".';
    }
    return 'Máy tính: mở trình duyệt Chrome/Edge → bấm biểu tượng cài đặt ở thanh địa chỉ để cài app desktop.';
}

function closeInstallGuide() {
    const modal = document.getElementById('install-guide-modal');
    if (modal) modal.style.display = 'none';
    syncOverlayUIState();
}

function renderInstallGuideSteps() {
    const stepsEl = document.getElementById('install-guide-steps');
    if (!stepsEl) return;
    const mode = detectDeviceType();
    if (mode === 'ios') {
        stepsEl.innerHTML = `
            <article class="install-step-card">
                <img src="./icons/install-guide-ios.svg" alt="Hướng dẫn cài đặt trên iPhone Safari">
                <p>1) Mở Safari → 2) Nhấn Share → 3) Chọn <b>Add to Home Screen</b>.</p>
            </article>`;
        return;
    }
    if (mode === 'android') {
        stepsEl.innerHTML = `
            <article class="install-step-card">
                <img src="./icons/install-guide-android.svg" alt="Hướng dẫn cài đặt trên Android Chrome">
                <p>1) Mở Chrome → 2) Nhấn menu <b>⋮</b> → 3) Chọn <b>Install app</b>.</p>
            </article>`;
        return;
    }
    stepsEl.innerHTML = `<p class="members-empty">Trên máy tính: bấm biểu tượng cài app ở thanh địa chỉ (Chrome/Edge).</p>`;
}

async function triggerInstallPrompt() {
    if (!deferredInstallPrompt) {
        showSystemToast(getInstallGuideMessage(), { icon: 'ℹ️', title: 'Hướng dẫn cài ứng dụng' });
        return;
    }
    deferredInstallPrompt.prompt();
    const result = await deferredInstallPrompt.userChoice.catch(() => ({ outcome: 'dismissed' }));
    if (result?.outcome !== 'accepted') {
        showSystemToast('Bạn có thể cài lại bất cứ lúc nào từ menu trình duyệt.', { icon: 'ℹ️', title: 'Chưa cài đặt' });
    } else {
        closeInstallGuide();
    }
}

async function showInstallGuide() {
    if (isRunningStandaloneMode()) {
        showSystemToast('Ứng dụng đã được cài và đang chạy dạng app.', { icon: '✅', title: 'Đã cài đặt ứng dụng' });
        return;
    }

    const modal = document.getElementById('install-guide-modal');
    const status = document.getElementById('install-guide-status');
    const ctaBtn = document.getElementById('install-guide-cta-btn');
    if (!modal || !status || !ctaBtn) return;

    status.innerHTML = [
        `HTTPS: <b>${window.isSecureContext ? 'OK' : 'Thiếu HTTPS'}</b>`,
        `Service Worker: <b>${'serviceWorker' in navigator ? 'OK' : 'Không hỗ trợ'}</b>`,
        `Manifest: <b>${document.querySelector('link[rel="manifest"]') ? 'OK' : 'Thiếu'}</b>`
    ].join(' • ');
    ctaBtn.style.display = deferredInstallPrompt ? 'inline-flex' : 'none';
    renderInstallGuideSteps();
    modal.style.display = 'flex';
    syncOverlayUIState();
}

window.addEventListener('DOMContentLoaded', () => {
    showBootSplash();
    document.getElementById('password-screen').style.display = 'none';
    document.getElementById('main-content').style.display = 'none';
    initThemeMode();
    initAOSWhenIdle();
    initPasswordToggles();
    setupFirebaseMessaging().catch((error) => {
        console.warn('Bỏ qua khởi tạo FCM:', error);
    });
    startLetterCountdownInterval();

    initEmojiPicker();

    const avatarInput = document.getElementById('profile-avatar');
    avatarInput?.addEventListener('input', () => {
        const preview = document.getElementById('profile-avatar-preview');
        if (preview) preview.src = avatarInput.value.trim() || buildAvatarUrl('Avatar');
    });

    const avatarFileInput = document.getElementById('profile-avatar-file');
    avatarFileInput?.addEventListener('change', handleProfileAvatarFileChange);

    const groupChatInput = document.getElementById('group-chat-input');
    groupChatInput?.addEventListener('keypress', (event) => {
        if (event.key === 'Enter') sendGroupMessage();
    });
    groupChatInput?.addEventListener('input', () => {
        const me = getCurrentUser();
        if (!me?.email) return;
        db.collection('group_meta').doc('typing').set({
            typingBy: { [me.email.toLowerCase()]: Date.now() }
        }, { merge: true }).catch(() => {});
        if (groupTypingDebounce) clearTimeout(groupTypingDebounce);
        groupTypingDebounce = setTimeout(() => {
            db.collection('group_meta').doc('typing').set({
                typingBy: { [me.email.toLowerCase()]: 0 }
            }, { merge: true }).catch(() => {});
        }, 1300);
    });

    const privateChatInput = document.getElementById('chat-input');
    privateChatInput?.addEventListener('input', () => {
        updatePrivateTypingIndicator(true);
        if (privateTypingDebounce) clearTimeout(privateTypingDebounce);
        privateTypingDebounce = setTimeout(() => updatePrivateTypingIndicator(false), 1300);
    });
    privateChatInput?.addEventListener('blur', () => updatePrivateTypingIndicator(false));

    document.getElementById('private-chat-search')?.addEventListener('input', (event) => {
        privateSearchKeyword = event.target.value || '';
        loadPrivateMessages();
    });
    document.getElementById('group-chat-search')?.addEventListener('input', (event) => {
        groupSearchKeyword = event.target.value || '';
        initGroupChat();
    });
    document.getElementById('private-chat-image-input')?.addEventListener('change', handlePrivateImagePicked);
    document.getElementById('group-chat-image-input')?.addEventListener('change', handleGroupImagePicked);

    const chatUserSearchInput = document.getElementById('chat-user-search');
    chatUserSearchInput?.addEventListener('input', (event) => {
        hasUserTypedChatSearch = true;
        chatUserSearchKeyword = event.target.value || '';
        if (allChatUsers.length) renderChatUsers(allChatUsers);
    });

    chatUserSearchInput?.addEventListener('focus', () => {
        clearChatSearchAutofill(chatUserSearchInput);
    });
    chatUserSearchInput?.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
        }
    });

    clearChatSearchAutofill(chatUserSearchInput);
    setTimeout(() => clearChatSearchAutofill(chatUserSearchInput), 300);
    setTimeout(() => clearChatSearchAutofill(chatUserSearchInput), 1200);

    setupMobileChatKeyboardBehavior();
    setupViewportKeyboardGuard();
    document.body.classList.toggle('standalone-mode', isRunningStandaloneMode());
    const installGuideBtn = document.querySelector('#profile-modal .profile-refresh-btn');
    if (installGuideBtn && isRunningStandaloneMode()) {
        installGuideBtn.style.display = 'none';
    }

    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.addEventListener('message', (event) => {
            const msgType = event?.data?.type || '';
            if (msgType === 'OPEN_GROUP_CHAT_FROM_PUSH') {
                const panel = document.getElementById('group-chat-panel');
                if (!panel?.classList.contains('show')) {
                    toggleGroupChatPanel();
                }
                return;
            }
            if (msgType === 'SW_UPDATE_READY' && navigator.serviceWorker.controller) {
                notifyServiceWorkerUpdateReady(pendingSWRegistration);
            }
        });
    }

    if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission().catch(() => {});
    }

    const onOffline = () => {
        setNetworkOfflineBanner(true);
        updateMyPresence();
        showSystemToast('Mất kết nối mạng. Một số tính năng có thể tạm gián đoạn.', { icon: '📡', title: 'Offline' });
    };
    const onOnline = () => {
        setNetworkOfflineBanner(false);
        updateMyPresence();
        refreshDataAfterReconnect();
        showSystemToast('Kết nối mạng đã trở lại.', { icon: '✅', title: 'Online' });
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    setNetworkOfflineBanner(!navigator.onLine);
    document.addEventListener('visibilitychange', () => {
        document.body.classList.toggle('tab-hidden', document.hidden);
        const hasSession = !!getCurrentUser();
        if (!hasSession) return;

        if (document.visibilityState === 'visible') {
            startPresenceTracking();
            updateMyPresence();
            ensurePushPermissionNudge();
            return;
        }

        stopPresenceTracking();
        pauseMusicForBackground();
    });
    document.body.classList.toggle('tab-hidden', document.hidden);

    window.addEventListener('pagehide', () => {
        stopPresenceTracking();
        pauseMusicForBackground({ reset: true });
    });
    
    auth.onAuthStateChanged(async (authUser) => {
        if (!authUser?.email) {
            hasEnteredMainSite = false;
            setCurrentUser(null);
            document.getElementById('main-content').style.display = 'none';
            document.getElementById('password-screen').style.display = 'flex';
            switchAuthTab('login');
            updatePrivateChatHeader();
            updateGroupChatHeaderAvatar();
            updateCurrentUserDisplay();
            hideBootSplash();
            authStateReady = true;
            return;
        }
        try {
            await applyAuthenticatedSession(authUser);
        } catch (error) {
            console.error('Khôi phục phiên đăng nhập thất bại:', error);
            hasEnteredMainSite = false;
            document.getElementById('main-content').style.display = 'none';
            document.getElementById('password-screen').style.display = 'flex';
            switchAuthTab('login');
            hideBootSplash();
        }
        authStateReady = true;
    });

    window.addEventListener('pageshow', async () => {
        const authUser = auth.currentUser;
        if (!authUser?.email) return;
        await applyAuthenticatedSession(authUser);
    });
});

window.toggleDarkMode = toggleDarkMode;
