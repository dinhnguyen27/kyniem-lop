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

// 2. Hàm Tải Ảnh từ Firebase (Quan trọng nhất)
let currentYearFilter = 'all';

// 1. Danh sách nhạc
const playlist = [
    { name: "Nụ cười 18 20", url: "https://www.dropbox.com/scl/fi/x9ecysqp7f524j5viynqp/nhac_nen.mp3?rlkey=bm731mxowol5lb03z94dzi1bt&st=bbswnyv7&raw=1" },
    { name: "Mình cùng nhau đóng băng", url: "https://www.dropbox.com/scl/fi/cjnpiialmlipbm6thf6se/M-nh-C-ng-Nhau-ng-B-ng-Th-y-Chi-FPT-Polytechnic-TH-Y-CHI-OFFICIAL-youtube.mp3?rlkey=xumdtk05j58w5kmrlj59fnhmn&st=8a7bju1w&raw=1" },
    { name: "Tháng 5 không trở lại", url: "https://www.dropbox.com/scl/fi/5j58xxq4mesripdpc8nv7/Th-ng-5-kh-ng-tr-l-i..-Tom-HiddleTom-youtube.mp3?rlkey=4sjno87kko61ogi8fwseak7t7&st=04ih5dk7&raw=1" },
    { name: "Người gieo mầm xanh", url: "https://www.dropbox.com/scl/fi/o0mlxit7ff4nh4u1msprh/NG-I-GIEO-M-M-XANH-H-A-KIM-TUY-N-x-HO-NG-D-NG-OFFICIAL-MV-H-a-Kim-Tuy-n-youtube.mp3?rlkey=3ouz5ydq09ad2p87lqn851kqq&st=vsraqvur&raw=1" },
];
let currentSongIndex = 0;
const audio = document.getElementById('bg-music');

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

function playSong(index) {
    const audio = document.getElementById('bg-music');
    const musicIcon = document.getElementById('music-icon');
    
    currentSongIndex = index;
    audio.src = playlist[index].url;
    audio.play();
    
    // Gọi thông báo tên bài hát ở đây
    showMusicToast(playlist[index].name);

    if(musicIcon) musicIcon.classList.add('rotating');
    renderPlaylist();
}

function toggleMusic() {
    const icon = document.getElementById('play-pause-icon');
    if (audio.paused) {
        audio.play();
        icon.className = "fas fa-pause"; // Đổi thành icon Tạm dừng
        document.getElementById('music-icon').classList.add('rotating');
    } else {
        audio.pause();
        icon.className = "fas fa-play"; // Đổi thành icon Phát
        document.getElementById('music-icon').classList.remove('rotating');
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
    let userName = localStorage.getItem("class_user_name");
    if (!userName) {
        userName = prompt("Vui lòng nhập tên của bạn để bình luận (VD: Tuấn Anh A1):");
        if (userName && userName.trim() !== "") {
            localStorage.setItem("class_user_name", userName.trim());
        } else {
            userName = "Thành viên ẩn danh"; // Tên mặc định nếu họ không nhập
        }
    }
    return userName;
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
function checkPassword() {
    const pass = document.getElementById('pass-input').value;
    const correctPass = "123456"; 

    if (pass === correctPass) {
        // 1. Ẩn màn hình khóa và hiện nội dung chính
        document.getElementById('password-screen').style.display = 'none';
        document.getElementById('main-content').style.display = 'block';
        
        // HIỆN TRÌNH NHẠC VÀ PHÁT TỰ ĐỘNG
        const container = document.getElementById('music-container');
        container.style.display = 'block';
        playSong(0);
        
        // 2. Bắn pháo giấy chúc mừng
        confetti({
            particleCount: 150,
            spread: 70,
            origin: { y: 0.6 },
            colors: ['#ff4d4d', '#ffffff', '#ff7e5f']
        });

        // 3. Khởi tạo các tính năng khác
        loadGallery();
        startCountdown();
        createLeaves(); // Gọi hàm tạo hoa phượng
        loadTimeCapsuleMessages();
        
        const music = document.getElementById('bg-music');
        if(music) music.play().catch(e => console.log("Nhạc bị chặn:", e));
    } else {
        document.getElementById('error-msg').style.display = 'block';
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
    if (allCards.length > 0) {
        const randomIndex = Math.floor(Math.random() * allCards.length);
        openLightbox(allCards[randomIndex]);
    }
}

// Cho phép nhấn Enter để mở khóa
document.getElementById('pass-input')?.addEventListener("keypress", (e) => {
    if (e.key === "Enter") checkPassword();
});

function changeMyName() {
    const newName = prompt("Nhập tên mới của bạn:");
    if (newName && newName.trim() !== "") {
        localStorage.setItem("class_user_name", newName.trim());
        alert("Đã đổi tên thành: " + newName);
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
    const sender = document.getElementById('capsule-sender').value.trim();
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
        // Reset form...
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

// Biến giới hạn 6 bức thư
let limitCount = 6; 

function loadTimeCapsuleMessages() {
    const today = new Date().toLocaleDateString('sv-SE');

    db.collection("messages").orderBy("unlockDate", "asc").onSnapshot((snapshot) => {
        const listDiv = document.getElementById('capsule-messages-list');
        const loadMoreBtn = document.getElementById('btn-load-more');
        if (!listDiv) return;
        
        let allMessages = [];
        snapshot.forEach(doc => {
            allMessages.push({ id: doc.id, ...doc.data() });
        });

        // Sắp xếp thư mở lên đầu
        allMessages.sort((a, b) => {
            const isALocked = today < a.unlockDate;
            const isBLocked = today < b.unlockDate;
            if (isALocked === isBLocked) return 0;
            return isALocked ? 1 : -1;
        });

        const displayedMessages = allMessages.slice(0, limitCount);

        // Hiển thị nút tải thêm
        if (loadMoreBtn) {
            loadMoreBtn.style.display = (allMessages.length > limitCount) ? "inline-block" : "none";
        }

        listDiv.innerHTML = "";
        displayedMessages.forEach((data, index) => {
            const isLocked = today < data.unlockDate;
            const card = document.createElement('div');
            
            // Chỉ áp dụng hiệu ứng fly-in cho những card mới xuất hiện ở trang hiện tại
            // Ví dụ: khi ấn lần đầu hiện 6, khi ấn "Xem thêm" lần 2 thì card từ 7-12 sẽ bay
            const isNewLoad = index >= (limitCount - 6);
            card.className = `capsule-card ${isLocked ? 'locked' : 'unlocked'} ${isNewLoad ? 'fly-in' : ''}`;
            
            // Tạo độ trễ (delay) tăng dần: 0s, 0.1s, 0.2s... để bay từ trái sang lần lượt
            if (isNewLoad) {
                card.style.animationDelay = `${(index % 6) * 0.15}s`;
            }

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
            listDiv.appendChild(card);
        });

        filterCapsules(); // Giữ bộ lọc tìm kiếm hoạt động
    });
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

