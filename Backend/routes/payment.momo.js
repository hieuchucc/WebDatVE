// routes/payment.momo.js
const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
require('dotenv').config();

const router = express.Router();

// ===== ENV MOMO =====
const PARTNER_CODE = process.env.MOMO_PARTNER_CODE;
const ACCESS_KEY = process.env.MOMO_ACCESS_KEY;
const SECRET_KEY = process.env.MOMO_SECRET_KEY;
const MOMO_ENDPOINT = process.env.MOMO_ENDPOINT;
const MOMO_RETURN_URL = process.env.MOMO_RETURN_URL; // http://localhost:3000/api/payment/momo/return
const MOMO_NOTIFY_URL = process.env.MOMO_NOTIFY_URL; // http://localhost:3000/api/payment/momo/notify

// ===== FRONTEND PAGES (giống VNPay) =====
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://127.0.0.1:5500';
const FRONTEND_SUCCESS = `${FRONTEND_URL}/payment-success.html`;
const FRONTEND_FAIL = `${FRONTEND_URL}/payment-fail.html`;

// ===== MODELS (để sau này xử lý IPN) =====
const { Booking } = require('../models/Booking');
const { Trip } = require('../models/Trip');
const { Hold } = require('../models/Hold');

// Nếu bạn có mailer giống VNPay:
let sendTicketPaidEmail = async() => {};
try {
    ({ sendTicketPaidEmail } = require('../services/mailer'));
} catch (e) {
    console.log('Mailer not found, skip email for MoMo');
}

/* ======================================================
   1) TẠO ĐƠN THANH TOÁN MOMO  /api/payment/momo/create
   -> trả về payUrl cho FE redirect
====================================================== */
router.post('/create', async(req, res) => {
    try {
        const { amount, orderId, orderInfo } = req.body || {};

        if (!amount || !orderId) {
            return res.status(400).json({ message: 'Thiếu amount / orderId' });
        }

        const requestId = orderId + '_' + Date.now();

        const rawSignature =
            `accessKey=${ACCESS_KEY}` +
            `&amount=${amount}` +
            `&extraData=` +
            `&ipnUrl=${MOMO_NOTIFY_URL}` +
            `&orderId=${orderId}` +
            `&orderInfo=${orderInfo || 'Thanh toan'}` +
            `&partnerCode=${PARTNER_CODE}` +
            `&redirectUrl=${MOMO_RETURN_URL}` +
            `&requestId=${requestId}` +
            `&requestType=captureWallet`;

        const signature = crypto
            .createHmac('sha256', SECRET_KEY)
            .update(rawSignature)
            .digest('hex');

        const body = {
            partnerCode: PARTNER_CODE,
            accessKey: ACCESS_KEY,
            requestId,
            amount,
            orderId,
            orderInfo,
            redirectUrl: MOMO_RETURN_URL,
            ipnUrl: MOMO_NOTIFY_URL,
            extraData: '',
            requestType: 'captureWallet',
            signature,
            lang: 'vi'
        };

        const momoRes = await axios.post(MOMO_ENDPOINT, body);

        if (!momoRes.data || !momoRes.data.payUrl) {
            console.error('MoMo create error:', momoRes.data);
            return res.status(500).json({ message: 'Không nhận được payUrl từ MoMo' });
        }

        return res.json({
            ok: true,
            payUrl: momoRes.data.payUrl
        });
    } catch (err) {
        console.error('MoMo create error:', err);
        return res.status(500).json({ message: 'Lỗi tạo thanh toán MoMo' });
    }
});

/* ======================================================
   2) RETURN URL  /api/payment/momo/return
   - MoMo (hoặc bạn) GET vào đây
   - TÙY vào resultCode => redirect payment-success / payment-fail
   - KHÔNG xử lý DB ở đây (để dành cho IPN)
====================================================== */
router.get('/return', async(req, res) => {
    try {
        const { orderId, resultCode, amount } = req.query || {};

        if (!orderId) {
            return res.redirect(`${FRONTEND_FAIL}?orderId=unknown&code=no-order`);
        }

        // 0 -> thành công, các mã khác coi như thất bại / hủy
        if (String(resultCode) === '0') {
            const payDate = new Date().toISOString().slice(0, 19).replace('T', ' ');
            return res.redirect(
                `${FRONTEND_SUCCESS}` +
                `?orderId=${encodeURIComponent(orderId)}` +
                `&amount=${encodeURIComponent(amount || '')}` +
                `&bank=MoMo` +
                `&payDate=${encodeURIComponent(payDate)}`
            );
        }

        // hủy / lỗi
        return res.redirect(
            `${FRONTEND_FAIL}` +
            `?orderId=${encodeURIComponent(orderId)}` +
            `&code=${encodeURIComponent(resultCode || 'cancelled')}`
        );
    } catch (err) {
        console.error('MoMo return error:', err);
        return res.redirect(`${FRONTEND_FAIL}?orderId=unknown&code=server-error`);
    }
});

