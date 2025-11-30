// routes/reviews.js
const express = require('express');
const router = express.Router();

// ===== LẤY BOOKING MODEL THEO CẢ HAI KIỂU EXPORT =====
let RawBooking = require('../models/Booking');

let Booking;
if (RawBooking && typeof RawBooking.findOne === 'function') {
    Booking = RawBooking;
} else if (RawBooking && RawBooking.Booking && typeof RawBooking.Booking.findOne === 'function') {
    Booking = RawBooking.Booking;
} else {
    console.error('❌ Không tìm được Booking model hợp lệ trong ../models/Booking');
}

const Review = require('../models/Review');

/**
 * POST /api/reviews/check-phone
 * Body: { phone: '0347...', tripId?: '...' }
 */
router.post('/check-phone', async(req, res) => {
    try {
        const { phone, tripId } = req.body;

        if (!phone) {
            return res.status(400).json({
                eligible: false,
                message: 'Thiếu số điện thoại.'
            });
        }

        if (!Booking || typeof Booking.findOne !== 'function') {
            console.error('❌ Booking model chưa được khởi tạo đúng');
            return res.status(500).json({
                eligible: false,
                message: 'Lỗi cấu hình server (Booking model).'
            });
        }

        const normalizedPhone = phone.replace(/\s+/g, '');

        const filter = {
            'customer.phone': normalizedPhone,
            // Có thể mở thêm nếu bạn muốn chỉ cho khách đã thanh toán:
            // 'payment.status': 'confirmed',
            // status: 'confirmed',
        };

        if (tripId) {
            filter.tripId = tripId;
        }

        const booking = await Booking.findOne(filter).sort({ createdAt: -1 });

        if (!booking) {
            return res.json({
                eligible: false,
                message: 'Số điện thoại này chưa từng đặt vé hoặc vé chưa hoàn tất.'
            });
        }

        return res.json({
            eligible: true,
            tripId: booking.tripId || null,
            bookingId: booking._id,
            name: booking.customer && booking.customer.name, // gửi luôn tên về nếu cần
            message: 'Bạn đủ điều kiện để gửi đánh giá.'
        });
    } catch (err) {
        console.error('check-phone error:', err);
        return res.status(500).json({
            eligible: false,
            message: 'Lỗi server khi kiểm tra số điện thoại.'
        });
    }
});

/**
 * POST /api/reviews
 * Body: { phone, rating, comment, tripId }
 * → TỰ LẤY TÊN TỪ BOOKING.CUSTOMER.NAME
 */
router.post('/', async(req, res) => {
    try {
        const { phone, rating, comment, tripId } = req.body;

        if (!phone || !rating || !comment) {
            return res.status(400).json({
                message: 'Thiếu dữ liệu (phone, rating, comment).'
            });
        }

        const normalizedPhone = phone.replace(/\s+/g, '');

        // ==== RÀNG BUỘC SỐ LẦN ĐÁNH GIÁ TRÊN 1 SỐ ĐIỆN THOẠI ====
        const MAX_REVIEWS_PER_PHONE = 3; // cho phép tối đa 3 lần
        const existingCount = await Review.countDocuments({
            phone: normalizedPhone
        });
        if (existingCount >= MAX_REVIEWS_PER_PHONE) {
            return res.status(400).json({
                message: `Số điện thoại này đã gửi tối đa ${MAX_REVIEWS_PER_PHONE} đánh giá.`
            });
        }

        // ==== RÀNG BUỘC NỘI DUNG BÌNH LUẬN ====
        const t = (comment || '').trim();
        if (!t || t.length < 10) {
            return res.status(400).json({
                message: 'Nội dung nhận xét quá ngắn. Vui lòng viết ít nhất 10 ký tự.'
            });
        }

        // kiểm tra không phải toàn 1 ký tự lặp lại
        let allSame = true;
        for (let i = 1; i < t.length; i++) {
            if (t[i] !== t[0]) {
                allSame = false;
                break;
            }
        }
        if (allSame) {
            return res.status(400).json({
                message: 'Nội dung nhận xét không hợp lệ. Vui lòng mô tả cụ thể trải nghiệm của bạn.'
            });
        }

        // Tìm booking để lấy tên khách
        if (!Booking || typeof Booking.findOne !== 'function') {
            console.error('❌ Booking model chưa được khởi tạo đúng');
            return res.status(500).json({
                message: 'Lỗi cấu hình server (Booking model).'
            });
        }

        const booking = await Booking.findOne({
                'customer.phone': normalizedPhone,
                // 'payment.status': 'confirmed', // nếu muốn lọc vé hoàn tất
            })
            .sort({ createdAt: -1 })
            .lean();

        if (!booking) {
            return res.status(400).json({
                message: 'Không tìm thấy vé hoàn tất của số điện thoại này.'
            });
        }

        const customerName =
            (booking.customer && booking.customer.name) || 'Khách hàng';

        const review = new Review({
            name: customerName,
            phone: normalizedPhone,
            rating,
            comment: t,
            tripId: tripId || booking.tripId || null
        });

        await review.save();

        return res.status(201).json({
            message: 'Đã lưu đánh giá thành công.',
            review
        });
    } catch (err) {
        console.error('create review error:', err);
        return res
            .status(500)
            .json({ message: 'Lỗi server khi lưu đánh giá.' });
    }
});


/**
 * GET /api/reviews/public  → trả danh sách review cho frontend
 */
router.get('/public', async(req, res) => {
    try {
        const limit = parseInt(req.query.limit, 10) || 20;
        const items = await Review.find({})
            .sort({ createdAt: -1 })
            .limit(limit)
            .lean();

        const total = await Review.countDocuments({});
        let sum = 0;
        items.forEach((r) => {
            sum += r.rating || 0;
        });
        const averageRating = total ? sum / total : 0;

        res.json({
            items,
            total,
            averageRating
        });
    } catch (err) {
        console.error('get public reviews error:', err);
        res
            .status(500)
            .json({ message: 'Lỗi server khi lấy danh sách đánh giá.' });
    }
});

module.exports = router;