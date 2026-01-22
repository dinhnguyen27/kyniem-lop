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
function loadGallery() {
    const gallery = document.getElementById('galleryGrid');
    if (!gallery) return;

    // Lắng nghe dữ liệu thay đổi trên Firebase
    db.collection("posts").orderBy("createdAt", "desc").onSnapshot((snapshot) => {
        gallery.innerHTML = ""; // Xóa trắng để tải mới
        snapshot.forEach((doc) => {
            const data = doc.data();
            const card = document.createElement('div');
            card.className = 'card';
            card.innerHTML = `
                <div class="media-wrap" onclick="openLightbox(this)">
                    <img src="${data.url}">
                </div>
                <div class="comment-area">
                    <div class="reactions">
                        <button class="react-btn" onclick="handleReact('${doc.id}', 'hearts')">❤️ <span class="count">${data.hearts || 0}</span></button>
                        <button class="react-btn" onclick="handleReact('${doc.id}', 'hahas')">😆 <span class="count">${data.hahas || 0}</span></button>
                    </div>
                    <p><strong>Kỷ niệm:</strong> ${data.caption || "Không có chú thích"}</p>
                </div>
            `;
            gallery.appendChild(card);
        });
    });
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
    const examDate = new Date("June 15, 2026 00:00:00").getTime();

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
    const music = document.getElementById('bg-music');

    if (pass === correctPass) {
        document.getElementById('password-screen').style.display = 'none';
        document.getElementById('main-content').style.display = 'block';
        
        // Khởi động các chức năng sau khi mở khóa
        loadGallery();
        startCountdown();
        createLeaves();
        
        if(music) music.play().catch(e => console.log("Nhạc bị chặn:", e));
    } else {
        document.getElementById('error-msg').style.display = 'block';
    }
}

// 6. Các hàm bổ trợ (Lightbox, Hiệu ứng rơi...)
function openLightbox(container) {
    const source = container.querySelector('img, video');
    const content = document.getElementById('lightboxContent');
    const lightbox = document.getElementById('lightbox');
    
    let el = document.createElement(source.tagName);
    el.src = source.src;
    if(source.tagName === 'VIDEO') { el.controls = true; el.autoplay = true; }
    
    el.id = "activeMedia";
    content.innerHTML = '';
    content.appendChild(el);
    lightbox.style.display = 'flex';
}

function closeLightbox() { document.getElementById('lightbox').style.display = 'none'; }

function createLeaves() {
    const container = document.getElementById('leaf-container');
    if(!container) return;
    for (let i = 0; i < 20; i++) {
        let leaf = document.createElement('div');
        leaf.className = 'leaf';
        leaf.style.left = Math.random() * 100 + '%';
        leaf.style.animationDuration = Math.random() * 5 + 5 + 's';
        leaf.style.animationDelay = Math.random() * 5 + 's';
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