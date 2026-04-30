const { auth, db, storage } = window.firebaseServices;
const THEME_MODE_KEY = 'class_theme_mode';
const ONLINE_ACTIVE_WINDOW_MS = 120000;
const REACTIONS = ['👍', '❤️', '🥰', '😆', '😮', '😢', '😡'];
const params = new URLSearchParams(window.location.search);
const profileId = (params.get('id') || '').trim().toLowerCase();
const focusPostId = (params.get('post') || '').trim();
let currentUser = null;

let profileDocRef = null;
let profileUserData = null;
let cachedPosts = [];
let lightbox = null;
const interactionState = {};
const interactionUnsubs = {};
let allChatUsers = [];
let usersUnsubscribe = null;

const el = {
    header: document.getElementById('profileHeader'),
    cover: document.getElementById('profileCover'),
    avatar: document.getElementById('profileAvatar'),
    name: document.getElementById('profileName'),
    bio: document.getElementById('profileBio'),
    onlineDot: document.getElementById('profileOnlineDot'),
    action: document.getElementById('profileActionBtn'),
    ownerComposer: document.getElementById('ownerComposer'),
    composerAvatar: document.getElementById('composerAvatar'),
    posts: document.getElementById('tab-posts'),
    photos: document.getElementById('tab-photos'),
    info: document.getElementById('tab-info')
};

const meKey = () => (currentUser?.email || 'guest').toLowerCase();
const isOwnerViewing = () => !!currentUser?.email && currentUser.email.toLowerCase() === (profileUserData?.email || '').toLowerCase();
const safeText = (v = '') => String(v || '').replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c));
const parseTs = (v) => typeof v?.toMillis === 'function' ? Number(v.toMillis() || 0) : (typeof v === 'number' ? v : 0);
const buildAvatarUrl = (name = 'Thành viên lớp') => `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=ff7e5f&color=fff`;
const isVideoUrl = (url = '') => /\.mp4|video\/upload|cloudinary/i.test(String(url));

function resolveAvatarByCommentAuthor(commentData = {}) {
    const email = String(commentData.userEmail || '').trim().toLowerCase();
    if (email) {
        const found = allChatUsers.find((u) => (u.email || '').toLowerCase() === email);
        if (found?.avatar) return found.avatar;
    }
    return buildAvatarUrl(commentData.user || 'Bạn');
}

function showConfirmModalProfile(message = 'Bạn có chắc chắn muốn tiếp tục?') {
    const modal = document.getElementById('profile-confirm-modal');
    const messageEl = document.getElementById('profile-confirm-message');
    const okBtn = document.getElementById('profile-confirm-ok');
    const cancelBtn = document.getElementById('profile-confirm-cancel');
    if (!modal || !messageEl || !okBtn || !cancelBtn) {
        return Promise.resolve(window.confirm(message));
    }
    return new Promise((resolve) => {
        messageEl.textContent = message;
        modal.style.display = 'flex';
        const cleanup = () => {
            okBtn.removeEventListener('click', onOk);
            cancelBtn.removeEventListener('click', onCancel);
            modal.removeEventListener('click', onBackdrop);
            modal.style.display = 'none';
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
            if (event.target === modal) onCancel();
        };
        okBtn.addEventListener('click', onOk);
        cancelBtn.addEventListener('click', onCancel);
        modal.addEventListener('click', onBackdrop);
    });
}

async function resolveCurrentSessionUser() {
    const authUser = auth.currentUser;
    if (!authUser?.email) return null;
    const email = String(authUser.email || '').trim().toLowerCase();
    try {
        const snap = await db.collection('users').where('email', '==', email).limit(1).get();
        if (!snap.empty) {
            return snap.docs[0].data() || { email };
        }
    } catch (_) {}
    return { email, name: authUser.displayName || 'Thành viên lớp' };
}

function applyThemeFromMain() {
    const mode = localStorage.getItem(THEME_MODE_KEY) || 'light';
    document.body.classList.toggle('dark-mode', mode === 'dark');
}

function bindTabs() {
    document.querySelectorAll('.tab-btn').forEach((btn) => btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
        document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(`tab-${btn.dataset.tab}`)?.classList.add('active');
        if (btn.dataset.tab === 'photos') setTimeout(initPhotoLightbox, 60);
    }));
}

