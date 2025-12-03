const express = require('express');
const crypto = require('crypto');
require('dotenv').config();

const router = express.Router();
const moment = require('moment-timezone');

// env
const VNP_TMN = process.env.VNP_TMNCODE;
const VNP_SECRET = process.env.VNP_HASHSECRET;
const VNP_URL = process.env.VNP_URL;
const VNP_RETURNURL = process.env.VNP_RETURNURL;

// ===== FE base & pages =====
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://127.0.0.1:5500';
const FRONTEND_SUCCESS = `${FRONTEND_URL}/payment-success.html`;
const FRONTEND_FAIL = `${FRONTEND_URL}/payment-fail.html`;

// ✅ models
const { Booking } = require('../models/Booking');
const { Hold } = require('../models/Hold');
const { Trip } = require('../models/Trip');
const PaymentIntent = require('../models/PaymentIntent');


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
      orderId: orderIdInput,
      orderInfo,
      bankCode,
    } = req.body || {};

    // 🔥 LẤY THỜI GIAN THEO MÚI GIỜ VIỆT NAM
    const now = moment().tz('Asia/Ho_Chi_Minh');
    const createDate = now.toDate(); // Date để lưu DB
    const expireDate = now.clone().add(15, 'minutes').toDate(); // +15 phút

    // Chuỗi thời gian theo format VNPay yêu cầu: yyyyMMddHHmmss
    const vnpCreateDate = now.format('YYYYMMDDHHmmss');
    const vnpExpireDate = now.clone().add(15, 'minutes').format('YYYYMMDDHHmmss');

    // Mã đơn hàng
    const orderId =
      (orderIdInput ||
        (createDate.getTime() + '-' + Math.floor(Math.random() * 1000))
      ).toString();

    // Số tiền (VNĐ)
    const amount = amountInput ? Number(amountInput) : 10000;

    // ============== TẠO PAYMENT INTENT LƯU DB ==============
    const intent = await PaymentIntent.create({
      provider: 'vnpay',
      orderId,
      amount,
      currency: 'VND',
      status: 'pending',
      clientIp,
      meta: {
        bankCode: bankCode || null,
        orderInfo: orderInfo || '',
      },
      createDate, // Date chuẩn VN (nhưng thực tế lúc lưu Mongo vẫn là UTC)
      expireDate,
    });

    // ============== BUILD PARAMS GỬI VNPay ==============
    const config = req.app.get('vnpayConfig');
    const vnpUrl = config.vnp_Url;
    const returnUrl = config.vnp_ReturnUrl;

    const params = {
      vnp_Version: config.vnp_Version,
      vnp_Command: 'pay',
      vnp_TmnCode: config.vnp_TmnCode,
      vnp_Locale: 'vn',
      vnp_CurrCode: 'VND',
      vnp_TxnRef: orderId,
      vnp_OrderInfo: orderInfo || `Thanh toan ve xe #${orderId}`,
      vnp_OrderType: 'other',
      vnp_Amount: amount * 100, // nhân 100 theo chuẩn VNPay
      vnp_ReturnUrl: returnUrl,
      vnp_IpAddr: clientIp,
      vnp_CreateDate: vnpCreateDate,
      vnp_ExpireDate: vnpExpireDate,
    };

    if (bankCode) params.vnp_BankCode = bankCode;

    // Sắp xếp key
    const sortedKeys = Object.keys(params).sort();

    function enc(v) {
      return encodeURIComponent(String(v)).replace(/%20/g, '+');
    }

    // Chuỗi rawData
    const signData = sortedKeys
      .map((k) => `${enc(k)}=${enc(params[k])}`)
      .join('&');

    // Tạo secure hash
    const hmac = crypto.createHmac('sha512', config.vnp_HashSecret);
    const signed = hmac.update(Buffer.from(signData, 'utf-8')).digest('hex');

    // Build URL cuối cùng
    const paymentUrl =
      vnpUrl +
      '?' +
      signData +
      '&vnp_SecureHash=' +
      signed;

    // Lưu url + secure hash vào intent
    intent.paymentUrl = paymentUrl;
    intent.secureHash = signed;
    await intent.save();

    return res.json({
      ok: true,
      paymentUrl,
      orderId,
      intentId: intent._id,
      amount,
      createDate: createDate.toISOString(),
      expireDate: expireDate.toISOString(),
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
