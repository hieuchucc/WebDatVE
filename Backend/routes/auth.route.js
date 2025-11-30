const express = require('express');
const bcrypt = require('bcrypt');
const router = express.Router();
const { User } = require('../models/User');
const { signAccess, signRefresh, setRefreshCookie } = require('../utils/jwt');
const { verifyAccess } = require('../middleware/auth');

router.post('/register', async(req, res) => {
    try {
        const { username, password, email, phone } = req.body;
        // Cho phép tiếng Việt + khoảng trắng + số
        const usernameRegex = /^[A-Za-zÀ-ỹ0-9 ]{3,32}$/;
        if (!usernameRegex.test(username.trim())) {
            return res.status(400).json({
                message: "Tên đăng nhập chỉ được chứa chữ cái (có dấu), số và khoảng trắng (3–32 ký tự)."
            });
        }

        if (!username || !password || !email || !phone)
            return res.status(400).json({ message: 'Thiếu thông tin bắt buộc.' });

        const uname = username.trim(); // giữ nguyên, không lowercase nữa

        const mail = email.trim().toLowerCase();
        const ph = phone.trim();

        const exists = await User.findOne({
            $or: [
                { username: uname },
                { email: mail },
                { phone: ph }
            ]
        });

        if (exists) {
            if (exists.username === uname)
                return res.status(409).json({ message: "Tên đăng nhập đã tồn tại" });
            if (exists.email === mail)
                return res.status(409).json({ message: "Email đã tồn tại" });
            if (exists.phone === ph)
                return res.status(409).json({ message: "Số điện thoại đã tồn tại" });
        }

        const hash = await bcrypt.hash(password, 12);

        const user = await User.create({
            username: uname,
            displayName: uname,
            email: mail,
            phone: ph,
            passwordHash: hash,
            role: "customer"
        });

        const access = signAccess(user);
        const refresh = signRefresh(user);
        setRefreshCookie(res, refresh);

        res.status(201).json({
            accessToken: access,
            user: {
                id: user._id,
                username: user.username,
                displayName: user.displayName,
                email: user.email,
                phone: user.phone,
                role: user.role
            }
        });


    } catch (e) {
        res.status(500).json({ message: "Server error" });
    }
});


router.post('/login', async(req, res) => {
    try {
        const { identifier, password } = req.body;

        if (!identifier || !password) {
            return res.status(400).json({ message: 'Thiếu thông tin đăng nhập' });
        }

        const raw = String(identifier).trim().toLowerCase();

        // Cho phép đăng nhập bằng:
        // - email
        // - số điện thoại (không lowercase)
        // - username (nếu bạn vẫn còn dùng)
        const user = await User.findOne({
            $or: [
                { email: raw }, // EMAIL
                { phone: identifier.trim() }, // PHONE
                { username: raw } // USERNAME (Nếu muốn giữ lại)
            ]
        });

        if (!user) {
            return res.status(401).json({ message: 'Sai email / số điện thoại / mật khẩu' });
        }

        const ok = await bcrypt.compare(password, user.passwordHash);
        if (!ok) {
            return res.status(401).json({ message: 'Sai email / số điện thoại / mật khẩu' });
        }

        const access = signAccess(user);
        const refresh = signRefresh(user);
        setRefreshCookie(res, refresh);

        res.json({
            accessToken: access,
            user: {
                id: user._id,
                username: user.username,
                displayName: user.displayName,
                email: user.email,
                phone: user.phone,
                role: user.role
            }
        });

    } catch (e) {
        console.error("LOGIN ERROR:", e);
        res.status(500).json({ message: "Server error" });
    }
});



router.post('/refresh', async(req, res) => {
    const jwt = require('jsonwebtoken');

    const token = req.cookies && req.cookies.refresh_token;
    if (!token) return res.status(401).json({ message: 'Missing refresh token' });

    try {
        const payload = jwt.verify(token, process.env.JWT_REFRESH_SECRET);
        const userId = payload.sub;

        const user = await User.findById(userId);
        if (!user) return res.status(401).json({ message: 'User not found' });

        const access = signAccess(user);
        res.json({ accessToken: access });

    } catch (e) {
        return res.status(401).json({ message: 'Invalid/expired refresh token' });
    }
});


router.post('/logout', (req, res) => {
    res.clearCookie('refresh_token', { path: process.env.COOKIE_PATH || '/' });
    res.json({ ok: true });
});

router.get('/me', verifyAccess, async(req, res) => {
    const user = await User.findById(req.user.id).select('_id username displayName email phone role');

    if (!user) return res.status(404).json({ message: 'User not found' });

    res.json({
        id: user._id,
        username: user.username,
        displayName: user.displayName,
        email: user.email,
        phone: user.phone,
        role: user.role
    });
});

const otpStore = {}; // Lưu OTP trong RAM: { email: {code, expiresAt} }

router.post("/forgot", async(req, res) => {
    const { identifier } = req.body;

    const user = await User.findOne({
        $or: [
            { username: identifier },
            { email: identifier },
            { phone: identifier }
        ]
    });

    if (!user) {
        return res.status(404).json({ message: "Không tìm thấy tài khoản!" });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    otpStore[user.email] = {
        code: otp,
        expiresAt: Date.now() + 5 * 60 * 1000
    };

    console.log("OTP gửi cho user:", user.email, " → ", otp);

    res.json({ message: "OTP đã được gửi" });
});
router.post("/reset", async(req, res) => {
    const { identifier, code, newPassword } = req.body;

    const user = await User.findOne({
        $or: [
            { username: identifier },
            { email: identifier },
            { phone: identifier }
        ]
    });

    if (!user) return res.status(404).json({ message: "Tài khoản không tồn tại" });

    const stored = otpStore[user.email];
    if (!stored) return res.status(400).json({ message: "OTP không hợp lệ" });

    if (stored.code !== code)
        return res.status(400).json({ message: "OTP sai" });

    if (Date.now() > stored.expiresAt) {
        delete otpStore[user.email];
        return res.status(400).json({ message: "OTP đã hết hạn" });
    }

    // Update password
    user.passwordHash = await bcrypt.hash(newPassword, 10);
    await user.save();

    delete otpStore[user.email];

    res.json({ message: "Đổi mật khẩu thành công" });
});

module.exports = router;