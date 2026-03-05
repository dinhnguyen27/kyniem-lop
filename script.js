// 1. Cấu hình Firebase
const firebaseConfig = {
    apiKey: "AIzaSyA1LkOgOfvmM49o4G4B8ZgoMglAPjNdD5w",
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

hàm isFCMSupported() {
    return !!(firebase.messaging && firebase.messaging.isSupported && firebase.messaging.isSupported());
}

hàm bất đồng bộ setupFirebaseMessaging() {
    if (!isFCMSupported()) return;
    nếu (thông báo) trả về;

    messaging = firebase.messaging();

    thử {
        if ('serviceWorker' trong bộ điều hướng) {
            swRegistration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
        }
    } bắt lỗi (error) {
        console.warn('Không thể đăng ký Service Worker cho FCM:', error);
    }

    messaging.onMessage((payload) => {
        const title = payload?.notification?.title || payload?.data?.title || 'Thông báo mới';
        const body = payload?.notification?.body || payload?.data?.body || '';
        nếu (body) showSystemToast(body);

        nếu ('Thông báo' trong cửa sổ và quyền Thông báo === 'đã cấp') {
            Thông báo mới(tiêu đề, { nội dung });
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

hàm bất đồng bộ enablePushNotifications() {
    nếu (!isFCMSupported()) {
        alert('Thiết bị/trình duyệt chưa hỗ trợ Firebase Cloud Messaging.');
        trở lại;
    }

    chờ thiết lập FirebaseMessaging();

    thử {
        nếu ('Thông báo' trong cửa sổ và quyền Thông báo khác với 'đã cấp') {
            const permission = await Notification.requestPermission();
            nếu (quyền cho phép khác 'đã cấp') {
                alert('Bạn cần cho phép thông báo để nhận tin khi không mở tab web.');
                updatePushButtonState(false);
                trở lại;
            }
        }

        const options = { vapidKey: FCM_VAPID_PUBLIC_KEY };
        if (swRegistration) options.serviceWorkerRegistration = swRegistration;

        const token = await messaging.getToken(options);
        nếu (!token) {
            alert('Chưa lấy được FCM token. Vui lòng thử lại.');
            trở lại;
        }

        localStorage.setItem(FCM_TOKEN_KEY, token);
        chờ lưu mã thông báo Fcm cho người dùng hiện tại (mã thông báo);
        updatePushButtonState(true);
        showSystemToast('Đã bật thông báo thông minh qua FCM.');
    } bắt lỗi (error) {
        console.error('Bật thông báo đẩy thất bại:', error);
        alert('Không thể bật thông báo đẩy. Hãy kiểm tra VAPID key trong script.js.');
    }
}

hàm bất đồng bộ autoEnablePushIfPossible() {
    if (!isFCMSupported()) return;
    if (!getCurrentUser()?.email) return;

    chờ thiết lập FirebaseMessaging();

    nếu ('Thông báo' trong cửa sổ và quyền Thông báo khác với 'đã cấp') {
        updatePushButtonState(false);
        trở lại;
    }

    thử {
        const options = { vapidKey: FCM_VAPID_PUBLIC_KEY };
        if (swRegistration) options.serviceWorkerRegistration = swRegistration;

        const token = await messaging.getToken(options);
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

hàm showSystemToast(message) {
    const toast = document.getElementById('music-toast');
    nếu (!toast) trả về;

    toast.innerHTML = `🔔 ${message}`;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 5000);
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
    presenceInterval = setInterval(updateMyPresence, 30000);
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
    const box = document.getElementById('chat-messages');
    if (box) box.innerHTML = '';
    document.getElementById('emoji-picker')?.classList.remove('show');
}

hàm saveChatReadState() {
    localStorage.setItem(CHAT_READ_KEY, JSON.stringify(chatReadState));
}

hàm cập nhật huy hiệu chưa đọc tin nhắn toàn cầu() {
    const badge = document.getElementById('chat-unread-badge');
    nếu (!badge) trả về;

    const senders = Object.values(unreadCountsByEmail).filter((c) => Number(c) > 0).length;
    nếu (người gửi <= 0) {
        badge.style.display = 'none';
        trở lại;
    }

    badge.style.display = 'inline-flex';
    badge.textContent = senders > 99 ? '99+' : String(senders);
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
            const unread = {};
            const myEmail = me.email.toLowerCase();

            snap.forEach((doc) => {
                const data = doc.data();
                const sender = (data.senderEmail || '').toLowerCase();
                const receiver = (data.receiverEmail || '').toLowerCase();
                const other = sender === myEmail ? receiver : sender;
                nếu (!khác) trả về;

                const ts = Number(data.createdAt || 0);
                if (!latest[other] || ts > latest[other]) latest[other] = ts;

                const lastRead = Number(chatReadState[other] || 0);
                const isIncoming = receiver === myEmail && sender === other;
                const isInOpenChat = selectedChatUser && other === (selectedChatUser.email || '').toLowerCase();

                if (isIncoming && ts > lastRead && !isInOpenChat) {
                    chưa đọc[khác] = (chưa đọc[khác] || 0) + 1;
                }
            });

            lastMessageAtByEmail = latest;
            unreadCountsByEmail = unread;
            updateGlobalChatUnreadBadge();
            if (allChatUsers.length) renderChatUsers(allChatUsers);
        }, (lỗi) => {
            console.warn('Không tải được xếp hạng tin nhắn mới nhất:', error);
        });
}

hàm renderChatUsers(users) {
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
            <span class="chat-user-label">${u.name || u.email} • ${online ? 'Trực tuyến' : 'Ngoại tuyến'}</span>
            <span class="chat-user-unread ${unreadCount > 0 ? 'show' : ''}">${unreadCount > 99 ? '99+' : unreadCount}</span>
        </div>`;
    }).tham gia('');
}

hàm mở cuộc trò chuyện riêng tư qua email (email) {
    selectedChatUser = chatUsersCache.find((u) => (u.email || '').toLowerCase() === (email || '').toLowerCase()) || null;
    nếu (!selectedChatUser) trả về;

    const panel = document.getElementById('chat-panel');
    panel?.classList.add('in-conversation');
    document.getElementById('emoji-picker')?.classList.remove('show');
    document.getElementById('chat-target-name').textContent = selectedChatUser.name || selectedChatUser.email;
    markChatAsRead(selectedChatUser.email);
    if (allChatUsers.length) renderChatUsers(allChatUsers);
    loadPrivateMessages();
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
    const key = getChatKey(me.email, selectedChatUser.email);

    if (chatUnsubscribe) chatUnsubscribe();

    const renderMessages = (snap) => {
        nếu (!messagesBox) trả về;
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
        const docRef = await db.collection('private_messages').add({
            chatKey: getChatKey(me.email, selectedChatUser.email),
            người tham gia: [me.email.toLowerCase(), selectedChatUser.email.toLowerCase()],
            senderEmail: me.email.toLowerCase(),
            tên người gửi: me.name || tôi.email,
            senderAvatar: me.avatar || buildAvatarUrl(me.name || me.email),
            receiverEmail: selectedChatUser.email.toLowerCase(),
            chữ,
            createdAt: Date.now()
        });

        chờ queueNotificationEvent(`chat_${docRef.id}`, {
            loại: 'chat_new_message',
            messageId: docRef.id,
            senderEmail: me.email.toLowerCase(),
            tên người gửi: me.name || tôi.email,
            receiverEmail: selectedChatUser.email.toLowerCase(),
            textPreview: text.slice(0, 120)
        });
        const otherEmail = selectedChatUser.email.toLowerCase();
        lastMessageAtByEmail[otherEmail] = Date.now();
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

hàm formatChatTime(timestamp) {
    nếu (!timestamp) trả về '';
    const d = new Date(Number(timestamp));
    return d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
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
    startCountdown();
    createLeaves();
    loadTimeCapsuleMessages();
    updateCurrentUserDisplay();
    startPresenceTracking();
    initPrivateChatUsers();
    autoEnablePushIfPossible();
}

hàm bất đồng bộ đăng xuất người dùng() {
    await updateMyPresence().catch(() => {});
    stopPresenceTracking();
    if (usersUnsubscribe) { usersUnsubscribe(); usersUnsubscribe = null; }
    if (recentMessagesUnsubscribe) { recentMessagesUnsubscribe(); recentMessagesUnsubscribe = null; }
    if (chatUnsubscribe) { chatUnsubscribe(); chatUnsubscribe = null; }
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

    let query = db.collection("posts").orderBy("createdAt", "desc");
    nếu (currentYearFilter !== 'all') {
        truy vấn = truy vấn.where("năm", "==", currentYearFilter);
    }

    truy vấn.onSnapshot((snapshot) => {
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
        });
    });
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

    const postRef = db.collection("posts").doc(postId);
    thử {
        chờ postRef.update({
            bình luận: firebase.firestore.FieldValue.arrayUnion({
                user: userName, // Sử dụng tên vừa lấy được
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

hàm openProfileModal() {
    const user = normalizeUserAvatar(getCurrentUser());
    if (!user) return alert('Bạn cần đăng nhập để xem hồ sơ.');

    document.getElementById('profile-name').value = user.name || '';
    document.getElementById('profile-phone').value = user.phone || '';
    document.getElementById('profile-email').value = user.email || '';
    document.getElementById('profile-avatar').value = user.avatar || buildAvatarUrl(user.name);
    document.getElementById('profile-avatar-preview').src = user.avatar || buildAvatarUrl(user.name);
    document.getElementById('profile-modal').style.display = 'flex';
}

hàm closeProfileModal() {
    const modal = document.getElementById('profile-modal');
    if (modal) modal.style.display = 'none';
}

    hàm bất đồng bộ saveProfile() {
    const user = normalizeUserAvatar(getCurrentUser());
    nếu (!user) trả về;

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

    thẻ.forMỗi(thẻ => {
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

        // --- PHẦN 1: RENDER VÒNG QUAY (TOP 6) ---
        nếu (carouselDiv) {
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
    thẻ trả lại;
}

// Hàm khi nhấn nút Tải thêm
hàm loadMoreCapsules() {
    limitCount += 10; // Tăng thêm 10 thư mỗi lần nhấn
    loadTimeCapsuleMessages(); // Tải lại danh sách
}

// Hàm mở Modal thư to
hàm openLetter(người gửi, ngày, tin nhắn) {
    document.getElementById('modal-sender').innerText = "Từ: " + sender;
    document.getElementById('modal-date').innerText = "Ngày hẹn mở: " + date;
    const msgElement = document.getElementById('modal-message');
    msgElement.innerText = tin nhắn;
    document.getElementById('letter-modal').style.display = 'flex';
}

// Hàm đóng Modal
hàm closeLetter() {
    document.getElementById('letter-modal').style.display = 'none';
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
    setupFirebaseMessaging();
    updateLetterCountdowns();
    setInterval(updateLetterCountdowns, 1000);

    initEmojiPicker();

    const avatarInput = document.getElementById('profile-avatar');
    avatarInput?.addEventListener('input', () => {
        const preview = document.getElementById('profile-avatar-preview');
        if (preview) preview.src = avatarInput.value.trim() || buildAvatarUrl('Avatar');
    });

    nếu ('Thông báo' trong cửa sổ và quyền Thông báo === 'mặc định') {
        Notification.requestPermission().catch(() => {});
    }

    window.addEventListener('online', updateMyPresence);
    window.addEventListener('offline', updateMyPresence);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') updateMyPresence();
    });
    
    const user = getCurrentUser();
    nếu (người dùng) {
        enterMainSite();
    } khác {
        switchAuthTab('đăng nhập');
    }
    updateCurrentUserDisplay();
});