function bindHeaderEffects() {
    const update = () => el.header.classList.toggle('compact', window.scrollY > 120);
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('storage', (ev) => {
        if (ev.key === THEME_MODE_KEY) applyThemeFromMain();
    });
    update();
}

function renderHeaderSkeleton() {
    el.name.textContent = '';
    el.bio.textContent = '';
    el.action.textContent = 'Đang tải...';
    el.action.disabled = true;
    el.posts.innerHTML = Array.from({ length: 3 }, () => '<div class="post-skeleton"><div class="skeleton-block img"></div><div class="skeleton-block line"></div><div class="skeleton-block line short"></div></div>').join('');
}

async function resolveProfileUser() {
    if (!profileId) return null;
    const snap = await db.collection('users').where('email', '==', profileId).limit(1).get();
    if (snap.empty) return null;
    profileDocRef = snap.docs[0].ref;
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
    return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() })).filter((post) =>
        (post.email || '').toLowerCase() === (user.email || '').toLowerCase() || (post.user || post.userName || '').trim() === (user.name || '').trim());
}

function initInteractionWatch(postId) {
    if (interactionUnsubs[postId]) return;
    interactionState[postId] = interactionState[postId] || { counts: {}, myReaction: '', comments: [] };

    const reactionsRef = db.collection('posts').doc(postId).collection('reactions');
    const commentsRef = db.collection('posts').doc(postId).collection('comments').orderBy('createdAt', 'asc').limit(40);

    const unsubReactions = reactionsRef.onSnapshot((snap) => {
        const counts = {};
        let myReaction = '';
        snap.forEach((doc) => {
            const data = doc.data() || {};
            const icon = data.type || '👍';
            counts[icon] = Number(counts[icon] || 0) + 1;
            if (doc.id === meKey()) myReaction = icon;
        });
        interactionState[postId].counts = counts;
        interactionState[postId].myReaction = myReaction;
        renderPosts(cachedPosts);
    });

    const unsubComments = commentsRef.onSnapshot((snap) => {
        interactionState[postId].comments = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        renderPosts(cachedPosts);
    });

    interactionUnsubs[postId] = () => {
        unsubReactions();
        unsubComments();
    };
}

function clearInteractionWatchers(activeIds = []) {
    Object.keys(interactionUnsubs).forEach((id) => {
        if (activeIds.includes(id)) return;
        interactionUnsubs[id]?.();
        delete interactionUnsubs[id];
        delete interactionState[id];
    });
}

function commentAgeLabel(ts) {
    const diff = Math.max(0, Date.now() - Number(ts || 0));
    const min = Math.floor(diff / 60000);
    if (min < 1) return '1 phút';
    if (min < 60) return `${min} phút`;
    const h = Math.floor(min / 60);
    if (h < 24) return `${h} giờ`;
    const d = Math.floor(h / 24);
    if (d < 30) return `${d} ngày`;
    const m = Math.floor(d / 30);
    if (m < 12) return `${m} tháng`;
    return `${Math.floor(m / 12)} năm`;
}

