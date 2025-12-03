const express = require('express');
const crypto = require('crypto');
require('dotenv').config();

const router = express.Router();
const moment = require('moment-timezone');

// env
const appConfig = req.app.get('vnpayConfig') || {};

const vnp_Url       = appConfig.vnp_Url       || process.env.VNP_URL;
const vnp_ReturnUrl = appConfig.vnp_ReturnUrl || process.env.VNP_RETURN_URL;
const vnp_TmnCode   = appConfig.vnp_TmnCode   || process.env.VNP_TMN_CODE;
const vnp_HashSecret= appConfig.vnp_HashSecret|| process.env.VNP_HASH_SECRET;

// Nếu thiếu bất kỳ cái nào → báo lỗi rõ ràng, khỏi cho crypto chạy
if (!vnp_Url || !vnp_ReturnUrl || !vnp_TmnCode || !vnp_HashSecret) {
  console.error('VNPay config missing:', {
    vnp_Url,
    vnp_ReturnUrl,
    vnp_TmnCode,
    vnp_HashSecret: vnp_HashSecret ? '***' : undefined,
  });
  return res.status(500).json({
    ok: false,
    message: 'VNPay config chưa cấu hình đầy đủ trên server (URL / TMN / HASH / RETURN_URL).',
  });
}

// ===== FE base & pages =====
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://127.0.0.1:5500';
const FRONTEND_SUCCESS = `${FRONTEND_URL}/payment-success.html`;
const FRONTEND_FAIL = `${FRONTEND_URL}/payment-fail.html`;

// ✅ models
const { Booking } = require('../models/Booking');
const { Hold } = require('../models/Hold');
const { Trip } = require('../models/Trip');
const { PaymentIntent } = require('../models/PaymentIntent');


// ✅ BƯỚC 4: import mailer để gửi email xác nhận vé
const { sendTicketPaidEmail } = require('../services/mailer');

function formatDateVN(date) {
  date = date || new Date();
  const pad = (n) => (n < 10 ? '0' + n : '' + n);
  return (
    date.getFullYear() +
    pad(date.getMonth() + 1) +
    pad(date.getDate()) +
    pad(date.getHours()) +
    pad(date.getMinutes()) +
    pad(date.getSeconds())
  );
}

