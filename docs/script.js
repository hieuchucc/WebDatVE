// ====== Cấu hình ======
const API_BASE = 'https://webdatve.onrender.com/api';

// Map text trong <select> sang routeCode backend
const ROUTE_MAP = {
    'Lagi - TP. Hồ Chí Minh': 'LAGI-HCM',
    'TP. Hồ Chí Minh - Lagi': 'HCM-LAGI',
    'Lagi - Đà Lạt': 'LAGI-DALAT',
    'Đà Lạt - Lagi': 'DALAT-LAGI',
    'Lagi - Nha Trang': 'LAGI-NTRANG',
    'Nha Trang - Lagi': 'NTRANG-LAGI',
};

// Label hiển thị theo routeCode (đúng chiều)
const ROUTE_LABEL = {
    'LAGI-HCM': 'Lagi - TP. Hồ Chí Minh',
    'HCM-LAGI': 'TP. Hồ Chí Minh - Lagi',
    'LAGI-DALAT': 'Lagi - Đà Lạt',
    'DALAT-LAGI': 'Đà Lạt - Lagi',
    'LAGI-NTRANG': 'Lagi - Nha Trang',
    'NTRANG-LAGI': 'Nha Trang - Lagi',
};

// Gợi ý điểm đón/điểm đến (chiều đi)
const PICKUP_POINTS = {
    'LAGI-HCM': ['Bến xe Lagi', 'Vòng xoay Lagi', 'QL55 - Ngã 3 Tân Hải'],
    'LAGI-DALAT': ['Bến xe Lagi', 'Cổng chợ Lagi', 'QL55 - Ngã 3 Hòa Minh'],
    'LAGI-NTRANG': ['Bến xe Lagi', 'Cầu Đa Tro', 'QL1A - Ngã 3 Tân Nghĩa'],
};
const DROPOFF_POINTS = {
    'LAGI-HCM': ['BX Miền Đông Mới', 'Thủ Đức - Xa Lộ Hà Nội', 'Q1 - Bến Thành'],
    'LAGI-DALAT': ['BX Liên Tỉnh Đà Lạt', 'Chợ Đà Lạt', 'Bùi Thị Xuân'],
    'LAGI-NTRANG': ['BX Phía Nam Nha Trang', 'Tháp Bà', 'Trần Phú - Trung tâm'],
};

// ====== DOM refs ======
const routeSelect = document.getElementById('route');
const dateInput = document.getElementById('date');
const pickupDL = document.getElementById('pickupPoints');
const dropoffDL = document.getElementById('dropOffPoints');
const departureIn = document.getElementById('departure');
const destinationIn = document.getElementById('destination');
const resultsWrap = document.getElementById('tripResults');

// ====== Utils ======
function reverseCode(code) {
    const p = (code || '').split('-');
    return p.length === 2 ? `${p[1]}-${p[0]}` : code;
}

function formatDateVN(yyyyMmDd) {
    const [y, m, d] = yyyyMmDd.split('-').map(Number);
    return `${String(d).padStart(2,'0')}/${String(m).padStart(2,'0')}/${y}`;
}

function ensureGroupContainers() {
    if (!document.getElementById('outboundResults') || !document.getElementById('returnResults')) {
        resultsWrap.innerHTML = `
      <div class="trip-group">
        <div class="trip-group__header"><span class="dot dot--go"></span><h3>Chiều đi</h3></div>
        <div id="outboundResults" class="trip-grid"></div>
      </div>
      <div class="trip-group">
        <div class="trip-group__header"><span class="dot dot--back"></span><h3>Chiều về</h3></div>
        <div id="returnResults" class="trip-grid"></div>
      </div>`;
    }
}

