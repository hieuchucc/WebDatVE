const { DateTime } = require('luxon');
const VN_TZ = 'Asia/Ho_Chi_Minh';

function todayVN() {
    return DateTime.now().setZone(VN_TZ).startOf('day');
}

function toVN(date) {
    return DateTime.fromJSDate(date).setZone(VN_TZ);
}

function ymdVN(dt) {
    return dt.setZone(VN_TZ).toFormat('yyyy-LL-dd');
}

function combineVN(dateStr, hm) {
    // tạo DateTime theo VN tz, rồi convert sang JS Date (UTC)
    const dt = DateTime.fromFormat(`${dateStr} ${hm}`, 'yyyy-LL-dd HH:mm', { zone: VN_TZ });
    return dt;
}

module.exports = { VN_TZ, todayVN, toVN, ymdVN, combineVN };