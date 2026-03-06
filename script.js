// 1. Cấu hình Firebase
const firebaseConfig = {
    apiKey: "AIzaSyA1lkOgOfvmM49o4G4B8ZgoMglAPjNdD5w",
    authDomain: "kyniemlop-d3404.firebaseapp.com",
    projectId: "kyniemlop-d3404",
    storageBucket: "kyniemlop-d3404.firebasestorage.app",
    messagingSenderId: "824232517330",
    appId: "1:824232517330:web:acf65afe55dac4d38b970b",
    measurementId: "G-XG46M01K89"
};

// Khởi tạo Firebase
if (!firebase.apps.length) {
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
let presenceInterval = null;
let usersUnsubscribe = null;
let recentMessagesUnsubscribe = null;
let chatUnsubscribe = null;
let selectedChatUser = null;
let chatUsersCache = [];
let allChatUsers = [];
let lastMessageAtByEmail = {};
let unreadCountsByEmail = {};
let chatReadState = JSON.parse(localStorage.getItem(CHAT_READ_KEY) || '{}');

const CHAT_EMOJIS = ['😀','😁','😂','🤣','😊','😍','🥰','😘','😎','🤩','😢','😭','😡','👍','👏','🙏','🔥','🎉','💖','💬','🌸','🎓','🫶','✨'];


const FCM_TOKEN_KEY = 'class_fcm_token';
const FCM_VAPID_PUBLIC_KEY = 'BFrdIOzjpU5hTbLY7PrS5LBZUZTFobgNH3jXd5CYu1akplI9gjZOx-gHMiadLZojTlY2sYMyveEApLRppP_yJq0';

let messaging = null;
let swRegistration = null;

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

    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        return 'Trình duyệt hiện tại chưa hỗ trợ đầy đủ Service Worker/Push API.';
    }

    return 'Thiết bị/trình duyệt chưa hỗ trợ Firebase Cloud Messaging.';
}

async function isFCMSupported() {
    if (fcmSupportCache !== null) return fcmSupportCache;

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

async function registerMessagingServiceWorker() {
    if (!('serviceWorker' in navigator)) return null;

    const basePath = getSiteBasePath();
    const candidates = basePath === '/'
        ? ['/firebase-messaging-sw.js']
        : [`${basePath}firebase-messaging-sw.js`, '/firebase-messaging-sw.js'];

    for (const swUrl of candidates) {
        try {
            const registration = await navigator.serviceWorker.register(swUrl, { scope: basePath });
            console.info(`FCM Service Worker đã đăng ký: ${swUrl}`);
            return registration;
        } catch (error) {
            console.warn(`Không đăng ký được SW tại ${swUrl}:`, error);
        }
    }

    return null;
}

async function setupFirebaseMessaging() {
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
        const title = payload?.notification?.title || payload?.data?.title || 'Thông báo mới';
        const body = payload?.notification?.body || payload?.data?.body || '';
        if (body) showSystemToast(body);

        if ('Notification' in window && Notification.permission === 'granted') {
            new Notification(title, { body });
        }
    });
}

