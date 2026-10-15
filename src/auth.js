// Auth helpers: JWT issue/verify, role middleware
const jwt = require('jsonwebtoken');
const { db } = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-secret-change-me';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

function signToken(user) {
  return jwt.sign(
    { id: user.id, role: user.role, plan: user.plan },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

function getTokenFromReq(req) {
  if (req.cookies && req.cookies.pk_token) return req.cookies.pk_token;
  const h = req.headers.authorization || '';
  if (h.startsWith('Bearer ')) return h.slice(7);
  return null;
}

// Attaches req.user = { id, role, plan } or 401
function requireAuth(req, res, next) {
  const token = getTokenFromReq(req);
  if (!token) return res.status(401).json({ error: 'লগইন প্রয়োজন (login required)' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const row = db.prepare('SELECT id, role, status, plan, premium_until FROM users WHERE id = ?').get(payload.id);
    if (!row) return res.status(401).json({ error: 'ব্যবহারকারী পাওয়া যায়নি' });
    if (row.status === 'banned') return res.status(403).json({ error: 'আপনার অ্যাকাউন্ট নিষিদ্ধ করা হয়েছে' });
    req.user = { id: row.id, role: row.role, plan: row.plan, premium_until: row.premium_until };
    next();
  } catch (e) {
    return res.status(401).json({ error: 'সেশন মেয়াদ শেষ, আবার লগইন করুন' });
  }
}

// requireRole('admin'), requireRole('admin','teacher')
function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'এই কাজের অনুমতি নেই (permission denied)' });
    }
    next();
  };
}

// Downgrade expired premium plans to free (checked on authenticated requests)
function refreshPlan(req, res, next) {
  if (req.user && req.user.plan === 'premium' && req.user.premium_until) {
    if (new Date(req.user.premium_until) < new Date()) {
      db.prepare("UPDATE users SET plan = 'free', premium_until = NULL WHERE id = ?").run(req.user.id);
      req.user.plan = 'free';
    }
  }
  next();
}

module.exports = { signToken, requireAuth, requireRole, refreshPlan, getTokenFromReq };
