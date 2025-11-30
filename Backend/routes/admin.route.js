// routes/admin.route.js
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

const { User, ROLES } = require('../models/User');
const { sendTicketPaidEmail } = require('../services/mailer');


// Import model an toàn cho mọi kiểu export
function pickModel(mod, key) { return mod?.[key] || mod?.default || mod; }
const Trip          = pickModel(require('../models/Trip'), 'Trip');
const Booking       = pickModel(require('../models/Booking'), 'Booking');
const PaymentIntent = pickModel(require('../models/PaymentIntent'), 'PaymentIntent');
const Review = require('../models/Review');

const { verifyAccess } = require('../middleware/auth');
const { requireRole } = require('../middleware/requireRole');

const router = express.Router();

// Debug log
router.use((req, _res, next) => { console.log('➡️ [ADMIN]', req.method, req.originalUrl); next(); });

/* Helpers (Admin) */
async function countAdmins() { return User.countDocuments({ role: 'admin' }); }
async function ensureNotLastAdmin(targetUser, actionDesc = 'modify') {
  if (targetUser.role !== 'admin') return;
  const admins = await countAdmins();
  if (admins <= 1) { const err = new Error(`Cannot ${actionDesc} the last admin`); err.status = 409; throw err; }
}

/* Guard toàn bộ admin routes */
router.use(verifyAccess, requireRole('admin'));

/* =========================
   1) USER MANAGEMENT
   ========================= */

// GET /api/admin/users
router.get('/users', async (_req, res) => {
  const users = await User.find().select('_id username email role isSystem createdAt');
  res.json(users);
});

// POST /api/admin/users  (tạo admin mới)
router.post('/users', async (req, res) => {
  try {
    const username = String(req.body?.username || '').toLowerCase().trim();
    const password = String(req.body?.password || '');
    const email = req.body?.email ? String(req.body.email).toLowerCase().trim() : undefined;

    if (!username || !password) return res.status(400).json({ message: 'username và password là bắt buộc' });

    const exists = await User.findOne({ $or: [{ username }, ...(email ? [{ email }] : [])] }).lean();
    if (exists) return res.status(409).json({ message: 'Username hoặc email đã tồn tại' });

    const passwordHash = await bcrypt.hash(password, Number(process.env.BCRYPT_SALT_ROUNDS) || 12);
    const doc = await User.create({ username, email, passwordHash, role: 'admin', isSystem: false });

    res.status(201).json({ id: doc._id, username: doc.username, email: doc.email || null, role: doc.role });
  } catch (e) {
    console.error('Create admin error:', e);
    res.status(500).json({ message: 'Create admin failed', error: e.message });
  }
});

// PATCH /api/admin/users/:id/role
router.patch('/users/:id/role', async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ message: 'Invalid user id' });

    const role = String(req.body?.role || '').toLowerCase().trim();
    if (!ROLES.includes(role)) return res.status(400).json({ message: 'Invalid role' });

    if (String(req.user.id) === String(id)) return res.status(400).json({ message: 'Admin cannot change own role' });

    const target = await User.findById(id);
    if (!target) return res.status(404).json({ message: 'User not found' });

    if (target.role === 'admin' && role !== 'admin') await ensureNotLastAdmin(target, 'demote');

    target.role = role;
    await target.save();
    res.json({ id: target._id, username: target.username, role: target.role });
  } catch (e) {
    res.status(e.status || 500).json({ message: e.message || 'Bad request' });
  }
});

// DELETE /api/admin/users/:id
router.delete('/users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ message: 'Invalid user id' });
    if (String(req.user.id) === String(id)) return res.status(400).json({ message: 'Admin cannot delete own account' });

    const target = await User.findById(id);
    if (!target) return res.status(404).json({ message: 'User not found' });

    if (target.role === 'admin') await ensureNotLastAdmin(target, 'delete');
    if (target.isSystem) return res.status(400).json({ message: 'Cannot delete system account' });

    await User.deleteOne({ _id: id });
    res.json({ deleted: id });
  } catch (e) {
    res.status(e.status || 500).json({ message: e.message || 'Bad request' });
  }
});


/* =========================
  // 2) TRIP MANAGEMENT
   ========================= */

function buildDepartAt(dateStr, departHM) {
  if (!dateStr || !departHM) return null;
  // UTC+07:00 (Asia/Ho_Chi_Minh)
  return new Date(`${dateStr}T${departHM}:00+07:00`);
}

