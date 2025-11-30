// Backend/routes/shuttle.js
const express = require('express');
const router = express.Router();

const { Shuttle } = require('../models/Shuttle');
const { Booking } = require('../models/Booking');

// (tuỳ anh/chị đang có middleware auth nào thì import vào)
// ví dụ:
// const { requireAuth, requireRole } = require('../middlewares/auth');

// ----- 1. Admin tạo / cập nhật shuttle -----

// Tạo xe trung chuyển mới (admin)
router.post('/', async (req, res) => {
  try {
    const { plateNumber, driverName, driverPhone, capacity, workingDateStr, mainRouteCode } = req.body;

    if (!plateNumber || !driverName || !driverPhone) {
      return res.status(400).json({ message: 'Thiếu thông tin xe/ tài xế' });
    }

    const shuttle = await Shuttle.create({
      plateNumber,
      driverName,
      driverPhone,
      capacity,
      workingDateStr,
      mainRouteCode
    });

    return res.json(shuttle);
  } catch (e) {
    console.error('Create shuttle error:', e);
    return res.status(500).json({ message: 'Server error tạo shuttle' });
  }
});

// Lấy danh sách shuttle theo ngày
router.get('/', async (req, res) => {
  try {
    const { date } = req.query; // YYYY-MM-DD
    const query = {};
    if (date) query.workingDateStr = date;

    const items = await Shuttle.find(query).sort({ createdAt: -1 }).lean();
    return res.json(items);
  } catch (e) {
    console.error('List shuttle error:', e);
    return res.status(500).json({ message: 'Server error tải shuttle' });
  }
});

// Update vị trí hiện tại (GPS) của shuttle
router.patch('/:id/location', async (req, res) => {
  try {
    const { id } = req.params;
    const { lat, lng, note } = req.body;

    const shuttle = await Shuttle.findByIdAndUpdate(
      id,
      {
        $set: {
          currentLat: lat,
          currentLng: lng,
          currentLocationNote: note
        }
      },
      { new: true }
    );

    if (!shuttle) return res.status(404).json({ message: 'Không tìm thấy shuttle' });

    return res.json(shuttle);
  } catch (e) {
    console.error('Update shuttle location error:', e);
    return res.status(500).json({ message: 'Server error cập nhật vị trí' });
  }
});

// ----- 2. Danh sách booking gắn với shuttle (cho nhân viên / tài xế) -----

router.get('/:id/bookings', async (req, res) => {
  try {
    const { id } = req.params;

    // Tìm các booking đã gán shuttle này
    const bookings = await Booking.find({ assignedShuttle: id })
      .sort({ createdAt: 1 })
      .lean();

    return res.json({ items: bookings });
  } catch (e) {
    console.error('List shuttle bookings error:', e);
    return res.status(500).json({ message: 'Server error tải danh sách khách của shuttle' });
  }
});

// ----- 3. Cập nhật trạng thái trung chuyển của 1 booking -----

router.patch('/bookings/:bookingId/transfer-status', async (req, res) => {
  try {
    const { bookingId } = req.params;
    const { transferStatus } = req.body;

    if (!transferStatus) {
      return res.status(400).json({ message: 'Thiếu transferStatus' });
    }

    const booking = await Booking.findByIdAndUpdate(
      bookingId,
      { $set: { transferStatus } },
      { new: true }
    );

    if (!booking) return res.status(404).json({ message: 'Không tìm thấy booking' });

    return res.json(booking);
  } catch (e) {
    console.error('Update transfer status error:', e);
    return res.status(500).json({ message: 'Server error cập nhật trạng thái trung chuyển' });
  }
});

module.exports = router;
