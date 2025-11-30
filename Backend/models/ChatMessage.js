const mongoose = require('mongoose');

const ChatMessageSchema = new mongoose.Schema(
  {

    roomId: { type: String }, 
    senderType: {
      type: String,
      enum: ['customer', 'staff', 'bot'],
    },
    senderId: { type: String }, 
    text: { type: String },     

  
    role: {
      type: String,
      enum: ['user', 'bot'],
    },
    content: { type: String },
  },
  { timestamps: true }
);

// xuất model
const ChatMessage = mongoose.model('ChatMessage', ChatMessageSchema);
module.exports = { ChatMessage };
