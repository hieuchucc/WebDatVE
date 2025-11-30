const jwt = require('jsonwebtoken');

function signAccess(user) {
  const payload = { sub: String(user._id), role: user.role, username: user.username };
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: process.env.ACCESS_TOKEN_TTL || '2h' });
}
function signRefresh(user) {
  const payload = { sub: String(user._id), ver: 1 };
  return jwt.sign(payload, process.env.JWT_REFRESH_SECRET, { expiresIn: process.env.REFRESH_TOKEN_TTL || '30d' });
}
function setRefreshCookie(res, token) {
  res.cookie('refresh_token', token, {
    httpOnly: true,
    secure: process.env.COOKIE_SECURE === 'true',
    sameSite: process.env.COOKIE_SAMESITE || 'lax',
    path: process.env.COOKIE_PATH || '/',
    domain: process.env.COOKIE_DOMAIN || undefined,
    maxAge: 1000 * 60 * 60 * 24 * 30,
  });
}
module.exports = { signAccess, signRefresh, setRefreshCookie };