/* ================== 1. TẠO LINK THANH TOÁN ================== */
router.post('/create_vnpay_url', async (req, res) => {
  try {
    const clientIp =
      req.headers['x-forwarded-for'] ||
      req.socket?.remoteAddress ||
      '127.0.0.1';

    const {
      amount: amountInput,
      orderId: bookingId,   // bookingId chính là orderId client gửi lên
      orderInfo,
      bankCode,
    } = req.body || {};

    if (!bookingId) {
      return res.status(400).json({
        ok: false,
        message: 'Thiếu bookingId (orderId).',
      });
    }

    // 🔥 Thời gian theo giờ VN
    const now = moment().tz('Asia/Ho_Chi_Minh');
    const expiresAt = now.clone().add(15, 'minutes').toDate(); // dùng cho PaymentIntent
    const vnpCreateDate = now.format('YYYYMMDDHHmmss');
    const vnpExpireDate = now.clone().add(15, 'minutes').format('YYYYMMDDHHmmss');

    // Số tiền
    const amount = amountInput ? Number(amountInput) : 10000;

    // Mã giao dịch gửi cho VNPay (TXN REF)
    const txnRef = (
      Date.now().toString() +
      Math.floor(Math.random() * 1000).toString().padStart(3, '0')
    );

    // ============== TẠO PAYMENT INTENT LƯU DB ==============
    const intent = await PaymentIntent.create({
      bookingId,          // ✅ REQUIRED
      method: 'vnpay',    // ✅ REQUIRED
      amount,
      currency: 'VND',
      status: 'pending',
      expiresAt,          // ✅ REQUIRED
      providerTxnId: txnRef,   // để mapping với vnp_TxnRef
      // nếu muốn lưu thêm meta sau này có thể sửa schema rồi thêm field khác
    });

    // ============== BUILD PARAMS GỬI VNPay ==============
    // nếu mày đang dùng env trực tiếp thì đoạn này dùng process.env.*
    const vnp_Url = process.env.VNP_URL;
    const vnp_ReturnUrl = process.env.VNP_RETURN_URL;
    const vnp_TmnCode = process.env.VNP_TMN_CODE;
    const vnp_HashSecret = process.env.VNP_HASH_SECRET;

    const params = {
      vnp_Version: '2.1.0',
      vnp_Command: 'pay',
      vnp_TmnCode,
      vnp_Locale: 'vn',
      vnp_CurrCode: 'VND',
      vnp_TxnRef: txnRef, // dùng txnRef đã lưu trong providerTxnId
      vnp_OrderInfo: orderInfo || `Thanh toan ve xe #${bookingId}`,
      vnp_OrderType: 'other',
      vnp_Amount: amount * 100, // VNPay yêu cầu nhân 100
      vnp_ReturnUrl,
      vnp_IpAddr: clientIp,
      vnp_CreateDate: vnpCreateDate,
      vnp_ExpireDate: vnpExpireDate,
    };

    if (bankCode) params.vnp_BankCode = bankCode;

    const sortedKeys = Object.keys(params).sort();

    const enc = (v) =>
      encodeURIComponent(String(v)).replace(/%20/g, '+');

    const signData = sortedKeys
      .map((k) => `${enc(k)}=${enc(params[k])}`)
      .join('&');

    const hmac = crypto.createHmac('sha512', vnp_HashSecret);
    const signed = hmac.update(Buffer.from(signData, 'utf-8')).digest('hex');

    const paymentUrl = `${vnp_Url}?${signData}&vnp_SecureHash=${signed}`;

    // Lưu thêm paymentUrl nếu thích
    intent.paymentUrl = paymentUrl;
    await intent.save();

    return res.json({
      ok: true,
      paymentUrl,
      orderId: bookingId,          // để FE kiểm tra lại booking
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

/* =============== HÀM PHỤ: chốt ghế & huỷ hold =============== */
async function confirmSeatFromBooking(booking) {
  try {
    if (!booking) return;

    // lấy trip + hold giống /bookings/confirm
    const trip = await Trip.findById(booking.tripId);
    const hold = await Hold.findById(booking.holdId);

    // chốt ghế vào trip
    if (trip) {
      const oldBooked = Array.isArray(trip.seatsBooked) ? trip.seatsBooked.map(String) : [];
      const newBooked = Array.isArray(booking.seatCodes) ? booking.seatCodes.map(String) : [];
      const set = {};
      oldBooked.concat(newBooked).forEach((s) => (set[s] = true));
      const merged = Object.keys(set);

      await Trip.updateOne({ _id: trip._id }, { $set: { seatsBooked: merged } });
    }

    // huỷ hold
    if (hold) {
      await Hold.updateOne({ _id: hold._id }, { $set: { status: 'cancelled' } });
    }
  } catch (e) {
    console.error('Lỗi chốt ghế sau khi thanh toán VNPay:', e);
  }
}

/* ================== 2. RETURN URL ================== */
router.get('/vnpay_return', async (req, res) => {
  try {
    let vnp_Params = req.query || {};
    const vnp_SecureHash = vnp_Params.vnp_SecureHash;

    // bỏ 2 param để ký lại
    const paramsForSign = {};
    Object.keys(vnp_Params).forEach((k) => {
      if (k !== 'vnp_SecureHash' && k !== 'vnp_SecureHashType') paramsForSign[k] = vnp_Params[k];
    });

    const sortedKeys = Object.keys(paramsForSign).sort();
    const enc = (v) => encodeURIComponent(String(v)).replace(/%20/g, '+');
    const signData = sortedKeys.map((k) => k + '=' + enc(paramsForSign[k])).join('&');

    const checkHash = crypto.createHmac('sha512', VNP_SECRET).update(Buffer.from(signData, 'utf8')).digest('hex');

    // thông tin để redirect
    const bookingId = vnp_Params.vnp_TxnRef; // chính là booking._id
    const amount = vnp_Params.vnp_Amount ? Number(vnp_Params.vnp_Amount) / 100 : 0;
    const bankCode = vnp_Params.vnp_BankCode || '';
    const payDate = vnp_Params.vnp_PayDate || '';

    if (checkHash !== vnp_SecureHash) {
      // sai chữ ký
      return res.redirect(`${FRONTEND_FAIL}?orderId=${bookingId || 'unknown'}&code=invalid-signature`);
    }

    const rspCode = vnp_Params.vnp_ResponseCode;

    if (rspCode === '00') {
      // ✅ 1) update booking => paid (kèm populate trip để gửi mail)
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
        return res.redirect(`${FRONTEND_FAIL}?orderId=${bookingId}&code=booking-not-found`);
      }

      // ✅ 2) chốt ghế + huỷ hold
      await confirmSeatFromBooking(booking);

      // ✅ 3) GỬI EMAIL XÁC NHẬN VÉ (BƯỚC 4)
      try {
        const enriched = { ...booking.toObject(), trip: booking.tripId };
        await sendTicketPaidEmail(enriched);
      } catch (e) {
        console.error('Send paid email error (return):', e);
      }

      // ✅ 4) redirect đẹp
      return res.redirect(`${FRONTEND_SUCCESS}?orderId=${bookingId}&amount=${amount}&bank=${bankCode}&payDate=${payDate}`);
    } else {
      // thanh toán fail → cho về trang fail + update payment
      await Booking.findByIdAndUpdate(bookingId, {
        $set: { 'payment.status': 'failed' },
      });

      return res.redirect(`${FRONTEND_FAIL}?orderId=${bookingId}&code=${rspCode}`);
    }
  } catch (err) {
    console.error(err);
    return res.redirect(`${FRONTEND_FAIL}?orderId=unknown&code=server-error`);
  }
});

/* ================== 3. IPN (server-to-server) ================== */
router.get('/vnpay_ipn', async (req, res) => {
  try {
    let vnp_Params = req.query || {};
    const vnp_SecureHash = vnp_Params.vnp_SecureHash;

    // verify
    const paramsForSign = {};
    Object.keys(vnp_Params).forEach((k) => {
      if (k !== 'vnp_SecureHash' && k !== 'vnp_SecureHashType') paramsForSign[k] = vnp_Params[k];
    });

    const sortedKeys = Object.keys(paramsForSign).sort();
    const enc = (v) => encodeURIComponent(String(v)).replace(/%20/g, '+');
    const signData = sortedKeys.map((k) => k + '=' + enc(paramsForSign[k])).join('&');

    const checkHash = crypto.createHmac('sha512', VNP_SECRET).update(Buffer.from(signData, 'utf8')).digest('hex');

    if (checkHash !== vnp_SecureHash) {
      return res.json({ RspCode: '97', Message: 'Invalid signature' });
    }

    const bookingId = vnp_Params.vnp_TxnRef;
    const amount = vnp_Params.vnp_Amount ? Number(vnp_Params.vnp_Amount) / 100 : 0;
    const rspCode = vnp_Params.vnp_ResponseCode;

    if (rspCode === '00') {
      // cập nhật giống return (kèm populate để gửi mail)
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

      // ✅ GỬI EMAIL XÁC NHẬN VÉ (BƯỚC 4)
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
