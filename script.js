// 1. Cấu hình Firebase
const firebaseConfig = {
    apiKey: "AIzaSyA1LkOgOfvmM49o4G4B8ZgoMglAPjNdD5w",
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
const auth = firebase.auth();


const ACCOUNTS_KEY = 'class_accounts';
const SESSION_KEY = 'class_current_user';

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
    const user = getCurrentUser();
    const chip = document.getElementById('current-user-display');
    if (chip) {
        chip.innerText = user ? `${user.name} • ${user.phone} • ${user.email}` : 'Bạn chưa đăng nhập';
    }

    const senderInput = document.getElementById('capsule-sender');
    if (senderInput && user) {
        senderInput.value = user.name;
    }
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

        await db.collection('users').add({
            name,
            phone,
            email,
            password,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        const localAccounts = getSavedAccounts();
        if (!localAccounts.some((a) => a.email === email)) {
            localAccounts.push({ name, phone, email, password });
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

function resetPassword() {
    const email = document.getElementById("login-email").value;

    if (!email) {
        alert("Vui lòng nhập email trước!");
        return;
    }

    auth.sendPasswordResetEmail(email)
        .then(() => {
            alert("Đã gửi email đặt lại mật khẩu. Kiểm tra hộp thư nhé!");
        })
        .catch((error) => {
            alert("Lỗi: " + error.message);
        });
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
}

function logoutUser() {
    localStorage.removeItem(SESSION_KEY);
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
            const commentHtml = comments.map(c => `
                <p class="each-comment"><b>${c.user}:</b> ${c.text}</p>
            `).join('');

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

    const postRef = db.collection("posts").doc(postId);
    try {
        await postRef.update({
            comments: firebase.firestore.FieldValue.arrayUnion({
                user: userName, // Sử dụng tên vừa lấy được
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
    const email = document.getElementById('login-email').value.trim().toLowerCase();
    const password = document.getElementById('login-password').value;
    if (!email || !password) return showAuthMessage('Vui lòng nhập email và mật khẩu để đăng nhập.');

    try {
        const userSnap = await db.collection('users')
            .where('email', '==', email)
            .where('password', '==', password)
            .limit(1)
            .get();

        let account = null;
        if (!userSnap.empty) {
            account = userSnap.docs[0].data();
        } else {
            const accounts = getSavedAccounts();
            account = accounts.find((a) => a.email === email && a.password === password) || null;
        }

        if (!account) return showAuthMessage('Sai email hoặc mật khẩu. Vui lòng thử lại.');

        const sessionUser = { name: account.name, phone: account.phone, email: account.email };
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

function changeMyName() {
    const user = getCurrentUser();
    const newName = prompt('Nhập tên mới của bạn:', user?.name || '');
    if (!newName || newName.trim() === '') return;

    const normalizedName = newName.trim();
    localStorage.setItem('class_user_name', normalizedName);

    if (!user) {
        alert('Đã đổi tên thành: ' + normalizedName);
        return;
    }

    const accounts = getSavedAccounts();
    const index = accounts.findIndex((a) => a.email === user.email);
    if (index !== -1) {
        accounts[index].name = normalizedName;
        saveAccounts(accounts);
    }

    const updatedUser = { ...user, name: normalizedName };
    localStorage.setItem(SESSION_KEY, JSON.stringify(updatedUser));
    updateCurrentUserDisplay();
    alert('Đã cập nhật tên thành: ' + normalizedName);
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
    if (event.target == modal) closeLetter();
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
    const user = getCurrentUser();
    if (user) {
        enterMainSite();
    } else {
        switchAuthTab('login');
    }
    updateCurrentUserDisplay();
});
