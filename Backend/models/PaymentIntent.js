const mongoose = require('mongoose');

const PaymentIntentSchema = new mongoose.Schema({
    bookingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking', required: true },
    method: { type: String, enum: ['momo', 'zalopay', 'vnpay'], required: true },
    amount: { type: Number, required: true },
    currency: { type: String, default: 'VND' },

    status: { type: String, enum: ['pending', 'paid', 'expired', 'cancelled'], default: 'pending' },

    providerTxnId: String, // khi nối gateway thật
    qrPayload: String, // link thanh toán/payUrl
    qrImageDataUrl: String, // ảnh QR (data url)
    expiresAt: { type: Date, required: true },

}, { timestamps: true });

PaymentIntentSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
const PaymentIntent = mongoose.model('PaymentIntent', PaymentIntentSchema);
module.exports = { PaymentIntent };
module.exports.PaymentIntent = PaymentIntent;
