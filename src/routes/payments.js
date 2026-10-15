// Subscriptions: manual bKash payment flow (v1). Student submits txn id, admin approves/rejects.
const express = require('express');
const { db } = require('../db');
const { requireAuth, requireRole } = require('../auth');
const { isNonEmpty } = require('../validate');
const { notify } = require('../notify');

const router = express.Router();
const PREMIUM_PRICE = 299; // BDT, 30 days
const PREMIUM_DAYS = 30;

router.get('/plans', (req, res) => {
  res.json({
    plans: [
      { id: 'free', name_bn: 'ফ্রি', price: 0, exams_per_day: 3, practice_per_day: 20, features: ['দিনে ৩টি পরীক্ষা', 'দিনে ২০টি প্র্যাকটিস উত্তর', 'লিডারবোর্ড', 'বুকমার্ক'] },
      { id: 'premium', name_bn: 'প্রিমিয়াম', price: PREMIUM_PRICE, days: PREMIUM_DAYS, features: ['আনলিমিটেড পরীক্ষা', 'আনলিমিটেড প্র্যাকটিস', 'সব প্রশ্ন ব্যাংক', 'অগ্রাধিকার সাপোর্ট'] },
    ],
  });
});

// Student: submit a manual bKash payment
router.post('/', requireAuth, (req, res) => {
  const { bkash_txn_id, sender_number } = req.body || {};
  if (!isNonEmpty(bkash_txn_id, 50)) return res.status(400).json({ error: 'bKash ট্রানজেকশন আইডি দিন' });
  const dup = db.prepare("SELECT id FROM payments WHERE bkash_txn_id = ? AND status != 'rejected'")
    .get(bkash_txn_id.trim());
  if (dup) return res.status(409).json({ error: 'এই ট্রানজেকশন আইডি আগেই ব্যবহার করা হয়েছে' });
  const info = db.prepare(`INSERT INTO payments (user_id, plan, amount, bkash_txn_id, sender_number)
    VALUES (?,?,?,?,?)`)
    .run(req.user.id, 'premium', PREMIUM_PRICE, bkash_txn_id.trim(), sender_number || null);
  res.status(201).json({ payment: db.prepare('SELECT * FROM payments WHERE id = ?').get(info.lastInsertRowid) });
});

router.get('/mine', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM payments WHERE user_id = ? ORDER BY id DESC').all(req.user.id);
  res.json({ payments: rows });
});

// Admin: list + approve/reject
router.get('/', requireAuth, requireRole('admin'), (req, res) => {
  const { status } = req.query;
  const where = status && ['pending', 'approved', 'rejected'].includes(status) ? 'WHERE p.status = ?' : '';
  const params = where ? [status] : [];
  const rows = db.prepare(
    `SELECT p.*, u.name AS user_name, u.email AS user_email FROM payments p
     JOIN users u ON u.id = p.user_id ${where} ORDER BY p.id DESC`
  ).all(...params);
  res.json({ payments: rows });
});

router.post('/:id/approve', requireAuth, requireRole('admin'), (req, res) => {
  const p = db.prepare('SELECT * FROM payments WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'পেমেন্ট পাওয়া যায়নি' });
  if (p.status !== 'pending') return res.status(400).json({ error: 'এটি ইতিমধ্যে নিষ্পত্তি হয়েছে' });
  const until = new Date(Date.now() + PREMIUM_DAYS * 24 * 3600 * 1000).toISOString();
  db.prepare("UPDATE payments SET status = 'approved', decided_by = ?, decided_at = datetime('now') WHERE id = ?")
    .run(req.user.id, p.id);
  db.prepare("UPDATE users SET plan = 'premium', premium_until = ? WHERE id = ?").run(until, p.user_id);
  db.prepare(`INSERT INTO audit_log (actor_id, action, target_type, target_id, details) VALUES (?,?,?,?,?)`)
    .run(req.user.id, 'payment.approve', 'payment', p.id, `txn=${p.bkash_txn_id}`);
  notify(p.user_id, 'প্রিমিয়াম চালু হয়েছে!', `আপনার প্রিমিয়াম প্ল্যান ${PREMIUM_DAYS} দিনের জন্য সক্রিয়।`, 'subscription');
  res.json({ ok: true, premium_until: until });
});

router.post('/:id/reject', requireAuth, requireRole('admin'), (req, res) => {
  const p = db.prepare('SELECT * FROM payments WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'পেমেন্ট পাওয়া যায়নি' });
  if (p.status !== 'pending') return res.status(400).json({ error: 'এটি ইতিমধ্যে নিষ্পত্তি হয়েছে' });
  const note = (req.body || {}).note || '';
  db.prepare("UPDATE payments SET status = 'rejected', decided_by = ?, decided_at = datetime('now'), note = ? WHERE id = ?")
    .run(req.user.id, note, p.id);
  db.prepare(`INSERT INTO audit_log (actor_id, action, target_type, target_id, details) VALUES (?,?,?,?,?)`)
    .run(req.user.id, 'payment.reject', 'payment', p.id, note.slice(0, 200));
  notify(p.user_id, 'পেমেন্ট বাতিল হয়েছে', note || 'আপনার পেমেন্ট যাচাই করা যায়নি। সাপোর্টে যোগাযোগ করুন।', 'subscription');
  res.json({ ok: true });
});

module.exports = router;
module.exports.PREMIUM_PRICE = PREMIUM_PRICE;
