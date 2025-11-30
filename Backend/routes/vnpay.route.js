const express = require('express');
const crypto  = require('crypto');
const router  = express.Router();

// ---- Helper lấy model an toàn với mọi kiểu export
function pickModel(mod, key) { return mod?.[key] || mod?.default || mod; }
const PaymentIntent = pickModel(require('../models/PaymentIntent'), 'PaymentIntent');
const Booking       = pickModel(require('../models/Booking'),       'Booking');

// ---- ENV
const VNP_TMN_CODE    = process.env.VNP_TMN_CODE;
const VNP_HASH_SECRET = process.env.VNP_HASH_SECRET;
const VNP_URL         = process.env.VNP_URL || 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html';
const VNP_RETURN_URL  = process.env.VNP_RETURN_URL; // ví dụ: http://127.0.0.1:3000/api/payments/vnpay/return
const VNP_IPN_URL     = process.env.VNP_IPN_URL || ''; // dùng cho hệ thống cần IPN
const VNP_DEBUG       = true; // đặt false khi chạy thật

// ---- Utils
const toVnpAmount = (vnd) => Math.round(Number(vnd || 0)) * 100;

function fmtDateYYYYMMDDHHmmss(d) {
  const yyyy = d.getFullYear();
  const MM   = String(d.getMonth() + 1).padStart(2,'0');
  const dd   = String(d.getDate()).padStart(2,'0');
  const HH   = String(d.getHours()).padStart(2,'0');
  const mm   = String(d.getMinutes()).padStart(2,'0');
  const ss   = String(d.getSeconds()).padStart(2,'0');
  return `${yyyy}${MM}${dd}${HH}${mm}${ss}`;
}

function getClientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  let ip = (fwd ? fwd.split(',')[0].trim() : (req.socket?.remoteAddress || '127.0.0.1'));
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  if (ip === '::1') ip = '127.0.0.1';
  return ip;
}

// Build chuỗi ký: sort key, encodeURIComponent value & đổi %20 -> +
function buildSignedQuery(params) {
  const keys = Object.keys(params).sort();
  const pairs = keys.map(k => {
    const v = encodeURIComponent(params[k]).replace(/%20/g, '+');
    return `${k}=${v}`;
  });
  const signData = pairs.join('&');
  const secureHash = crypto
    .createHmac('sha512', VNP_HASH_SECRET)
    .update(Buffer.from(signData, 'utf8'))
    .digest('hex');
  const queryWithHash = `${signData}&vnp_SecureHash=${secureHash}`;
  return { queryWithHash, signData, secureHash };
}

/* =========================================
 * 1) CREATE — Tạo URL thanh toán VNPay
 * POST /api/payments/vnpay/create { bookingId }
 * => { payUrl, intentId }
 * ========================================= */
router.post('/create', async (req, res) => {
  try {
    const miss = [];
    if (!VNP_TMN_CODE)    miss.push('VNP_TMN_CODE');
    if (!VNP_HASH_SECRET) miss.push('VNP_HASH_SECRET');
    if (!VNP_URL)         miss.push('VNP_URL');
    if (!VNP_RETURN_URL)  miss.push('VNP_RETURN_URL');
    if (miss.length) return res.status(500).json({ message: 'VNPAY config missing', missing: miss });

    const { bookingId } = req.body || {};
    if (!bookingId) return res.status(400).json({ message: 'Missing bookingId' });

    const booking = await Booking.findById(bookingId);
    if (!booking) return res.status(404).json({ message: 'Booking not found' });

    // Tính số tiền VND
    let amountVnd = Number(booking?.payment?.amount || 0);
    if (!amountVnd) {
      const seats = Array.isArray(booking.seats) ? booking.seats.length : 0;
      const price = Number(booking.price || booking.tripPrice || 0);
      amountVnd = Math.round(price * seats);
    }
    if (!amountVnd || isNaN(amountVnd) || amountVnd <= 0) {
      return res.status(400).json({ message: 'Booking amount is invalid (<=0)' });
    }

    // Hạn thanh toán 30'
    const intentExpiresAt = new Date(Date.now() + 30 * 60 * 1000);

    // Lưu PaymentIntent
    const intent = await PaymentIntent.create({
      method: 'vnpay',
      amount: amountVnd,
      bookingId: booking._id,
      status: 'pending',
      expiresAt: intentExpiresAt,
      meta: {}
    });

    const now        = new Date();
    const createDate = fmtDateYYYYMMDDHHmmss(now);
    const expireDate = fmtDateYYYYMMDDHHmmss(intentExpiresAt);

    // KHÔNG truyền vnp_BankCode / vnp_CardType => VNPay sẽ hiện trang CHỌN PHƯƠNG THỨC
    const baseParams = {
      vnp_Version:    '2.1.0',
      vnp_Command:    'pay',
      vnp_TmnCode:    VNP_TMN_CODE,
      vnp_Locale:     'vn',
      vnp_CurrCode:   'VND',
      vnp_TxnRef:     String(intent._id),
      vnp_OrderInfo:  `Thanh toan don ${booking._id}`,
      vnp_OrderType:  'other',
      vnp_Amount:     String(toVnpAmount(amountVnd)),
      vnp_ReturnUrl:  VNP_RETURN_URL,
      vnp_IpAddr:     getClientIp(req),
      vnp_CreateDate: createDate,
      vnp_ExpireDate: expireDate,
      // vnp_BankCode:  (không set)
      // vnp_CardType:  (không set)
    };

    // Lọc rỗng + ép string
    const vnp_Params = {};
    for (const [k, v] of Object.entries(baseParams)) {
      if (v !== null && v !== undefined && v !== '') vnp_Params[k] = String(v);
    }

    const { queryWithHash, signData, secureHash } = buildSignedQuery(vnp_Params);
    if (VNP_DEBUG) {
      console.log('[VNPAY][DEBUG] TMN:', VNP_TMN_CODE);
      console.log('[VNPAY][DEBUG] signData:', signData);
      console.log('[VNPAY][DEBUG] secureHash:', secureHash.slice(0, 16) + '...');
    }

    const payUrl = `${VNP_URL}?${queryWithHash}`;

    // Lưu meta (đối soát)
    intent.meta = { ...intent.meta, createDate, expireDate };
    await intent.save();

    return res.json({ payUrl, intentId: intent._id });
  } catch (err) {
    console.error('VNPAY create error:', err);
    return res.status(500).json({ message: 'Create VNPAY url failed', error: String(err?.message || err) });
  }
});

