// routes/bookings.js
const express = require('express');
const router = express.Router();
const { Hold } = require('../models/Hold');
const { Trip, ROUTES } = require('../models/Trip');
const { Booking } = require('../models/Booking');


const CANCEL_BEFORE_HOURS = 2;
// POST /api/bookings/confirm
router.post('/confirm', async function(req, res) {
    try {
        const body = req.body || {};
        const holdId = body.holdId;
        const customer = body.customer || {};
        const paymentMethod = body.paymentMethod || 'cod';

        if (!holdId) {
            return res.status(400).json({ ok: false, message: 'Thiếu holdId' });
        }

        // ================================
        // 🔥 CHỐNG TRÙNG BOOKING
        // ================================
        const existed = await Booking.findOne({ holdId: holdId });
        if (existed) {
            return res.json({
                ok: true,
                bookingId: existed._id,
                payment: existed.payment,
                reused: true
            });
        }

        // ================================
        // TÌM HOLD
        // ================================
        const hold = await Hold.findById(holdId);
        if (!hold) {
            return res.status(400).json({ ok: false, message: 'Giữ chỗ không hợp lệ' });
        }

        if (hold.status !== 'active' || (hold.expiresAt && hold.expiresAt <= new Date())) {
            return res.status(400).json({ ok: false, message: 'Giữ chỗ đã hết hạn' });
        }

        // ================================
        // TÌM TRIP
        // ================================
        const trip = await Trip.findById(hold.tripId);
        if (!trip) {
            return res.status(404).json({ ok: false, message: 'Không tìm thấy chuyến' });
        }

        const priceEach = trip.price || 0;
        const seatCount = Array.isArray(hold.seatCodes) ? hold.seatCodes.length : 0;
        const total = priceEach * seatCount;

        const seatCodes = Array.isArray(hold.seatCodes)
            ? hold.seatCodes.map(String)
            : [];

        const bookingData = {
            tripId: trip._id,
            holdId: hold._id,
            seatCodes: seatCodes,
            customer: {
                name: customer.name ? String(customer.name).trim() : undefined,
                phone: customer.phone ? String(customer.phone).trim() : undefined,
                email: customer.email ? String(customer.email).trim() : undefined,
                pickupPoint: customer.pickupPoint ? String(customer.pickupPoint).trim() : undefined,
                dropoffPoint: customer.dropoffPoint ? String(customer.dropoffPoint).trim() : undefined,
                note: customer.note ? String(customer.note).trim() : undefined
            },
            payment: {
                method: paymentMethod,
                status: 'pending',
                amount: total,
                currency: 'VND'
            },
            status: paymentMethod === 'cod' ? 'confirmed' : 'pending'
        };

        // ================================
        // TẠO BOOKING
        // ================================
        const booking = await Booking.create(bookingData);

        // ================================
        // LUÔN HỦY HOLD — tránh trùng vé
        // ================================
        await Hold.updateOne(
            { _id: hold._id },
            { $set: { status: 'cancelled' } }
        );

        // ================================
        // COD => CẬP NHẬT seatsBooked
        // ================================
        if (paymentMethod === 'cod') {
            const booked = Array.isArray(trip.seatsBooked)
                ? trip.seatsBooked.map(String)
                : [];

            const mergedSet = new Set([...booked, ...booking.seatCodes]);
            const merged = Array.from(mergedSet);

            await Trip.updateOne(
                { _id: trip._id },
                { $set: { seatsBooked: merged } }
            );
        }

        return res.json({
            ok: true,
            bookingId: booking._id,
            payment: booking.payment
        });

    } catch (e) {
        console.error(e);
        return res.status(500).json({ ok: false, message: 'Server error' });
    }
});

// 🆕 GET /api/bookings/lookup?phone=0347...
router.get('/lookup', async(req, res) => {
    try {
        const phone = (req.query.phone || '').trim();
        if (!phone) {
            return res.status(400).json({ ok: false, message: 'Thiếu phone' });
        }

        const bookings = await Booking.find({
                'customer.phone': phone
            })
            .sort({ createdAt: -1 })
            .populate('tripId')
            .lean();

        const routeMap = {};
        (ROUTES || []).forEach(function(r) {
            routeMap[r.code] = { from: r.from, to: r.to };
        });

        const result = bookings.map(function(b) {
            const trip = b.tripId || {};
            const routeInfo = routeMap[trip.routeCode] || {};
            return {
                _id: b._id,
                seatCodes: b.seatCodes || [],
                customer: b.customer || {},
                payment: b.payment || {},
                status: b.status,
                createdAt: b.createdAt,
                updatedAt: b.updatedAt,
                departureTime: trip.departAt,
                trip: {
                    routeCode: trip.routeCode,
                    from: routeInfo.from,
                    to: routeInfo.to,
                    dateStr: trip.dateStr,
                    departHM: trip.departHM,
                    departAt: trip.departAt,
                    price: trip.price
                }
            };
        });

        return res.json(result);
    } catch (e) {
        console.error(e);
        return res.status(500).json({ ok: false, message: 'Server error' });
    }
});
router.post('/:id/cancel',  async (req, res, next) => {
  try {
    const bookingId = req.params.id;

   
    const booking = await Booking.findById(bookingId).populate('tripId');

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Không tìm thấy vé',
      });
    }

    if (booking.status === 'cancelled') {
      return res.status(400).json({
        success: false,
        message: 'Vé này đã được hủy trước đó',
      });
    }

    if (booking.status === 'completed') {
      return res.status(400).json({
        success: false,
        message: 'Không thể hủy vé đã hoàn thành chuyến',
      });
    }

    if (booking.checkedIn) {
      return res.status(400).json({
        success: false,
        message: 'Không thể hủy vé đã check-in lên xe',
      });
    }

    const trip = booking.tripId;
    if (!trip) {
      return res.status(400).json({
        success: false,
        message: 'Vé không có thông tin chuyến đi hợp lệ',
      });
    }

    const now = new Date();
    const departTime = new Date(trip.departAt); 

    const diffMs = departTime - now;
    const diffHours = diffMs / (1000 * 60 * 60);

    if (diffHours < CANCEL_BEFORE_HOURS) {
      return res.status(400).json({
        success: false,
        message: `Chỉ được hủy vé trước giờ khởi hành ít nhất ${CANCEL_BEFORE_HOURS} giờ`,
      });
    }

    if (Array.isArray(booking.seatCodes) && booking.seatCodes.length > 0) {
      const seatSetToRemove = new Set(booking.seatCodes);

      const newSeatsBooked = (trip.seatsBooked || []).filter(
        (code) => !seatSetToRemove.has(code)
      );

      trip.seatsBooked = newSeatsBooked;
      await trip.save();
    }

    booking.status = 'cancelled';

    if (booking.payment && booking.payment.status === 'paid') {
      booking.payment.status = 'refunded';
      booking.payment.refundedAt = new Date(); 
    }

    await booking.save();

    return res.json({
      success: true,
      message: 'Hủy vé thành công',
      data: {
        id: booking._id,
        status: booking.status,
        paymentStatus: booking.payment?.status,
        trip: {
          id: trip._id,
          routeCode: trip.routeCode,
          dateStr: trip.dateStr,
          departHM: trip.departHM,
        },
        seatCodes: booking.seatCodes,
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;