// Support tickets: students create, admins reply/close
const express = require('express');
const { db } = require('../db');
const { requireAuth, requireRole } = require('../auth');
const { isNonEmpty } = require('../validate');
const { notify } = require('../notify');

const router = express.Router();

router.post('/', requireAuth, (req, res) => {
  const { subject, message } = req.body || {};
  if (!isNonEmpty(subject, 200)) return res.status(400).json({ error: 'বিষয় লিখুন' });
  if (!isNonEmpty(message, 2000)) return res.status(400).json({ error: 'বিস্তারিত লিখুন' });
  const info = db.prepare('INSERT INTO tickets (user_id, subject, message) VALUES (?,?,?)')
    .run(req.user.id, subject.trim(), message.trim());
  res.status(201).json({ ticket: db.prepare('SELECT * FROM tickets WHERE id = ?').get(info.lastInsertRowid) });
});

router.get('/mine', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM tickets WHERE user_id = ? ORDER BY id DESC').all(req.user.id);
  res.json({ tickets: rows });
});

// Admin: list all
router.get('/', requireAuth, requireRole('admin'), (req, res) => {
  const { status } = req.query;
  const where = status && ['open', 'answered', 'closed'].includes(status) ? 'WHERE t.status = ?' : '';
  const rows = db.prepare(
    `SELECT t.*, u.name AS user_name, u.email AS user_email FROM tickets t
     JOIN users u ON u.id = t.user_id ${where} ORDER BY t.id DESC`
  ).all(...(where ? [status] : []));
  res.json({ tickets: rows });
});

function getTicket(id, user) {
  const t = db.prepare('SELECT * FROM tickets WHERE id = ?').get(id);
  if (!t) return { error: 404 };
  if (t.user_id !== user.id && user.role !== 'admin') return { error: 403 };
  return { ticket: t };
}

router.get('/:id', requireAuth, (req, res) => {
  const { ticket, error } = getTicket(req.params.id, req.user);
  if (error) return res.status(error).json({ error: 'অনুমতি নেই' });
  const replies = db.prepare(
    `SELECT r.*, u.name AS author_name, u.role AS author_role FROM ticket_replies r
     JOIN users u ON u.id = r.user_id WHERE r.ticket_id = ? ORDER BY r.id`
  ).all(ticket.id);
  res.json({ ticket, replies });
});

router.post('/:id/reply', requireAuth, (req, res) => {
  const { ticket, error } = getTicket(req.params.id, req.user);
  if (error) return res.status(error).json({ error: 'অনুমতি নেই' });
  if (ticket.status === 'closed') return res.status(400).json({ error: 'টিকিট বন্ধ হয়ে গেছে' });
  const { message } = req.body || {};
  if (!isNonEmpty(message, 2000)) return res.status(400).json({ error: 'উত্তর লিখুন' });
  db.prepare('INSERT INTO ticket_replies (ticket_id, user_id, message) VALUES (?,?,?)')
    .run(ticket.id, req.user.id, message.trim());
  const newStatus = req.user.role === 'admin' ? 'answered' : 'open';
  db.prepare('UPDATE tickets SET status = ? WHERE id = ?').run(newStatus, ticket.id);
  const otherId = req.user.role === 'admin' ? ticket.user_id : null;
  if (otherId) notify(otherId, 'সাপোর্ট টিকিটে উত্তর এসেছে', `টিকিট: ${ticket.subject}`, 'support');
  else {
    // notify admins
    const admins = db.prepare("SELECT id FROM users WHERE role = 'admin'").all();
    for (const a of admins) notify(a.id, 'নতুন টিকিট উত্তর', `টিকিট #${ticket.id}: ${ticket.subject}`, 'support');
  }
  res.status(201).json({ ok: true });
});

router.post('/:id/close', requireAuth, (req, res) => {
  const { ticket, error } = getTicket(req.params.id, req.user);
  if (error) return res.status(error).json({ error: 'অনুমতি নেই' });
  db.prepare("UPDATE tickets SET status = 'closed' WHERE id = ?").run(ticket.id);
  res.json({ ok: true });
});

module.exports = router;
