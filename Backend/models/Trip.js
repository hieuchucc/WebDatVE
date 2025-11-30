const mongoose = require('mongoose');

const ROUTES = [
    { code: 'LAGI-HCM', from: 'Lagi', to: 'TP.HCM' },
    { code: 'HCM-LAGI', from: 'TP.HCM', to: 'Lagi' },

    { code: 'LAGI-DALAT', from: 'Lagi', to: 'Đà Lạt' },
    { code: 'DALAT-LAGI', from: 'Đà Lạt', to: 'Lagi' },

    { code: 'LAGI-NTRANG', from: 'Lagi', to: 'Nha Trang' },
    { code: 'NTRANG-LAGI', from: 'Nha Trang', to: 'Lagi' },
];


const TripSchema = new mongoose.Schema({
    routeCode: { type: String, enum: ROUTES.map(r => r.code), required: true, index: true },
    dateStr: { type: String, required: true, index: true }, // 'YYYY-MM-DD' theo Asia/Ho_Chi_Minh
    departHM: { type: String, required: true }, // 'HH:mm'
    departAt: { type: Date, required: true, index: true }, // ISO Date UTC
    price: { type: Number, required: true, default: 180000 },
    seatsTotal: { type: Number, required: true, default: 15 },
    seatsBooked: { type: [String], default: [] }, // ví dụ: ['A1','A2'] nếu bạn có sơ đồ ghế
    active: { type: Boolean, default: true }
}, { timestamps: true });

TripSchema.index({ routeCode: 1, dateStr: 1, departAt: 1 });
TripSchema.index({ active: 1 });

module.exports = {
    Trip: mongoose.model('Trip', TripSchema),
    ROUTES
};