async function saveFcmTokenForCurrentUser(token) {
    const user = getCurrentUser();
    if (!user?.email || !token) return;

    const snap = await db.collection('users').where('email', '==', user.email.toLowerCase()).limit(1).get();
    if (snap.empty) return;

    await db.collection('users').doc(snap.docs[0].id).update({
        fcmTokens: firebase.firestore.FieldValue.arrayUnion(token),
        fcmUpdatedAt: Date.now()
    });
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

// Cấu trúc chuẩn để tránh lỗi messaging/use-sw-after-get-token
async function getFcmTokenWithFallback(registration) {
    const messaging = firebase.messaging();
    
    try {
        // BƯỚC 1: Cấu hình Service Worker TRƯỚC
        messaging.useServiceWorker(registration); 

        // BƯỚC 2: Sau đó mới gọi getToken
        const currentToken = await messaging.getToken({
            vapidKey: 'BFrdIOzjp...' // Key của bạn
        });

        if (currentToken) {
            console.log("Đã lấy được Token thành công:", currentToken);
            return currentToken;
        }
    } catch (err) {
        console.error("Lỗi lấy Token:", err);
    }
}

function buildPushErrorMessage(error) {
    const code = String(error?.code || '');
    const message = String(error?.message || '');
    const lower = `${code} ${message}`.toLowerCase();

    if (code.includes('unsupported-browser')) {
        return getPushUnsupportedReason();
    }

    if (code.includes('permission-blocked')) {
        return 'Trình duyệt đang chặn thông báo. Hãy mở Site Settings và cho phép Notifications.';
    }

    if (lower.includes('api key not valid') || lower.includes('installations/request-failed')) {
        return 'Firebase API key đang không hợp lệ hoặc bị chặn theo domain. Đây KHÔNG phải lỗi VAPID. Hãy kiểm tra lại apiKey trong firebaseConfig và phần API key restrictions trên Google Cloud Console.';
    }

    if (code.includes('token-subscribe-failed') || message.includes('create-installation-request')) {
        return 'Không đăng ký được token push (FI 400). Thường do VAPID key không khớp project Firebase hoặc cấu hình app web chưa đúng.';
    }

    return 'Không thể bật thông báo đẩy. Kiểm tra Service Worker, domain HTTPS và cấu hình Firebase.';
}

async function enablePushNotifications() {
    if (!(await isFCMSupported())) {
        alert(getPushUnsupportedReason());
        return;
    }

    await setupFirebaseMessaging();

    if (!swRegistration) {
        alert(`Không đăng ký được Service Worker cho FCM. Hãy kiểm tra file firebase-messaging-sw.js có tồn tại ở ${getSiteBasePath()}firebase-messaging-sw.js`);
        return;
    }

    try {
        if ('Notification' in window && Notification.permission !== 'granted') {
            const permission = await Notification.requestPermission();
            if (permission !== 'granted') {
                alert('Bạn cần cho phép thông báo để nhận tin khi không mở tab web.');
                updatePushButtonState(false);
                return;
            }
        }

        const token = await getFcmTokenWithFallback();
        if (!token) {
            alert('Chưa lấy được FCM token. Vui lòng thử lại.');
            return;
        }

        localStorage.setItem(FCM_TOKEN_KEY, token);
        await saveFcmTokenForCurrentUser(token);
        updatePushButtonState(true);
        showSystemToast('Đã bật thông báo thông minh qua FCM.');
    } catch (error) {
        console.error('Bật thông báo đẩy thất bại:', error);
        alert(buildPushErrorMessage(error));
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

function getSavedAccounts() {
    return JSON.parse(localStorage.getItem(ACCOUNTS_KEY) || '[]');
}

function saveAccounts(accounts) {
    localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
}

function getCurrentUser() {
    return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
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

function showSystemToast(message) {
    const toast = document.getElementById('music-toast');
    if (!toast) return;

    toast.innerHTML = `🔔 ${message}`;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 5000);
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
    presenceInterval = setInterval(updateMyPresence, 30000);
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

function toggleChatPanel() {
    const panel = document.getElementById('chat-panel');
    panel?.classList.toggle('show');
}

function closePrivateChat() {
    const panel = document.getElementById('chat-panel');
    panel?.classList.remove('in-conversation');
    selectedChatUser = null;
    if (chatUnsubscribe) {
        chatUnsubscribe();
        chatUnsubscribe = null;
    }
    const box = document.getElementById('chat-messages');
    if (box) box.innerHTML = '';
    document.getElementById('emoji-picker')?.classList.remove('show');
}

function saveChatReadState() {
    localStorage.setItem(CHAT_READ_KEY, JSON.stringify(chatReadState));
}

function updateGlobalChatUnreadBadge() {
    const badge = document.getElementById('chat-unread-badge');
    if (!badge) return;

    const senders = Object.values(unreadCountsByEmail).filter((c) => Number(c) > 0).length;
    if (senders <= 0) {
        badge.style.display = 'none';
        return;
    }

    badge.style.display = 'inline-flex';
    badge.textContent = senders > 99 ? '99+' : String(senders);
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

    if (recentMessagesUnsubscribe) recentMessagesUnsubscribe();

    recentMessagesUnsubscribe = db.collection('private_messages')
        .where('participants', 'array-contains', me.email.toLowerCase())
        .onSnapshot((snap) => {
            const latest = {};
            const unread = {};
            const myEmail = me.email.toLowerCase();

            snap.forEach((doc) => {
                const data = doc.data();
                const sender = (data.senderEmail || '').toLowerCase();
                const receiver = (data.receiverEmail || '').toLowerCase();
                const other = sender === myEmail ? receiver : sender;
                if (!other) return;

                const ts = Number(data.createdAt || 0);
                if (!latest[other] || ts > latest[other]) latest[other] = ts;

                const lastRead = Number(chatReadState[other] || 0);
                const isIncoming = receiver === myEmail && sender === other;
                const isInOpenChat = selectedChatUser && other === (selectedChatUser.email || '').toLowerCase();

                if (isIncoming && ts > lastRead && !isInOpenChat) {
                    unread[other] = (unread[other] || 0) + 1;
                }
            });

            lastMessageAtByEmail = latest;
            unreadCountsByEmail = unread;
            updateGlobalChatUnreadBadge();
            if (allChatUsers.length) renderChatUsers(allChatUsers);
        }, (error) => {
            console.warn('Không tải được xếp hạng tin nhắn mới nhất:', error);
        });
}

function renderChatUsers(users) {
    const list = document.getElementById('chat-users');
    const me = getCurrentUser();
    if (!list || !me?.email) return;

    const others = users
        .filter((u) => (u.email || '').toLowerCase() !== me.email.toLowerCase());

    const sortedUsers = sortChatUsersByLatest(others);

    chatUsersCache = sortedUsers;

    list.innerHTML = sortedUsers.map((u) => {
        const online = getOnlineStateFromTimestamp(u.lastActiveAt) && !!u.isOnline;
        const avatar = u.avatar || buildAvatarUrl(u.name || 'Bạn');
        const email = (u.email || '').replace(/'/g, "\'");
        const unreadCount = Number(unreadCountsByEmail[(u.email || '').toLowerCase()] || 0);
        return `<div class="chat-user-item ${online ? 'online' : ''}" onclick="openPrivateChatByEmail('${email}')">
            <span class="dot"></span>
            <img class="comment-avatar" src="${avatar}" alt="avatar">
            <span class="chat-user-label">${u.name || u.email} • ${online ? 'Online' : 'Offline'}</span>
            <span class="chat-user-unread ${unreadCount > 0 ? 'show' : ''}">${unreadCount > 99 ? '99+' : unreadCount}</span>
        </div>`;
    }).join('');
}

function openPrivateChatByEmail(email) {
    selectedChatUser = chatUsersCache.find((u) => (u.email || '').toLowerCase() === (email || '').toLowerCase()) || null;
    if (!selectedChatUser) return;

    const panel = document.getElementById('chat-panel');
    panel?.classList.add('in-conversation');
    document.getElementById('emoji-picker')?.classList.remove('show');
    document.getElementById('chat-target-name').textContent = selectedChatUser.name || selectedChatUser.email;
    markChatAsRead(selectedChatUser.email);
    if (allChatUsers.length) renderChatUsers(allChatUsers);
    loadPrivateMessages();
}

function initPrivateChatUsers() {
    initRecentMessagesRanking();

    if (usersUnsubscribe) usersUnsubscribe();
    usersUnsubscribe = db.collection('users').onSnapshot((snap) => {
        const users = [];
        snap.forEach((doc) => users.push(doc.data()));
        allChatUsers = users;
        renderChatUsers(users);
    });
}

function loadPrivateMessages() {
    const me = getCurrentUser();
    if (!selectedChatUser || !me?.email) return;

    const messagesBox = document.getElementById('chat-messages');
    const key = getChatKey(me.email, selectedChatUser.email);

    if (chatUnsubscribe) chatUnsubscribe();

    const renderMessages = (snap) => {
        if (!messagesBox) return;
        const docs = [];
        snap.forEach((doc) => docs.push(doc.data()));
        docs.sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0));

        let html = '';
        let latestIncomingTs = 0;
        docs.forEach((data) => {
            const isMe = (data.senderEmail || '').toLowerCase() === me.email.toLowerCase();
            const safeText = escapeHtml(data.text || '');
            const senderName = escapeHtml(data.senderName || (isMe ? (me.name || 'Bạn') : (selectedChatUser?.name || 'Bạn ấy')));
            const timeText = formatChatTime(data.createdAt);
            const ts = Number(data.createdAt || 0);
            if (!isMe && ts > latestIncomingTs) latestIncomingTs = ts;
            html += `<div class="chat-bubble ${isMe ? 'me' : 'other'}">${safeText}<span class="meta">${senderName} • ${timeText}</span></div>`;
        });

        if (latestIncomingTs && selectedChatUser?.email) {
            markChatAsRead(selectedChatUser.email, latestIncomingTs);
            if (allChatUsers.length) renderChatUsers(allChatUsers);
        }

        messagesBox.innerHTML = html || '<p style="color:#888">Chưa có tin nhắn nào.</p>';
        messagesBox.scrollTop = messagesBox.scrollHeight;
    };

    chatUnsubscribe = db.collection('private_messages')
        .where('chatKey', '==', key)
        .onSnapshot(renderMessages, (error) => {
            console.error('Lỗi tải tin nhắn riêng:', error);
            if (messagesBox) {
                messagesBox.innerHTML = '<p style="color:#d33">Không tải được tin nhắn. Kiểm tra Firestore rules/index.</p>';
            }
        });
}

async function sendPrivateMessage() {
    const me = getCurrentUser();
    const input = document.getElementById('chat-input');
    const text = input?.value.trim();
    if (!me?.email || !selectedChatUser?.email || !text) return;

    try {
        const docRef = await db.collection('private_messages').add({
            chatKey: getChatKey(me.email, selectedChatUser.email),
            participants: [me.email.toLowerCase(), selectedChatUser.email.toLowerCase()],
            senderEmail: me.email.toLowerCase(),
            senderName: me.name || me.email,
            senderAvatar: me.avatar || buildAvatarUrl(me.name || me.email),
            receiverEmail: selectedChatUser.email.toLowerCase(),
            text,
            createdAt: Date.now()
        });

        await queueNotificationEvent(`chat_${docRef.id}`, {
            type: 'chat_new_message',
            messageId: docRef.id,
            senderEmail: me.email.toLowerCase(),
            senderName: me.name || me.email,
            receiverEmail: selectedChatUser.email.toLowerCase(),
            textPreview: text.slice(0, 120)
        });
        const otherEmail = selectedChatUser.email.toLowerCase();
        lastMessageAtByEmail[otherEmail] = Date.now();
        if (allChatUsers.length) renderChatUsers(allChatUsers);

        input.value = '';
        document.getElementById('emoji-picker')?.classList.remove('show');
    } catch (e) {
        console.error('Không gửi được tin nhắn riêng:', e);
        alert('Gửi tin nhắn thất bại. Vui lòng thử lại.');
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

function formatChatTime(timestamp) {
    if (!timestamp) return '';
    const d = new Date(Number(timestamp));
    return d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
}

function initEmojiPicker() {
    const picker = document.getElementById('emoji-picker');
    if (!picker) return;

    picker.innerHTML = CHAT_EMOJIS
        .map((emoji) => `<button class="emoji-item" onclick="appendEmoji('${emoji}')">${emoji}</button>`)
        .join('');
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
        const [emailSnap, phoneSnap] = await Promise.all([
            db.collection('users').where('email', '==', email).limit(1).get(),
            db.collection('users').where('phone', '==', phone).limit(1).get()
        ]);

        if (!emailSnap.empty || !phoneSnap.empty) {
            return showAuthMessage('Email hoặc số điện thoại đã được đăng ký.');
        }

        const avatar = buildAvatarUrl(name);    

        await db.collection('users').add({
            name,
            phone,
            email,
            avatar, 
            password,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        const localAccounts = getSavedAccounts();
        if (!localAccounts.some((a) => a.email === email)) {
            localAccounts.push({ name, phone, email, avatar, password });
            saveAccounts(localAccounts);
        }

        document.getElementById('register-name').value = '';
        document.getElementById('register-phone').value = '';
        document.getElementById('register-email').value = '';
        document.getElementById('register-password').value = '';

        showAuthMessage('Tạo tài khoản thành công và đã lưu Firebase! Mời bạn đăng nhập.', false);
        switchAuthTab('login');
    } catch (error) {
        console.error('Lỗi đăng ký Firebase:', error);
        showAuthMessage('Không thể đăng ký lên Firebase. Vui lòng kiểm tra quyền Firestore hoặc thử lại.');
    }
}

function enterMainSite() {
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
    startCountdown();
    createLeaves();
    loadTimeCapsuleMessages();
    updateCurrentUserDisplay();
    startPresenceTracking();
    initPrivateChatUsers();
    autoEnablePushIfPossible();
}

async function logoutUser() {
    await updateMyPresence().catch(() => {});
    stopPresenceTracking();
    if (usersUnsubscribe) { usersUnsubscribe(); usersUnsubscribe = null; }
    if (recentMessagesUnsubscribe) { recentMessagesUnsubscribe(); recentMessagesUnsubscribe = null; }
    if (chatUnsubscribe) { chatUnsubscribe(); chatUnsubscribe = null; }
    const current = getCurrentUser();
    if (current?.email) {
        try {
            const snap = await db.collection('users').where('email', '==', current.email).limit(1).get();
            if (!snap.empty) {
                await db.collection('users').doc(snap.docs[0].id).update({ isOnline: false, lastActiveAt: Date.now() });
            }
        } catch (e) {}
    }
    localStorage.removeItem(SESSION_KEY);
    updatePushButtonState(false);
    document.getElementById('main-content').style.display = 'none';
    document.getElementById('password-screen').style.display = 'flex';
    if (audio) {
        audio.pause();
        syncMusicUI(false);
    }
    showAuthMessage('Bạn đã đăng xuất.', false);
    switchAuthTab('login');
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
    loadGallery(); // Tải lại ảnh theo năm đã chọn
}

function loadGallery() {
    const gallery = document.getElementById('galleryGrid');
    if (!gallery) return;

    let query = db.collection("posts").orderBy("createdAt", "desc");
    if (currentYearFilter !== 'all') {
        query = query.where("year", "==", currentYearFilter);
    }

    query.onSnapshot((snapshot) => {
        gallery.innerHTML = ""; 
        snapshot.forEach((doc) => {
            const data = doc.data();
            const fileUrl = data.url || "";
            
            // Kiểm tra xem là video hay ảnh
            const isVideo = fileUrl.toLowerCase().includes('.mp4') || 
                            fileUrl.toLowerCase().includes('video/upload') || 
                            fileUrl.toLowerCase().includes('cloudinary');

            let mediaHtml = "";
            if (isVideo) {
            // Tạo link ảnh đại diện tự động từ Cloudinary
            let posterUrl = fileUrl.replace("/upload/", "/upload/so_0/").replace(/\.[^/.]+$/, ".jpg");

            mediaHtml = `
                <div class="video-preview-container" onclick="openLightbox('${fileUrl}', true)">
                    <video 
                        src="${fileUrl}" 
                        poster="${posterUrl}"
                        preload="metadata" 
                        playsinline
                        muted
                        loop>
                        style="width:100%; height:250px; object-fit: cover; border-radius: 8px;">
                    </video>
                    <div class="play-button-overlay">▶</div>
                </div>`;
            } else {
                // Với ảnh: truyền link trực tiếp vào hàm openLightbox
                mediaHtml = `<img src="${fileUrl}" onclick="openLightbox('${fileUrl}', false)" loading="lazy" alt="Kỷ niệm">`;
            }

            const heartUsers = data.heartUsers || [];
            const hahaUsers = data.hahaUsers || [];
            const comments = data.comments || [];
            const commentHtml = comments.map(c => {
                const avatar = c.avatar || buildAvatarUrl(c.user || 'Thành viên');
                return `
                    <div class="each-comment">
                        <img class="comment-avatar" src="${avatar}" alt="avatar">
                        <div class="comment-text"><b>${c.user}:</b> ${c.text}</div>
                    </div>
                `;
            }).join('');

            // Tạo danh sách tên để hiện khi rê chuột vào (Tooltip)
            const heartListHtml = heartUsers.length > 0 ? heartUsers.join("<br>") : "Chưa có ai thả tim";
            const hahaListHtml = hahaUsers.length > 0 ? hahaUsers.join("<br>") : "Chưa có ai haha";

            const card = document.createElement('div');
            card.className = 'card';
            card.setAttribute('data-aos', 'fade-up');
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
                max: 15,
                speed: 400,
                glare: true,
                "max-glare": 0.5,
                gyroscope: true,
                scale: 1.05
            });
        });
    });
}
function getUserName() {
    const user = getCurrentUser();
    if (user?.name) return user.name;

    const fallbackName = localStorage.getItem('class_user_name');
    return fallbackName || 'Thành viên ẩn danh';
}

// Hàm gửi bình luận đã nâng cấp
async function addComment(postId) {
    const input = document.getElementById(`input-${postId}`);
    const text = input.value.trim();
    if (!text) return;

    // Lấy tên người dùng trước khi gửi
    const userName = getUserName();
    const currentUser = normalizeUserAvatar(getCurrentUser());
    const avatar = currentUser?.avatar || buildAvatarUrl(userName);

    const postRef = db.collection("posts").doc(postId);
    try {
        await postRef.update({
            comments: firebase.firestore.FieldValue.arrayUnion({
                user: userName, // Sử dụng tên vừa lấy được
                avatar: avatar,
                text: text,
                time: Date.now()
            })
        });
        input.value = ""; 
    } catch (error) {
        console.error("Lỗi khi gửi bình luận: ", error);
        alert("Không thể gửi bình luận, vui lòng thử lại!");
    }
}

// Thêm tính năng: Nhấn Enter để gửi bình luận nhanh
function checkCommentEnter(e, postId) {
    if (e.key === "Enter") {
        addComment(postId);
    }
}


// 3. Hàm Thả Tim/Haha (Cập nhật lên Firebase)
function handleReact(postId, type) {
    const postRef = db.collection("posts").doc(postId);
    const increment = firebase.firestore.FieldValue.increment(1);
    
    if (type === 'hearts') {
        postRef.update({ hearts: increment });
    } else {
        postRef.update({ hahas: increment });
    }
}

// 4. Đồng hồ đếm ngược (Sửa lỗi không chạy)
function startCountdown() {
    const examDate = new Date("June 12, 2026 00:00:00").getTime();

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

        if (distance < 0) {
            clearInterval(timer);
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
        const [emailSnap, phoneSnap] = await Promise.all([
            db.collection('users')
                .where('email', '==', normalizedIdentifier)
                .where('password', '==', password)
                .limit(1)
                .get(),
            db.collection('users')
                .where('phone', '==', loginIdentifier)
                .where('password', '==', password)
                .limit(1)
                .get()
        ]);

        let account = null;
        if (!emailSnap.empty) {
            account = emailSnap.docs[0].data();
        } else if (!phoneSnap.empty) {
            account = phoneSnap.docs[0].data();
        } else {
            const accounts = getSavedAccounts();
            account = accounts.find((a) =>
                (a.email === normalizedIdentifier || a.phone === loginIdentifier) && a.password === password
            ) || null;
        }

        if (!account) return showAuthMessage('Sai email/số điện thoại hoặc mật khẩu. Vui lòng thử lại.');   

        const sessionUser = normalizeUserAvatar({ name: account.name, phone: account.phone, email: account.email, avatar: account.avatar });
        localStorage.setItem(SESSION_KEY, JSON.stringify(sessionUser));
        localStorage.setItem('class_user_name', account.name);
        showAuthMessage('Đăng nhập thành công!', false);
        enterMainSite();
    } catch (error) {
        console.error('Lỗi đăng nhập Firebase:', error);
        showAuthMessage('Không đăng nhập được do lỗi kết nối Firebase.');
    }
}

function createLeaves() {
    const container = document.getElementById('leaf-container');
    if (!container) return;
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
function openLightbox(url, isVideo) {
    const lightbox = document.getElementById('lightbox');
    const content = document.getElementById('lightboxContent');
    
    content.innerHTML = ""; // Xóa nội dung cũ
    
    if (isVideo) {
        content.innerHTML = `<video src="${url}" controls autoplay style="max-width:100%; max-height:80vh;"></video>`;
    } else {
        content.innerHTML = `<img src="${url}" style="max-width:100%; max-height:80vh;">`;
    }
    
    lightbox.style.display = 'flex';
}

function closeLightbox() { document.getElementById('lightbox').style.display = 'none'; }

function createLeaves() {
    const container = document.getElementById('leaf-container');
    if (!container) return;
    
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
        leaf.style.animationDuration = duration + 's, 3s'; // Duration cho 'fall' và 'swing'
        leaf.style.animationDelay = delay + 's, 0s';
        leaf.style.opacity = Math.random() * 0.5 + 0.5; // Độ trong suốt ngẫu nhiên

        container.appendChild(leaf);
    }
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

function openProfileModal() {
    const user = normalizeUserAvatar(getCurrentUser());
    if (!user) return alert('Bạn cần đăng nhập để xem hồ sơ.');

    document.getElementById('profile-name').value = user.name || '';
    document.getElementById('profile-phone').value = user.phone || '';
    document.getElementById('profile-email').value = user.email || '';
    document.getElementById('profile-avatar').value = user.avatar || buildAvatarUrl(user.name);
    document.getElementById('profile-avatar-preview').src = user.avatar || buildAvatarUrl(user.name);
    document.getElementById('profile-modal').style.display = 'flex';
}

function closeProfileModal() {
    const modal = document.getElementById('profile-modal');
    if (modal) modal.style.display = 'none';
}

    async function saveProfile() {
    const user = normalizeUserAvatar(getCurrentUser());
    if (!user) return;

    const name = document.getElementById('profile-name').value.trim();
    const phone = document.getElementById('profile-phone').value.trim();
    const avatarInput = document.getElementById('profile-avatar').value.trim();
    const avatar = avatarInput || buildAvatarUrl(name || user.name);

    if (!name || !phone) return alert('Vui lòng nhập đầy đủ họ tên và số điện thoại.');

    try {
        const snap = await db.collection('users').where('email', '==', user.email).limit(1).get();
        if (!snap.empty) {
            await db.collection('users').doc(snap.docs[0].id).update({ name, phone, avatar });
        }

        const accounts = getSavedAccounts();
        const idx = accounts.findIndex((a) => a.email === user.email);
        if (idx !== -1) {
            accounts[idx].name = name;
            accounts[idx].phone = phone;
            accounts[idx].avatar = avatar;
            saveAccounts(accounts);
        }

        const updated = { ...user, name, phone, avatar };
        localStorage.setItem(SESSION_KEY, JSON.stringify(updated));
        localStorage.setItem('class_user_name', name);
        updateCurrentUserDisplay();
        closeProfileModal();
        alert('Đã cập nhật hồ sơ thành công!');
    } catch (error) {
        console.error('Lỗi cập nhật hồ sơ:', error);
        alert('Không thể cập nhật hồ sơ. Vui lòng thử lại.');
    }
}

// Hàm xử lý thả cảm xúc (Lưu danh sách tên)
async function handleReact(postId, type) {
    const userName = getUserName(); // Lấy tên người dùng đã lưu hoặc hỏi tên
    const postRef = db.collection("posts").doc(postId);
    
    const field = type === 'hearts' ? 'heartUsers' : 'hahaUsers';

    try {
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
    }
}

async function sendTimeCapsule() {
    const user = getCurrentUser();
    const sender = document.getElementById('capsule-sender').value.trim() || user?.name || '';
    const msg = document.getElementById('capsule-message').value.trim();
    const unlockDateValue = document.getElementById('unlock-date-input').value; // Định dạng YYYY-MM-DD
    
    if (!sender || !msg || !unlockDateValue) return alert("Vui lòng nhập đủ tên, lời nhắn và chọn ngày mở!");

    try {
        await db.collection("messages").add({
            sender: sender,
            message: msg,
            unlockDate: unlockDateValue, // Lưu ngày người dùng chọn
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        
        alert("💌 Thư đã được khóa lại cho đến ngày " + unlockDateValue);
        document.getElementById('capsule-message').value = '';
        document.getElementById('unlock-date-input').value = '';
    } catch (e) { alert("Lỗi: " + e.message); }
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

function loadTimeCapsuleMessages() {
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

        // --- PHẦN 1: RENDER VÒNG QUAY (TOP 6) ---
        if (carouselDiv) {
            carouselDiv.innerHTML = "";
            const top6 = allMessages.slice(0, 6);
            top6.forEach((data, index) => {
                const isLocked = today < data.unlockDate;
                // Gọi hàm tạo card chi tiết bên dưới
                const card = createCardMarkup(data, isLocked); 
                
                // Thiết lập vị trí 3D
                const angle = index * 60; 
                const radius = 220; // Khoảng cách từ trục đến thư

                // CHỈ DÙNG TRANSFORM ĐỂ ĐỊNH VỊ 3D
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

// HÀM QUAN TRỌNG: Tạo HTML cho thẻ thư (Dùng chung cho cả 2 phần)
function createCardMarkup(data, isLocked) {
    const card = document.createElement('div');
    card.className = `capsule-card ${isLocked ? 'locked' : 'unlocked'}`;
    
    if (!isLocked) {
        card.onclick = () => openLetter(data.sender, data.unlockDate, data.message);
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
            ` : ''}
        </div>
    `;
    return card;
}

// Hàm khi nhấn nút Tải thêm
function loadMoreCapsules() {
    limitCount += 10; // Tăng thêm 10 thư mỗi lần nhấn
    loadTimeCapsuleMessages(); // Tải lại danh sách
}

// Hàm mở Modal thư to
function openLetter(sender, date, message) {
    document.getElementById('modal-sender').innerText = "Từ: " + sender;
    document.getElementById('modal-date').innerText = "Ngày hẹn mở: " + date;
    const msgElement = document.getElementById('modal-message');
    msgElement.innerText = message;
    document.getElementById('letter-modal').style.display = 'flex';
}

// Hàm đóng Modal
function closeLetter() {
    document.getElementById('letter-modal').style.display = 'none';
}
    
// Đóng khi nhấn ra ngoài vùng thư
window.onclick = function(event) {
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
    if (container && !container.contains(e.target)) {
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

    if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission().catch(() => {});
    }

    window.addEventListener('online', updateMyPresence);
    window.addEventListener('offline', updateMyPresence);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') updateMyPresence();
    });
    
    const user = getCurrentUser();
    if (user) {
        enterMainSite();
    } else {
        switchAuthTab('login');
    }
    updateCurrentUserDisplay();
});



