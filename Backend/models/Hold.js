const mongoose = require('mongoose');

const HoldSchema = new mongoose.Schema({
    tripId: { type: mongoose.Schema.Types.ObjectId, ref: 'Trip', required: true },
    seatCodes: [String],
    customerPhone: String,
    status: { type: String, enum: ['active', 'cancelled'], default: 'active' },
    expiresAt: { type: Date, default: () => new Date(Date.now() + 10 * 60 * 1000) }
}, { timestamps: true });

// TTL tự xoá sau khi tới expiresAt
HoldSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = { Hold: mongoose.model('Hold', HoldSchema) };