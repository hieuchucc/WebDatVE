const mongoose = require('mongoose');

const CustomerSchema = new mongoose.Schema({
  name: String,
  phone: String,
  email: String,
  pickupPoint: String,
  dropoffPoint: String,
  note: String,

 
  transferOption: {
    type: String,
    enum: ['none', 'pickup', 'dropoff', 'both'],
    default: 'none',
  },
  pickupAddress: String,      
  dropoffAddress: String,     
  transferTimeNote: String,   
}, { _id: false });

const PaymentSchema = new mongoose.Schema({
  method: { type: String, enum: ['cod', 'momo', 'zalopay', 'vnpay'], default: 'cod' },
  status: {
    type: String,
    enum: ['pending', 'paid', 'failed', 'refunded'],
    default: 'pending'
  },
  amount: { type: Number, default: 0 },
  currency: { type: String, default: 'VND' },
  lastIntentId: { type: mongoose.Schema.Types.ObjectId, ref: 'PaymentIntent' },
  paidAt: Date,
}, { _id: false });

const BookingSchema = new mongoose.Schema({
  tripId: { type: mongoose.Schema.Types.ObjectId, ref: 'Trip', required: true },
  holdId: { type: mongoose.Schema.Types.ObjectId, ref: 'Hold', required: true },

  seatCodes: [String],

  customer: CustomerSchema,
  payment: PaymentSchema,

  status: {
    type: String,
    enum: ['pending', 'confirmed', 'cancelled', 'completed'],
    default: 'pending'
  },

  // Check-in lên xe chính
  checkedIn: { type: Boolean, default: false },
  boardedAt: { type: Date },

}, { timestamps: true });

const Booking = mongoose.model('Booking', BookingSchema);
module.exports = { Booking };
