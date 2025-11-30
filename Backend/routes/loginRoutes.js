
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { sendEmail } = require('../utils/sendEmail');

const router = express.Router();

function signToken(user) {
  return jwt.sign(
    { sub: user._id, email: user.email },
    process.env.JWT_SECRET || 'devsecret',
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

// 🧩 Đăng nhập
router.post('/', async (req, res) => {
  try {
    const { emailOrUsername, password } = req.body || {};
    if (!emailOrUsername || !password) {
      return res.status(400).json({ message: 'Thiếu thông tin đăng nhập.' });
    }

    const user = await User.findOne({
      $or: [{ email: emailOrUsername.toLowerCase() }, { username: emailOrUsername }]
    });

    if (!user) return res.status(401).json({ message: 'Sai thông tin đăng nhập.' });

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).json({ message: 'Sai thông tin đăng nhập.' });

    if (!user.emailVerified) {
      return res.status(403).json({ message: 'Email chưa được xác nhận. Vui lòng kiểm tra email hoặc gửi lại liên kết.' });
    }

    const token = signToken(user);
    return res.status(200).json({ message: 'Đăng nhập thành công.', token });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ message: 'Lỗi máy chủ.' });
  }
});

// 🧩 Gửi lại email xác nhận
router.post('/resend-verification', async (req, res) => {
  try {
    const { email } = req.body || {};
    if (!email) return res.status(400).json({ message: 'Thiếu email.' });

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) return res.status(404).json({ message: 'Không tìm thấy người dùng.' });
    if (user.emailVerified) return res.status(200).json({ message: 'Email đã xác nhận.' });

    const plainToken = user.generateEmailVerifyToken(30);
    await user.save();

    const apiBase = process.env.API_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
    const appBase = process.env.APP_BASE_URL || 'http://127.0.0.1:5500';
    const verifyUrlBackend = `${apiBase}/api/register/verify-email?email=${encodeURIComponent(user.email)}&token=${plainToken}`;
    const verifyUrlFrontend = `${appBase}/verify.html?email=${encodeURIComponent(user.email)}&token=${plainToken}`;

    const html = `
      <div style="font-family:Arial,Helvetica,sans-serif">
        <p>Nhấn vào liên kết để xác nhận email:</p>
        <p><a href="${verifyUrlBackend}">${verifyUrlBackend}</a></p>
        <p><a href="${verifyUrlFrontend}">${verifyUrlFrontend}</a></p>
      </div>
    `;

    await sendEmail({
      to: user.email,
      subject: 'Gửi lại liên kết xác nhận email',
      html,
      text: `Xác nhận email: ${verifyUrlBackend}\nHoặc: ${verifyUrlFrontend}`
    });

    return res.status(200).json({ message: 'Đã gửi lại email xác nhận.' });
  } catch (err) {
    console.error('Resend verify error:', err);
    return res.status(500).json({ message: 'Lỗi máy chủ.' });
  }
});

module.exports = router;
