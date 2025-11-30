// Backend/models/Shuttle.js
const mongoose = require('mongoose');

const ShuttleSchema = new mongoose.Schema({
  // Biển số / mã xe trung chuyển
  plateNumber: { type: String, required: true },

  // Tên tài xế
  driverName: { type: String, required: true },

  // SĐT tài xế
  driverPhone: { type: String, required: true },

  // Sức chứa (bao nhiêu khách)
  capacity: { type: Number, default: 7 },

  // Trạng thái xe trung chuyển
  // idle: rảnh
  // on_route: đang đi đón / trả
  // offline: nghỉ / không hoạt động
  status: {
    type: String,
    enum: ['idle', 'on_route', 'offline'],
    default: 'idle'
  },

  // Ngày làm việc (theo trip) dạng YYYY-MM-DD
  workingDateStr: { type: String, index: true },

  // Tuyến chính mà xe trung chuyển đang phục vụ (optional)
  mainRouteCode: { type: String },

  // Vị trí hiện tại (để sau này định vị)
  currentLat: Number,
  currentLng: Number,
  currentLocationNote: String
}, { timestamps: true });

const Shuttle = mongoose.model('Shuttle', ShuttleSchema);

module.exports = { Shuttle };
