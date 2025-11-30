const mongoose = require('mongoose');
require('dotenv').config();

async function connectDB() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI missing');

  mongoose.set('strictQuery', true);

  await mongoose.connect(uri, {
   
    serverSelectionTimeoutMS: 5000,   
    socketTimeoutMS: 45000,
    maxPoolSize: 20,                  
    autoIndex: false,                
  });

  console.log('✅ MongoDB Atlas connected');
}

module.exports = connectDB;