// Card hiển thị mỗi chuyến (KHÔNG gắn click ở đây; dùng delegation)
function renderCard(t) {
    const div = document.createElement('div');
    div.className = 'trip-card';
    div.innerHTML = `
    <div class="trip-card__body">
      <h5 class="trip-title">${ROUTE_LABEL[t.routeCode] || t.routeCode}</h5>
      <p class="trip-meta"><strong>Ngày đi:</strong> ${formatDateVN(t.date)}</p>
      <p class="trip-meta"><strong>Giờ khởi hành:</strong> ${t.departHM}</p>
      <div class="trip-footer">
        <span class="badge badge--price">💸 ${new Intl.NumberFormat('vi-VN').format(t.price)}đ</span>
        <span class="badge badge--seats">🪑 ${t.seatsLeft} / 15</span>
        <button class="btn-book" ${t.seatsLeft <= 0 ? 'disabled' : ''} data-trip="${t.id}">
          Chọn chuyến
        </button>
      </div>
    </div>`;
    return div;
}

// Tự sinh gợi ý cho chiều ngược
(function seedReversePoints() {
    const pairs = [
        ['LAGI-HCM', 'HCM-LAGI'],
        ['LAGI-DALAT', 'DALAT-LAGI'],
        ['LAGI-NTRANG', 'NTRANG-LAGI'],
    ];
    pairs.forEach(([go, back]) => {
        if (DROPOFF_POINTS[go] && !PICKUP_POINTS[back]) PICKUP_POINTS[back] = DROPOFF_POINTS[go].slice();
        if (PICKUP_POINTS[go] && !DROPOFF_POINTS[back]) DROPOFF_POINTS[back] = PICKUP_POINTS[go].slice();
    });
})();

// ====== Khóa ngày quá khứ ======
(function setMinDate() {
    const todayStr = new Date().toISOString().slice(0, 10);
    dateInput.min = todayStr;
})();

// ====== Khi đổi tuyến: đổ datalist điểm đón/trả ======
routeSelect.addEventListener('change', () => {
    const code = ROUTE_MAP[routeSelect.value] || null;
    pickupDL.innerHTML = '';
    dropoffDL.innerHTML = '';
    departureIn.value = '';
    destinationIn.value = '';
    if (!code) return;

    (PICKUP_POINTS[code] || []).forEach(p => {
        const o = document.createElement('option');
        o.value = p;
        pickupDL.appendChild(o);
    });
    (DROPOFF_POINTS[code] || []).forEach(p => {
        const o = document.createElement('option');
        o.value = p;
        dropoffDL.appendChild(o);
    });
});

// ====== Submit tìm kiếm ======
document.getElementById('searchForm').addEventListener('submit', async(e) => {
    e.preventDefault();

    const routeText = routeSelect.value;
    const routeCode = ROUTE_MAP[routeText];
    const date = (dateInput.value || '').trim();

    if (!routeCode) return alert('Vui lòng chọn tuyến hợp lệ');
    if (!date) return alert('Vui lòng chọn ngày');

    const todayStr = new Date().toISOString().slice(0, 10);
    if (date < todayStr) return alert('Ngày đã qua, vui lòng chọn lại');

    resultsWrap.innerHTML = '<p class="text-muted">Đang tìm chuyến...</p>';

    try {
        const url = `${API_BASE}/trips/search?routeCode=${encodeURIComponent(routeCode)}&date=${encodeURIComponent(date)}&includeReturn=1`;
        const res = await fetch(url);
        if (!res.ok) {
            const txt = await res.text().catch(() => '');
            console.error('HTTP', res.status, txt);
            resultsWrap.innerHTML = '<p class="text-danger">Máy chủ lỗi. Thử lại sau.</p>';
            return;
        }
        const data = await res.json();
        const trips = (data && Array.isArray(data.trips)) ? data.trips : [];
        renderTrips(trips, { date });
    } catch (err) {
        console.error(err);
        resultsWrap.innerHTML = '<p class="text-danger">Không thể tải dữ liệu. Vui lòng thử lại.</p>';
    }
});