// GET /api/admin/trips?routeCode=&dateStr=&active=&page=&limit=
router.get('/trips', async (req, res) => {
  try {
    const { routeCode, dateStr, active, page = 1, limit = 20 } = req.query;
    const q = {};
    if (routeCode) q.routeCode = routeCode;
    if (dateStr) q.dateStr = dateStr;
    if (typeof active !== 'undefined' && active !== '') q.active = String(active) === 'true';

    const skip = (Number(page) - 1) * Number(limit);
    const [items, total] = await Promise.all([
      Trip.find(q).sort({ dateStr: 1, departHM: 1 }).skip(skip).limit(Number(limit)),
      Trip.countDocuments(q),
    ]);

    const mapped = items.map(t => {
      const o = t.toObject();
      o.seatsBookedCount = Array.isArray(o.seatsBooked) ? o.seatsBooked.length : 0;
      return o;
    });

    res.json({ total, page: Number(page), limit: Number(limit), items: mapped });
  } catch (e) {
    console.error('GET /trips error:', e);
    res.status(500).json({ message: 'Trips failed', error: e.message });
  }
});

// POST /api/admin/trips
router.post('/trips', async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.routeCode || !b.dateStr || !b.departHM || b.price == null || b.seatsTotal == null) {
      return res.status(400).json({ message: 'Thiếu: routeCode, dateStr, departHM, price, seatsTotal' });
    }

    // Validate HH:mm format
    if (!/^\d{2}:\d{2}$/.test(b.departHM)) {
      return res.status(400).json({ message: 'departHM phải định dạng HH:mm (VD: "09:30")' });
    }

    // Build departAt (Asia/Ho_Chi_Minh)
    const departAt = b.departAt 
      ? new Date(b.departAt)
      : new Date(`${b.dateStr}T${b.departHM}:00+07:00`);

    if (!departAt || isNaN(departAt.getTime())) {
      return res.status(400).json({ message: 'Không tạo được thời gian departAt từ dateStr + departHM' });
    }

    const doc = await Trip.create({
      routeCode: b.routeCode,
      dateStr: b.dateStr,               
      departHM: b.departHM,               
      departAt,                         
      price: Number(b.price),
      seatsTotal: Number(b.seatsTotal),
      seatsBooked: Array.isArray(b.seatsBooked) ? b.seatsBooked : [],
      active: typeof b.active === 'boolean' ? b.active : true,
    });

    res.status(201).json(doc);

  } catch (e) {
    // Duplicate key -> 409
    if (e && e.code === 11000) {
      return res.status(409).json({ message: 'Chuyến này đã tồn tại (trùng routeCode + dateStr + departHM)' });
    }
    console.error('Create trip error:', e);
    res.status(500).json({ message: 'Create trip failed', error: e.message });
  }
});

// PATCH /api/admin/trips/:id
router.patch('/trips/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ message: 'Invalid trip id' });

    const body = req.body || {};
    const set = {};
    const allow = ['routeCode', 'dateStr', 'departHM', 'departAt', 'price', 'seatsTotal', 'seatsBooked', 'active'];
    for (const k of allow) if (k in body) set[k] = body[k];

    if ('departAt' in set && set.departAt) set.departAt = new Date(set.departAt);
    if (!set.departAt && (set.dateStr || set.departHM)) {
      const current = await Trip.findById(id).lean();
      const dateStr = set.dateStr || current?.dateStr;
      const departHM = set.departHM || current?.departHM;
      const built = buildDepartAt(dateStr, departHM);
      if (built) set.departAt = built;
    }
    if ('price' in set) set.price = Number(set.price);
    if ('seatsTotal' in set) set.seatsTotal = Number(set.seatsTotal);
    if ('seatsBooked' in set && !Array.isArray(set.seatsBooked)) {
      return res.status(400).json({ message: 'seatsBooked phải là mảng string' });
    }

    const updated = await Trip.findByIdAndUpdate(id, { $set: set }, { new: true });
    if (!updated) return res.status(404).json({ message: 'Trip not found' });
    res.json(updated);
  } catch (e) {
    console.error('PATCH /trips/:id error:', e);
    res.status(500).json({ message: 'Update trip failed', error: e.message });
  }
});

// DELETE /api/admin/trips/:id
router.delete('/trips/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ message: 'Invalid trip id' });
    const del = await Trip.findByIdAndDelete(id);
    if (!del) return res.status(404).json({ message: 'Trip not found' });
    res.json({ deleted: id });
  } catch (e) {
    console.error('DELETE /trips/:id error:', e);
    res.status(500).json({ message: 'Delete trip failed', error: e.message });
  }
});


