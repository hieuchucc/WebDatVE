const express = require('express');
const router = express.Router();
const { Trip } = require('../models/Trip');
const { Booking } = require('../models/Booking');

function ok(res, data = {}) {
  return res.json(data);
}

router.get('/trips', async (req, res) => {
  try {
    const { date } = req.query;
    const filter = {};

    if (date) {
      filter.dateStr = date;
    }

    const trips = await Trip.find(filter).sort({ departAt: 1 }).lean();

    return ok(res, {
      items: trips,
      total: trips.length,
    });
  } catch (err) {
    console.error('Employee /trips error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
});


router.get('/trips/:tripId/bookings', async (req, res) => {
  try {
    const { tripId } = req.params;

    const bookings = await Booking.find({ tripId })
      .sort({ createdAt: 1 })
      .lean();

    return ok(res, {
      items: bookings,
      total: bookings.length,
    });
  } catch (err) {
    console.error('Employee /trips/:tripId/bookings error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
});


router.patch('/bookings/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const allowed = ['pending', 'confirmed', 'completed', 'cancelled'];
    if (!allowed.includes(status)) {
      return res.status(400).json({ message: 'Trạng thái không hợp lệ' });
    }

    const booking = await Booking.findByIdAndUpdate(
      id,
      { $set: { status } },
      { new: true }
    ).lean();

    if (!booking) {
      return res.status(404).json({ message: 'Không tìm thấy booking' });
    }

    return ok(res, { item: booking });
  } catch (err) {
    console.error('Employee PATCH /bookings/:id/status error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;