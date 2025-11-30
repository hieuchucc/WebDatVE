const cron = require('node-cron');
const mongoose = require('mongoose');
const { Booking } = require('../models/Booking');
const { Trip } = require('../models/Trip');
const { sendDepartReminderEmail } = require('../services/mailer');

function toDepartDate(trip){
  if(!trip?.dateStr || !trip?.departHM) return null;
  const [hh, mm] = String(trip.departHM).split(':').map(Number);
  // Asia/Ho_Chi_Minh ~ +07:00
  return new Date(`${trip.dateStr}T${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}:00+07:00`);
}

function minutes(n){ return n*60*1000; }

function scheduleReminderCron(){
  const lead = Number(process.env.REMINDER_LEAD_MINUTES || 180);

  // chạy mỗi phút
  cron.schedule('* * * * *', async () => {
    try {
      const now = Date.now();
      const windowEnd = now + minutes(1); // cửa sổ 1 phút

      // Lấy các booking đã thanh toán, chưa gửi nhắc, có email
      const candidates = await Booking.find({
        'payment.status': 'paid',
        'customer.email': { $exists: true, $ne: '' },
        reminderSent: { $ne: true }
      })
      .select('_id tripId customer seatCodes payment reminderSent')
      .populate({ path: 'tripId', select: 'routeCode dateStr departHM' })
      .limit(200) // tránh quá tải mỗi phút
      .lean();

      for(const b of candidates){
        const departAt = toDepartDate(b.tripId);
        if(!departAt) continue;
        const fireAt = departAt.getTime() - minutes(lead);
        if (fireAt >= now && fireAt < windowEnd){
          // gửi
          const enriched = { ...b, trip: b.tripId };
          await sendDepartReminderEmail(enriched, lead);
          await Booking.updateOne({ _id: b._id }, { $set: { reminderSent: true, reminderSentAt: new Date() } });
          // (tuỳ chọn) console.log
          console.log('[reminder] sent for booking', b._id.toString());
        }
      }
    } catch (e) {
      console.error('reminder cron error:', e);
    }
  });

  console.log(`⏰ Reminder cron scheduled (lead=${lead}m, every 1m)`);
}

module.exports = { scheduleReminderCron };
