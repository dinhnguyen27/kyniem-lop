// 1. Cấu hình Firebase
const firebaseConfig = {
    apiKey: "AIzaSyA1lkOgOfvmM49o4G4B8ZgoMglAPjNdD5w",
    authDomain: "kyniemlop-d3404.firebaseapp.com",
    projectId: "kyniemlop-d3404",
    storageBucket: "kyniemlop-d3404.firebasestorage.app",
    messagingSenderId: "824232517330",
    appId: "1:824232517330:web:acf65afe55dac4d38b970b",
    Mã đo: "G-XG46M01K89"
};

// Khởi tạo Firebase
nếu (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}
const db = firebase.firestore();


const ACCOUNTS_KEY = 'class_accounts';
const SESSION_KEY = 'class_current_user';
const UNLOCK_NOTIFY_KEY = 'class_capsule_notified_unlocks';
const CHAT_READ_KEY = 'class_chat_read_state';

let unlockWatcherInitialized = false;
let notifiedUnlockIds = new Set(JSON.parse(localStorage.getItem(UNLOCK_NOTIFY_KEY) || '[]'));

const ONLINE_ACTIVE_WINDOW_MS = 120000;
const PRIVATE_CHAT_LIMIT = 120;
let presenceInterval = null;
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
hãy chatUserSearchKeyword = '';
let hasUserTypedChatSearch = false;
let currentOpenedLetter = null;
let memoryMap = null;
let pendingScrollPostId = null;


const CHAT_EMOJIS = ['😀','😁','😂','🤣','😊','😍','🥰','😘','😎','🤩','😢','😭','😡','👍','👏','🙏','🔥','🎉','💖','💬','🌸','🎓','🫶','✨'];

const MEMORY_SPOTS = [
    {
        name: 'Quán trà sữa sau giờ học',
        address: 'Khu vực gần cổng trường',
        Tọa độ: [21.0289, 105.8522],
        note: 'Nơi cả lớp hay tụ tập làm bài nhóm rồi tám chuyện tới tối.',
        Ảnh: 'https://picsum.photos/seed/kyniem-tra-sua/420/250'
    },
    {
        name: 'Công viên cuối tuần',
        address: 'Điểm dã ngoại quen thuộc',
        Tọa độ: [21.0368, 105.8342],
        note: 'Những buổi chụp ảnh và đá bóng mini của lớp vào cuối tuần.',
        Ảnh: 'https://picsum.photos/seed/kyniem-cong-vien/420/250'
    },
    {
        name: 'Địa điểm dã ngoại năm cuối',
        address: 'Chuyến đi kỷ yếu',
        Tọa độ: [21.0181, 105.8198],
        note: 'Buổi đi chơi đông đủ nhất, lưu lại rất nhiều ảnh kỷ niệm.',
        Ảnh: 'https://picsum.photos/seed/kyniem-da-ngoai/420/250'
    }
];

hàm parseFirestoreTimestampToMillis(value) {
    nếu (!value) trả về 0;
    if (typeof value === 'number') return value;
    if (typeof value?.toMillis === 'function') return Number(value.toMillis() || 0);
    const seconds = Number(value?.seconds || 0);
    const nanos = Number(value?.nanoseconds || 0);
    nếu (!giây) trả về 0;
    return (giây * 1000) + Math.floor(nanos / 1e6);
}

hàm formatMemoryDateLabel(ts) {
    const millis = Number(ts || 0);
    nếu (!millis) trả về '';
    const d = new Date(millis);
    if ( Number . isNaN ( d . getTime() ) ) return '' ;
    return d.toLocaleDateString('vi-VN');
}


hàm distanceMetersBetweenCoords(a = [], b = []) {
    const [lat1, lng1] = a.map(Number);
    const [lat2, lng2] = b.map(Number);
    if (![lat1, lng1, lat2, lng2].every(Number.isFinite)) return Number.POSITIVE_INFINITY;

    const toRad = (deg) => (deg * Math.PI) / 180;
    hằng số R = 6371000;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const q = Math.sin(dLat / 2) ** 2
        + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    trả về 2 * R * Math.asin(Math.sqrt(q));
}