/* ======================================================
   3) IPN MOMO  /api/payment/momo/notify
   - SAU NÀY có Android hoặc muốn simulate thì dùng
   - Bây giờ bạn có thể bỏ qua, vẫn test được redirect
====================================================== */
router.post('/notify', async(req, res) => {
    try {
        const data = req.body || {};

        const {
            orderId,
            resultCode,
            amount
        } = data;

        if (!orderId) {
            return res.json({ message: 'Missing orderId' });
        }

        // TODO: Tính lại signature nếu bạn muốn verify thật sự.
        // Trong giai đoạn test không cần quá gắt.

        const bookingId = orderId;

        if (String(resultCode) === '0') {
            // cập nhật booking đã thanh toán
            let booking = await Booking.findByIdAndUpdate(
                bookingId, {
                    $set: {
                        'payment.status': 'paid',
                        'payment.method': 'momo',
                        'payment.amount': Number(amount || 0),
                        'payment.paidAt': new Date()
                    },
                    status: 'confirmed'
                }, { new: true }
            ).populate({ path: 'tripId', select: 'routeCode dateStr departHM' });

            if (!booking) {
                return res.json({ message: 'Booking not found' });
            }

            // chốt ghế + hủy hold giống VNPay
            try {
                const trip = await Trip.findById(booking.tripId);
                const hold = await Hold.findById(booking.holdId);

                if (trip) {
                    const oldSeats = Array.isArray(trip.seatsBooked) ? trip.seatsBooked : [];
                    const newSeats = Array.isArray(booking.seatCodes) ? booking.seatCodes : [];
                    const merged = Array.from(new Set([...oldSeats, ...newSeats]));
                    await Trip.updateOne({ _id: trip._id }, { $set: { seatsBooked: merged } });
                }

                if (hold) {
                    await Hold.updateOne({ _id: hold._id }, { $set: { status: 'cancelled' } });
                }
            } catch (e) {
                console.error('Confirm seats after MoMo pay error:', e);
            }

            try {
                const enriched = {...booking.toObject(), trip: booking.tripId };
                await sendTicketPaidEmail(enriched);
            } catch (e) {
                console.error('Send MoMo paid email error:', e);
            }

            return res.json({ message: 'OK', resultCode: 0 });
        }

        // thất bại
        await Booking.findByIdAndUpdate(bookingId, {
            $set: { 'payment.status': 'failed' }
        });

        return res.json({ message: 'Payment failed' });
    } catch (err) {
        console.error('MoMo notify error:', err);
        return res.json({ message: 'Server error' });
    }
});

/* ======================================================
   4) ROUTE TEST KHÔNG CẦN ĐIỆN THOẠI ANDROID
   - Gõ URL trên trình duyệt là được
====================================================== */

// test success: http://localhost:3000/api/payment/momo/test-success/<bookingId>?amount=300000
router.get('/test-success/:id', (req, res) => {
    const orderId = req.params.id;
    const amount = req.query.amount || '';
    const payDate = new Date().toISOString().slice(0, 19).replace('T', ' ');
    return res.redirect(
        `${FRONTEND_SUCCESS}` +
        `?orderId=${encodeURIComponent(orderId)}` +
        `&amount=${encodeURIComponent(amount)}` +
        `&bank=MoMo` +
        `&payDate=${encodeURIComponent(payDate)}`
    );
});

// test fail: http://localhost:3000/api/payment/momo/test-fail/<bookingId>?code=USER_CANCEL
router.get('/test-fail/:id', (req, res) => {
    const orderId = req.params.id;
    const code = req.query.code || 'USER_CANCEL';
    return res.redirect(
        `${FRONTEND_FAIL}` +
        `?orderId=${encodeURIComponent(orderId)}` +
        `&code=${encodeURIComponent(code)}`
    );
});

module.exports = router;