function renderCommentRow(postId, c) {
    const reactions = c.reactions || {};
    const my = c.userReactions?.[meKey()] || '';
    const count = Object.values(reactions).reduce((a, b) => a + Number(b || 0), 0);
    const topIcons = Object.entries(reactions).filter(([, n]) => Number(n || 0) > 0).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([icon]) => `<span class="badge">${icon}</span>`).join('');
    const replies = Array.isArray(c.replies) ? c.replies : [];
    const canDelete = isOwnerViewing() || (c.userEmail || '').toLowerCase() === (currentUser?.email || '').toLowerCase();
    const avatarUrl = resolveAvatarByCommentAuthor(c);

    return `
    <div class="post-comment-row">
        <img src="${safeText(avatarUrl)}" alt="avatar">
        <div style="flex:1;">
            <div class="post-comment"><strong>${safeText(c.user || 'Bạn')}</strong><br>${safeText(c.text || '')}${c.imageUrl ? `<br><img src="${safeText(c.imageUrl)}" alt="comment-image" style="width:100%;max-height:180px;object-fit:cover;border-radius:10px;margin-top:6px;">` : ''}</div>
            <div class="comment-meta">
                <span>${commentAgeLabel(c.createdAt)}</span>
                <button type="button" class="comment-react-btn ${my ? 'active' : ''}" onmouseenter="showCommentReactionPicker('${postId}','${c.id}')" onmouseleave="scheduleHideCommentReactionPicker('${postId}','${c.id}')" ontouchstart="startCommentReactionHold(event,'${postId}','${c.id}')" ontouchend="cancelCommentReactionHold('${postId}','${c.id}')">${my ? my : '<i class=\"fa-regular fa-thumbs-up\"></i> Thích'}</button>
                <button type="button" onclick="toggleReplyBox('${postId}','${c.id}')">Trả lời</button>
                ${canDelete ? `<button type="button" onclick="deleteComment('${postId}','${c.id}')">Xóa</button>` : ''}
                <span class="reaction-icons comment-inline-reactions">${count ? `${topIcons} ${count}` : ''}</span>
            </div>
            <div id="comment-react-picker-${postId}-${c.id}" class="react-picker" style="display:none;" onmouseenter="showCommentReactionPicker('${postId}','${c.id}')" onmouseleave="hideCommentReactionPicker('${postId}','${c.id}')">${REACTIONS.map((icon) => `<button type="button" onclick="setCommentReaction('${postId}','${c.id}','${icon}')">${icon}</button>`).join('')}</div>
            ${replies.map((r) => `<div class="post-comment-row" style="margin-top:6px;"><img src="${safeText(resolveAvatarByCommentAuthor(r))}" alt="avatar"><div class="post-comment" style="font-size:.82rem;"><strong>${safeText(r.user || 'Bạn')}</strong><br>${safeText(r.text || '')}</div></div>`).join('')}
            <div id="reply-box-${postId}-${c.id}" class="reply-box" style="display:none;"></div>
        </div>
    </div>`;
}


function renderProfileHeader(user) {
    profileUserData = user;
    const avatar = user?.avatar || buildAvatarUrl(user?.name || 'Thành viên');
    const owner = isOwnerViewing();
    el.cover.src = user?.coverPhoto || el.cover.src;
    el.avatar.src = avatar;
    el.composerAvatar.src = avatar;
    el.name.textContent = user?.name || user?.email || 'Thành viên lớp';
    el.bio.textContent = user?.bio || 'Chưa có tiểu sử.';
    el.action.disabled = false;
    el.action.textContent = owner ? 'Chỉnh sửa trang cá nhân' : 'Nhắn tin';
    el.action.onclick = () => owner ? openEditProfileModal() : window.location.href = `./index.html?shortcut=chat&user=${encodeURIComponent(user?.email || '')}`;
    el.ownerComposer.style.display = owner ? 'block' : 'none';
    const online = !!user?.isOnline && (Date.now() - Number(user?.lastActiveAt || 0) <= ONLINE_ACTIVE_WINDOW_MS);
    el.onlineDot.classList.toggle('online', online);
}

