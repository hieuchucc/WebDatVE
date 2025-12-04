const express = require('express');
const crypto = require('crypto');
const moment = require('moment-timezone');
require('dotenv').config();

const router = express.Router();

// ===== VNPay config từ ENV =====
const {
  VNP_URL,
  VNP_RETURN_URL,
  VNP_TMN_CODE,
  VNP_HASH_SECRET,
  FRONTEND_URL = 'http://127.0.0.1:5500',
} = process.env;

const FRONTEND_SUCCESS = `${FRONTEND_URL}/payment-success.html`;
const FRONTEND_FAIL = `${FRONTEND_URL}/payment-fail.html`;

// ===== Models & services =====
const { Booking } = require('../models/Booking');
const { Hold } = require('../models/Hold');
const { Trip } = require('../models/Trip');
const { PaymentIntent } = require('../models/PaymentIntent');
const { sendTicketPaidEmail } = require('../services/mailer');

// ========= Helper: check config VNPay =========
function ensureVnpConfig(req, res) {
  if (!VNP_URL || !VNP_RETURN_URL || !VNP_TMN_CODE || !VNP_HASH_SECRET) {
    console.error('VNPay config missing at runtime:', {
      VNP_URL,
      VNP_RETURN_URL,
      VNP_TMN_CODE,
      VNP_HASH_SECRET: VNP_HASH_SECRET ? '***' : undefined,
    });
    res.status(500).json({
      ok: false,
      message:
        'VNPay chưa cấu hình đầy đủ trên server (URL / TMN / HASH / RETURN_URL).',
    });
    return false;
  }
  return true;
}

// ========= Helper: chốt ghế & huỷ hold =========
async function confirmSeatFromBooking(booking) {
  try {
    if (!booking) return;

    const trip = await Trip.findById(booking.tripId);
    const hold = await Hold.findById(booking.holdId);

    if (trip) {
      const oldBooked = Array.isArray(trip.seatsBooked)
        ? trip.seatsBooked.map(String)
        : [];
      const newBooked = Array.isArray(booking.seatCodes)
        ? booking.seatCodes.map(String)
        : [];
      const set = {};
      oldBooked.concat(newBooked).forEach((s) => (set[s] = true));
      const merged = Object.keys(set);

      await Trip.updateOne(
        { _id: trip._id },
        { $set: { seatsBooked: merged } }
      );
    }

    if (hold) {
      await Hold.updateOne(
        { _id: hold._id },
        { $set: { status: 'cancelled' } }
      );
    }
  } catch (e) {
    console.error('Lỗi chốt ghế sau khi thanh toán VNPay:', e);
  }
}

/* ================== 1. TẠO LINK THANH TOÁN ================== */
router.post('/create_vnpay_url', async (req, res) => {
  try {
    if (!ensureVnpConfig(req, res)) return;

    const clientIp =
      req.headers['x-forwarded-for'] ||
      req.socket?.remoteAddress ||
      '127.0.0.1';

    const {
      amount: amountInput,
      orderId: bookingId, // bookingId chính là orderId client gửi lên
      orderInfo,
      bankCode,
    } = req.body || {};

    if (!bookingId) {
      return res.status(400).json({
        ok: false,
        message: 'Thiếu bookingId (orderId).',
      });
    }

    const now = moment().tz('Asia/Ho_Chi_Minh');
    const expiresAt = now.clone().add(15, 'minutes').toDate();
    const vnpCreateDate = now.format('YYYYMMDDHHmmss');
    const vnpExpireDate = now
      .clone()
      .add(15, 'minutes')
      .format('YYYYMMDDHHmmss');

    const amount = amountInput ? Number(amountInput) : 10000;

    // Ở đây cho vnp_TxnRef = bookingId cho dễ mapping
    const txnRef = bookingId;

    const intent = await PaymentIntent.create({
      bookingId,
      method: 'vnpay',
      amount,
      currency: 'VND',
      status: 'pending',
      expiresAt,
      providerTxnId: txnRef,
    });

    const params = {
      vnp_Version: '2.1.0',
      vnp_Command: 'pay',
      vnp_TmnCode: VNP_TMN_CODE,
      vnp_Locale: 'vn',
      vnp_CurrCode: 'VND',
      vnp_TxnRef: txnRef,
      vnp_OrderInfo: orderInfo || `Thanh toan ve xe #${bookingId}`,
      vnp_OrderType: 'other',
      vnp_Amount: amount * 100,
      vnp_ReturnUrl: VNP_RETURN_URL,
      vnp_IpAddr: clientIp,
      vnp_CreateDate: vnpCreateDate,
      vnp_ExpireDate: vnpExpireDate,
    };

    if (bankCode) params.vnp_BankCode = bankCode;

    const sortedKeys = Object.keys(params).sort();
    const enc = (v) => encodeURIComponent(String(v)).replace(/%20/g, '+');

    const signData = sortedKeys
      .map((k) => `${enc(k)}=${enc(params[k])}`)
      .join('&');

    console.log(
      'VNP_HASH_SECRET in runtime =',
      VNP_HASH_SECRET ? '***' : 'undefined'
    );

    if (!VNP_HASH_SECRET) {
      return res.status(500).json({
        ok: false,
        message: 'VNPay secret chưa cấu hình (VNP_HASH_SECRET).',
      });
    }

    const hmac = crypto.createHmac('sha512', VNP_HASH_SECRET);
    const signed = hmac
      .update(Buffer.from(signData, 'utf-8'))
      .digest('hex');

    const paymentUrl = `${VNP_URL}?${signData}&vnp_SecureHash=${signed}`;

    intent.paymentUrl = paymentUrl;
    await intent.save();

    return res.json({
      ok: true,
      paymentUrl,
      orderId: bookingId,
      intentId: intent._id,
      amount,
      createDate: now.toDate().toISOString(),
      expireDate: expiresAt.toISOString(),
    });
  } catch (err) {
    console.error('create_vnpay_url error:', err);
    return res.status(500).json({
      ok: false,
      message: 'Lỗi tạo link VNPay',
    });
  }
});

