const { verifyAccess } = require('./auth');
module.exports = function authenticateToken(req, res, next) {
  verifyAccess(req, res, () => {
    if (!req.user?.role && req.user?.admin === true) req.user.role = 'admin';
    if (!req.user?.id) {
      const p = req.user || {};
      req.user = { id: p.sub || p.id || p._id, role: p.role || (p.admin ? 'admin' : undefined) };
    }
    next();
  });
};