function renderPosts(posts) {
    if (!posts.length) {
        el.posts.innerHTML = '<div class="empty-state">Chưa có bài viết nào trên timeline.</div>';
        return;
    }
    const owner = isOwnerViewing();

    el.posts.innerHTML = posts.map((post) => {
        const created = parseTs(post.createdAt || post.takenAt);
        const dateLabel = created ? new Date(created).toLocaleString('vi-VN') : 'Không rõ ngày';
        const media = post.url ? `<div class="post-media">${isVideoUrl(post.url) ? `<video src="${safeText(post.url)}" controls playsinline></video>` : `<a href="${safeText(post.url)}" class="glightbox" data-gallery="post-gallery"><img src="${safeText(post.url)}" alt="media"></a>`}</div>` : '';
        const state = interactionState[post.id] || { counts: {}, myReaction: '', comments: [] };
        const totalReacts = Object.values(state.counts).reduce((a, b) => a + Number(b || 0), 0);
        const topIcons = Object.entries(state.counts).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([icon]) => `<span class="badge">${icon}</span>`).join('');
        const myReaction = state.myReaction || '👍';

        return `<article class="post-card" data-post-id="${post.id}">
            <div class="post-head">
                <div class="post-owner"><img src="${safeText(profileUserData.avatar || buildAvatarUrl(profileUserData.name || 'Bạn'))}" alt="avatar"><div><strong>${safeText(profileUserData.name || profileUserData.email || 'Thành viên')}</strong><div class="post-meta">${dateLabel}</div></div></div>
                ${owner ? `<button class="post-menu-trigger" onclick="togglePostMenu('${post.id}')"><i class="fa-solid fa-ellipsis"></i></button><div id="post-menu-${post.id}" class="post-menu-dropdown" style="display:none;"><button type="button" onclick="removePostMedia('${post.id}')">Xóa ảnh/video</button><button type="button" onclick="deletePost('${post.id}')">Xóa bài đăng</button></div>` : ''}
            </div>
            ${media}
            <div class="post-body">${safeText(post.caption || 'Không có chú thích')}</div>
            <div class="post-stats"><span class="reaction-icons">${topIcons || '<span class="badge">👍</span>'} ${totalReacts}</span><span>${state.comments.length} bình luận</span></div>
            <div class="reaction-actions">
                <button type="button" class="react-btn ${state.myReaction ? 'active' : ''}" onmouseenter="showReactionPicker('${post.id}')" onmouseleave="scheduleHideReactionPicker('${post.id}')" ontouchstart="startReactionHold(event,'${post.id}')" ontouchend="cancelReactionHold('${post.id}')">${myReaction} Cảm xúc</button>
                <button type="button" class="comment-toggle-btn" onclick="focusCommentInput('${post.id}')"><i class="fa-regular fa-comment"></i> Bình luận</button>
            </div>
            <div id="react-picker-${post.id}" class="react-picker" style="display:none;" onmouseenter="showReactionPicker('${post.id}')" onmouseleave="hideReactionPicker('${post.id}')">${REACTIONS.map((icon) => `<button type="button" onclick="setReaction('${post.id}','${icon}')">${icon}</button>`).join('')}</div>
            <div class="post-comments">${state.comments.map((c) => renderCommentRow(post.id, c)).join('') || '<div class="post-comment">Chưa có bình luận</div>'}</div>
            <div class="comment-composer">
                <input id="comment-input-${post.id}" type="text" placeholder="Viết bình luận..." onkeypress="if(event.key==='Enter') submitComment('${post.id}')" inputmode="text">
                <span class="comment-tools">
                    <button type="button" onclick="toggleEmojiPanel('${post.id}')"><i class="fa-regular fa-face-smile"></i></button>
                    <button type="button" onclick="openCommentMediaPicker('${post.id}')"><i class="fa-solid fa-camera"></i></button>
                    <button type="button" onclick="insertGifComment('${post.id}')"><i class="fa-solid fa-gift"></i></button>
                    <button type="button" onclick="insertStickerComment('${post.id}')"><i class="fa-regular fa-note-sticky"></i></button>
                </span>
                <div id="emoji-panel-${post.id}" class="react-picker" style="display:none;position:absolute;right:52px;bottom:48px;z-index:20;">${['😀','😍','😂','😭','😮','🔥','🙏','🎉'].map((emo) => `<button type=\"button\" onclick=\"insertEmoji('${post.id}','${emo}')\">${emo}</button>`).join('')}</div>
                <button type="button" class="send-btn" onclick="submitComment('${post.id}')"><i class="fa-solid fa-paper-plane"></i></button>
            </div>
        </article>`;
    }).join('');

    setTimeout(() => {
        initPhotoLightbox();
        if (focusPostId) {
            const target = document.querySelector(`[data-post-id="${focusPostId}"]`);
            target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }, 50);
}

function initPhotoLightbox() {
    if (lightbox) lightbox.destroy();
    lightbox = GLightbox({ selector: '.glightbox', touchNavigation: true, loop: true, openEffect: 'zoom' });
}

function renderPhotos(posts) {
    const pics = posts.filter((post) => post.url && !isVideoUrl(post.url));
    if (!pics.length) {
        el.photos.innerHTML = '<div class="empty-state" style="grid-column:1/-1;">Chưa có ảnh.</div>';
        return;
    }
    el.photos.innerHTML = pics.map((post) => `<a href="${safeText(post.url)}" class="glightbox" data-gallery="profile-gallery"><img src="${safeText(post.url)}" alt="ảnh"></a>`).join('');
    setTimeout(initPhotoLightbox, 50);
}

function renderInfo(user, posts) {
    const links = user?.socialLinks || {};
    const social = [links.facebook && `<a href="${safeText(links.facebook)}" target="_blank" rel="noopener"><i class="fa-brands fa-facebook"></i> Facebook</a>`, links.instagram && `<a href="${safeText(links.instagram)}" target="_blank" rel="noopener"><i class="fa-brands fa-instagram"></i> Instagram</a>`, links.tiktok && `<a href="${safeText(links.tiktok)}" target="_blank" rel="noopener"><i class="fa-brands fa-tiktok"></i> TikTok</a>`].filter(Boolean).join('');
    el.info.innerHTML = `<div class="info-item"><strong>Email:</strong> ${safeText(user?.email || '---')}</div><div class="info-item"><strong>SĐT:</strong> ${safeText(user?.phone || '---')}</div><div class="info-item"><strong>Năm sinh:</strong> ${safeText(user?.birthYear || '---')}</div><div class="info-item"><strong>Vai trò:</strong> ${safeText(user?.classRole || 'Thành viên')}</div><div class="info-item"><strong>Số bài viết:</strong> ${posts.length}</div><div class="info-item"><strong>Mạng xã hội:</strong><div class="social-links">${social || '---'}</div></div>`;
}

async function uploadFileToStorage(file, folder = 'profile_uploads') {
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
    const fileRef = storage.ref(`${folder}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`);
    await fileRef.put(file);
    return fileRef.getDownloadURL();
}

async function publishNewPost() {
    const caption = document.getElementById('newPostCaption').value.trim();
    const mediaFile = document.getElementById('newPostImage').files?.[0] || null;
    if (!caption && !mediaFile) return alert('Vui lòng nhập nội dung hoặc chọn ảnh/video.');

    let mediaUrl = '';
    if (mediaFile) mediaUrl = await uploadFileToStorage(mediaFile, 'posts');

    const docRef = await db.collection('posts').add({
        caption,
        url: mediaUrl,
        email: (profileUserData.email || '').toLowerCase(),
        user: profileUserData.name || profileUserData.email,
        userName: profileUserData.name || profileUserData.email,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    await db.collection('notification_events').doc(`post_${docRef.id}`).set({
        type: 'post_new',
        title: `${profileUserData.name || 'Thành viên'} vừa đăng bài mới`,
        body: caption ? caption.slice(0, 120) : 'Nhấn để xem bài viết mới',
        link: `profile.html?id=${encodeURIComponent((profileUserData.email || '').toLowerCase())}&post=${docRef.id}`,
        createdAt: Date.now()
    }, { merge: true });

    document.getElementById('newPostCaption').value = '';
    document.getElementById('newPostImage').value = '';
    document.getElementById('composerMediaPreview').style.display = 'none';
    await reloadPosts();
}

async function reloadPosts() {
    cachedPosts = await resolvePosts(profileUserData);
    cachedPosts.forEach((post) => initInteractionWatch(post.id));
    clearInteractionWatchers(cachedPosts.map((p) => p.id));
    renderPosts(cachedPosts);
    renderPhotos(cachedPosts);
    renderInfo(profileUserData, cachedPosts);
}

async function deletePost(postId) {
    if (!(await showConfirmModalProfile('Xóa bài viết này?'))) return;
    await db.collection('posts').doc(postId).delete();
    await reloadPosts();
}

async function removePostMedia(postId) {
    if (!(await showConfirmModalProfile('Xóa ảnh/video khỏi bài viết này?'))) return;
    await db.collection('posts').doc(postId).set({ url: '' }, { merge: true });
    await reloadPosts();
}

function togglePostMenu(postId) {
    const menu = document.getElementById(`post-menu-${postId}`);
    if (!menu) return;
    menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
}

const reactionHideTimers = {};
const reactionHoldTimers = {};
function showReactionPicker(postId) {
    clearTimeout(reactionHideTimers[postId]);
    document.getElementById(`react-picker-${postId}`)?.style.setProperty('display', 'flex');
}
function scheduleHideReactionPicker(postId) {
    clearTimeout(reactionHideTimers[postId]);
    reactionHideTimers[postId] = setTimeout(() => hideReactionPicker(postId), 180);
}
function hideReactionPicker(postId) {
    document.getElementById(`react-picker-${postId}`)?.style.setProperty('display', 'none');
}
function startReactionHold(event, postId) {
    reactionHoldTimers[postId] = setTimeout(() => showReactionPicker(postId), 280);
    event.preventDefault();
}
function cancelReactionHold(postId) { clearTimeout(reactionHoldTimers[postId]); }
async function setReaction(postId, icon) {
    await db.collection('posts').doc(postId).collection('reactions').doc(meKey()).set({ type: icon, createdAt: Date.now() }, { merge: true });
    hideReactionPicker(postId);
}

async function submitComment(postId, extra = {}) {
    const input = document.getElementById(`comment-input-${postId}`);
    const text = input?.value?.trim() || '';
    if (!text && !extra.imageUrl) return;
    await db.collection('posts').doc(postId).collection('comments').add({
        user: currentUser?.name || currentUser?.email || 'Khách',
        userEmail: currentUser?.email || '',
        avatar: currentUser?.avatar || buildAvatarUrl(currentUser?.name || 'Bạn'),
        text,
        imageUrl: extra.imageUrl || '',
        createdAt: Date.now(),
        reactions: {},
        userReactions: {},
        replies: []
    });
    if (input) input.value = '';
}

async function setCommentReaction(postId, commentId, icon) {
    const ref = db.collection('posts').doc(postId).collection('comments').doc(commentId);
    const snap = await ref.get();
    if (!snap.exists) return;
    const data = snap.data() || {};
    const reactions = { ...(data.reactions || {}) };
    const userReactions = { ...(data.userReactions || {}) };
    const key = meKey();
    const prev = userReactions[key];

    if (prev) reactions[prev] = Math.max(0, Number(reactions[prev] || 0) - 1);
    if (prev === icon) {
        delete userReactions[key];
    } else {
        userReactions[key] = icon;
        reactions[icon] = Number(reactions[icon] || 0) + 1;
    }

    await ref.set({ reactions, userReactions }, { merge: true });
    hideCommentReactionPicker(postId, commentId);
}

function toggleReplyBox(postId, commentId) {
    const box = document.getElementById(`reply-box-${postId}-${commentId}`);
    if (!box) return;
    const show = box.style.display === 'none';
    if (!show) {
        box.style.display = 'none';
        box.innerHTML = '';
        return;
    }
    box.style.display = 'flex';
    box.innerHTML = `
        <input id="reply-input-${postId}-${commentId}" type="text" placeholder="Viết trả lời...">
        <button type="button" onclick="submitReply('${postId}','${commentId}')">Gửi</button>
    `;
    document.getElementById(`reply-input-${postId}-${commentId}`)?.focus();
}

async function submitReply(postId, commentId) {
    const input = document.getElementById(`reply-input-${postId}-${commentId}`);
    const text = input?.value?.trim();
    if (!text) return;
    const ref = db.collection('posts').doc(postId).collection('comments').doc(commentId);
    await ref.set({
        replies: firebase.firestore.FieldValue.arrayUnion({
            user: currentUser?.name || currentUser?.email || 'Khách',
            userEmail: currentUser?.email || '',
            text,
            createdAt: Date.now()
        })
    }, { merge: true });
    input.value = '';
    const box = document.getElementById(`reply-box-${postId}-${commentId}`);
    if (box) {
        box.style.display = 'none';
        box.innerHTML = '';
    }
}

function initUsersCache() {
    if (usersUnsubscribe) usersUnsubscribe();
    usersUnsubscribe = db.collection('users').onSnapshot((snap) => {
        allChatUsers = snap.docs.map((doc) => ({ ...(doc.data() || {}) }));
        if (cachedPosts.length) renderPosts(cachedPosts);
    }, () => {});
}

function insertEmoji(postId, emoji) {
    const input = document.getElementById(`comment-input-${postId}`);
    if (!input) return;
    input.value = `${input.value || ''}${emoji}`;
    input.focus();
    const panel = document.getElementById(`emoji-panel-${postId}`);
    if (panel) panel.style.display = 'none';
}

let pendingCommentMediaPostId = '';
function openCommentMediaPicker(postId) {
    pendingCommentMediaPostId = postId;
    document.getElementById('commentMediaInput')?.click();
}

async function handleCommentMediaPicked(event) {
    const file = event.target.files?.[0];
    if (!file || !pendingCommentMediaPostId) return;
    const imageUrl = await uploadFileToStorage(file, 'comment_media');
    await submitComment(pendingCommentMediaPostId, { imageUrl });
    event.target.value = '';
}

async function insertGifComment(postId) {
    const gifUrl = prompt('Dán link GIF:') || '';
    if (!gifUrl.trim()) return;
    await submitComment(postId, { imageUrl: gifUrl.trim() });
}

async function insertStickerComment(postId) {
    const sticker = ['😀','😍','🔥','💖','🎉'][Math.floor(Math.random()*5)];
    await submitComment(postId, { imageUrl: `https://dummyimage.com/160x160/ffffff/111111&text=${encodeURIComponent(sticker)}` });
}

function focusCommentInput(postId) {
    document.getElementById(`comment-input-${postId}`)?.focus();
}

const commentReactionHideTimers = {};
const commentReactionHoldTimers = {};
function showCommentReactionPicker(postId, commentId) {
    const key = `${postId}_${commentId}`;
    clearTimeout(commentReactionHideTimers[key]);
    document.getElementById(`comment-react-picker-${postId}-${commentId}`)?.style.setProperty('display', 'flex');
}
function scheduleHideCommentReactionPicker(postId, commentId) {
    const key = `${postId}_${commentId}`;
    clearTimeout(commentReactionHideTimers[key]);
    commentReactionHideTimers[key] = setTimeout(() => hideCommentReactionPicker(postId, commentId), 180);
}
function hideCommentReactionPicker(postId, commentId) {
    document.getElementById(`comment-react-picker-${postId}-${commentId}`)?.style.setProperty('display', 'none');
}
function startCommentReactionHold(event, postId, commentId) {
    const key = `${postId}_${commentId}`;
    commentReactionHoldTimers[key] = setTimeout(() => showCommentReactionPicker(postId, commentId), 260);
    event.preventDefault();
}
function cancelCommentReactionHold(postId, commentId) {
    clearTimeout(commentReactionHoldTimers[`${postId}_${commentId}`]);
}

async function deleteComment(postId, commentId) {
    if (!(await showConfirmModalProfile('Xóa bình luận này?'))) return;
    await db.collection('posts').doc(postId).collection('comments').doc(commentId).delete();
}

function toggleEmojiPanel(postId) {
    const panel = document.getElementById(`emoji-panel-${postId}`);
    if (!panel) return;
    panel.style.display = panel.style.display === 'none' ? 'flex' : 'none';
}

function openEditProfileModal() {
    const modal = document.getElementById('editProfileModal');
    document.getElementById('editBio').value = profileUserData?.bio || '';
    document.getElementById('editPhone').value = profileUserData?.phone || '';
    document.getElementById('editBirthYear').value = profileUserData?.birthYear || '';
    document.getElementById('editClassRole').value = profileUserData?.classRole || '';
    document.getElementById('editFacebook').value = profileUserData?.socialLinks?.facebook || '';
    document.getElementById('editInstagram').value = profileUserData?.socialLinks?.instagram || '';
    document.getElementById('editTiktok').value = profileUserData?.socialLinks?.tiktok || '';
    document.getElementById('editAvatarFile').value = '';
    document.getElementById('editCoverFile').value = '';
    modal.style.display = 'flex';
}

async function saveProfileFromModal() {
    let avatarUrl = profileUserData.avatar || '';
    let coverUrl = profileUserData.coverPhoto || '';
    const avatarFile = document.getElementById('editAvatarFile').files?.[0] || null;
    const coverFile = document.getElementById('editCoverFile').files?.[0] || null;
    if (avatarFile) avatarUrl = await uploadFileToStorage(avatarFile, 'avatars');
    if (coverFile) coverUrl = await uploadFileToStorage(coverFile, 'covers');

    const payload = {
        bio: document.getElementById('editBio').value.trim(),
        phone: document.getElementById('editPhone').value.trim(),
        birthYear: Number(document.getElementById('editBirthYear').value || 0) || null,
        classRole: document.getElementById('editClassRole').value.trim(),
        socialLinks: {
            facebook: document.getElementById('editFacebook').value.trim(),
            instagram: document.getElementById('editInstagram').value.trim(),
            tiktok: document.getElementById('editTiktok').value.trim()
        },
        avatar: avatarUrl,
        coverPhoto: coverUrl,
        updatedAt: Date.now()
    };
    await profileDocRef.set(payload, { merge: true });
    profileUserData = { ...profileUserData, ...payload };
    renderProfileHeader(profileUserData);
    renderInfo(profileUserData, cachedPosts);
    document.getElementById('editProfileModal').style.display = 'none';
}

function wireEvents() {
    document.getElementById('publishPostBtn')?.addEventListener('click', publishNewPost);
    document.getElementById('newPostImage')?.addEventListener('change', (e) => {
        const file = e.target.files?.[0];
        const wrap = document.getElementById('composerMediaPreview');
        if (!file || !wrap) return;
        const url = URL.createObjectURL(file);
        wrap.innerHTML = file.type.startsWith('video/') ? `<video src="${url}" controls></video>` : `<img src="${url}" alt="preview">`;
        wrap.style.display = 'block';
    });

    document.getElementById('commentMediaInput')?.addEventListener('change', handleCommentMediaPicked);

    document.getElementById('closeEditModal')?.addEventListener('click', () => {
        document.getElementById('editProfileModal').style.display = 'none';
    });
    document.getElementById('saveProfileBtn')?.addEventListener('click', saveProfileFromModal);
    document.getElementById('editProfileModal')?.addEventListener('click', (e) => {
        if (e.target.id === 'editProfileModal') e.currentTarget.style.display = 'none';
    });

    window.togglePostMenu = togglePostMenu;
    window.showReactionPicker = showReactionPicker;
    window.scheduleHideReactionPicker = scheduleHideReactionPicker;
    window.hideReactionPicker = hideReactionPicker;
    window.startReactionHold = startReactionHold;
    window.cancelReactionHold = cancelReactionHold;
    window.setReaction = setReaction;
    window.submitComment = submitComment;
    window.focusCommentInput = focusCommentInput;
    window.deletePost = deletePost;
    window.removePostMedia = removePostMedia;
    window.setCommentReaction = setCommentReaction;
    window.showCommentReactionPicker = showCommentReactionPicker;
    window.scheduleHideCommentReactionPicker = scheduleHideCommentReactionPicker;
    window.startCommentReactionHold = startCommentReactionHold;
    window.cancelCommentReactionHold = cancelCommentReactionHold;
    window.toggleReplyBox = toggleReplyBox;
    window.submitReply = submitReply;
    window.insertEmoji = insertEmoji;
    window.toggleEmojiPanel = toggleEmojiPanel;
    window.deleteComment = deleteComment;
    window.openCommentMediaPicker = openCommentMediaPicker;
    window.insertGifComment = insertGifComment;
    window.insertStickerComment = insertStickerComment;
}

function watchPresence() {
    if (!profileDocRef) return;
    profileDocRef.onSnapshot((doc) => {
        if (!doc.exists) return;
        const data = doc.data() || {};
        profileUserData = { ...profileUserData, ...data };
        const online = !!profileUserData?.isOnline && (Date.now() - Number(profileUserData?.lastActiveAt || 0) <= ONLINE_ACTIVE_WINDOW_MS);
        el.onlineDot.classList.toggle('online', online);
    });
}

async function initProfilePage() {
    currentUser = await resolveCurrentSessionUser();
    auth.onAuthStateChanged(async () => {
        currentUser = await resolveCurrentSessionUser();
        if (profileUserData) {
            renderProfileHeader(profileUserData);
            renderPosts(cachedPosts);
            renderInfo(profileUserData, cachedPosts);
        }
    });
    applyThemeFromMain();
    bindTabs();
    bindHeaderEffects();
    wireEvents();
    initUsersCache();
    renderHeaderSkeleton();

    const user = await resolveProfileUser();
    if (!user) {
        el.posts.innerHTML = '<div class="empty-state">Không tìm thấy người dùng.</div>';
        el.photos.innerHTML = '<div class="empty-state" style="grid-column:1/-1;">Không tìm thấy ảnh.</div>';
        el.info.innerHTML = '<div class="empty-state">Hãy mở profile với tham số ?id=email.</div>';
        el.name.textContent = 'Không tìm thấy người dùng';
        el.action.style.display = 'none';
        return;
    }

    renderProfileHeader(user);
    await reloadPosts();
    watchPresence();
}

initProfilePage();
