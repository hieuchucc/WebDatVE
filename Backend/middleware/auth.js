const jwt = require('jsonwebtoken');

function verifyAccess(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ message: 'Missing access token' });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = { id: payload.sub || payload.id || payload._id, role: payload.role, username: payload.username };
    return next();
  } catch (e) {
    return res.status(401).json({ message: 'Invalid/expired access token' });
  }
}

module.exports = { verifyAccess };
