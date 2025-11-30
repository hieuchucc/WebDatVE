// models/Review.js
const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema({
    name: { type: String, required: true }, // TÊN KHÁCH HÀNG
    phone: { type: String, required: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, required: true },
    tripId: { type: mongoose.Schema.Types.ObjectId, ref: 'Trip', default: null }
}, { timestamps: true });

module.exports = mongoose.model('Review', reviewSchema);