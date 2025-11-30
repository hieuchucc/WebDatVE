const express = require('express');
const router = express.Router();
const { Trip, ROUTES } = require('../models/Trip');
const { DateTime } = require('luxon');
const { VN_TZ, todayVN, combineVN, ymdVN } = require('../utils/time');

// Liệt kê tuyến cho FE
router.get('/routes', (req, res) => {
    res.json({
        routes: ROUTES.map(r => ({ code: r.code, from: r.from, to: r.to }))
    });
});

// Tìm kiếm chuyến
// GET /api/trips/search?routeCode=HCM-DALAT&date=2025-10-09
function reverseCode(code) {
    // Ví dụ: 'LAGI-HCM' -> 'HCM-LAGI'
    const parts = code.split('-');
    if (parts.length !== 2) return code;
    return `${parts[1]}-${parts[0]}`;
}

router.get('/search', async(req, res) => {
    try {
        const { routeCode, date, includeReturn } = req.query;
        if (!routeCode || !date) return res.status(400).json({ message: 'routeCode và date là bắt buộc' });

        // hợp lệ route
        const routeSet = new Set(ROUTES.map(r => r.code));
        if (!routeSet.has(routeCode)) return res.status(400).json({ message: 'routeCode không hợp lệ' });

        const qDate = DateTime.fromFormat(date, 'yyyy-LL-dd', { zone: VN_TZ });
        if (!qDate.isValid) return res.status(400).json({ message: 'date không đúng định dạng yyyy-MM-dd' });
        if (qDate < todayVN()) return res.json({ trips: [], message: 'Ngày đã qua' });

        // ✅ nếu includeReturn=1/true thì thêm chiều ngược
        const wantBoth = includeReturn === '1' || includeReturn === 'true';
        const codes = [routeCode];
        const rev = reverseCode(routeCode);
        if (wantBoth && routeSet.has(rev)) codes.push(rev);

        const nowVN = DateTime.now().setZone(VN_TZ);

        const filter = { routeCode: { $in: codes }, dateStr: date, active: true };
        if (qDate.hasSame(nowVN, 'day')) {
            filter.departAt = { $gt: nowVN.toJSDate() };
        }

        const trips = await Trip.find(filter).sort({ departAt: 1 }).lean();

        const mapped = trips.map(t => {
            const seatsBookedCount = Array.isArray(t.seatsBooked) ? t.seatsBooked.length : 0;
            const total = (typeof t.seatsTotal === 'number') ? t.seatsTotal : 0;
            const seatsLeft = Math.max(0, total - seatsBookedCount);
            return {
                id: t._id,
                routeCode: t.routeCode, // giữ routeCode để FE hiển thị đúng chiều
                date: t.dateStr,
                departHM: t.departHM,
                departAt: t.departAt,
                price: t.price,
                seatsLeft
            };
        });

        res.json({ trips: mapped });
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Lỗi server' });
    }
});


const { Hold } = require('../models/Hold');

// Sơ đồ 15 ghế (chuẩn hoá số ghế 1..15)
const SEAT_LAYOUT_15 = [
    [null, null, '1', '2'], // H1: 2 ghế bên phải (tài xế/logo bên trái)
    ['3', '4', '5'], // H2
    ['6', '7', '8'], // H3
    ['9', '10', '11'], // H4
    ['12', '13', '14', '15'] // H5
];

// GET /api/trips/:id/seats
router.get('/:id/seats', async(req, res) => {
    try {
        const { id } = req.params;
        const trip = await Trip.findById(id).lean();
        if (!trip) return res.status(404).json({ message: 'Không tìm thấy chuyến' });

        // booked: từ Trip
        const booked = (Array.isArray(trip.seatsBooked) ? trip.seatsBooked : [])
            .map(x => String(x));

        // held: từ Hold còn hiệu lực
        const now = new Date();
        const holds = await Hold.find({
            tripId: trip._id,
            status: 'active',
            expiresAt: { $gt: now }
        }, { seatCodes: 1 }).lean();

        const held = new Set();
        holds.forEach(h => (h.seatCodes || []).forEach(s => held.add(String(s))));

        res.json({
            layout: SEAT_LAYOUT_15, // để FE dựng lưới
            seatsTotal: trip.seatsTotal || 15,
            booked, // ['1','7', ...]
            held: Array.from(held), // ['5','6', ...]
            routeCode: trip.routeCode,
            date: trip.dateStr,
            departHM: trip.departHM,
            price: trip.price
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Lỗi server' });
    }
});

module.exports = router;