/* =========================
   3) BOOKING MANAGEMENT
   Booking.status: pending|confirmed|cancelled|completed
   ========================= */

// GET /api/admin/bookings?tripId=&q=&status=&from=&to=&page=&limit=
router.get('/bookings', async (req, res) => {
  try {
    const { tripId, q, status, from, to, page = 1, limit = 20 } = req.query;
    const filter = {};
    if (tripId && mongoose.isValidObjectId(tripId)) filter.tripId = new mongoose.Types.ObjectId(tripId);
    if (status) filter.status = status;

    if (from || to) {
      filter.createdAt = {};
      if (from) filter.createdAt.$gte = new Date(from);
      if (to) filter.createdAt.$lte = new Date(to);
    }
    if (q) {
      filter.$or = [
        { 'customer.name': new RegExp(q, 'i') },
        { 'customer.phone': new RegExp(q, 'i') },
        { 'customer.email': new RegExp(q, 'i') },
      ];
    }

    const skip = (Number(page) - 1) * Number(limit);
    const [items, total] = await Promise.all([
      Booking.find(filter).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
      Booking.countDocuments(filter),
    ]);
    res.json({ total, page: Number(page), limit: Number(limit), items });
  } catch (e) {
    console.error('GET /bookings error:', e);
    res.status(500).json({ message: 'Bookings failed', error: e.message });
  }
});

// PATCH /api/admin/bookings/:id/status
router.patch('/bookings/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body || {};
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ message: 'Invalid booking id' });

    const ALLOWED = ['pending','confirmed','cancelled','completed'];
    if (!ALLOWED.includes(status)) return res.status(400).json({ message: 'Invalid status' });

    const updated = await Booking.findByIdAndUpdate(id, { $set: { status } }, { new: true });
    if (!updated) return res.status(404).json({ message: 'Booking not found' });
    res.json(updated);
  } catch (e) {
    console.error('PATCH /bookings/:id/status error:', e);
    res.status(500).json({ message: 'Update booking failed', error: e.message });
  }
});

// POST /api/admin/bookings/:id/refund
router.post('/bookings/:id/refund', async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ message: 'Invalid booking id' });

    const bk = await Booking.findById(id);
    if (!bk) return res.status(404).json({ message: 'Booking not found' });
    if ((bk.payment?.status) !== 'paid') return res.status(400).json({ message: 'Booking is not paid' });

    // Đánh dấu hoàn tiền trên Booking
    bk.payment.status = 'refunded';
    bk.payment.refundedAt = new Date();
    bk.status = 'cancelled';
    await bk.save();

    // Đồng bộ PaymentIntent: paid -> cancelled (enum của PaymentIntent không có 'refunded')
    await PaymentIntent.updateMany({ bookingId: bk._id, status: 'paid' }, { $set: { status: 'cancelled' } });

    res.json({ refunded: true, bookingId: bk._id });
  } catch (e) {
    console.error('POST /bookings/:id/refund error:', e);
    res.status(500).json({ message: 'Refund failed', error: e.message });
  }
});


/* =========================
   4) PAYMENT MANAGEMENT (PaymentIntent)
   status: pending|paid|expired|cancelled
   ========================= */

// GET /api/admin/payments?status=&method=&bookingId=&from=&to=&page=&limit=
router.get('/payments', async (req, res) => {
  try {
    const { status, method, bookingId, from, to, page = 1, limit = 20 } = req.query;

    const q = {};

    if (status) q.status = status;
    if (method) q.method = method; // momo|zalopay|vnpay

    if (bookingId && mongoose.isValidObjectId(bookingId)) {
      q.bookingId = new mongoose.Types.ObjectId(bookingId);
    }

    // Lọc theo ngày tạo payment
    if (from || to) {
      q.createdAt = {};
      if (from) q.createdAt.$gte = new Date(from);
      if (to) q.createdAt.$lte = new Date(to);
    }

    const pageNum = Number(page) || 1;
    const limitNum = Number(limit) || 20;
    const skip = (pageNum - 1) * limitNum;

    const [items, total] = await Promise.all([
      PaymentIntent.find(q)
        .populate({
          path: 'bookingId',
          select: 'customer seatCodes tripId payment status createdAt',
          populate: {
            path: 'tripId',
            select: 'routeCode dateStr departHM'
          }
        })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),

      PaymentIntent.countDocuments(q),
    ]);

    // Chuẩn hoá dữ liệu trả về cho dễ nhìn
    const mapped = items.map(p => {
      const bk = p.bookingId;
      return {
        ...p,
        bookingInfo: bk
          ? {
              bookingId: bk._id,
              customerName: bk.customer?.name || null,
              customerPhone: bk.customer?.phone || null,
              seatCodes: bk.seatCodes,
              status: bk.status,
              trip: bk.tripId
                ? {
                    routeCode: bk.tripId.routeCode,
                    dateStr: bk.tripId.dateStr,
                    departHM: bk.tripId.departHM
                  }
                : null
            }
          : null
      };
    });

    res.json({
      total,
      page: pageNum,
      limit: limitNum,
      items: mapped
    });

  } catch (e) {
    console.error('GET /payments error:', e);
    res.status(500).json({ message: 'Payments failed', error: e.message });
  }
});