hàm mergeNearbyMemorySpots(spots = [], thresholdMeters = 80) {
    const merged = [];

    spots.forEach((spot) => {
        const coords = Array.isArray(spot?.coords) ? Spot.coords : [];
        if (coords.length !== 2) return;

        const found = merged.find((item) => {
            const dist = distanceMetersBetweenCoords(item.coords, coords);
            return Number.isFinite(dist) && dist <= thresholdMeters;
        });

        nếu (!found) {
            merged.push({
                ...điểm,
                ảnh: Array.isArray(spot.photos) ? [...spot.photos] : [],
                số lượng: Số(điểm.số lượng || 1)
            });
            trở lại;
        }

        const existingCount = Number(found.count || 1);
        const incomingCount = Number(spot.count || 1);
        const total = existingCount + incomingCount;

        đã tìm thấy.tọa độ = [
            ((Số(tọa độ tìm thấy[0]) * Số lượng hiện có) + (Số(tọa độ[0]) * Số lượng đến)) / tổng,
            ((Số(tọa độ tìm thấy[1]) * Số lượng hiện có) + (Số(tọa độ[1]) * Số lượng đến)) / tổng
        ];

        số lượng tìm thấy = tổng số;
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

    trả về giá trị đã hợp nhất;
}

hàm bất đồng bộ getMemorySpotsFromPosts() {
    thử {
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
                ảnh: data.url || 'https://picsum.photos/seed/kyniem-default/420/250',
                takenAt: takenAtMs
            };

            nếu (!grouped[key]) {
                nhóm[khóa] = {
                    tên: tiêu đề mục,
                    Địa chỉ: địa chỉ mặt hàng,
                    Tọa độ: [vĩ độ, kinh độ],
                    lưu ý: mục.ghi chú,
                    ảnh: [mục],
                    takenAt: item.takenAt,
                    số lượng: 1,
                    fromPost: true
                };
                trở lại;
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
    } bắt lỗi (error) {
        console.warn('Không tải được dữ liệu ảnh kỷ niệm để đưa lên bản đồ:', error);
        trở lại [];
    }
}



const FCM_TOKEN_KEY = 'class_fcm_token';
const AUTO_PUSH_PROMPT_KEY = 'class_auto_push_prompted';
const FCM_VAPID_PUBLIC_KEY = 'BFrdIOzjpU5hTbLY7PrS5LBZUZTFobgNH3jXd5CYu1akplI9gjZOx-gHMiadLZojTlY2sYMyveEApLRppP_yJq0';

let messaging = null;
let swRegistration = null;

let fcmSupportCache = null;

hàm getSiteBasePath() {
    const pathname = window.location.pathname || '/';
    nếu (đường dẫn kết thúc bằng '.html') {
        return pathname.slice(0, pathname.lastIndexOf('/') + 1) || '/';
    }
    return pathname.endsWith('/') ? pathname : `${pathname}/`;
}

hàm getPushUnsupportedReason() {
    const ua = navigator.userAgent || '';
    const isIOS = /iPhone|iPad|iPod/i.test(ua);
    const isSafari = /^((?!chrome|crios|android).)*safari/i.test(ua);
    const isStandalone = window.matchMedia?.('(display-mode: standalone)')?.matches || window.navigator.standalone === true;

    if (isIOS && isSafari && !isStandalone) {
        return 'Safari iPhone chỉ hỗ trợ thông báo đẩy khi web được thêm vào Màn hình chính (Add to Home Screen).';
    }

    nếu (!window.isSecureContext) {
        return 'Thông báo đẩy chỉ hoạt động trên HTTPS (hoặc localhost).';
    }

    nếu (!('serviceWorker' trong navigator) || !('PushManager' trong window)) {
        return 'Trình duyệt hiện tại chưa hỗ trợ đầy đủ Service Worker/Push API.';
    }

    return 'Thiết bị/trình duyệt chưa hỗ trợ Firebase Cloud Messaging.';
}

hàm bất đồng bộ isFCMSupported() {
    if (fcmSupportCache !== null) return fcmSupportCache;

    nếu (!firebase.messaging || !firebase.messaging.isSupported) {
        fcmSupportCache = false;
        Trả về false;
    }

    thử {
        const supportResult = firebase.messaging.isSupported();
        fcmSupportCache = typeof supportResult?.then === 'function'
            ? Boolean(await supportResult)
            : Boolean(supportResult);
    } bắt lỗi (error) {
        fcmSupportCache = false;
        console.warn('FCM không được hỗ trợ trên trình duyệt này:', error);
    }

    Trả về fcmSupportCache;
}

hàm bất đồng bộ waitForServiceWorkerReady(timeoutMs = 10000) {
    if (!('serviceWorker' in navigator)) return null;

    thử {
        trả về chờ Promise.race([
            navigator.serviceWorker.ready,
            new Promise((resolve) => setTimeout(() => resolve(null), timeoutMs))
        ]);
    } bắt lỗi (error) {
        console.warn('Service Worker chưa sẵn sàng:', error);
        trả về null;
    }
}

hàm bất đồng bộ registerMessagingServiceWorker() {
    if (!('serviceWorker' in navigator)) return null;

    const basePath = getSiteBasePath();
    const candidates = basePath === '/'
        ? ['/firebase-messaging-sw.js']
        : [`${basePath}firebase-messaging-sw.js`, '/firebase-messaging-sw.js'];

    for (const swUrl of candidates) {
        thử {
            const registration = await navigator.serviceWorker.register(swUrl, { scope: basePath });
            const readyRegistration = await waitForServiceWorkerReady();

            let hasReloaded = false;
            const reloadOnControllerChange = () => {
                navigator.serviceWorker.addEventListener('controllerchange', () => {
                    nếu (hasReloaded) trả về;
                    hasReloaded = true;
                    window.location.reload();
                });
            };

            nếu (registration.waiting) {
                reloadOnControllerChange();
                registration.waiting.postMessage({ type: 'SKIP_WAITING' });
            }

            registration.addEventListener('updatefound', () => {
                const worker = registration.installing;
                nếu (!worker) trả về;
                worker.addEventListener('statechange', () => {
                    if (worker.state === 'installed' && navigator.serviceWorker.controller) {
                        reloadOnControllerChange();
                        worker.postMessage({ type: 'SKIP_WAITING' });
                    }
                });
            });

            nếu (registration.update) {
                setTimeout(() => registration.update().catch(() => {}), 3000);
                setInterval(() => registration.update().catch(() => {}), 5 * 60 * 1000);
            }

            console.info(`FCM Service Worker đã đăng ký: ${swUrl}`);
            trả về trạng thái đăng ký sẵn sàng || đăng ký;
        } bắt lỗi (error) {
            console.warn(`Không đăng ký được SW tại ${swUrl}:`, error);
        }
    }
                                                 
    trả về null;
}

hàm bất đồng bộ setupFirebaseMessaging() {
    if (!(await isFCMSupported())) return;
    nếu (thông báo) trả về;

    thử {
        messaging = firebase.messaging();
    } bắt lỗi (error) {
        console.warn('Không thể khởi tạo Firebase Messaging:', error);
        trở lại;
    }

    swRegistration = await registerMessagingServiceWorker();
    nếu (!swRegistration) {
        console.warn('FCM chưa hoạt động vì không đăng ký được Service Worker.');
    }

    messaging.onMessage((payload) => {
        const type = payload?.data?.type || '';
        const title = payload?.notification?.title || payload?.data?.title || 'Thông báo mới';
        const body = payload?.notification?.body || payload?.data?.body || '';
       const senderName = payload?.data?.senderName || payload?.data?.sender || parseChatSenderFromTitle(title);
        const đã gửiAt = Số(tải trọng?.data?.sentAt || Date.now());

        nếu (thân bài) {
            nếu (type === 'chat_new_message') {
                showSystemToast(body, {
                    biểu tượng: '💬',
                    title: senderName ? `Tin nhắn từ ${senderName}` : 'Tin nhắn mới',
                    meta: formatChatTime(sentAt)
                });
            } khác {
                showSystemToast(body, { icon: '🔔', title });
            }
        }

        nếu ('Thông báo' trong cửa sổ và quyền Thông báo === 'đã cấp') {
            nếu (swRegistration?.showNotification) {
                swRegistration.showNotification(title, { body }).catch((error) => {
                    console.warn('Không hiển thị được foreground notification qua SW:', error);
                });
            } khác {
                Thông báo mới(tiêu đề, { nội dung });
            }
        }
    });
}

hàm bất đồng bộ saveFcmTokenForCurrentUser(token) {
    const user = getCurrentUser();
    if (!user?.email || !token) return;

    const snap = await db.collection('users').where('email', '==', user.email.toLowerCase()).limit(1).get();
    nếu (snap.empty) trả về;

    await db.collection('users').doc(snap.docs[0].id).update({
        fcmTokens: firebase.firestore.FieldValue.arrayUnion(token),
        fcmUpdatedAt: Date.now()
    });
}

hàm parseChatSenderFromTitle(title = '') {
    const normalized = String(title || '').trim();
    const match = normalized.match(/^💬\s*(.+?)\s+vừa\s+nhắn\s+tin/i);
    trả về kết quả khớp ? kết quả khớp[1].trim() : '';
}

hàm cập nhật trạng thái nút nhấn (đã bật) {
    const btn = document.getElementById('enable-push-btn');
    nếu (!btn) trả về;

    nếu (được bật) {
        btn.textContent = 'Thông báo đẩy: Đã bật';
        btn.disabled = true;
    } khác {
        btn.textContent = 'Bật thông báo đẩy';
        btn.disabled = false;
    }
}

hàm prepareMessagingCompat() {
    nếu (!messaging) trả về;

    thử {
        if (swRegistration && typeof messaging.useServiceWorker === 'function') {
            messaging.useServiceWorker(swRegistration);
        }

        if (FCM_VAPID_PUBLIC_KEY && typeof messaging.usePublicVapidKey === 'function') {
            messaging.usePublicVapidKey(FCM_VAPID_PUBLIC_KEY);
        }
    } bắt lỗi (error) {
        console.warn('Không cấu hình được messaging compat API:', error);
    }
}

hàm trễ (ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

hàm bất đồng bộ getFcmTokenWithFallback() {
    nếu (!messaging) trả về null;

    prepareMessagingCompat();

    const strategies = [
        async () => messaging.getToken({ vapidKey: FCM_VAPID_PUBLIC_KEY, serviceWorkerRegistration: swRegistration }),
        async () => messaging.getToken({ vapidKey: FCM_VAPID_PUBLIC_KEY }),
        async () => messaging.getToken()
    ];

    let lastError = null;

    for (let i = 0; i < strategies.length; i++) {
        for (let attempt = 1; attempt <= 2; attempt++) {
            thử {
                const token = await strategies[i]();
                nếu (token) trả về token;
            } bắt lỗi (error) {
                lastError = lỗi;
                console.warn(`Lấy FCM token thất bại ở chiến lược ${i + 1}, lần ${attempt}:`, error);
            }

            nếu (thử < 2) {
                chờ đợi độ trễ (400 * lần thử);
            }
        }
    }

    nếu (lastError) ném lỗi cuối cùng;
    trả về null;
}

hàm buildPushErrorMessage(error) {
    const code = String(error?.code || '');
    const message = String(error?.message || '');
    const lower = `${code} ${message}`.toLowerCase();

    if (code.includes('unsupported-browser') || lower.includes('unsupported-browser')) {
        return getPushUnsupportedReason();
    }

    nếu (code.includes('permission-blocked')) {
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

hàm bất đồng bộ enablePushNotifications(options = {}) {
    const silent = !!options.silent;
    nếu (!(await isFCMSupported())) {
        nếu (!silent) alert(getPushUnsupportedReason());
        trở lại;
    }

    chờ thiết lập FirebaseMessaging();

    nếu (!swRegistration) {
        if (!silent) alert(`Không đăng ký được Service Worker cho FCM. Hãy kiểm tra file firebase-messaging-sw.js có tồn tại ở ${getSiteBasePath()}firebase-messaging-sw.js`);
        trở lại;
    }

    thử {
        nếu ('Thông báo' trong cửa sổ và quyền Thông báo khác với 'đã cấp') {
            const permission = await Notification.requestPermission();
            nếu (quyền cho phép khác 'đã cấp') {
                if (!silent) alert('Bạn cần cho phép thông báo để nhận tin khi không mở tab web.');
                updatePushButtonState(false);
                trở lại;
            }
        }

        const token = await getFcmTokenWithFallback();
        nếu (!token) {
            if (!silent) alert('Chưa lấy được FCM token. Vui lòng thử lại.');
            trở lại;
        }

        localStorage.setItem(FCM_TOKEN_KEY, token);
        chờ lưu mã thông báo Fcm cho người dùng hiện tại (mã thông báo);
        updatePushButtonState(true);
        showSystemToast('Đã bật thông báo thông minh qua FCM.');
    } bắt lỗi (error) {
        console.error('Bật thông báo đẩy thất bại:', error);
        nếu (!silent) alert(buildPushErrorMessage(error));
    }
}

hàm bất đồng bộ autoEnablePushIfPossible() {
    if (!(await isFCMSupported())) return;
    if (!getCurrentUser()?.email) return;

    chờ thiết lập FirebaseMessaging();
    nếu (!swRegistration) {
        updatePushButtonState(false);
        trở lại;
    }

    nếu ('Thông báo' trong cửa sổ và quyền Thông báo khác với 'đã cấp') {
        updatePushButtonState(false);
        trở lại;
    }

    thử {
        const token = await getFcmTokenWithFallback();
        nếu (!token) {
            updatePushButtonState(false);
            trở lại;
        }

        const oldToken = localStorage.getItem(FCM_TOKEN_KEY);
        nếu (oldToken khác token) {
            localStorage.setItem(FCM_TOKEN_KEY, token);
            chờ lưu mã thông báo Fcm cho người dùng hiện tại (mã thông báo);
        }

        updatePushButtonState(true);
    } bắt lỗi (error) {
        console.warn('Không tự kích hoạt được FCM:', error);
        updatePushButtonState(false);
    }
}


chức năng không đồng bộ autoEnablePushFromFirstGesture() {
    if (localStorage.getItem(AUTO_PUSH_PROMPT_KEY) === '1') return;
    if (!getCurrentUser()?.email) return;

    localStorage.setItem(AUTO_PUSH_PROMPT_KEY, '1');

    thử {
        chờ bật thông báo đẩy ({ silent: true });
    } bắt lỗi (error) {
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

hàm bất đồng bộ queueNotificationEvent(eventId, payload) {
    if (!eventId || !payload) return;

    thử {
        await db.collection('notification_events').doc(eventId).set({
            ...hàng hóa,
            createdAt: Date.now()
        }, { merge: true });
    } bắt lỗi (error) {
        console.warn('Không thể tạo sự kiện thông báo:', error);
    }
}


function buildAvatarUrl(name = 'Thành viên lớp') {
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=ff7e5f&color=fff`;
}

hàm normalizeUserAvatar(user) {
    nếu (!user) trả về null;
    return { ...user, avatar: user.avatar || buildAvatarUrl(user.name) };
}

hàm getSavedAccounts() {
    return JSON.parse(localStorage.getItem(ACCOUNTS_KEY) || '[]');
}

hàm saveAccounts(accounts) {
    localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
}

hàm getCurrentUser() {
    return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
}

hàm buildMemoryPopupHtml(spot) {
    const title = escapeHtml(spot.name || 'Địa điểm kỷ niệm');
    const address = escapeHtml(spot.address || '');
    const note = escapeHtml(spot.note || '');
    const dateLabel = escapeHtml(formatMemoryDateLabel(spot.takenAt));
    const photos = Array.isArray(spot.photos) && spot.photos.length
        ? spot.photos
        : [{ photo: spot.photo || '', note: spot.note || '', takenAt: spot.takenAt || 0 }];

    const safeCount = Number(spot.count || photos.length || 1);
    const displayPhotos = photos.slice(0, 4);
    const galleryHtml = displayPhotos.map((item) => {
        const safePhoto = escapeHtml(item.photo || '');
        const safeItemNote = escapeHtml(item.note || '');
        const safeItemDate = escapeHtml(formatMemoryDateLabel(item.takenAt));
        const safePostId = escapeHtml(item.id || '');
        const jumpHandler = safePostId? `onclick="focusGalleryPost('${safePostId}')"` : '';
        trả về `<div class="memory-popup-card">
            <img src="${safePhoto}" alt="${title}" loading="lazy" ${jumpHandler}>
            <div class="memory-popup-note">${safeItemNote || note}</div>
            ${safeItemDate ? `<div class="memory-popup-time">🗓️ ${safeItemDate}</div>` : ''}
        </div>`;
    }).tham gia('');

    const moreButtonHtml = safeCount > 4
        ? `<button class="memory-popup-more-btn" onclick="openMemorySpotModal('${encodeURIComponent(JSON.stringify(photos))}', '${encodeURIComponent(spot.name || '')}', '${encodeURIComponent(spot.address || '')}', '${encodeURIComponent(spot.note || '')}')">Xem thêm (${safeCount - 4})</button>`
        : '';

    trả về `
        <div class="memory-popup">
            <div class="memory-popup-title">${title} ${safeCount > 1 ? `(${safeCount} ảnh)` : ''}</div>
            <div class="memory-popup-address">📍 ${address}</div>
            ${dateLabel ? `<div class="memory-popup-time">🗓️ Cập nhật gần nhất: ${dateLabel}</div>` : ''}
            <div class="memory-popup-gallery">${galleryHtml}</div>
            ${moreButtonHtml}
        </div>
    `;
}

hàm ensureMemorySpotModal() {
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
    thử {
        photos = JSON.parse(decodeURIComponent(rawPhotos));
    } bắt lỗi (error) {
        ảnh = [];
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
            ? `<button class="memory-jump-btn" onclick="focusGalleryPost('${safePostId}'); closeMemorySpotModal();">vỗ bài viết</button>`
            : '';
        trả về `<div class="memory-popup-card">
            <img src="${safePhoto}" alt="${escapeHtml(title)}" loading="lazy">
            <div class="memory-popup-note">${safeNote}</div>
            ${safeDate ? `<div class="memory-popup-time">🗓️ ${safeDate}</div>` : ''}
            ${actionBtn}
        </div>`;
    }).tham gia('');

    modal.classList.add('show');
}

hàm closeMemorySpotModal() {
    document.getElementById('memory-spot-modal')?.classList.remove('show');
}

hàm focusGalleryPost(postId) {
    nếu (!postId) trả về;
    const target = document.querySelector(`[data-post-id="${postId}"]`);

    nếu (!target && currentYearFilter !== 'all') {
        pendingScrollPostId = postId;
        filterByYear('all');
        trở lại;
    }

    nếu (!target) trả về;

    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target.classList.add('map-post-highlight');
    setTimeout(() => target.classList.remove('map-post-highlight'), 2000);
}

hàm bất đồng bộ initMemoryMap() {
    const mapEl = document.getElementById('memory-map');
    nếu (!mapEl) trả về;

    nếu (typeof window.L === 'undefined') {
        console.warn('Leaflet chưa tải xong, bỏ qua khởi tạo bản đồ kỷ niệm.');
        trở lại;
    }

    const dynamicSpots = await getMemorySpotsFromPosts();
    const fallbackSpots = mergeNearbyMemorySpots(MEMORY_SPOTS, 80);
    const spots = dynamicSpons.length ? dynamicSpons : fallbackSpons;

    nếu (memoryMap) {
        MemoryMap.eachLayer((layer) => {
            nếu (lớp là một thể hiện của L.Marker) {
                memoryMap.removeLayer(layer);
            }
        });
    } khác {
        memoryMap = L.map(mapEl, {
            zoomControl: true,
            scrollWheelZoom: false
        }).setView([21.0285, 105.8542], 13);

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            Ghi nguồn: '© Những người đóng góp cho OpenStreetMap'
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

    nếu (bounds.length > 1) {
        memoryMap.fitBounds(bounds, { padding: [28, 28] });
    } else if (bounds.length === 1) {
        memoryMap.setView(bounds[0], 15);
    }

    setTimeout(() => memoryMap?.invalidateSize(), 160);
}

hàm updateCurrentUserDisplay() {
    const user = normalizeUserAvatar(getCurrentUser());
    const chip = document.getElementById('current-user-display');
    const avatar = document.getElementById('current-user-avatar');

    nếu (chip) {
        chip.innerText = user ? `${user.name} • ${user.phone} • ${user.email}` : 'Bạn chưa đăng nhập';
    }

    nếu (hình đại diện) {
        avatar.src = người dùng?.avatar || buildAvatarUrl('Khách');
        avatar.style.display = 'block';
    }

    const senderInput = document.getElementById('capsule-sender');
    nếu (senderInput && user) {
        senderInput.value = user.name;
    }
}

hàm saveNotifiedUnlockIds() {
    localStorage.setItem(UNLOCK_NOTIFY_KEY, JSON.stringify([...notifiedUnlockIds]));
}

function showSystemToast(message, options = {}) {
    const toast = document.getElementById('music-toast');
    nếu (!toast) trả về;

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

function notifyUnlockedMessages(allMessages, today) {
    const unlockedMessages = allMessages.filter((m) => today >= m.unlockDate);

    nếu (!unlockWatcherInitialized) {
        unlockedMessages.forEach((m) => notifiedUnlockIds.add(m.id));
        saveNotifiedUnlockIds();
        unlockWatcherInitialized = true;
        trở lại;
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
        loại: 'capsule_unlocked',
        unlockMessageIds: newlyUnlocked.map((m) => m.id).filter(Boolean),
        senderName: latest.sender || 'một bạn',
        nội dung: tin nhắn
    });

    nếu ('Thông báo' trong cửa sổ và quyền Thông báo === 'đã cấp') {
        new Notification('Hộp thư thời gian', { body: message });
    }
}

hàm getOnlineStateFromTimestamp(lastActiveAt) {
    nếu (!lastActiveAt) trả về false;
    return Date.now() - Number(lastActiveAt) <= ONLINE_ACTIVE_WINDOW_MS;
}

hàm cập nhật huy hiệu trực tuyến của riêng bạn() {
    const badge = document.getElementById('online-status');
    nếu (!badge) trả về;

    const isOnline = navigator.onLine;
    huy hiệu.textContent = isOnline ? 'Trực tuyến' : 'Ngoại tuyến';
    badge.classList.toggle('online', isOnline);
    badge.classList.toggle('offline', !isOnline);
}

hàm bất đồng bộ updateMyPresence() {
    const user = getCurrentUser();
    nếu (!user?.email) trả về;

    updateOwnOnlineBadge();

    thử {
        const snap = await db.collection('users').where('email', '==', user.email).limit(1).get();
        nếu (!snap.empty) {
            await db.collection('users').doc(snap.docs[0].id).update({
                lastActiveAt: Date.now(),
                isOnline: navigator.onLine
            });
        }
    } bắt (e) {
        console.warn('Không cập nhật được trạng thái online:', e);
    }
}

hàm startPresenceTracking() {
    updateMyPresence();
    if (presenceInterval) clearInterval(presenceInterval);
    presenceInterval = setInterval(updateMyPresence, 45000);
}

hàm stopPresenceTracking() {
    nếu (presenceInterval) {
        clearInterval(presenceInterval);
        presenceInterval = null;
    }
}

hàm getChatKey(emailA, emailB) {
    return [emailA, emailB].map((s) => (s || '').toLowerCase()).sort().join('__');
}

hàm getPrivateConversationRef(emailA, emailB) {
    return db.collection('private_messages').doc(getChatKey(emailA, emailB));
}

hàm getPrivateMessagesRef(emailA, emailB) {
    return getPrivateConversationRef(emailA, emailB).collection('tin_nhan');
}

hàm getReadMarkerKey(email = '') {
    return (email || '').toLowerCase().replace(/\./g, ',');
}

hàm getReadTimestampFromConversation(data, email) {
    const key = getReadMarkerKey(email);
    return Number(data?.readBy?.[key] || 0);
}

function syncConversationReadState(otherEmail, timestamp = Date.now()) {
    const me = getCurrentUser();
    if (!me?.email || !otherEmail) return Promise.resolve();

    const key = (otherEmail || '').toLowerCase();
    const ts = Number(timestamp || 0);
    nếu (!ts || ts <= Number(lastRemoteReadSyncByEmail[key] || 0)) {
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

hàm toggleChatPanel() {
    const panel = document.getElementById('chat-panel');
    panel?.classList.toggle('show');
}

hàm đóng cửa trò chuyện riêng tư() {
    const panel = document.getElementById('chat-panel');
    panel?.classList.remove('in-conversation');
    selectedChatUser = null;
    nếu (chatUnsubscribe) {
        chatUnsubscribe();
        chatUnsubscribe = null;
    }
    nếu (chatConversationUnsubscribe) {
        chatConversationUnsubscribe();
        chatConversationUnsubscribe = null;
    }
    const box = document.getElementById('chat-messages');
    if (box) box.innerHTML = '';
    document.getElementById('emoji-picker')?.classList.remove('show');
}

hàm saveChatReadState() {
    localStorage.setItem(CHAT_READ_KEY, JSON.stringify(chatReadState));
}

hàm cập nhật huy hiệu chưa đọc tin nhắn toàn cầu() {
    const badge = document.getElementById('chat-unread-badge');
    const toggleBtn = document.getElementById('chat-toggle-btn');
    nếu (!badge) trả về;

    const senders = Object.values(unreadCountsByEmail).filter((c) => Number(c) > 0).length;
    nếu (người gửi <= 0) {
        badge.style.display = 'none';
        badge.textContent = '0';
        toggleBtn?.classList.remove('has-unread');
        toggleBtn?.setAttribute('aria-label', 'Chat');
        trở lại;
    }

    badge.style.display = 'inline-flex';
    badge.textContent = senders > 99 ? '99+' : String(senders);
    toggleBtn?.classList.add('has-unread');
    toggleBtn?.setAttribute('aria-label', `Chat (${badge.textContent} người gửi tin nhắn mới)`);
}

function markChatAsRead(otherEmail, timestamp = Date.now()) {
    nếu (!otherEmail) trả về;
    const key = otherEmail.toLowerCase();
    chatReadState[key] = Math.max(Number(chatReadState[key] || 0), Number(timestamp || 0));
    unreadCountsByEmail[key] = 0;
    saveChatReadState();
    updateGlobalChatUnreadBadge();
}

hàm sắp xếp người dùng trò chuyện theo người dùng mới nhất {
    trả về [...người dùng].sort((a, b) => {
        const aTs = Number(lastMessageAtByEmail[(a.email || '').toLowerCase()] || 0);
        const bTs = Number(lastMessageAtByEmail[(b.email || '').toLowerCase()] || 0);
        if (bTs !== aTs) return bTs - aTs;
        return (a.name || '').localeCompare(b.name || '');
    });
}

hàm initRecentMessagesRanking() {
    const me = getCurrentUser();
    nếu (!me?.email) trả về;

    if (recentMessagesUnsubscribe) recentMessagesUnsubscribe();

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
                nếu (!khác) trả về;

                const ts = Number(data.lastMessageAt || 0);
                nếu (!latest[other] || ts > latest[other]) {
                    latest[other] = ts;
                    latestPreview[other] = {
                        văn bản: data.lastMessageText || '',
                        tên người gửi: data.lastSenderName || '',
                        isFromMe: (data.lastSenderEmail || '').toLowerCase() === myEmail
                    };
                }

                const lastRead = Number(chatReadState[other] || 0);
                const isIncoming = (data.lastSenderEmail || '').toLowerCase() === other;
                const isInOpenChat = selectedChatUser && other === (selectedChatUser.email || '').toLowerCase();

                if (isIncoming && ts > lastRead && !isInOpenChat) {
                    chưa đọc[khác] = 1;
                }
            });

            lastMessageAtByEmail = latest;
            latestMessagePreviewByEmail = latestPreview;
            unreadCountsByEmail = unread;
            updateGlobalChatUnreadBadge();
            if (allChatUsers.length) renderChatUsers(allChatUsers);
        }, (lỗi) => {
            console.warn('Không tải được xếp hạng tin nhắn mới nhất:', error);
        });
}

hàm filterChatUsersByKeyword(users) {
    const keyword = (chatUserSearchKeyword || "").trim().toLowerCase();
    nếu (!từ khóa) trả về người dùng;

    trả về users.filter((u) => {
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

hàm setupMobileChatKeyboardBehavior() {
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
        nếu (!isTyping) {
            resetPanelPosition();
            trở lại;
        }

        const keyboardHeight = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
        nếu (chiều cao bàn phím < 80) {
            resetPanelPosition();
            trở lại;
        }

        panel.classList.add('keyboard-open');
        panel.style.setProperty('--chat-keyboard-offset', `${keyboardHeight + 10}px`);
    };

    viewport.addEventListener('resize', applyPanelPosition);
    viewport.addEventListener('scroll', applyPanelPosition);
    chatInput.addEventListener('focus', () => setTimeout(applyPanelPosition, 60));
    chatInput.addEventListener('blur', resetPanelPosition);
}

hàm renderChatUsers(users) {
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
        const statusText = online ? 'Trực tuyến' : (lastSeen || 'Ngoại tuyến');
        const statusClass = online ? 'online' : (lastSeen && lastSeen !== 'Offline' ? 'recent' : 'long-offline');

        return `<div class="chat-user-item ${online ? 'online' : ''}" onclick="openPrivateChatByEmail('${email}')">
            <span class="dot"></span>
            <img class="comment-avatar" src="${avatar}" alt="avatar">
            <div class="chat-user-texts">
                <div class="chat-user-head">
                    <span class="chat-user-label">${u.name || u.email}</span>
                    <span class="chat-user-status ${statusClass}">${statusText}</span>
                </div>
                <span class="chat-user-preview">${safePreview}</span>
            </div>
            <span class="chat-user-unread ${unreadCount > 0 ? 'show' : ''}">${unreadCount > 99 ? '99+' : unreadCount}</span>
        </div>`;
    }).tham gia('');

    nếu (!filteredUsers.length) {
        list.innerHTML = '<p style="color:#888;padding:8px 6px;">Không tìm thấy người phù hợp.</p>';
    }
}

hàm mở cuộc trò chuyện riêng với người dùng(user) {
    if (!user?.email) return false;

    selectedChatUser = user;
    const panel = document.getElementById('chat-panel');
    panel?.classList.add('show');
    panel?.classList.add('in-conversation');
    document.getElementById('emoji-picker')?.classList.remove('show');
    document.getElementById('chat-target-name').textContent = selectedChatUser.name || selectedChatUser.email;
    markChatAsRead(selectedChatUser.email);
    if (allChatUsers.length) renderChatUsers(allChatUsers);
    loadPrivateMessages();
    Trả về giá trị đúng;
}

hàm mở cuộc trò chuyện riêng tư qua email (email) {
    const user = chatUsersCache.find((u) => (u.email || '').toLowerCase() === (email || '').toLowerCase())
        || allChatUsers.find((u) => (u.email || '').toLowerCase() === (email || '').toLowerCase())
        || null;
    nếu (!user) trả về;

    openPrivateChatWithUser(user);
}

hàm initPrivateChatUsers() {
    initRecentMessagesRanking();

    nếu (usersUnsubscribe) usersUnsubscribe();
    usersUnsubscribe = db.collection('users').onSnapshot((snap) => {
        const users = [];
        snap.forEach((doc) => users.push(doc.data()));
        allChatUsers = users;
        renderChatUsers(users);
    });
}

hàm loadPrivateMessages() {
    const me = getCurrentUser();
    if (!selectedChatUser || !me?.email) return;

    const messagesBox = document.getElementById('chat-messages');
    const conversationRef = getPrivateConversationRef(me.email, selectedChatUser.email);

    if (chatUnsubscribe) chatUnsubscribe();
    if (chatConversationUnsubscribe) chatConversationUnsubscribe();

    let latestDocs = [];
    let otherReadTs = 0;

    const renderMessages = () => {
        nếu (!messagesBox) trả về;

        const docs = [...latestDocs].sort((a, b) => {
            const tsDiff = Number(a.createdAt || 0) - Number(b.createdAt || 0);
            if (tsDiff !== 0) return tsDiff;
            return String(a.id || '').localeCompare(String(b.id || ''));
        });

        let html = '';
        let latestIncomingTs = 0;
        let latestOutgoingTs = 0;
        let lastRenderedDateKey = '';

        docs.forEach((data) => {
            const isMe = (data.senderEmail || '').toLowerCase() === me.email.toLowerCase();
            const safeText = escapeHtml(data.text || '');
            const senderName = escapeHtml(data.senderName || (isMe ? (me.name || 'Bạn') : (selectedChatUser?.name || 'Bạn ấy')));
            const timeText = formatChatTime(data.createdAt);
            const ts = Number(data.createdAt || 0);
            const dateKey = getChatDateKey(ts);

            nếu (dateKey && dateKey !== lastRenderedDateKey) {
                html += `<div class="chat-time-separator">${escapeHtml(formatChatCenterDateTime(ts))}</div>`;
                LastRenderedDateKey = dateKey;
            }

            if (!isMe && ts > latestIncomingTs) latestIncomingTs = ts;
            if (isMe && ts > latestOutgoingTs) latestOutgoingTs = ts;

            html += `<div class="chat-bubble ${isMe ? 'me' : 'other'}">${safeText}<span class="meta">${senderName} • ${timeText}</span></div>`;
        });

        nếu (latestOutgoingTs && otherReadTs >= latestOutgoingTs) {
            html += '<div class="chat-read-receipt" style="text-align:right;color:#9aa2ff;font-size:12px;margin-top:6px;"> xem</div>';
        }

        if (latestIncomingTs && selectedChatUser?.email) {
            markChatAsRead(selectedChatUser.email, latestIncomingTs);
            syncConversationReadState(selectedChatUser.email, latestIncomingTs);
            if (allChatUsers.length) renderChatUsers(allChatUsers);
        }

        messagesBox.innerHTML = html || '<p style="color:#888">Chưa có tin nhắn nào.</p>';
        messagesBox.scrollTop = messagesBox.scrollHeight;
    };

    nếu (messagesBox) {
        messagesBox.innerHTML = '<p style="color:#888">Đang tải tin nhắn...</p>';
    }

    chatConversationUnsubscribe = conversationRef.onSnapshot((doc) => {
        const data = doc.data() || {};
        otherReadTs = getReadTimestampFromConversation(data, selectedChatUser?.email || '');
        renderMessages();
    }, (lỗi) => {
        console.warn('Không tải được trạng thái đã xem của cuộc trò chuyện:', error);
    });

    chatUnsubscribe = getPrivateMessagesRef(me.email, selectedChatUser.email)
        .orderBy('createdAt', 'desc')
        .limit(PRIVATE_CHAT_LIMIT)
        .onSnapshot((snap) => {
            latestDocs = [];
            snap.forEach((doc) => latestDocs.push({ id: doc.id, ...doc.data() }));
            renderMessages();
        }, (lỗi) => {
            console.error('Lỗi tải tin nhắn riêng:', error);
            nếu (messagesBox) {
                messagesBox.innerHTML = '<p style="color:#d33">Không tải được tin nhắn. Kiểm tra Firestore rules/index.</p>';
            }
        });
}

hàm bất đồng bộ sendPrivateMessage() {
    const me = getCurrentUser();
    const input = document.getElementById('chat-input');
    const text = input?.value.trim();
    if (!me?.email || !selectedChatUser?.email || !text) return;

    thử {
        const now = Date.now();
        const conversationRef = getPrivateConversationRef(me.email, selectedChatUser.email);
        const docRef = getPrivateMessagesRef(me.email, selectedChatUser.email).doc();

        const payload = {
            chatKey: getChatKey(me.email, selectedChatUser.email),
            người tham gia: [me.email.toLowerCase(), selectedChatUser.email.toLowerCase()],
            senderEmail: me.email.toLowerCase(),
            tên người gửi: me.name || tôi.email,
            senderAvatar: me.avatar || buildAvatarUrl(me.name || me.email),
            receiverEmail: selectedChatUser.email.toLowerCase(),
            chữ,
            createdAt: now
        };

        const batch = db.batch();
        batch.set(docRef, payload);
        batch.set(conversationRef, {
            chatKey: payload.chatKey,
            người tham gia: payload.người tham gia,
            lastSenderEmail: payload.senderEmail,
            lastSenderName: payload.senderName,
            lastMessageText: văn bản,
            lastMessageAt: bây giờ,
            updatedAt: now,
            messagesPath: `private_messages/${payload.chatKey}/tin_nhan`,
            readBy: {
                [getReadMarkerKey(payload.senderEmail)]: bây giờ
            }
        }, { merge: true });
        chờ batch.commit();

        chờ queueNotificationEvent(`chat_${docRef.id}`, {
            loại: 'chat_new_message',
            messageId: docRef.id,
            senderEmail: me.email.toLowerCase(),
            tên người gửi: me.name || tôi.email,
            receiverEmail: selectedChatUser.email.toLowerCase(),
            textPreview: text.slice(0, 120),
            sentAt: now
        });
        const otherEmail = selectedChatUser.email.toLowerCase();
        lastMessageAtByEmail[otherEmail] = now;
        latestMessagePreviewByEmail[otherEmail] = {
            chữ,
            tên người gửi: me.name || tôi.email,
            isFromMe: true
        };
        if (allChatUsers.length) renderChatUsers(allChatUsers);

        input.value = '';
        document.getElementById('emoji-picker')?.classList.remove('show');
    } bắt (e) {
        console.error('Không gửi được tin nhắn riêng:', e);
        alert('Gửi tin nhắn thất bại. Vui lòng thử lại.');
    }
}

hàm escapeHtml(giá trị = '') {
    giá trị trả về
        .replace(/&/g, '&')
        .replace(/</g, '<')
        .replace(/>/g, '>')
        .replace(/"/g, '"')
        .replace(/'/g, ''');
}

hàm isSameLocalDate(a, b) {
    return a.getFullYear() === b.getFullYear()
        && a.getMonth() === b.getMonth()
        && a.getDate() === b.getDate();
}

hàm getChatDateKey(timestamp) {
    const ts = Number(timestamp || 0);
    nếu (!ts) trả về '';
    const d = new Date(ts);
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

hàm formatChatCenterDateTime(timestamp) {
    const ts = Number(timestamp || 0);
    nếu (!ts) trả về '';
    const d = new Date(ts);
    const timeText = d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
    return `${timeText} ${d.getDate()} Tháng ${d.getMonth() + 1}, ${d.getFullYear()}`;
}

hàm formatChatRecencyLabel(timestamp) {
    const ts = Number(timestamp || 0);
    nếu (!ts) trả về '';

    const now = new Date();
    const d = new Date(ts);
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);

    if (isSameLocalDate(d, now)) return 'Hôm nay';
    if (isSameLocalDate(d, yesterday)) return ' Hôm qua';

    return `${d.getDate()} Tháng ${d.getMonth() + 1}, ${d.getFullYear()}`;
}

hàm formatLastSeenLabel(lastActiveAt) {
    const ts = Number(lastActiveAt || 0);
    nếu (!ts) trả về '';

    const diff = Date.now() - ts;
    nếu (diff < 0) trả về 'Offline';

    hằng phút = 60 * 1000;
    hằng số giờ = 60 * phút;
    hằng ngày = 24 * giờ;
    hằng tuần = 7 * ngày;
    hằng tháng = 30 * ngày;

    if (diff < minute) return 'Vừa hoạt động';
    if (diff < hour) return `${Math.max(1, Math.floor(diff / minute))} phút trước`;
    if (diff < day) return `${Math.max(1, Math.floor(diff / hour))} giờ trước`;
    if (diff < 2 * day) return 'Hôm qua';
    if (diff < week) return `${Math.floor(diff / day)} ngày trước`;
    if (diff < month) return `${Math.floor(diff / week)} tuần trước`;

    Trả về 'Ngoại tuyến';
}

hàm formatChatTime(timestamp) {
    nếu (!timestamp) trả về '';
    const d = new Date(Number(timestamp));
    return d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

hàm khởi tạo EmojiPicker() {
    const picker = document.getElementById('emoji-picker');
    nếu (!picker) trả về;

    picker.innerHTML = CHAT_EMOJIS
        .map((emoji) => `<button class="emoji-item" onclick="appendEmoji('${emoji}')">${emoji}</button>`)
        .tham gia('');
}

hàm toggleEmojiPicker() {
    const picker = document.getElementById('emoji-picker');
    picker?.classList.toggle('show');
}

hàm appendEmoji(emoji) {
    const input = document.getElementById('chat-input');
    nếu (!input) trả về;
    input.value += emoji;
    input.focus();
}

function showAuthMessage(message, isError = true) {
    const err = document.getElementById('error-msg');
    const ok = document.getElementById('auth-success');
    if (!err || !ok) return;

    nếu (isError) {
        err.innerText = message;
        err.style.display = 'block';
        ok.style.display = 'none';
    } khác {
        ok.innerText = message;
        ok.style.display = 'block';
        err.style.display = 'none';
    }
}

hàm switchAuthTab(tab) {
    const isLogin = tab === 'login';
    document.getElementById('tab-login')?.classList.toggle('active', isLogin);
    document.getElementById('tab-register')?.classList.toggle('active', !isLogin);
    document.getElementById('auth-login')?.classList.toggle('active', isLogin);
    document.getElementById('auth-register')?.classList.toggle('active', !isLogin);
    showAuthMessage('', false);
    document.getElementById('error-msg').style.display = 'none';
    document.getElementById('auth-success').style.display = 'none';
}

hàm bindPasswordToggle(toggleId, passwordId) {
    const toggle = document.getElementById(toggleId);
    const passwordInput = document.getElementById(passwordId);
    if (!toggle || !passwordInput) return;

    toggle.addEventListener('change', () => {
        passwordInput.type = toggle.checked ? 'text' : 'password';
    });
}   

hàm initPasswordToggles() {
    bindPasswordToggle('toggle-login-password', 'login-password');
    bindPasswordToggle('toggle-register-password', 'register-password');
}

hàm bất đồng bộ đăng ký tài khoản() {
    const name = document.getElementById('register-name').value.trim();
    const phone = document.getElementById('register-phone').value.trim();
    const email = document.getElementById('register-email').value.trim().toLowerCase();
    const password = document.getElementById('register-password').value;

    const phoneRegex = /^0\d{9,10}$/;
    if (!name || !phone || !email || !password) return showAuthMessage('Vui lòng nhập đầy đủ họ tên, số điện thoại, email và mật khẩu.');
    if (!phoneRegex.test(phone)) return showAuthMessage('Số điện thoại chưa đúng định dạng (VD: 09xxxxxxxx).');
    if (password.length < 6) return showAuthMessage('Mật khẩu cần ít nhất 6 ký tự.');

    thử {
        const [emailSnap, phoneSnap] = await Promise.all([
            db.collection('users').where('email', '==', email).limit(1).get(),
            db.collection('users').where('phone', '==', phone).limit(1).get()
        ]);

        nếu (!emailSnap.empty || !phoneSnap.empty) {
            return showAuthMessage('Email hoặc số điện thoại đã được đăng ký.');
        }

        const avatar = buildAvatarUrl(name);    

        await db.collection('users').add({
            tên,
            điện thoại,
            e-mail,
            hình đại diện, 
            mật khẩu,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        const localAccounts = getSavedAccounts();
        nếu (!localAccounts.some((a) => a.email === email)) {
            localAccounts.push({ name, phone, email, avatar, password });
            saveAccounts(localAccounts);
        }

        document.getElementById('register-name').value = '';
        document.getElementById('register-phone').value = '';
        document.getElementById('register-email').value = '';
        document.getElementById('register-password').value = '';

        showAuthMessage('Tạo tài khoản thành công và đã lưu Firebase! Mời bạn đăng nhập.', false);
        switchAuthTab('đăng nhập');
    } bắt lỗi (error) {
        console.error('Lỗi đăng ký Firebase:', error);
        showAuthMessage('Không thể đăng ký lên Firebase. Vui lòng kiểm tra quyền Firestore hoặc thử lại.');
    }
}

hàm enterMainSite() {
    document.getElementById('password-screen').style.display = 'none';
    document.getElementById('main-content').style.display = 'block';

    const container = document.getElementById('music-container');
    container.style.display = 'block';
    playSong(currentSongIndex, { showToast: false, fromLogin: true });

    hoa giấy ({
        Số lượng hạt: 150,
        Độ rộng: 70,
        gốc: { y: 0.6 },
        màu sắc: ['#ff4d4d', '#ffffff', '#ff7e5f']
    });

    loadGallery();
    initMemoryMap();
    startCountdown();
    createLeaves();
    loadTimeCapsuleMessages();
    updateCurrentUserDisplay();
    startPresenceTracking();
    initPrivateChatUsers();
    autoEnablePushIfPossible();
    initAutoPushEnableOnFirstGesture();
}

hàm bất đồng bộ đăng xuất người dùng() {
    await updateMyPresence().catch(() => {});
    stopPresenceTracking();
    if (usersUnsubscribe) { usersUnsubscribe(); usersUnsubscribe = null; }
    if (recentMessagesUnsubscribe) { recentMessagesUnsubscribe(); recentMessagesUnsubscribe = null; }
    if (chatUnsubscribe) { chatUnsubscribe(); chatUnsubscribe = null; }
    if (chatConversationUnsubscribe) { chatConversationUnsubscribe(); chatConversationUnsubscribe = null; }
    if (galleryUnsubscribe) { galleryUnsubscribe(); galleryUnsubscribe = null; }
    const current = getCurrentUser();
    nếu (email hiện tại?) {
        thử {
            const snap = await db.collection('users').where('email', '==', current.email).limit(1).get();
            nếu (!snap.empty) {
                await db.collection('users').doc(snap.docs[0].id).update({ isOnline: false, lastActiveAt: Date.now() });
            }
        } bắt (e) {}
    }
    localStorage.removeItem(SESSION_KEY);
    updatePushButtonState(false);
    document.getElementById('main-content').style.display = 'none';
    document.getElementById('password-screen').style.display = 'flex';
    nếu (âm thanh) {
        audio.pause();
        syncMusicUI(false);
    }
    showAuthMessage('Bạn đã đăng xuất.', false);
    switchAuthTab('đăng nhập');
}

// 2. Hàm Tải Ảnh từ Firebase (Quan trọng nhất)
let currentYearFilter = 'all';

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
    nếu (playPauseIcon) {
        playPauseIcon.className = isPlaying ? 'fas fa-pause' : 'fas fa-play';
    }
    nếu (biểu tượng âm nhạc) {
        musicIcon.classList.toggle('rotating', isPlaying);
    }
}


let shouldResumeMusicOnGesture = false;

hàm requestMusicResumeOnGesture() {
    nếu (shouldResumeMusicOnGesture) trả về;
    shouldResumeMusicOnGesture = true;

    const resume = () => {
        nếu (!audio) trả về;
        audio.play().then(() => {
            shouldResumeMusicOnGesture = false;
            document.removeEventListener('click', resume, true);
            document.removeEventListener('touchstart', resume, true);
        }).catch(() => {});
    };

    document.addEventListener('click', resume, true);
    document.addEventListener('touchstart', resume, true);
}

nếu (âm thanh) {
    audio.loop = false;
    audio.removeEventListener('ended', changeMusic);
    audio.addEventListener('ended', changeMusic);
    audio.addEventListener('play', () => syncMusicUI(true));
    audio.addEventListener('pause', () => syncMusicUI(false));
}

// 2. Hàm mở Menu nhạc
hàm toggleMusicMenu() {
    const btn = document.getElementById('main-music-btn');
    const options = document.getElementById('music-options');
    const panel = document.getElementById('playlist-panel'); // Lấy thêm bảng danh sách

    btn.classList.toggle('active');
    options.classList.toggle('show');

    // NẾU menu chính đóng lại (không còn class active)
    nếu (!btn.classList.contains('active')) {
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
hàm togglePlaylistMenu() {
    const panel = document.getElementById('playlist-panel');
    panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    if(panel.style.display === 'block') renderPlaylist();
}

hàm renderPlaylist() {
    const listUI = document.getElementById('song-list');
    listUI.innerHTML = playlist.map((song, i) => 
        `<li onclick="playSong(${i})">${i === currentSongIndex ? '▶ ' : ''}${song.name}</li>`
    ).tham gia('');
}

hàm playSong(index, options = {}) {
    if (!audio || !playlist[index]) return;

    const { showToast = true, fromLogin = false } = options;
    currentSongIndex = index;

    const nextUrl = playlist[index].url;
    nếu (audio.src !== nextUrl) {
        audio.pause();
        audio.src = nextUrl;
        audio.load();
    } khác {
        audio.currentTime = 0;
    }

    audio.play().then(() => {
        if (showToast) showMusicToast(playlist[index].name);
    }).catch((e) => {
        console.log('Nhạc bị chặn:', e);
        nếu (từ đăng nhập) yêu cầu tiếp tục phát nhạc khi có cử chỉ (Gesture());
    });

    renderPlaylist();
}

hàm toggleMusic() {
    nếu (!audio) trả về;

    nếu (!audio.src) {
        phát bài hát(chỉ số bài hát hiện tại);
        trở lại;
    }

    nếu (âm thanh tạm dừng) {
        audio.play().catch((e) => console.log('Nhạc bị chặn:', e));
    } khác {
        audio.pause();
    }
}

function pauseMusicForBackground({ reset = false } = {}) {
    nếu (!audio) trả về;
    const wasPlaying = !audio.paused;

    audio.pause();
    nếu (đặt lại) audio.currentTime = 0;
    if (wasPlaying || reset) syncMusicUI(false);
}

hàm changeMusic() {
    currentSongIndex = (currentSongIndex + 1) % playlist.length;
    phát bài hát(chỉ số bài hát hiện tại);
}

hàm lọc theo năm (năm) {
    currentYearFilter = năm;
    // Cập nhật giao diện nút bấm
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.classList.remove('active');
        if(btn.innerText.includes(year) || (năm === 'tất cả' && btn.innerText === 'Tất cả')) {
            btn.classList.add('active');
        }
    });
    loadGallery(); // Tải lại ảnh theo năm đã chọn
}

hàm loadGallery() {
    const gallery = document.getElementById('galleryGrid');
    nếu (!gallery) trả về;

    nếu (galleryUnsubscribe) {
        galleryUnsubscribe();
        galleryUnsubscribe = null;
    }

    let query = db.collection("posts").orderBy("createdAt", "desc");
    nếu (currentYearFilter !== 'all') {
        truy vấn = truy vấn.where("năm", "==", currentYearFilter);
    }

    galleryUnsubscribe = query.onSnapshot((snapshot) => {
        gallery.innerHTML = ""; 
        snapshot.forEach((doc) => {
            const data = doc.data();
            const fileUrl = data.url || "";
            
            // Kiểm tra xem là video hay ảnh
            const isVideo = fileUrl.toLowerCase().includes('.mp4') || 
                            fileUrl.toLowerCase().includes('video/upload') || 
                            fileUrl.toLowerCase().includes('cloudinary');

            let mediaHtml = "";
            nếu (isVideo) {
            // Tạo link ảnh đại diện tự động từ Cloudinary
            hãy để posterUrl = fileUrl.replace("/upload/", "/upload/so_0/").replace(/\.[^/.]+$/, ".jpg");

            mediaHtml = `
                <div class="video-preview-container" onclick="openLightbox('${fileUrl}', true)">
                    <video 
                        src="${fileUrl}" 
                        poster="${posterUrl}"
                        tải trước="siêu dữ liệu" 
                        chơi trực tuyến
                        bị tắt tiếng
                        vòng lặp>
                        style="width:100%; height:250px; object-fit: cover; border-radius: 8px;">
                    </video>
                    <div class="play-button-overlay">▶</div>
                </div>`;
            } khác {
                // Với ảnh: truyền link trực tiếp vào hàm openLightbox
                mediaHtml = `<img src="${fileUrl}" onclick="openLightbox('${fileUrl}', false)" loading="lazy" alt="Kỷý">`;
            }

            const heartUsers = data.heartUsers || [];
            const hahaUsers = data.hahaUsers || [];
            const comments = data.comments || [];
            const commentHtml = comments.map(c => {
                const avatar = c.avatar || buildAvatarUrl(c.user || 'Thành viên');
                trả về `
                    <div class="each-comment">
                        <img class="comment-avatar" src="${avatar}" alt="avatar">
                        <div class="comment-text"><b>${c.user}:</b> ${c.text}</div>
                    </div>
                `;
            }).tham gia('');

            // Tạo danh sách tên để hiện khi rê chuột vào (Tooltip)
            const heartListHtml = heartUsers.length > 0 ? heartUsers.join("<br>") : "Chưa có ai trả lời";
            const hahaListHtml = hahaUsers.length > 0 ? hahaUsers.join("<br>") : "Chưa có ai haha";

            const card = document.createElement('div');
            card.className = 'card';
            card.setAttribute('data-aos', 'fade-up');
            card.setAttribute('data-post-id', doc.id);
            card.id = `post-${doc.id}`;
            card.innerHTML = `
                <div class="media-wrap">
                    ${mediaHtml}
                </div>
                <div class="comment-area">
                    <div class="reactions">
                        <button class="react-btn" onclick="handleReact('${doc.id}', 'hearts')">
                            ❤️ <span class="count">${heartUsers.length}</span>
                            <span class="tooltip-list">${heartListHtml}</span>
                        </button>
                        <button class="react-btn" onclick="handleReact('${doc.id}', 'hahas')">
                            😆 <span class="count">${hahaUsers.length}</span>
                            <span class="tooltip-list">${hahaListHtml}</span>
                        </button>
                    </div>
                    <p><strong>Kỷ niệm:</strong> ${data.caption || "Không có chú thích"}</p>

                    <div class="comment-list" id="comments-${doc.id}">
                        ${commentHtml}
                    </div>

                    <div class="comment-input-group">
                        <input type="text" placeholder="Viết bình luận..." id="input-${doc.id}" onkeypress="checkCommentEnter(event, '${doc.id}')">
                        <button onclick="addComment('${doc.id}')">Gửi</button>
                    </div>
                </div>
            `;
            gallery.appendChild(card);

            // Khởi tạo hiệu ứng nghiêng 3D
            VanillaTilt.init(card, {
                tối đa: 15,
                tốc độ: 400,
                ánh sáng chói: đúng,
                "Độ chói tối đa": 0.5,
                con quay hồi chuyển: đúng,
                tỉ lệ: 1,05
            });

            nếu (pendingScrollPostId && pendingScrollPostId === doc.id) {
                setTimeout(() => focusGalleryPost(doc.id), 150);
                pendingScrollPostId = null;
            }
        });
    });
}

window.openMemorySpotModal = openMemorySpotModal;
window.closeMemorySpotModal = closeMemorySpotModal;
window.focusGalleryPost = focusGalleryPost;

async function syncUserAvatarInAllComments(userEmail, oldName, newName, newAvatar) {
    const normalizedEmail = (userEmail || '').toLowerCase();
    if (!normalizedEmail && !oldName && !newName) return;

    thử {
        const postSnap = await db.collection('posts').get();
        if (postSnap.empty) return;

        const updates = [];
        postSnap.forEach((doc) => {
            const data = doc.data();
            const comments = Array.isArray(data.comments) ? data.comments : [];
            let changed = false;

            const nextComments = comments.map((comment) => {
                const commentEmail = (comment?.userEmail || '').toLowerCase();
                const commentName = comment?.user || '';
                const isSameUser = (normalizedEmail && commentEmail === normalizedEmail)
                    || (!!commentName && [oldName, newName].filter(Boolean).includes(commentName));

                nếu (!isSameUser) trả về bình luận;

                đã thay đổi = đúng;
                trở lại {
                    ...bình luận,
                    người dùng: newName || commentName,
                    userEmail: normalizedEmail || commentEmail,
                    avatar: newAvatar || comment.avatar || buildAvatarUrl(newName || commentName || 'Thành viên')
                };
            });

            nếu (đã thay đổi) {
                updates.push({ docId: doc.id, comments: nextComments });
            }
        });

        nếu (!updates.length) trả về;

        const chunkSize = 400;
        for (let i = 0; i < updates.length; i += chunkSize) {
            const chunk = updates.slice(i, i + chunkSize);
            const batch = db.batch();
            chunk.forEach((item) => {
                batch.update(db.collection('posts').doc(item.docId), { comments: item.comments });
            });
            chờ batch.commit();
        }
    } bắt lỗi (error) {
        console.warn('Không thể đồng bộ avatar vào bình luận cũ:', error);
    }
}

hàm getUserName() {
    const user = getCurrentUser();
    if (user?.name) return user.name;

    const fallbackName = localStorage.getItem('class_user_name');
    return fallbackName || 'Thành viên ẩn danh';
}

// Hàm gửi bình luận đã nâng cấp
hàm bất đồng bộ addComment(postId) {
    const input = document.getElementById(`input-${postId}`);
    const text = input.value.trim();
    nếu (!text) trả về;

    // Lấy tên người dùng trước khi gửi
    const userName = getUserName();
    const currentUser = normalizeUserAvatar(getCurrentUser());
    const avatar = currentUser?.avatar || buildAvatarUrl(userName);
    const userEmail = (currentUser?.email || '').toLowerCase();

    const postRef = db.collection("posts").doc(postId);
    thử {
        chờ postRef.update({
            bình luận: firebase.firestore.FieldValue.arrayUnion({
                user: userName, // Sử dụng tên vừa lấy được
                Email người dùng,
                avatar: avatar,
                văn bản: văn bản,
                thời gian: Date.now()
            })
        });
        input.value = ""; 
    } bắt lỗi (error) {
        console.error("Lỗi khi gửi bình luận: ", error);
        alert("Không thể gửi bình luận, vui lòng thử lại!");
    }
}

// Thêm tính năng: Nhấn Enter để gửi bình luận nhanh
hàm checkCommentEnter(e, postId) {
    nếu (e.key === "Enter") {
        addComment(postId);
    }
}


// 3. Hàm Thả Tim/Haha (Cập nhật lên Firebase)
hàm handleReact(postId, type) {
    const postRef = db.collection("posts").doc(postId);
    const increment = firebase.firestore.FieldValue.increment(1);
    
    nếu (type === 'hearts') {
        postRef.update({ hearts: increment });
    } khác {
        postRef.update({ hahas: increment });
    }
}

// 4. Đồng hồ đếm ngược (Sửa lỗi không chạy)
hàm startCountdown() {
    const examDate = new Date("Ngày 12 tháng 6 năm 2026 00:00:00").getTime();

    const timer = setInterval(function() {
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

        nếu (khoảng cách < 0) {
            clearInterval(timer);
            document.getElementById("timer").innerHTML = "CHÚC CẢ LỚP THI TỐT! 🎓";
        }
    }, 1000);
}

// 5. Kiểm tra mật khẩu và khởi động web
hàm bất đồng bộ checkPassword() {
    const loginIdentifier = document.getElementById('login-identifier').value.trim();
    const normalizedIdentifier = loginIdentifier.toLowerCase();
    const password = document.getElementById('login-password').value;
    if (!loginIdentifier || !password) return showAuthMessage('Vui lòng nhập email hoặc số điện thoại cùng mật khẩu để đăng nhập.');

    thử {
        const [emailSnap, phoneSnap] = await Promise.all([
            db.collection('users')
                .where('email', '==', normalizedIdentifier)
                .where('password', '==', password)
                .limit(1)
                .lấy(),
            db.collection('users')
                .where('phone', '==', loginIdentifier)
                .where('password', '==', password)
                .limit(1)
                .lấy()
        ]);

        let account = null;
        nếu (!emailSnap.empty) {
            tài khoản = emailSnap.docs[0].data();
        } else if (!phoneSnap.empty) {
            tài khoản = phoneSnap.docs[0].data();
        } khác {
            const accounts = getSavedAccounts();
            tài khoản = tài khoản.find((a) =>
                (a.email === normalizedIdentifier || a.phone === loginIdentifier) ​​​​&& a.password === mật khẩu
            ) || null;
        }

        if (!account) return showAuthMessage('Sai email/số điện thoại hoặc mật khẩu. Vui lòng thử lại.');   

        const sessionUser = normalizeUserAvatar({ name: account.name, phone: account.phone, email: account.email, avatar: account.avatar });
        localStorage.setItem(SESSION_KEY, JSON.stringify(sessionUser));
        localStorage.setItem('class_user_name', account.name);
        showAuthMessage('Đăng nhập thành công!', false);
        enterMainSite();
    } bắt lỗi (error) {
        console.error('Lỗi đăng nhập Firebase:', error);
        showAuthMessage('Không đăng nhập được do lỗi kết nối Firebase.');
    }
}

hàm createLeaves() {
    const container = document.getElementById('leaf-container');
    nếu (!container) trả về;
    container.innerHTML = ''; 

    for (let i = 0; i < 25; i++) {
        let leaf = document.createElement('div');
        leaf.className = 'leaf';
        
        // Các thông số ngẫu nhiên để hoa rơi tự nhiên hơn
        const startLeft = Math.random() * 100;
        const size = Math.random() * 12 + 8;
        const duration = Math.random() * 5 + 7;
        const delay = Math.random() * 10;

        leaf.style.left = startLeft + '%';
        leaf.style.width = size + 'px';
        leaf.style.height = (size * 0.7) + 'px';
        leaf.style.animationDuration = `${duration}s, 3s`; // Rơi và đu đưa
        leaf.style.animationDelay = `${delay}s, 0s`;

        container.appendChild(leaf);
    }
}

// 6. Các hàm bổ trợ (Lightbox, Hiệu ứng rơi...)
hàm openLightbox(url, isVideo) {
    const lightbox = document.getElementById('lightbox');
    const content = document.getElementById('lightboxContent');
    
    content.innerHTML = ""; // Xóa nội dung cũ
    
    nếu (isVideo) {
        content.innerHTML = `<video src="${url}" controls autoplay style="max-width:100%; max-height:80vh;"></video>`;
    } khác {
        content.innerHTML = `<img src="${url}" style="max-width:100%; max-height:80vh;">`;
    }
    
    lightbox.style.display = 'flex';
}

function closeLightbox() { document.getElementById('lightbox').style.display = 'none'; }

hàm createLeaves() {
    const container = document.getElementById('leaf-container');
    nếu (!container) trả về;
    
    container.innerHTML = ''; // Xóa sạch nếu có hoa cũ
    const leafCount = 30; // Số lượng cánh hoa

    for (let i = 0; i < leafCount; i++) {
        let leaf = document.createElement('div');
        leaf.className = 'leaf';
        
        // Ngẫu nhiên vị trí xuất hiện (0-100%)
        const startLeft = Math.random() * 100;
        // Ngẫu nhiên kích thước (từ 10px đến 20px)
        const size = Math.random() * 10 + 10;
        // Ngẫu nhiên thời gian rơi (từ 5s đến 10s)
        const duration = Math.random() * 5 + 5;
        // Ngẫu nhiên độ trễ (delay) để hoa không rơi cùng lúc
        const delay = Math.random() * 5;

        leaf.style.left = startLeft + '%';
        leaf.style.width = size + 'px';
        leaf.style.height = (size * 0.8) + 'px'; // Cánh hoa hơi thon
        leaf.style.animationDuration = duration + 's, 3s'; // Thời lượng cho 'rơi' và 'đung đưa'
        leaf.style.animationDelay = delay + 's, 0s';
        leaf.style.opacity = Math.random() * 0.5 + 0.5; // Độ trong suốt ngẫu nhiên

        container.appendChild(leaf);
    }
}

hàm showSurprise() {
    const allCards = document.querySelectorAll('.media-wrap');
    if (allCards.length === 0) return;

    const randomIndex = Math.floor(Math.random() * allCards.length);
    const randomCard = allCards[randomIndex];
    const media = randomCard.querySelector('img, video');
    nếu (!media) trả về;

    const isVideo = media.tagName.toLowerCase() === 'video';
    const sourceUrl = media.getAttribute('src') || media.currentSrc;
    nếu (!sourceUrl) trả về;

    openLightbox(sourceUrl, isVideo);
}

// Cho phép nhấn Enter để mở khóa
document.getElementById('login-password')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') checkPassword();
});

function resizeImageToDataUrl(file, maxSize = 640, quality = 0.85) {
    trả về Promise mới((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const img = new Image();
            img.onload = () => {
                let { width, height } = img;
                const scale = Math.min(1, maxSize / Math.max(width, height));
                chiều rộng = Math.max(1, Math.round(chiều rộng * tỷ lệ));
                chiều cao = Math.max(1, Math.round(chiều cao * tỉ lệ));

                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = chiều cao;
                const ctx = canvas.getContext('2d');
                nếu (!ctx) {
                    reject(new Error('Canvas không khả dụng'));
                    trở lại;
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

hàm fileToDataUrl(file) {
    trả về Promise mới((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('Không thể đọc file ảnh gốc'));
        reader.readAsDataURL(file);
    });
}

hàm bất đồng bộ handleProfileAvatarFileChange(event) {
    const file = event?.target?.files?.[0];
    nếu (!tệp tin) trả về;

    nếu (!file.type.startsWith('image/')) {
        alert('Vui lòng chọn file ảnh hợp lệ.');
        event.target.value = '';
        trở lại;
    }

    thử {
        let dataUrl = '';
        thử {
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
        nếu (xem trước) preview.src = dataUrl;
    } bắt lỗi (error) {
        console.error('Lỗi xử lý ảnh avatar:', error);
        alert('Không thể xử lý ảnh. Vui lòng thử ảnh khác hoặc dùng link ảnh.');
    }
}

hàm openProfileModal() {
    const user = normalizeUserAvatar(getCurrentUser());
    if (!user) return alert('Bạn cần đăng nhập để xem hồ sơ.');

    document.getElementById('profile-name').value = user.name || '';
    document.getElementById('profile-phone').value = user.phone || '';
    document.getElementById('profile-email').value = user.email || '';
    document.getElementById('profile-avatar').value = user.avatar || buildAvatarUrl(user.name);
    document.getElementById('profile-avatar-preview').src = user.avatar || buildAvatarUrl(user.name);
    const fileInput = document.getElementById('profile-avatar-file');
    if (fileInput) fileInput.value = '';
    document.getElementById('profile-modal').style.display = 'flex';
}

hàm closeProfileModal() {
    const modal = document.getElementById('profile-modal');
    if (modal) modal.style.display = 'none';
}

    hàm bất đồng bộ saveProfile() {
    const user = normalizeUserAvatar(getCurrentUser());
    nếu (!user) trả về;

    const oldName = user.name || '';
    const name = document.getElementById('profile-name').value.trim();
    const phone = document.getElementById('profile-phone').value.trim();
    const avatarInput = document.getElementById('profile-avatar').value.trim();
    const avatar = avatarInput || buildAvatarUrl(name || user.name);

    if (!name || !phone) return alert('Vui lòng nhập đầy đủ họ tên và số điện thoại.');

    thử {
        const snap = await db.collection('users').where('email', '==', user.email).limit(1).get();
        nếu (!snap.empty) {
            await db.collection('users').doc(snap.docs[0].id).update({ name, phone, avatar });
        }

        const accounts = getSavedAccounts();
        const idx = accounts.findIndex((a) => a.email === user.email);
        nếu (idx !== -1) {
            accounts[idx].name = name;
            accounts[idx].phone = phone;
            accounts[idx].avatar = avatar;
            saveAccounts(accounts);
        }

        const updated = { ...user, name, phone, avatar };
        localStorage.setItem(SESSION_KEY, JSON.stringify(updated));
        localStorage.setItem('class_user_name', name);
        await syncUserAvatarInAllComments(user.email, oldName, name, avatar);
        updateCurrentUserDisplay();
        closeProfileModal();
        alert('Đã cập nhật hồ sơ thành công!');
    } bắt lỗi (error) {
        console.error('Lỗi cập nhật hồ sơ:', error);
        alert('Không thể cập nhật hồ sơ. Vui lòng thử lại.');
    }
}

// Hàm xử lý thả cảm xúc (Lưu danh sách tên)
hàm bất đồng bộ handleReact(postId, type) {
    const userName = getUserName(); // Lấy tên người dùng đã lưu hoặc hỏi tên
    const postRef = db.collection("posts").doc(postId);
    
    const field = type === 'hearts' ? 'heartUsers' : 'hahaUsers';

    thử {
        const doc = await postRef.get();
        const data = doc.data();
        const userList = data[field] || [];

        nếu (userList.includes(userName)) {
            // Nếu đã thả rồi thì "Bỏ thích" (Xóa khỏi mảng)
            chờ postRef.update({
                [field]: firebase.firestore.FieldValue.arrayRemove(userName)
            });
        } khác {
            // Nếu chưa thả thì "Thêm vào" (Thêm vào mảng)
            chờ postRef.update({
                [field]: firebase.firestore.FieldValue.arrayUnion(userName)
            });
        }
    } bắt lỗi (error) {
        console.error("Lỗi tương tác:", error);
    }
}

hàm bất đồng bộ sendTimeCapsule() {
    const user = getCurrentUser();
    const sender = document.getElementById('capsule-sender').value.trim() || user?.name || '';
    const msg = document.getElementById('capsule-message').value.trim();
    const unlockDateValue = document.getElementById('unlock-date-input').value; // Định dạng YYYY-MM-DD
    
    if (!sender || !msg || !unlockDateValue) return alert("Vui lòng nhập đủ tên, lời nhắn và chọn ngày mở!");

    thử {
        await db.collection("messages").add({
            người gửi: người gửi,
            senderEmail: (user?.email || '').toLowerCase(),
            tin nhắn: msg,
            unlockDate: unlockDateValue, // Lưu ngày người dùng chọn
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        
        alert("💌 Thư đã được khóa lại cho đến ngày " + unlockDateValue);
        document.getElementById('capsule-message').value = '';
        document.getElementById('unlock-date-input').value = '';
    } Catch (e) { cảnh báo("Lỗi: " + e.message); }
}


// Hàm lọc thư ngay trên giao diện
hàm filterCapsules() {
    const searchText = document.getElementById('search-sender').value.toLowerCase();
    const statusFilter = document.getElementById('filter-status').value;
    const cards = document.querySelectorAll('.capsule-card');

    thẻ.forEach(thẻ => {
        const sender = card.querySelector('strong').innerText.toLowerCase();
        const isLocked = card.classList.contains('locked');
        
        let matchSearch = sender.includes(searchText);
        let matchStatus = (statusFilter === 'all') || 
                          (statusFilter === 'locked' && isLocked) || 
                          (statusFilter === 'unlocked' && !isLocked);

        nếu (matchSearch && matchStatus) {
            card.style.display = "flex";
        } khác {
            card.style.display = "none";
        }
    });
}

// Khai báo biến giới hạn cho phần Grid bên dưới
let limitCount = 6; 

hàm getFeaturedCarouselLimit() {
    const width = window.innerWidth || 390;
    if (width <= 420) return 4;
    if (width <= 560) return 5;
    trả về 6;
}

hàm loadTimeCapsuleMessages() {
    const today = new Date().toLocaleDateString('sv-SE');

    db.collection("messages").orderBy("unlockDate", "asc").onSnapshot((snapshot) => {
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
        nếu (carouselDiv) {
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
            
            nếu (isNewLoad) {
                card.style.animationDelay = `${(index % 6) * 0.15}s`;
            }

            listDiv.appendChild(card);
        });

        // Điều khiển nút Xem thêm
        nếu (loadMoreBtn) {
            loadMoreBtn.style.display = (allMessages.length > limitCount) ? "inline-block" : "none";
        }

        updateLetterCountdowns();
    });
}

hàm formatUnlockCountdown(unlockDate) {
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

hàm updateLetterCountdowns() {
    document.querySelectorAll('.letter-unlock-countdown').forEach((el) => {
        const unlockDate = el.dataset.unlockDate;
        nếu (!unlockDate) trả về;
        el.innerText = formatUnlockCountdown(unlockDate);
    });
}

// HÀM QUAN TRỌNG: Tạo HTML cho thẻ thư (Dùng chung cho cả 2 phần)
hàm createCardMarkup(data, isLocked) {
    const card = document.createElement('div');
    card.className = `capsule-card ${isLocked ? 'locked' : 'unlocked'}`;
    
    nếu (!isLocked) {
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

    nếu (!isLocked) {
        const replyBtn = card.querySelector('.letter-reply-mini-btn');
        replyBtn?.addEventListener('click', (event) => {
            event.stopPropagation();
            openLetter(data);
            toggleLetterReplyComposer();
        });
    }
    thẻ trả lại;
}

// Hàm khi nhấn nút Tải thêm
hàm loadMoreCapsules() {
    limitCount += 10; // Tăng thêm 10 thư mỗi lần nhấn
    loadTimeCapsuleMessages(); // Tải lại danh sách
}

// Hàm mở Modal thư to
hàm resetLetterReplyComposer() {
    const box = document.getElementById('letter-reply-box');
    const input = document.getElementById('letter-reply-input');
    if (box) box.style.display = 'none';
    nếu (đầu vào) input.value = '';
}

hàm toggleLetterReplyComposer() {
    const box = document.getElementById('letter-reply-box');
    const input = document.getElementById('letter-reply-input');
    nếu (!box) trả về;

    const isVisible = box.style.display === 'block';
    box.style.display = isVisible ? 'none' : 'block';
    if (!isVisible) input?.focus();
}

hàm bất đồng bộ findUserForCapsuleReply(letter) {
    const senderEmail = (letter?.senderEmail || '').toLowerCase();
    const senderName = (letter?.sender || '').trim().toLowerCase();
    const me = getCurrentUser();

    nếu (email người gửi) {
        const byEmail = allChatUsers.find((u) => (u.email || '').toLowerCase() === senderEmail);
        nếu (byEmail) trả về byEmail;
    }

    nếu (tên người gửi) {
        const byName = allChatUsers.find((u) => (u.name || '').trim().toLowerCase() === senderName);
        nếu (byName) trả về byName;
    }

    thử {
        nếu (email người gửi) {
            const snapByEmail = await db.collection('users').where('email', '==', senderEmail).limit(1).get();
            nếu (!snapByEmail.empty) {
                trả về normalizeUserAvatar(snapByEmail.docs[0].data());
            }
        }

        nếu (tên người gửi) {
            const snapByName = await db.collection('users').where('name', '==', letter.sender).limit(1).get();
            nếu (!snapByName.empty) {
                const found = snapByName.docs.map((d) => normalizeUserAvatar(d.data()))
                    .find((u) => (u.email || '').toLowerCase() !== (me?.email || '').toLowerCase());
                nếu (đã tìm thấy) trả về kết quả đã tìm thấy;
            }
        }
    } bắt lỗi (error) {
        console.warn('Không tìm được người viết thư để nhắn tin:', error);
    }

    trả về null;
}

hàm buildCapsuleReplyMessage(letter, replyText) {
    const sender = letter?.sender || 'Bạn';
    const unlockDate = letter?.unlockDate || '';
    const letterBody = (letter?.message || '').trim();
    const myText = (replyText || '').trim();

    const letterPreview = letterBody.length > 220 ? `${letterBody.slice(0, 220)}…` : letterBody;
    return `📨 Phản hồi thư của ${sender} (${unlockDate})
“${letterPreview}”

${myText}`.trim();
}

hàm bất đồng bộ sendReplyToCapsuleAuthor() {
    const me = getCurrentUser();
    if (!me?.email) return alert('Bạn cần đăng nhập để gửi tin nhắn.');
    if (!currentOpenedLetter || !currentOpenedLetter.message) return alert('Không tìm thấy thông tin bức thư để phản hồi.');

    const input = document.getElementById('letter-reply-input');
    const replyText = input?.value.trim() || '';
    if (!replyText) return alert('Hãy nhập lời nhắn trước khi gửi.');

    const targetUser = await findUserForCapsuleReply(currentOpenedLetter);
    nếu (!targetUser?.email) {
        return alert('Không tìm thấy tài khoản của người viết thư để mở chat riêng.');
    }

    if ((targetUser.email || '').toLowerCase() === (me.email || '').toLowerCase()) {
        return alert('Đây là thư của bạn, không thể tự gửi tin nhắn cho chính mình.');
    }

    openPrivateChatWithUser(targetUser);
    closeLetter();

    const chatInput = document.getElementById('chat-input');
    nếu (!chatInput) trả về;

    chatInput.value = buildCapsuleReplyMessage(currentOpenedLetter, replyText);
    chờ gửi tin nhắn riêng tư();
    resetLetterReplyComposer();
    showSystemToast(`Đã gửi phản hồi đến ${targetUser.name || targetUser.email}`, { icon: '📨', title: 'Phản hồi thư thành công' });
}

hàm openLetter(letter) {
    currentOpenedLetter = letter || null;
    document.getElementById('modal-sender').innerText = "Từ: " + (letter?.sender || 'Không rõ');
    document.getElementById('modal-date').innerText = "Ngày mở: " + (letter?.unlockDate || '---');
    const msgElement = document.getElementById('modal-message');
    msgElement.innerText = thư?.message || '';
    resetLetterReplyComposer();
    document.getElementById('letter-modal').style.display = 'flex';
}

// Hàm đóng Modal
hàm closeLetter() {
    document.getElementById('letter-modal').style.display = 'none';
    resetLetterReplyComposer();
}
    
// Đóng khi nhấn ra ngoài vùng thư
cửa sổ.onclick = hàm(sự kiện) {
    const modal = document.getElementById('letter-modal');
    const profileModal = document.getElementById('profile-modal');
    if (event.target == modal) closeLetter();
    if (event.target == profileModal) closeProfileModal();
}



document.addEventListener('keydown', (event) => {
    const modal = document.getElementById('letter-modal');
    if (!modal || modal.style.display !== 'flex') return;

    if (event.key === 'Escape' || event.key.toLowerCase() === 'x') {
        closeLetter();
    }
});

window.addEventListener('click', function(e) {
    const container = document.getElementById('music-container');
    const btn = document.getElementById('main-music-btn');    
    const options = document.getElementById('music-options');
    const panel = document.getElementById('playlist-panel');

    // Nếu click ra ngoài vùng music-container
    nếu (container && !container.contains(e.target)) {
        btn.classList.remove('active');
        options.classList.remove('show');
        if (panel) panel.style.display = 'none';
    }
});


window.addEventListener('DOMContentLoaded', () => {
    initPasswordToggles();
    setupFirebaseMessaging().catch((error) => {
        console.warn('Bỏ qua khởi tạo FCM:', error);
    });
    updateLetterCountdowns();
    setInterval(updateLetterCountdowns, 1000);

    initEmojiPicker();

    const avatarInput = document.getElementById('profile-avatar');
    avatarInput?.addEventListener('input', () => {
        const preview = document.getElementById('profile-avatar-preview');
        if (preview) preview.src = avatarInput.value.trim() || buildAvatarUrl('Avatar');
    });

    const avatarFileInput = document.getElementById('profile-avatar-file');
    avatarFileInput?.addEventListener('change', handleProfileAvatarFileChange);

    const chatUserSearchInput = document.getElementById('chat-user-search');
    chatUserSearchInput?.addEventListener('input', (event) => {
        hasUserTypedChatSearch = true;
        chatUserSearchKeyword = event.target.value || '';
        if (allChatUsers.length) renderChatUsers(allChatUsers);
    });

    chatUserSearchInput?.addEventListener('focus', () => {
        clearChatSearchAutofill(chatUserSearchInput);
    });

    clearChatSearchAutofill(chatUserSearchInput);
    setTimeout(() => clearChatSearchAutofill(chatUserSearchInput), 300);
    setTimeout(() => clearChatSearchAutofill(chatUserSearchInput), 1200);

    setupMobileChatKeyboardBehavior();

    nếu ('Thông báo' trong cửa sổ và quyền Thông báo === 'mặc định') {
        Notification.requestPermission().catch(() => {});
    }

    window.addEventListener('online', updateMyPresence);
    window.addEventListener('offline', updateMyPresence);
    document.addEventListener('visibilitychange', () => {
        const hasSession = !!getCurrentUser();
        nếu (!hasSession) trả về;

        nếu (document.visibilityState === 'visible') {
            startPresenceTracking();
            updateMyPresence();
            trở lại;
        }

        stopPresenceTracking();
        pauseMusicForBackground();
    });

    window.addEventListener('pagehide', () => {
        stopPresenceTracking();
        pauseMusicForBackground({ reset: true });
    });
    
    const user = getCurrentUser();
    nếu (người dùng) {
        enterMainSite();
    } khác {
        switchAuthTab('đăng nhập');
    }
    updateCurrentUserDisplay();
});
