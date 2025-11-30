const express = require('express');
const router = express.Router();
const { Trip } = require('../models/Trip');
const { Hold } = require('../models/Hold');
const { DateTime } = require('luxon');
const { VN_TZ } = require('../utils/time');

// Helper: rút trích meta chuyến để trả cho FE
function pickTripMeta(trip) {
    if (!trip) return {};
    // Ưu tiên trường sẵn có
    let routeCode = trip.routeCode || trip.route || '';
    let priceEach = typeof trip.price === 'number' ? trip.price : undefined;

    // date / time: nếu có departAt thì suy ra; còn không dùng field có sẵn
    let date = trip.date || '';
    let departHM = trip.departHM || '';

    if (trip.departAt instanceof Date) {
        const dtVN = DateTime.fromJSDate(trip.departAt).setZone(VN_TZ);
        if (!date) date = dtVN.toISODate(); // YYYY-MM-DD
        if (!departHM) departHM = dtVN.toFormat('HH:mm');
    }
    return { routeCode, date, departHM, priceEach };
}

// ============== POST /api/holds ==================
// body: { tripId, seatCodes: ['1','2'], customerPhone }
router.post('/', async(req, res) => {
    try {
        const { tripId, seatCodes, customerPhone } = req.body || {};
        if (!tripId || !Array.isArray(seatCodes) || seatCodes.length === 0) {
            return res.status(400).json({ ok: false, message: 'tripId và seatCodes là bắt buộc' });
        }

        const trip = await Trip.findById(tripId);
        if (!trip) return res.status(404).json({ ok: false, message: 'Không tìm thấy chuyến' });

        // chặn chuyến đã khởi hành
        const nowVN = DateTime.now().setZone(VN_TZ);
        const departVN = DateTime.fromJSDate(trip.departAt).setZone(VN_TZ);
        if (departVN <= nowVN) return res.status(400).json({ ok: false, message: 'Chuyến đã khởi hành' });

        // chuẩn hoá ghế string
        const reqSeats = seatCodes.map(s => String(s));

        // kiểm tra ghế hợp lệ theo layout 1..15
        const validSet = new Set(Array.from({ length: 15 }, (_, i) => String(i + 1)));
        for (const s of reqSeats) {
            if (!validSet.has(s)) {
                return res.status(400).json({ ok: false, message: `Ghế không hợp lệ: ${s}` });
            }
        }

        // ghế đã book?
        const bookedSet = new Set((trip.seatsBooked || []).map(x => String(x)));

        // ghế đang hold bởi người khác?
        const holds = await Hold.find({ tripId: trip._id, status: 'active', expiresAt: { $gt: new Date() } }, { seatCodes: 1 }).lean();

        const heldSet = new Set();
        holds.forEach(h => (h.seatCodes || []).forEach(s => heldSet.add(String(s))));

        for (const s of reqSeats) {
            if (bookedSet.has(s)) return res.status(409).json({ ok: false, message: `Ghế ${s} đã bán` });
            if (heldSet.has(s)) return res.status(409).json({ ok: false, message: `Ghế ${s} đang được giữ` });
        }

        // tạo hold
        const doc = await Hold.create({
            tripId: trip._id,
            seatCodes: reqSeats,
            customerPhone: (customerPhone || '').trim()
                // expiresAt auto 15' (xem note ở dưới models/Hold.js)
        });

        const meta = pickTripMeta(trip);
        return res.json({
            ok: true,
            holdId: doc._id,
            expiresAt: doc.expiresAt,
            seatCodes: reqSeats,
            ...meta
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ ok: false, message: 'Lỗi server' });
    }
});

// ============== GET /api/holds/:id ==================
// Trả đủ thông tin để checkout render
router.get('/:id', async(req, res) => {
    try {
        const h = await Hold.findById(req.params.id).lean();
        if (!h) return res.status(404).json({ ok: false, message: 'Hold không tồn tại' });

        const trip = await Trip.findById(h.tripId).lean();
        const meta = pickTripMeta(trip);

        // Nếu model Hold đã có expiresAt thì dùng; nếu không, suy ra từ createdAt + TTL
        let expiresAt = h.expiresAt;
        if (!expiresAt && h.createdAt) {
            // TTL mặc định 15 phút — chỉnh nếu bạn đặt khác
            const TTL_MIN = 10;

            expiresAt = new Date(new Date(h.createdAt).getTime() + TTL_MIN * 60 * 1000);
        }

        return res.json({
            ok: true,
            holdId: h._id,
            seatCodes: h.seatCodes || [],
            expiresAt,
            ...meta
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ ok: false, message: 'Lỗi server' });
    }
});

// (tuỳ chọn) huỷ hold: DELETE /api/holds/:id
router.delete('/:id', async(req, res) => {
    try {
        const { id } = req.params;
        await Hold.updateOne({ _id: id, status: 'active' }, { $set: { status: 'cancelled' } });
        res.json({ ok: true });
    } catch (e) {
        console.error(e);
        res.status(500).json({ ok: false, message: 'Lỗi server' });
    }
});

module.exports = router;