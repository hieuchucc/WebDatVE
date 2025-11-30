// Backend/jobs/generateTrip.js
const cron = require('node-cron');
const { Trip, ROUTES } = require('../models/Trip');
const { DateTime } = require('luxon');
const { VN_TZ, todayVN, ymdVN, combineVN } = require('../utils/time');

const DEFAULT_TIMES = ['02:00', '04:00', '08:00', '12:00', '16:00', '20:00'];

// Khai báo giá theo chiều "gốc"; chiều ngược sẽ dùng chung giá
const DEFAULT_PRICE = {
    'LAGI-HCM': 150000,
    'LAGI-DALAT': 280000,
    'LAGI-NTRANG': 350000
};

const SEATS_TOTAL = 15;

function reverseCode(code) {
    const p = (code || '').split('-');
    return p.length === 2 ? (p[1] + '-' + p[0]) : code;
}

function priceFor(code) {
    // Ưu tiên đúng chiều; nếu không có thì lấy giá chiều ngược; cuối cùng fallback 180k
    return (DEFAULT_PRICE[code] !== undefined) ?
        DEFAULT_PRICE[code] :
        (DEFAULT_PRICE[reverseCode(code)] !== undefined ? DEFAULT_PRICE[reverseCode(code)] : 180000);
}

async function ensureTripsForDate(dateVN) {
    const dateStr = ymdVN(dateVN);

    for (const r of ROUTES) {
        for (const hm of DEFAULT_TIMES) {
            const departDT = combineVN(dateStr, hm);

            const filter = { routeCode: r.code, dateStr: dateStr, departHM: hm };

            // chỉ set khi tạo mới
            const setOnInsert = {
                routeCode: r.code,
                dateStr: dateStr,
                departHM: hm,
                departAt: departDT.toJSDate(),
                active: true
            };

            // luôn đồng bộ (kể cả đã tồn tại)
            const alwaysSet = {
                price: priceFor(r.code),
                seatsTotal: SEATS_TOTAL
            };

            await Trip.updateOne(
                filter, { $setOnInsert: setOnInsert, $set: alwaysSet }, { upsert: true }
            );
        }
    }
}

async function seedNextDays(days = 30) {
    const start = todayVN();
    for (let i = 0; i < days; i++) {
        const d = start.plus({ days: i });
        await ensureTripsForDate(d);
    }
}

function scheduleDailyJob() {
    // 00:05 hằng ngày
    cron.schedule('5 0 * * *', async() => {
        const tomorrow = DateTime.now().setZone(VN_TZ).plus({ days: 1 }).startOf('day');
        await ensureTripsForDate(tomorrow);
        console.log('Generated trips for', tomorrow.toISODate());
    });
}

module.exports = { seedNextDays, scheduleDailyJob };