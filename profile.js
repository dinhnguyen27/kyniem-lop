const firebaseConfig = {
    apiKey: "AIzaSyA1lkOgOfvmM49o4G4B8ZgoMglAPjNdD5w",
    authDomain: "kyniemlop-d3404.firebaseapp.com",
    projectId: "kyniemlop-d3404",
    storageBucket: "kyniemlop-d3404.firebasestorage.app",
    messagingSenderId: "824232517330",
    appId: "1:824232517330:web:acf65afe55dac4d38b970b",
    measurementId: "G-XG46M01K89"
};

if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}

const db = firebase.firestore();
const SESSION_KEY = 'class_current_user';
const params = new URLSearchParams(window.location.search);
const profileId = (params.get('id') || '').trim().toLowerCase();
const currentUser = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
const headerEl = document.getElementById('profileHeader');

function buildAvatarUrl(name = 'Thành viên lớp') {
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=ff7e5f&color=fff`;
}

function parseTs(value) {
    if (!value) return 0;
    if (typeof value === 'number') return value;
    if (typeof value?.toMillis === 'function') return Number(value.toMillis() || 0);
    return 0;
}

function safeText(value = '') {
    return String(value || '').replace(/[&<>'"]/g, (char) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[char] || char));
}

function bindTabs() {
    document.querySelectorAll('.tab-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
            document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById(`tab-${btn.dataset.tab}`)?.classList.add('active');
        });
    });
}

function bindHeaderShrink() {
    const update = () => {
        const isCompact = window.scrollY > 120;
        headerEl?.classList.toggle('compact', isCompact);
    };
    window.addEventListener('scroll', update, { passive: true });
    update();
}

async function resolveProfileUser() {
    if (!profileId) return null;
    const snap = await db.collection('users').where('email', '==', profileId).limit(1).get();
    if (snap.empty) return null;
    return snap.docs[0].data();
}

async function resolvePosts(user) {
    if (!user) return [];
    let snap;
    try {
        snap = await db.collection('posts').where('email', '==', (user.email || '').toLowerCase()).orderBy('createdAt', 'desc').get();
    } catch (_) {
        snap = await db.collection('posts').orderBy('createdAt', 'desc').get();
    }

    return snap.docs
        .map((doc) => ({ id: doc.id, ...doc.data() }))
        .filter((post) => {
            const emailMatch = (post.email || '').toLowerCase() === (user.email || '').toLowerCase();
            const nameMatch = (post.user || post.userName || '').trim() === (user.name || '').trim();
            return emailMatch || nameMatch;
        });
}

function renderProfileHeader(user) {
    const avatar = user?.avatar || buildAvatarUrl(user?.name || 'Thành viên');
    const isOwner = !!currentUser?.email && currentUser.email.toLowerCase() === (user?.email || '').toLowerCase();

    document.getElementById('profileCover').src = user?.coverPhoto || document.getElementById('profileCover').src;
    document.getElementById('profileAvatar').src = avatar;
    document.getElementById('profileName').textContent = user?.name || user?.email || 'Thành viên lớp';

    const actionBtn = document.getElementById('profileActionBtn');
    actionBtn.textContent = isOwner ? 'Chỉnh sửa trang cá nhân' : 'Nhắn tin';
    actionBtn.onclick = () => {
        if (isOwner) {
            window.location.href = './index.html';
            return;
        }
        window.location.href = `./index.html?shortcut=chat&user=${encodeURIComponent(user?.email || '')}`;
    };
}

function renderPosts(posts) {
    const postEl = document.getElementById('tab-posts');
    if (!posts.length) {
        postEl.innerHTML = '<div class="empty-state">Chưa có bài viết nào trên timeline.</div>';
        return;
    }

    postEl.innerHTML = posts.map((post) => {
        const media = post.url
            ? (String(post.url).includes('.mp4') ? `<video src="${safeText(post.url)}" controls playsinline></video>` : `<img src="${safeText(post.url)}" alt="media">`)
            : '';

        const created = parseTs(post.createdAt || post.takenAt);
        const dateLabel = created ? new Date(created).toLocaleDateString('vi-VN') : 'Không rõ ngày';
        return `<article class="post-card">
            ${media}
            <p class="post-meta">🗓️ ${dateLabel}</p>
            <p>${safeText(post.caption || 'Không có chú thích')}</p>
        </article>`;
    }).join('');
}

function renderPhotos(posts) {
    const photoEl = document.getElementById('tab-photos');
    const mediaOnly = posts.filter((post) => !!post.url);
    if (!mediaOnly.length) {
        photoEl.innerHTML = '<div class="empty-state" style="grid-column:1/-1;">Chưa có ảnh/video.</div>';
        return;
    }

    photoEl.innerHTML = mediaOnly.map((post) => (
        String(post.url).includes('.mp4')
            ? `<video src="${safeText(post.url)}" controls playsinline></video>`
            : `<img src="${safeText(post.url)}" alt="ảnh bài viết">`
    )).join('');
}

function renderInfo(user, posts) {
    const infoEl = document.getElementById('tab-info');
    infoEl.innerHTML = `
        <div class="info-item"><strong>Email:</strong> ${safeText(user?.email || '---')}</div>
        <div class="info-item"><strong>SĐT:</strong> ${safeText(user?.phone || '---')}</div>
        <div class="info-item"><strong>Vai trò:</strong> ${safeText(user?.classRole || 'Thành viên')}</div>
        <div class="info-item"><strong>Số bài viết:</strong> ${posts.length}</div>
    `;
}

async function initProfilePage() {
    bindTabs();
    bindHeaderShrink();

    const user = await resolveProfileUser();
    if (!user) {
        renderPosts([]);
        document.getElementById('tab-photos').innerHTML = '<div class="empty-state" style="grid-column:1/-1;">Không tìm thấy người dùng.</div>';
        document.getElementById('tab-info').innerHTML = '<div class="empty-state">Hãy mở profile với tham số ?id=email.</div>';
        document.getElementById('profileName').textContent = 'Không tìm thấy người dùng';
        document.getElementById('profileActionBtn').style.display = 'none';
        return;
    }

    renderProfileHeader(user);
    const posts = await resolvePosts(user);
    renderPosts(posts);
    renderPhotos(posts);
    renderInfo(user, posts);
}

initProfilePage();