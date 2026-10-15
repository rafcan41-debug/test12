// Auth routes: register, login, logout, me, profile, password change, reset
const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { db } = require('../db');
const { signToken, requireAuth, refreshPlan } = require('../auth');
const { authLimiter } = require('../ratelimit');
const { isEmail, isNonEmpty } = require('../validate');
const { notify } = require('../notify');

const router = express.Router();
router.use(authLimiter);

const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.COOKIE_SECURE === '1',
  maxAge: 7 * 24 * 3600 * 1000,
  path: '/',
};

function publicUser(u) {
  return {
    id: u.id, name: u.name, email: u.email, role: u.role,
    photo_url: u.photo_url, institution: u.institution, class: u.class,
    group_name: u.group_name, plan: u.plan, premium_until: u.premium_until,
    created_at: u.created_at,
  };
}

function issueSession(res, user) {
  const token = signToken(user);
  res.cookie('pk_token', token, COOKIE_OPTS);
  return token;
}

// Warn user when premium is about to expire (once per day)
function maybeExpiryWarning(user) {
  if (user.plan !== 'premium' || !user.premium_until) return;
  const msLeft = new Date(user.premium_until) - Date.now();
  if (msLeft > 0 && msLeft < 3 * 24 * 3600 * 1000) {
    const exists = db.prepare(
      "SELECT 1 FROM notifications WHERE user_id = ? AND type = 'expiry' AND created_at > datetime('now','-1 day')"
    ).get(user.id);
    if (!exists) {
      notify(user.id, 'সাবস্ক্রিপশন শেষ হতে চলেছে', 'আপনার প্রিমিয়াম প্ল্যানের মেয়াদ শীঘ্রই শেষ হবে। নবায়ন করতে প্রাইসিং পেজ দেখুন।', 'expiry');
    }
  }
}

router.post('/register', (req, res) => {
  const { name, email, password, institution, class: cls, group: grp } = req.body || {};
  if (!isNonEmpty(name, 100)) return res.status(400).json({ error: 'সঠিক নাম দিন' });
  if (!isEmail(email)) return res.status(400).json({ error: 'সঠিক ইমেইল দিন' });
  if (typeof password !== 'string' || password.length < 6) {
    return res.status(400).json({ error: 'পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে' });
  }
  const emailNorm = email.trim().toLowerCase();
  const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(emailNorm);
  if (exists) return res.status(409).json({ error: 'এই ইমেইলে অ্যাকাউন্ট আছে' });
  const hash = bcrypt.hashSync(password, 10);
  const info = db.prepare(
    'INSERT INTO users (name, email, password_hash, institution, class, group_name) VALUES (?,?,?,?,?,?)'
  ).run(name.trim(), emailNorm, hash, institution || null, cls || null, grp || null);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  issueSession(res, user);
  notify(user.id, 'স্বাগতম!', 'পরীক্ষা-তে অ্যাকাউন্ট তৈরি হয়েছে। প্র্যাকটিস শুরু করুন।', 'info');
  res.status(201).json({ user: publicUser(user) });
});

router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!isEmail(email) || typeof password !== 'string') {
    return res.status(400).json({ error: 'ইমেইল ও পাসওয়ার্ড দিন' });
  }
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.trim().toLowerCase());
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'ইমেইল বা পাসওয়ার্ড ভুল' });
  }
  if (user.status === 'banned') return res.status(403).json({ error: 'অ্যাকাউন্ট নিষিদ্ধ করা হয়েছে' });
  const token = issueSession(res, user);
  maybeExpiryWarning(user);
  res.json({ user: publicUser(user), token });
});

router.post('/logout', (req, res) => {
  res.clearCookie('pk_token', { path: '/' });
  res.json({ ok: true });
});

router.get('/me', requireAuth, refreshPlan, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  maybeExpiryWarning(user);
  res.json({ user: publicUser(user) });
});

router.put('/profile', requireAuth, (req, res) => {
  const { name, photo_url, institution, class: cls, group: grp } = req.body || {};
  if (name !== undefined && !isNonEmpty(name, 100)) return res.status(400).json({ error: 'সঠিক নাম দিন' });
  db.prepare(
    'UPDATE users SET name = COALESCE(?, name), photo_url = ?, institution = ?, class = ?, group_name = ? WHERE id = ?'
  ).run(
    name ? name.trim() : null,
    photo_url || null, institution || null, cls || null, grp || null, req.user.id
  );
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.json({ user: publicUser(user) });
});

router.put('/change-password', requireAuth, (req, res) => {
  const { current, new: npw } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!bcrypt.compareSync(current || '', user.password_hash)) {
    return res.status(400).json({ error: 'বর্তমান পাসওয়ার্ড ভুল' });
  }
  if (typeof npw !== 'string' || npw.length < 6) {
    return res.status(400).json({ error: 'নতুন পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে' });
  }
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(npw, 10), req.user.id);
  db.prepare('UPDATE meta SET value = ? WHERE key = ?').run('1', 'admin_pw_changed');
  res.json({ ok: true });
});

// Password reset: token is logged to console + data/reset-tokens.log (v1, no SMS/email)
router.post('/forgot', (req, res) => {
  const { email } = req.body || {};
  const done = { ok: true, message: 'ইমেইল সঠিক হলে রিসেট নির্দেশনা পাঠানো হয়েছে' };
  if (!isEmail(email)) return res.json(done);
  const user = db.prepare('SELECT id FROM users WHERE email = ?').get(email.trim().toLowerCase());
  if (!user) return res.json(done); // do not reveal whether the email exists
  const token = crypto.randomBytes(32).toString('hex');
  const ttlMin = parseInt(process.env.RESET_TOKEN_TTL_MIN || '30', 10);
  db.prepare("INSERT INTO password_resets (user_id, token, expires_at) VALUES (?,?,datetime('now', ?))")
    .run(user.id, token, `+${ttlMin} minutes`);
  const line = `[${new Date().toISOString()}] email=${email.trim().toLowerCase()} token=${token}\n`;
  console.log('[password-reset] ' + line.trim());
  try {
    fs.appendFileSync(path.join(__dirname, '..', 'data', 'reset-tokens.log'), line);
  } catch (e) { /* ignore */ }
  res.json(done);
});

router.post('/reset', (req, res) => {
  const { token, password } = req.body || {};
  if (typeof password !== 'string' || password.length < 6) {
    return res.status(400).json({ error: 'পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে' });
  }
  const row = db.prepare(
    "SELECT * FROM password_resets WHERE token = ? AND used = 0 AND expires_at > datetime('now')"
  ).get(token);
  if (!row) return res.status(400).json({ error: 'টোকেন ভুল বা মেয়াদ শেষ' });
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(password, 10), row.user_id);
  db.prepare('UPDATE password_resets SET used = 1 WHERE id = ?').run(row.id);
  res.json({ ok: true, message: 'পাসওয়ার্ড পরিবর্তন হয়েছে, এখন লগইন করুন' });
});

module.exports = router;