// ====== Render: tách 2 chiều & grid ======
function renderTrips(trips, meta) {
    ensureGroupContainers();

    const goWrap = document.getElementById('outboundResults');
    const backWrap = document.getElementById('returnResults');
    const groups = resultsWrap.querySelectorAll('.trip-group');

    goWrap.innerHTML = '';
    backWrap.innerHTML = '';

    const { date } = meta;
    if (!Array.isArray(trips) || !trips.length) {
        resultsWrap.innerHTML =
            `<div class="alert alert-warning w-100">Không có chuyến ngày <strong>${formatDateVN(date)}</strong>.</div>`;
        return;
    }

    const selectedCode = ROUTE_MAP[routeSelect.value];
    const revCode = reverseCode(selectedCode);

    const goTrips = trips.filter(t => t.routeCode === selectedCode);
    const backTrips = trips.filter(t => t.routeCode === revCode);

    groups[0].style.display = goTrips.length ? '' : 'none';
    groups[1].style.display = backTrips.length ? '' : 'none';

    goTrips.forEach(t => goWrap.appendChild(renderCard(t)));
    backTrips.forEach(t => backWrap.appendChild(renderCard(t)));
}

/* =======================
   Seat chooser (Modal)
======================= */
const seatModalEl = document.getElementById('seatModal');
let seatModal; // Bootstrap modal instance
let currentTripId = null;
let currentSeatsData = null;
let selectedSeats = new Set();

function bsModal() {
    if (!seatModal) seatModal = new bootstrap.Modal(seatModalEl);
    return seatModal;
}

// Event delegation: chỉ gắn 1 lần cho container
resultsWrap.addEventListener('click', async(e) => {
    const btn = e.target.closest('button[data-trip]');
    if (!btn) return;
    const tripId = btn.getAttribute('data-trip');
    currentTripId = tripId;
    selectedSeats = new Set();
    await openSeatModal(tripId);
});

// Mở modal & tải sơ đồ
async function openSeatModal(tripId) {
    const seatGrid = document.getElementById('seatGrid');
    const seatMeta = document.getElementById('seatMeta');
    const seatMsg = document.getElementById('seatMsg');
    const btnHold = document.getElementById('btnHold');

    seatGrid.innerHTML = '<div class="text-muted">Đang tải sơ đồ ghế...</div>';
    seatMeta.textContent = '';
    seatMsg.textContent = '';
    btnHold.disabled = true;

    try {
        const res = await fetch(`${API_BASE}/trips/${encodeURIComponent(tripId)}/seats`);
        const data = await res.json();
        currentSeatsData = data;

        seatMeta.textContent =
            `${data.routeCode} • ${data.date} • ${data.departHM} • ${new Intl.NumberFormat('vi-VN').format(data.price)}đ`;

        // vẽ lưới
        seatGrid.innerHTML = '';
        (data.layout || []).forEach(row => {
            const rowDiv = document.createElement('div');
            rowDiv.className = 'seat-row';
            row.forEach(cell => {
                const s = document.createElement('div');
                s.className = 'seat-cell';
                if (cell === null) {
                    s.classList.add('is-null');
                } else {
                    const id = String(cell);
                    const isBooked = data.booked.includes(id);
                    const isHeld = data.held.includes(id);
                    s.textContent = id;
                    if (isBooked) s.classList.add('is-booked');
                    else if (isHeld) s.classList.add('is-held');
                    else s.classList.add('is-free');

                    if (!isBooked && !isHeld) {
                        s.addEventListener('click', () => {
                            if (s.classList.contains('is-selected')) {
                                s.classList.remove('is-selected');
                                selectedSeats.delete(id);
                            } else {
                                s.classList.add('is-selected');
                                selectedSeats.add(id);
                            }
                            btnHold.disabled = selectedSeats.size === 0;
                        });
                    }
                }
                rowDiv.appendChild(s);
            });
            seatGrid.appendChild(rowDiv);
        });

        // Giữ chỗ
        btnHold.onclick = async() => {
            if (selectedSeats.size === 0) return;
            btnHold.disabled = true;
            seatMsg.textContent = 'Đang giữ chỗ...';

            try {
                const res2 = await fetch(`${API_BASE}/holds`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        tripId: currentTripId,
                        seatCodes: Array.from(selectedSeats)
                    })
                });

                const data2 = await res2.json();
                if (!res2.ok || !data2.ok || !data2.holdId) {
                    seatMsg.textContent = data2.message || 'Giữ chỗ thất bại.';
                    btnHold.disabled = false;
                    return;
                }

                // ✅ Thành công: chuyển sang trang nhập thông tin
                const holdId = data2.holdId;
                window.location.href = `checkout.html?hold=${encodeURIComponent(holdId)}`;
            } catch (err) {
                console.error(err);
                seatMsg.textContent = 'Không thể giữ chỗ. Vui lòng thử lại.';
                btnHold.disabled = false;
            }
        };

        bsModal().show();
    } catch (err) {
        console.error(err);
        seatGrid.innerHTML = '<div class="text-danger">Tải sơ đồ thất bại.</div>';
    }
}