// PATCH /api/admin/payments/:id/status
router.patch('/payments/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body || {};
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ message: 'Invalid id' });

    const ALLOWED = ['pending', 'paid', 'expired', 'cancelled'];
    if (!ALLOWED.includes(status)) return res.status(400).json({ message: 'Invalid status' });

    const updated = await PaymentIntent.findByIdAndUpdate(id, { $set: { status } }, { new: true });
    if (!updated) return res.status(404).json({ message: 'Payment not found' });
    res.json(updated);
  } catch (e) {
    console.error('PATCH /payments/:id/status error:', e);
    res.status(500).json({ message: 'Update payment failed', error: e.message });
  }
});


/* =========================
   5) REVENUE (Booking.payment.status='paid')
   ========================= */

// GET /api/admin/revenue?from=&to=&groupBy=day|month
router.get('/revenue', async (req, res) => {
  try {
    const { from, to, groupBy = 'day' } = req.query;
    const start = from ? new Date(from) : new Date('1970-01-01');
    const end = to ? new Date(to) : new Date();
    const format = groupBy === 'month' ? '%Y-%m' : '%Y-%m-%d';

    const byDate = await Booking.aggregate([
      { $match: { 'payment.status': 'paid', createdAt: { $gte: start, $lte: end } } },
      { $group: {
          _id: { $dateToString: { format, date: '$createdAt' } },
          total: { $sum: { $ifNull: ['$payment.amount', 0] } },
          orders: { $sum: 1 }
      }},
      { $sort: { _id: 1 } }
    ]);

    const sum = await Booking.aggregate([
      { $match: { 'payment.status': 'paid', createdAt: { $gte: start, $lte: end } } },
      { $group: { _id: null, total: { $sum: { $ifNull: ['$payment.amount', 0] } }, orders: { $sum: 1 } } }
    ]);

    res.json({ summary: sum[0] || { total: 0, orders: 0 }, byDate });
  } catch (e) {
    console.error('GET /revenue error:', e);
    res.status(500).json({ message: 'Revenue failed', error: e.message });
  }
});

// GET /api/admin/revenue/by-route?from=&to=
router.get('/revenue/by-route', async (req, res) => {
  try {
    const { from, to } = req.query;
    const start = from ? new Date(from) : new Date('1970-01-01');
    const end = to ? new Date(to) : new Date();

    const data = await Booking.aggregate([
      { $match: { 'payment.status': 'paid', createdAt: { $gte: start, $lte: end } } },
      { $lookup: { from: 'trips', localField: 'tripId', foreignField: '_id', as: 'trip' } },
      { $unwind: '$trip' },
      { $group: {
          _id: '$trip.routeCode',
          revenue: { $sum: { $ifNull: ['$payment.amount', 0] } },
          tickets: { $sum: 1 }
      }},
      { $project: { _id: 0, routeCode: '$_id', revenue: 1, tickets: 1 } },
      { $sort: { revenue: -1 } }
    ]);

    res.json(data);
  } catch (e) {
    console.error('GET /revenue/by-route error:', e);
    res.status(500).json({ message: 'Revenue by route failed', error: e.message });
  }
});

/* Catch-all error cho admin */
router.use((err, req, res, _next) => {
  console.error('🔥 ADMIN ERROR:', req.method, req.originalUrl, err);
  res.status(500).json({ message: err.message, stack: err.stack });
});

