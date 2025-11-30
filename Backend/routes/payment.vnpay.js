const express = require('express');
const crypto = require('crypto');
require('dotenv').config();

const router = express.Router();

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
router.post('/create_vnpay_url', async function (req, res) {
  try {
    // Lấy IP client (ES5 style)
    var xfwd = (req.headers['x-forwarded-for'] || '').toString();
    var ipAddr = '127.0.0.1';

    if (xfwd) {
      ipAddr = xfwd.split(',')[0].trim();
    } else if (req.connection && req.connection.remoteAddress) {
      ipAddr = req.connection.remoteAddress;
    } else if (req.socket && req.socket.remoteAddress) {
      ipAddr = req.socket.remoteAddress;
    } else if (req.connection && req.connection.socket && req.connection.socket.remoteAddress) {
      ipAddr = req.connection.socket.remoteAddress;
    }

    if (ipAddr === '::1') ipAddr = '127.0.0.1';

    var body = req.body || {};
    var amount = body.amount; // VND
    var orderId = body.orderId; // booking._id mà /confirm trả về
    var orderInfo = body.orderInfo;
    var bankCode = body.bankCode;

    var vnpAmount = Math.round(Number(amount || 0)) * 100;
    if (!vnpAmount || !orderId) {
      return res.status(400).json({ message: 'Thiếu amount/orderId' });
    }

    // TxnRef phải sạch ký tự
    var vnpTxnRef = String(orderId).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);

    // Tập params để ký
    var params = {
      vnp_Version: '2.1.0',
      vnp_Command: 'pay',
      vnp_TmnCode: VNP_TMN,
      vnp_Amount: vnpAmount,
      vnp_CurrCode: 'VND',
      vnp_TxnRef: vnpTxnRef,
      vnp_OrderInfo: orderInfo || 'Thanh toan ' + vnpTxnRef,
      vnp_OrderType: 'billpayment',
      vnp_Locale: 'vn',
      vnp_ReturnUrl: VNP_RETURNURL,
      vnp_IpAddr: ipAddr,
      vnp_CreateDate: formatDateVN(new Date()),
      vnp_ExpireDate: formatDateVN(new Date(Date.now() + 15 * 60 * 1000)),
    };

    if (bankCode) params.vnp_BankCode = bankCode;

    // Sắp xếp key
    var sortedKeys = Object.keys(params).sort();

    function enc(v) {
      return encodeURIComponent(String(v)).replace(/%20/g, '+');
    }

    // chuỗi để ký
    var signDataArr = [];
    for (var i = 0; i < sortedKeys.length; i++) {
      var k = sortedKeys[i];
      signDataArr.push(k + '=' + enc(params[k]));
    }
    var signData = signDataArr.join('&');

    // tạo chữ ký
    var vnp_SecureHash = crypto.createHmac('sha512', VNP_SECRET).update(Buffer.from(signData, 'utf8')).digest('hex');

    // query gửi đi
    var queryToSend = signData + '&vnp_SecureHashType=HMACSHA512&vnp_SecureHash=' + vnp_SecureHash;

    var paymentUrl = VNP_URL + '?' + queryToSend;

    return res.json({ paymentUrl: paymentUrl });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Server error tạo VNPay URL' });
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
