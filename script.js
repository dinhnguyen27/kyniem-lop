function checkPassword() {
    const pass = document.getElementById('pass-input').value;
    const correctPass = "123456"; 
    const music = document.getElementById('bg-music');

    if (pass === correctPass) {
        document.getElementById('password-screen').style.display = 'none';
        document.getElementById('main-content').style.display = 'block';
        
        // Phát nhạc khi mở khóa thành công
        music.play().catch(error => console.log("Trình duyệt chặn tự động phát:", error));
    } else {
        document.getElementById('error-msg').style.display = 'block';
    }
}

// Cho phép nhấn Enter để mở khóa
document.getElementById('pass-input')?.addEventListener("keypress", function(event) {
    if (event.key === "Enter") {
        checkPassword();
    }
});
let currentScale = 1;
let currentRotation = 0;

function handleUpload() {
    const input = document.getElementById('fileInput');
    const gallery = document.getElementById('galleryGrid');

    if (input.files && input.files[0]) {
        const file = input.files[0];
        const reader = new FileReader();

        reader.onload = function(e) {
            const card = document.createElement('div');
            card.className = 'card';
            
            const isVideo = file.type.includes('video');
            const mediaTag = isVideo 
                ? `<video src="${e.target.result}"></video>` 
                : `<img src="${e.target.result}">`;

            card.innerHTML = `
                <div class="media-wrap" onclick="openLightbox(this)">
                    ${mediaTag}
                </div>
                <div class="comment-area">
                    <div class="comment-box"><i>Gửi lời nhắn kỷ niệm...</i></div>
                    <div style="display:flex; gap:5px;">
                        <input type="text" placeholder="Viết bình luận..." style="flex:1; border:1px solid #ddd; border-radius:4px; padding:5px;">
                        <button onclick="sendComment(this)" style="border:none; background:#feb47b; color:white; border-radius:4px; cursor:pointer;">Gửi</button>
                    </div>
                </div>
            `;
            gallery.prepend(card);
            input.value = "";
        }
        reader.readAsDataURL(file);
    }
}

function sendComment(btn) {
    const input = btn.previousElementSibling;
    const box = btn.parentElement.previousElementSibling;
    if (input.value.trim()) {
        if (box.querySelector('i')) box.innerHTML = '';
        const p = document.createElement('p');
        p.style.margin = "5px 0";
        p.innerHTML = `<strong>Bạn:</strong> ${input.value}`;
        box.appendChild(p);
        input.value = "";
        box.scrollTop = box.scrollHeight;
    }
}

function openLightbox(container) {
    const source = container.querySelector('img, video');
    const content = document.getElementById('lightboxContent');
    const lightbox = document.getElementById('lightbox');
    
    let el;
    if (source.tagName === 'IMG') {
        el = document.createElement('img');
        el.src = source.src;
    } else {
        el = document.createElement('video');
        el.src = source.src;
        el.controls = true;
        el.autoplay = true;
    }
    
    el.id = "activeMedia";
    content.innerHTML = '';
    content.appendChild(el);
    lightbox.style.display = 'flex';
    currentScale = 1; currentRotation = 0;
    updateStyle();
}

function closeLightbox() {
    document.getElementById('lightbox').style.display = 'none';
}

function changeZoom(factor) {
    currentScale *= factor;
    updateStyle();
}

function doRotate() {
    currentRotation += 90;
    updateStyle();
}

function updateStyle() {
    const media = document.getElementById('activeMedia');
    if (media) {
        media.style.transform = `scale(${currentScale}) rotate(${currentRotation}deg)`;
    }
}
// 1. Tạo hiệu ứng hoa rơi
function createLeaves() {
    const container = document.getElementById('leaf-container');
    for (let i = 0; i < 30; i++) {
        let leaf = document.createElement('div');
        leaf.className = 'leaf';
        let size = Math.random() * 10 + 10 + 'px';
        leaf.style.width = size;
        leaf.style.height = size;
        leaf.style.left = Math.random() * 100 + '%';
        leaf.style.setProperty('--left', Math.random() * 20 + '%');
        leaf.style.animationDuration = Math.random() * 5 + 5 + 's';
        leaf.style.animationDelay = Math.random() * 5 + 's';
        container.appendChild(leaf);
    }
}
createLeaves();

// 2. Đồng hồ đếm ngược (15/06/2026)
const examDate = new Date("June 15, 2026 00:00:00").getTime();

setInterval(function() {
    const now = new Date().getTime();
    const distance = examDate - now;

    const d = Math.floor(distance / (1000 * 60 * 60 * 24));
    const h = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const m = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
    const s = Math.floor((distance % (1000 * 60)) / 1000);

    document.getElementById("days").innerHTML = d;
    document.getElementById("hours").innerHTML = h < 10 ? "0" + h : h;
    document.getElementById("minutes").innerHTML = m < 10 ? "0" + m : m;
    document.getElementById("seconds").innerHTML = s < 10 ? "0" + s : s;
}, 1000);

// 3. Nút Kỷ niệm ngẫu nhiên
function showSurprise() {
    const allCards = document.querySelectorAll('.media-wrap');
    if (allCards.length > 0) {
        const randomIndex = Math.floor(Math.random() * allCards.length);
        alert("Xuyên không về một kỷ niệm bất ngờ nè! ✨");
        openLightbox(allCards[randomIndex]);
    } else {
        alert("Bạn chưa đăng tấm ảnh nào để xuyên không cả!");
    }
}

function react(btn, type) {
    const countSpan = btn.querySelector('.count');
    let currentCount = parseInt(countSpan.innerText);
    
    btn.classList.toggle('active');
    if (btn.classList.contains('active')) {
        countSpan.innerText = currentCount + 1;
    } else {
        countSpan.innerText = currentCount - 1;
    }
}