router.post('/bookings/:id/resend-email', /* requireAdmin, */ async (req, res) => {
  try {
    const bk = await Booking.findById(req.params.id)
      .populate({ path: 'tripId', select: 'routeCode dateStr departHM' });

    if (!bk) return res.status(404).json({ message: 'Booking not found' });
    if (bk.payment?.status !== 'paid')
      return res.status(400).json({ message: 'Chỉ gửi email cho đơn đã thanh toán' });
    if (!bk.customer?.email)
      return res.status(400).json({ message: 'Booking không có email khách hàng' });

    const enriched = { ...bk.toObject(), trip: bk.tripId };
    await sendTicketPaidEmail(enriched);

    res.json({ ok: true, message: 'Đã gửi lại email xác nhận vé' });
  } catch (e) {
    console.error('resend-email error:', e);
    res.status(500).json({ message: 'Gửi lại email thất bại' });
  }
});

router.get('/trips/:tripId/passengers', async (req, res) => {
  try {
    const { tripId } = req.params;

    const trip = await Trip.findById(tripId).lean();
    if (!trip) return res.status(404).json({ message: 'Trip không tồn tại' });

    // lấy các booking đã giữ ghế/thanh toán
    const bookings = await Booking.find({
      tripId,
      status: { $in: ['held', 'paid', 'confirmed', 'completed'] },
    }).sort({ createdAt: 1 }).lean();

    const mapped = bookings.map(b => ({
      id: b._id,
      customerName: b.customer?.name || '',
      phone: b.customer?.phone || '',
      email: b.customer?.email || '',
      seats: b.seatCodes || [],
      status: b.status,
      paymentStatus: b.payment?.status || '',
      paymentMethod: b.payment?.method || '',
      checkedIn: !!b.checkedIn,
      boardedAt: b.boardedAt,
    }));

    res.json({
      trip: {
        id: trip._id,
        routeCode: trip.routeCode,
        dateStr: trip.dateStr,
        departHM: trip.departHM,
      },
      passengers: mapped,
    });
  } catch (e) {
    console.error('GET /api/admin/trips/:tripId/passengers error:', e);
    res.status(500).json({ message: 'Lỗi tải danh sách hành khách' });
  }
});
router.patch('/bookings/:id/checkin', async (req, res) => {
  try {
    const { id } = req.params;

    const booking = await Booking.findById(id);
    if (!booking) return res.status(404).json({ message: 'Không tìm thấy booking' });

    // chỉ cho check-in nếu vé đã thanh toán/confirmed
    if (!['paid', 'confirmed', 'completed'].includes(booking.status)) {
      return res.status(400).json({ message: 'Vé chưa thanh toán/confirm, không thể check-in' });
    }

    booking.checkedIn = true;
    booking.boardedAt = new Date();
    await booking.save();

    res.json({
      message: 'Đã check-in hành khách',
      booking,
    });
  } catch (e) {
    console.error('PATCH /api/admin/bookings/:id/checkin error:', e);
    res.status(500).json({ message: 'Lỗi check-in' });
  }
});
router.get('/reviews', async (req, res) => {
  try {
    const { phone, tripId, page = 1, limit = 20 } = req.query;

    const filter = {};
    if (phone) {
      filter.phone = new RegExp(phone, 'i');        // tìm gần đúng theo số điện thoại
    }
    if (tripId && mongoose.isValidObjectId(tripId)) {
      filter.tripId = new mongoose.Types.ObjectId(tripId);
    }

    const pageNum = Number(page) || 1;
    const limitNum = Number(limit) || 20;
    const skip = (pageNum - 1) * limitNum;

    const [items, total] = await Promise.all([
      Review.find(filter)
        .sort({ createdAt: -1 })
        .populate('tripId', 'routeCode dateStr departHM') // chỉ lấy vài field cho gọn
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Review.countDocuments(filter),
    ]);

    res.json({
      total,
      page: pageNum,
      limit: limitNum,
      items,
    });
  } catch (e) {
    console.error('GET /api/admin/reviews error:', e);
    res.status(500).json({ message: 'Server error', error: e.message });
  }
});
router.delete('/reviews/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ message: 'Invalid review id' });
    }

    const existed = await Review.findById(id);
    if (!existed) {
      return res.status(404).json({ message: 'Review not found' });
    }

    await Review.deleteOne({ _id: id });
    res.json({ deleted: id });
  } catch (e) {
    console.error('DELETE /api/admin/reviews/:id error:', e);
    res.status(500).json({ message: 'Xoá review thất bại', error: e.message });
  }
});
module.exports = router;
