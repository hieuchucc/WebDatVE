require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const { User } = require('../models/User');

async function main() {
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/bavexetructuyen';
  await mongoose.connect(uri);

  const username = (process.env.ADMIN_USERNAME || 'admin').toLowerCase().trim();
  const password = process.env.ADMIN_PASSWORD || 'admin123';

  let admin = await User.findOne({ username });
  if (admin) {
    // đảm bảo role là admin
    if (admin.role !== 'admin') {
      admin.role = 'admin';
      await admin.save();
    }
    console.log(`✅ Admin đã tồn tại: ${username} (${admin._id})`);
    return process.exit(0);
  }

  const saltRounds = Number(process.env.BCRYPT_SALT_ROUNDS) || 12;
  const passwordHash = await bcrypt.hash(password, saltRounds);

  admin = await User.create({
    username,
    passwordHash,
    role: 'admin',
    isSystem: true,
    displayName: 'System Admin',
    email: undefined,
  });

  console.log(`✅ Tạo admin thành công: ${username} (${admin._id})`);
  console.log('⚠️  Hãy đổi ADMIN_PASSWORD trong .env sau khi đăng nhập lần đầu.');
  process.exit(0);
}

main().catch(e => {
  console.error('Seed admin error:', e);
  process.exit(1);
});