/* ================== 2. RETURN URL ================== */
router.get('/vnpay_return', async (req, res) => {
  try {
    if (!ensureVnpConfig(req, res)) return;

    let vnp_Params = req.query || {};
    const vnp_SecureHash = vnp_Params.vnp_SecureHash;

    const paramsForSign = {};
    Object.keys(vnp_Params).forEach((k) => {
      if (k !== 'vnp_SecureHash' && k !== 'vnp_SecureHashType')
        paramsForSign[k] = vnp_Params[k];
    });

    const sortedKeys = Object.keys(paramsForSign).sort();
    const enc = (v) => encodeURIComponent(String(v)).replace(/%20/g, '+');
    const signData = sortedKeys
      .map((k) => k + '=' + enc(paramsForSign[k]))
      .join('&');

    const checkHash = crypto
      .createHmac('sha512', VNP_HASH_SECRET)
      .update(Buffer.from(signData, 'utf8'))
      .digest('hex');

    const bookingId = vnp_Params.vnp_TxnRef;
    const amount = vnp_Params.vnp_Amount
      ? Number(vnp_Params.vnp_Amount) / 100
      : 0;
    const bankCode = vnp_Params.vnp_BankCode || '';
    const payDate = vnp_Params.vnp_PayDate || '';

    if (checkHash !== vnp_SecureHash) {
      return res.redirect(
        `${FRONTEND_FAIL}?orderId=${
          bookingId || 'unknown'
        }&code=invalid-signature`
      );
    }

    const rspCode = vnp_Params.vnp_ResponseCode;

    if (rspCode === '00') {
      let booking = await Booking.findByIdAndUpdate(
        bookingId,
        {
          $set: {
            'payment.status': 'paid',
            'payment.method': 'vnpay',
            'payment.amount': amount,
          },
          status: 'confirmed',
        },
        { new: true }
      ).populate({ path: 'tripId', select: 'routeCode dateStr departHM' });

      if (!booking) {
        return res.redirect(
          `${FRONTEND_FAIL}?orderId=${bookingId}&code=booking-not-found`
        );
      }

      await confirmSeatFromBooking(booking);

      try {
        const enriched = { ...booking.toObject(), trip: booking.tripId };
        await sendTicketPaidEmail(enriched);
      } catch (e) {
        console.error('Send paid email error (return):', e);
      }

      return res.redirect(
        `${FRONTEND_SUCCESS}?orderId=${bookingId}&amount=${amount}&bank=${bankCode}&payDate=${payDate}`
      );
    } else {
      await Booking.findByIdAndUpdate(bookingId, {
        $set: { 'payment.status': 'failed' },
      });

      return res.redirect(
        `${FRONTEND_FAIL}?orderId=${bookingId}&code=${rspCode}`
      );
    }
  } catch (err) {
    console.error(err);
    return res.redirect(
      `${FRONTEND_FAIL}?orderId=unknown&code=server-error`
    );
  }
});

/* ================== 3. IPN (server-to-server) ================== */
router.get('/vnpay_ipn', async (req, res) => {
  try {
    if (!ensureVnpConfig(req, res)) return;

    let vnp_Params = req.query || {};
    const vnp_SecureHash = vnp_Params.vnp_SecureHash;

    const paramsForSign = {};
    Object.keys(vnp_Params).forEach((k) => {
      if (k !== 'vnp_SecureHash' && k !== 'vnp_SecureHashType')
        paramsForSign[k] = vnp_Params[k];
    });

    const sortedKeys = Object.keys(paramsForSign).sort();
    const enc = (v) => encodeURIComponent(String(v)).replace(/%20/g, '+');
    const signData = sortedKeys
      .map((k) => k + '=' + enc(paramsForSign[k]))
      .join('&');

    const checkHash = crypto
      .createHmac('sha512', VNP_HASH_SECRET)
      .update(Buffer.from(signData, 'utf8'))
      .digest('hex');

    if (checkHash !== vnp_SecureHash) {
      return res.json({ RspCode: '97', Message: 'Invalid signature' });
    }

    const bookingId = vnp_Params.vnp_TxnRef;
    const amount = vnp_Params.vnp_Amount
      ? Number(vnp_Params.vnp_Amount) / 100
      : 0;
    const rspCode = vnp_Params.vnp_ResponseCode;

    if (rspCode === '00') {
      const booking = await Booking.findByIdAndUpdate(
        bookingId,
        {
          $set: {
            'payment.status': 'paid',
            'payment.method': 'vnpay',
            'payment.amount': amount,
          },
          status: 'confirmed',
        },
        { new: true }
      ).populate({ path: 'tripId', select: 'routeCode dateStr departHM' });

      if (!booking) {
        return res.json({ RspCode: '01', Message: 'Booking not found' });
      }

      await confirmSeatFromBooking(booking);

      try {
        const enriched = { ...booking.toObject(), trip: booking.tripId };
        await sendTicketPaidEmail(enriched);
      } catch (e) {
        console.error('Send paid email error (ipn):', e);
      }

      return res.json({ RspCode: '00', Message: 'Confirm Success' });
    } else {
      await Booking.findByIdAndUpdate(bookingId, {
        $set: { 'payment.status': 'failed' },
      });
      return res.json({ RspCode: '00', Message: 'Confirm Fail' });
    }
  } catch (err) {
    console.error(err);
    return res.json({ RspCode: '99', Message: 'Server error' });
  }
});

module.exports = router;