/* =========================================
 * 2) RETURN — user quay lại sau khi thanh toán
 * GET /api/payments/vnpay/return?...vnp_Params
 * ========================================= */
router.get('/return', async (req, res) => {
  try {
    const raw = { ...req.query };
    const vnpSecureHash = raw.vnp_SecureHash;
    delete raw.vnp_SecureHashType;
    delete raw.vnp_SecureHash;

    const { secureHash, signData } = buildSignedQuery(raw);
    const ok      = secureHash === vnpSecureHash;
    const intentId = raw.vnp_TxnRef;
    const rspCode  = raw.vnp_ResponseCode;

    if (VNP_DEBUG) {
      console.log('[VNPAY][RETURN] ok=', ok, 'rspCode=', rspCode, 'txnRef=', intentId);
      if (!ok) console.log('[VNPAY][RETURN] signData:', signData);
    }

    if (ok && rspCode === '00') {
      const intent = await PaymentIntent.findByIdAndUpdate(
        intentId,
        { $set: { status: 'paid', meta: { ...raw } } },
        { new: true }
      );
      if (intent?.bookingId) {
        await Booking.findByIdAndUpdate(intent.bookingId, {
          $set: { 'payment.status': 'paid', 'payment.paidAt': new Date(), status: 'confirmed' }
        });
      }
      return res.send('<h3>Thanh toán thành công. Bạn có thể đóng trang này.</h3>');
    } else {
      await PaymentIntent.findByIdAndUpdate(intentId, { $set: { status: 'cancelled', meta: { ...raw } } });
      return res.send('<h3>Thanh toán không thành công hoặc đã hủy.</h3>');
    }
  } catch (err) {
    console.error('VNPAY return error:', err);
    return res.status(500).send('<h3>Lỗi xử lý VNPAY return</h3>');
  }
});

/* =========================================
 * 3) IPN — server-to-server xác nhận giao dịch
 * GET /api/payments/vnpay/ipn?...vnp_Params
 * ========================================= */
router.get('/ipn', async (req, res) => {
  try {
    const raw = { ...req.query };
    const vnpSecureHash = raw.vnp_SecureHash;
    delete raw.vnp_SecureHashType;
    delete raw.vnp_SecureHash;

    const { secureHash } = buildSignedQuery(raw);
    if (secureHash !== vnpSecureHash) {
      return res.json({ RspCode: '97', Message: 'Checksum failed' });
    }

    const intentId = raw.vnp_TxnRef;
    const rspCode  = raw.vnp_ResponseCode;

    const intent = await PaymentIntent.findById(intentId);
    if (!intent) return res.json({ RspCode: '01', Message: 'Order not found' });
    if (intent.status === 'paid') return res.json({ RspCode: '02', Message: 'Order already confirmed' });

    if (rspCode === '00') {
      intent.status = 'paid';
      intent.meta = { ...intent.meta, ...raw };
      await intent.save();
      if (intent.bookingId) {
        await Booking.findByIdAndUpdate(intent.bookingId, {
          $set: { 'payment.status': 'paid', 'payment.paidAt': new Date(), status: 'confirmed' }
        });
      }
      return res.json({ RspCode: '00', Message: 'Confirm Success' });
    } else {
      intent.status = 'cancelled';
      intent.meta = { ...intent.meta, ...raw };
      await intent.save();
      if (intent.bookingId) {
        await Booking.findByIdAndUpdate(intent.bookingId, {
          $set: { 'payment.status': 'cancelled', status: 'cancelled' }
        });
      }
      return res.json({ RspCode: '00', Message: 'Confirm Failed' });
    }
  } catch (err) {
    console.error('VNPAY IPN error:', err);
    return res.json({ RspCode: '99', Message: 'Unknown error' });
  }
});

module.exports = router;