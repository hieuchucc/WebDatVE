const express = require('express');
const router = express.Router();
const QRCode = require('qrcode');
const { nanoid } = require('nanoid');
const { Booking } = require('../models/Booking');
const { PaymentIntent } = require('../models/PaymentIntent');

// POST /api/payments/create  { bookingId, method: 'momo'|'zalopay'|'vnpay' }
router.post('/create', async(req, res) => {
    try {
        const { bookingId, method } = req.body || {};
        if (!bookingId || !['momo', 'zalopay', 'vnpay'].includes(method))
            return res.status(400).json({ ok: false, message: 'bookingId/method không hợp lệ' });

        const booking = await Booking.findById(bookingId);
        if (!booking) return res.status(404).json({ ok: false, message: 'Booking không tồn tại' });
        if (booking.payment.status === 'paid') return res.json({ ok: true, alreadyPaid: true });

        const amount = booking.payment.amount;
        const orderCode = 'B' + booking._id.toString().slice(-8).toUpperCase() + '-' + nanoid(6).toUpperCase();

        // DEMO payUrl – sau này thay bằng link thật của Momo/ZaloPay/VNPAY
        const payUrl = `https://example-pay.local/${method}?order=${orderCode}&booking=${booking._id}&amount=${amount}`;

        const qrImageDataUrl = await QRCode.toDataURL(payUrl, { margin: 1, width: 360 });
        const TTL_MIN = 10;
        const intent = await PaymentIntent.create({
            bookingId: booking._id,
            method,
            amount,
            qrPayload: payUrl,
            qrImageDataUrl,
            expiresAt: new Date(Date.now() + TTL_MIN * 60 * 1000),
        });

        await Booking.updateOne({ _id: booking._id }, {
            $set: { 'payment.method': method, 'payment.lastIntentId': intent._id }
        });

        res.json({
            ok: true,
            intentId: intent._id,
            method,
            amount,
            payUrl,
            qrImageDataUrl,
            expiresAt: intent.expiresAt,
            status: intent.status
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ ok: false, message: 'Server error' });
    }
});

// GET /api/payments/:id/status
router.get('/:id/status', async(req, res) => {
    try {
        const intent = await PaymentIntent.findById(req.params.id).lean();
        if (!intent) return res.status(404).json({ ok: false, message: 'Intent không tồn tại' });

        let status = intent.status;
        if (status === 'pending' && intent.expiresAt <= new Date()) {
            status = 'expired';
            await PaymentIntent.updateOne({ _id: intent._id }, { $set: { status } });
        }
        res.json({ ok: true, status, providerTxnId: intent.providerTxnId || null });
    } catch (e) {
        console.error(e);
        res.status(500).json({ ok: false, message: 'Server error' });
    }
});

// DEMO: POST /api/payments/:id/simulate  { status:'paid'|'cancelled' }
router.post('/:id/simulate', async(req, res) => {
    try {
        const { status } = req.body || {};
        if (!['paid', 'cancelled'].includes(status))
            return res.status(400).json({ ok: false, message: 'status không hợp lệ' });

        const intent = await PaymentIntent.findById(req.params.id);
        if (!intent) return res.status(404).json({ ok: false, message: 'Intent không tồn tại' });
        if (intent.status !== 'pending') return res.json({ ok: true, status: intent.status });

        intent.status = status;
        intent.providerTxnId = intent.providerTxnId || ('SIM-' + nanoid(8).toUpperCase());
        await intent.save();

        const booking = await Booking.findById(intent.bookingId);
        if (booking) {
            if (status === 'paid') {
                booking.payment.status = 'paid';
                booking.payment.paidAt = new Date();
                booking.status = 'confirmed';
                await booking.save();
            } else {
                booking.payment.status = 'failed';
                await booking.save();
            }
        }
        res.json({ ok: true, status: intent.status });
    } catch (e) {
        console.error(e);
        res.status(500).json({ ok: false, message: 'Server error' });
    }
});

module.exports = router;