//Review
// Backend base (nếu bạn đã set ở chỗ khác rồi thì bỏ dòng này)
window.API_BASE = window.API_BASE || 'https://webdatve.onrender.com';

(function() {
    var API_BASE = window.API_BASE || '';
    var CURRENT_TRIP_ID = window.CURRENT_TRIP_ID || null;

    var form = document.getElementById('reviewForm');
    var phoneInput = document.getElementById('rvPhone');
    var commentInput = document.getElementById('rvComment');
    var messageBox = document.getElementById('reviewMessage');
    var submitBtn = document.getElementById('btnSubmitReview');

    var reviewsListEl = document.getElementById('reviewsList');
    var reviewsEmptyEl = document.getElementById('reviewsEmpty');
    var ratingAverageEl = document.getElementById('ratingAverage');
    var ratingCountEl = document.getElementById('ratingCount');
    var ratingSummaryStarsEl = document.getElementById('ratingSummaryStars');
    var reviewsListCountBadgeEl = document.getElementById('reviewsListCountBadge');
    var reviewsStarFilterEl = document.getElementById('reviewsStarFilter');
    var reviewsToggleBtnEl = document.getElementById('reviewsToggleBtn');

    var allReviews = [];
    var showAllReviews = false;

    /* ===== HELPERS ===== */
    function getSelectedRating() {
        var radios = document.getElementsByName('rating');
        for (var i = 0; i < radios.length; i++) {
            if (radios[i].checked) return parseInt(radios[i].value, 10) || 0;
        }
        return 0;
    }

    function showMessage(type, text) {
        messageBox.className = 'review-message ' + type;
        messageBox.innerHTML = text;
        messageBox.style.display = 'block';
    }

    function setSubmitting(isSubmitting) {
        if (isSubmitting) {
            submitBtn.disabled = true;
            submitBtn.innerHTML = 'Đang gửi...';
        } else {
            submitBtn.disabled = false;
            submitBtn.innerHTML = 'Gửi đánh giá';
        }
    }

    function maskPhone(phone) {
        if (!phone) return '';
        var s = phone.replace(/\s+/g, '');
        if (s.length <= 4) return s;
        return s.slice(0, 3) + '***' + s.slice(-3);
    }

    function formatDate(isoStr) {
        if (!isoStr) return '';
        var d = new Date(isoStr);
        if (isNaN(d.getTime())) return '';
        var dd = ('0' + d.getDate()).slice(-2);
        var mm = ('0' + (d.getMonth() + 1)).slice(-2);
        var yyyy = d.getFullYear();
        return dd + '/' + mm + '/' + yyyy;
    }

    function buildStarsHTML(rating) {
        var full = Math.round(rating || 0);
        var html = '';
        for (var i = 1; i <= 5; i++) {
            html += '<span class="star' + (i <= full ? ' filled' : '') + '">★</span>';
        }
        return html;
    }

    /* ===== RENDER LIST (FILTER + 5 GẦN NHẤT / ALL) ===== */
    function renderReviewsList() {
        if (!reviewsListEl) return;

        var starFilter = 0;
        if (reviewsStarFilterEl) {
            starFilter = parseInt(reviewsStarFilterEl.value, 10) || 0;
        }

        var filtered = allReviews.filter(function(r) {
            if (!starFilter || starFilter === 1) return true;
            if (starFilter === 5) return r.rating === 5;
            if (starFilter === 4) return r.rating >= 4;
            if (starFilter === 3) return r.rating >= 3;
            if (starFilter === 2) return r.rating >= 2;
            return true;
        });

        var displayList = filtered;
        if (!showAllReviews && filtered.length > 5) {
            displayList = filtered.slice(0, 5);
        }

        if (reviewsToggleBtnEl) {
            if (filtered.length > 5) {
                reviewsToggleBtnEl.style.display = 'inline-block';
                reviewsToggleBtnEl.textContent = showAllReviews ? 'Thu gọn' : 'Xem tất cả';
            } else {
                reviewsToggleBtnEl.style.display = 'none';
            }
        }

        if (!displayList.length) {
            reviewsListEl.innerHTML = '';
            reviewsEmptyEl.style.display = 'block';
            return;
        }

        reviewsEmptyEl.style.display = 'none';

        var html = '';
        for (var j = 0; j < displayList.length; j++) {
            var r = displayList[j];
            var initial = (r.name && r.name.charAt(0)) || (maskPhone(r.phone).charAt(0) || 'K');
            html +=
                '<div class="review-card">' +
                '  <div class="review-avatar">' + initial + '</div>' +
                '  <div class="review-body">' +
                '    <div class="review-header-row">' +
                '      <div>' +
                '        <div class="review-name">' + (r.name || 'Khách hàng') + '</div>' +
                '        <div class="review-phone">' + maskPhone(r.phone) + '</div>' +
                '      </div>' +
                '      <div class="review-stars">' + buildStarsHTML(r.rating || 0) + '</div>' +
                '    </div>' +
                '    <div class="review-meta-row">' +
                '      <span class="review-date">' + formatDate(r.createdAt) + '</span>' +
                '      <span class="review-chip">Đã đi chuyến</span>' +
                '    </div>' +
                '    <p class="review-comment">' + (r.comment || '') + '</p>' +
                '  </div>' +
                '</div>';
        }

        reviewsListEl.innerHTML = html;
    }

    /* ===== LOAD REVIEWS TỪ BACKEND ===== */
    function loadReviews() {
        if (!reviewsListEl) return;

        var xhr = new XMLHttpRequest();
        xhr.open('GET', API_BASE + '/api/reviews/public?limit=50', true);

        xhr.onreadystatechange = function() {
            if (xhr.readyState === 4) {
                if (xhr.status === 200) {
                    var res = null;
                    try {
                        res = JSON.parse(xhr.responseText);
                    } catch (e) {}

                    var items, total, avg;

                    if (Array.isArray(res)) {
                        items = res;
                        total = res.length;
                        var sum = 0;
                        for (var i = 0; i < res.length; i++) sum += res[i].rating || 0;
                        avg = total ? sum / total : 0;
                    } else {
                        items = res && res.items ? res.items : [];
                        total = res && typeof res.total === 'number' ? res.total : items.length;
                        avg = res && typeof res.averageRating === 'number' ? res.averageRating : 0;
                    }

                    allReviews = items || [];

                    ratingAverageEl.innerHTML = avg ? avg.toFixed(1) : '0.0';
                    ratingCountEl.innerHTML = total;
                    ratingSummaryStarsEl.innerHTML = buildStarsHTML(avg);
                    reviewsListCountBadgeEl.innerHTML = total + ' đánh giá';

                    showAllReviews = false;
                    renderReviewsList();
                } else {
                    console.error('Load reviews error:', xhr.status, xhr.responseText);
                }
            }
        };

        xhr.send();
    }

    /* ===== GỬI REVIEW (CHECK PHONE + POST) ===== */
    function sendReview(phone, rating, comment, tripId) {
        var xhr = new XMLHttpRequest();
        xhr.open('POST', API_BASE + '/api/reviews', true);
        xhr.setRequestHeader('Content-Type', 'application/json;charset=UTF-8');

        xhr.onreadystatechange = function() {
            if (xhr.readyState === 4) {
                setSubmitting(false);
                if (xhr.status === 200 || xhr.status === 201) {
                    showMessage('success', 'Cảm ơn bạn đã đánh giá dịch vụ!');
                    form.reset();
                    var star5 = document.getElementById('star5');
                    if (star5) star5.checked = true;
                    loadReviews();
                } else {
                    var res = null;
                    try {
                        res = JSON.parse(xhr.responseText);
                    } catch (e) {}
                    var msg =
                        (res && res.message) ||
                        'Không gửi được đánh giá. Vui lòng thử lại sau.';
                    showMessage('error', msg);
                }
            }
        };

        var payload = {
            phone: phone,
            rating: rating,
            comment: comment,
            tripId: tripId || CURRENT_TRIP_ID || null
        };

        xhr.send(JSON.stringify(payload));
    }

    function checkPhoneAndSubmit(phone, rating, comment) {
        var xhr = new XMLHttpRequest();
        xhr.open('POST', API_BASE + '/api/reviews/check-phone', true);
        xhr.setRequestHeader('Content-Type', 'application/json;charset=UTF-8');

        xhr.onreadystatechange = function() {
            if (xhr.readyState === 4) {
                if (xhr.status === 200) {
                    var res = null;
                    try {
                        res = JSON.parse(xhr.responseText);
                    } catch (e) {}

                    if (!res || !res.eligible) {
                        var msg =
                            (res && res.message) ||
                            'Số điện thoại này chưa từng đặt vé hoặc vé chưa hoàn tất.';
                        showMessage('error', msg);
                        setSubmitting(false);
                        return;
                    }

                    var tripId = (res && res.tripId) || CURRENT_TRIP_ID || null;
                    sendReview(phone, rating, comment, tripId);
                } else {
                    showMessage(
                        'error',
                        'Không kiểm tra được số điện thoại. Vui lòng thử lại.'
                    );
                    setSubmitting(false);
                }
            }
        };

        var payload = { phone: phone, tripId: CURRENT_TRIP_ID || null };
        xhr.send(JSON.stringify(payload));
    }

    /* ===== SỰ KIỆN ===== */
    if (form) {
        form.addEventListener('submit', function(e) {
            e.preventDefault();

            var phone = (phoneInput.value || '').replace(/\s+/g, '').trim();
            var rating = getSelectedRating();
            var comment = (commentInput.value || '').trim();

            if (!phone) {
                showMessage('error', 'Vui lòng nhập số điện thoại đã đặt vé.');
                phoneInput.focus();
                return;
            }
            if (phone.length < 8) {
                showMessage('error', 'Số điện thoại không hợp lệ.');
                phoneInput.focus();
                return;
            }
            if (!rating || rating < 1 || rating > 5) {
                showMessage('error', 'Vui lòng chọn mức đánh giá sao.');
                return;
            }
            if (!isMeaningfulComment(comment)) {
                showMessage(
                    'error',
                    'Nội dung nhận xét quá ngắn hoặc không hợp lệ. Vui lòng mô tả cụ thể trải nghiệm của bạn (ít nhất 10 ký tự).'
                );
                commentInput.focus();
                return;
            }

            setSubmitting(true);
            showMessage('success', 'Đang kiểm tra số điện thoại của bạn...');
            checkPhoneAndSubmit(phone, rating, comment);
        });
    }

    if (reviewsStarFilterEl) {
        reviewsStarFilterEl.addEventListener('change', function() {
            showAllReviews = false;
            renderReviewsList();
        });
    }

    if (reviewsToggleBtnEl) {
        reviewsToggleBtnEl.addEventListener('click', function() {
            showAllReviews = !showAllReviews;
            renderReviewsList();
        });
    }

    function isMeaningfulComment(text) {
        if (!text) return false;
        var t = text.trim();

        // Độ dài tối thiểu
        if (t.length < 10) return false; // yêu cầu ít nhất 10 ký tự

        // Nếu toàn là một ký tự lặp lại (vd: zzzzz, aaaaaa)
        var first = t[0];
        var allSame = true;
        for (var i = 1; i < t.length; i++) {
            if (t[i] !== first) {
                allSame = false;
                break;
            }
        }
        if (allSame) return false;

        // Có ít nhất 2 ký tự khác nhau
        var uniqueChars = {};
        for (var j = 0; j < t.length; j++) {
            var c = t[j];
            if (c !== ' ' && c !== '.' && c !== ',' && c !== '!') {
                uniqueChars[c] = true;
            }
        }
        if (Object.keys(uniqueChars).length < 2) return false;

        return true;
    }

    // Load dữ liệu khi trang mở
    loadReviews();
})();
