// Admin: dashboard stats, user management, audit log, CSV reports
const express = require('express');
const { db } = require('../db');
const { requireAuth, requireRole } = require('../auth');
const { isNonEmpty } = require('../validate');

const router = express.Router();
router.use(requireAuth, requireRole('admin'));

router.get('/stats', (req, res) => {
  const users = db.prepare('SELECT COUNT(*) c FROM users').get().c;
  const students = db.prepare("SELECT COUNT(*) c FROM users WHERE role = 'student'").get().c;
  const premium = db.prepare("SELECT COUNT(*) c FROM users WHERE plan = 'premium'").get().c;
  const questions = db.prepare("SELECT COUNT(*) c FROM questions WHERE status = 'published'").get().c;
  const qDrafts = db.prepare("SELECT COUNT(*) c FROM questions WHERE status = 'draft'").get().c;
  const examsTaken = db.prepare("SELECT COUNT(*) c FROM attempts WHERE status = 'submitted'").get().c;
  const pendingPayments = db.prepare("SELECT COUNT(*) c FROM payments WHERE status = 'pending'").get().c;
  const openTickets = db.prepare("SELECT COUNT(*) c FROM tickets WHERE status IN ('open','answered')").get().c;
  res.json({ users, students, premium, questions, question_drafts: qDrafts, exams_taken: examsTaken, pending_payments: pendingPayments, open_tickets: openTickets });
});

router.get('/users', (req, res) => {
  const { role, q } = req.query;
  const page = Math.max(1, parseInt(req.query.page || '1', 10));
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || '20', 10)));
  const where = [];
  const params = [];
  if (role && ['student', 'teacher', 'admin'].includes(role)) { where.push('role = ?'); params.push(role); }
  if (q && q.trim()) { where.push('(name LIKE ? OR email LIKE ?)'); params.push(`%${q.trim()}%`, `%${q.trim()}%`); }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const total = db.prepare(`SELECT COUNT(*) c FROM users ${whereSql}`).get(...params).c;
  const rows = db.prepare(
    `SELECT id, name, email, role, photo_url, institution, class, group_name, status, plan, premium_until, created_at
     FROM users ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`
  ).all(...params, limit, (page - 1) * limit);
  res.json({ total, page, limit, users: rows });
});

router.put('/users/:id', (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!u) return res.status(404).json({ error: 'ব্যবহারকারী পাওয়া যায়নি' });
  if (u.id === req.user.id && req.body.role && req.body.role !== 'admin') {
    return res.status(400).json({ error: 'নিজের অ্যাডমিন রোল সরানো যাবে না' });
  }
  const b = req.body || {};
  if (b.name !== undefined && !isNonEmpty(b.name, 100)) return res.status(400).json({ error: 'সঠিক নাম দিন' });
  if (b.role !== undefined && !['student', 'teacher', 'admin'].includes(b.role)) {
    return res.status(400).json({ error: 'ভুল রোল' });
  }
  if (b.status !== undefined && !['active', 'banned'].includes(b.status)) {
    return res.status(400).json({ error: 'ভুল স্ট্যাটাস' });
  }
  if (b.plan !== undefined && !['free', 'premium'].includes(b.plan)) {
    return res.status(400).json({ error: 'ভুল প্ল্যান' });
  }
  db.prepare(`UPDATE users SET name=COALESCE(?,name), role=COALESCE(?,role), status=COALESCE(?,status),
    plan=COALESCE(?,plan), institution=?, class=?, group_name=?, premium_until=? WHERE id=?`)
    .run(
      b.name ? b.name.trim() : null, b.role || null, b.status || null, b.plan || null,
      b.institution !== undefined ? b.institution : u.institution,
      b.class !== undefined ? b.class : u.class,
      b.group !== undefined ? b.group : u.group_name,
      b.premium_until !== undefined ? b.premium_until : u.premium_until,
      u.id
    );
  db.prepare(`INSERT INTO audit_log (actor_id, action, target_type, target_id, details) VALUES (?,?,?,?,?)`)
    .run(req.user.id, 'user.update', 'user', u.id, JSON.stringify({ role: b.role, status: b.status, plan: b.plan }));
  const fresh = db.prepare(
    'SELECT id, name, email, role, status, plan, premium_until FROM users WHERE id = ?').get(u.id);
  res.json({ user: fresh });
});

router.get('/audit', (req, res) => {
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit || '50', 10)));
  const rows = db.prepare(
    `SELECT a.*, u.name AS actor_name FROM audit_log a
     LEFT JOIN users u ON u.id = a.actor_id ORDER BY a.id DESC LIMIT ?`
  ).all(limit);
  res.json({ audit: rows });
});

// CSV export of results (optionally per exam)
router.get('/reports/results.csv', (req, res) => {
  const { exam_id } = req.query;
  const where = exam_id ? 'WHERE a.exam_id = ?' : '';
  const rows = db.prepare(
    `SELECT a.id, e.title AS exam, u.name, u.email, a.score, a.total_marks, a.percentage,
            a.correct_count, a.wrong_count, a.unanswered_count, a.time_taken_sec, a.submitted_at
     FROM attempts a JOIN users u ON u.id = a.user_id JOIN exams e ON e.id = a.exam_id
     ${where} AND a.status = 'submitted' ORDER BY a.id DESC`
  ).all(...(exam_id ? [exam_id] : []));
  const head = 'attempt_id,exam,student,email,score,total_marks,percentage,correct,wrong,unanswered,time_sec,submitted_at';
  const csv = [head].concat(rows.map((r) =>
    [r.id, `"${String(r.exam).replace(/"/g, '""')}"`, `"${String(r.name).replace(/"/g, '""')}"`,
      r.email, r.score, r.total_marks, r.percentage, r.correct_count, r.wrong_count,
      r.unanswered_count, r.time_taken_sec, r.submitted_at].join(',')
  )).join('\n');
  db.prepare(`INSERT INTO audit_log (actor_id, action, target_type, details) VALUES (?,?,?,?)`)
    .run(req.user.id, 'report.export_csv', 'attempt', `exam_id=${exam_id || 'all'} rows=${rows.length}`);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="results.csv"');
  res.send('﻿' + csv); // BOM for Excel Bangla support
});

// POST /api/admin/seed-packs — import seed_data/*.json question packs on demand
// (for when files are uploaded after the initial seed)
router.post('/seed-packs', (req, res) => {
  const fs = require('fs');
  const path = require('path');
  const { db } = require('../db');
  const packDir = path.join(__dirname, '..', '..', 'seed_data');
  if (!fs.existsSync(packDir)) return res.status(404).json({ error: 'seed_data folder পাওয়া যায়নি' });

  const packIns = db.prepare(`INSERT INTO questions
    (subject_id, chapter_id, topic_id, question_text, option_a, option_b, option_c, option_d,
     correct_option, explanation, marks, difficulty, tags, prev_year, year, unit, source, origin, status, created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'user', 'published', NULL)`);

  let imported = 0, files = 0;
  const errors = [];
  const existing = new Set(db.prepare('SELECT question_text, subject_id, year FROM questions').all()
    .map(r => r.question_text + '|' + r.subject_id + '|' + r.year));

  for (const f of fs.readdirSync(packDir).filter(f => f.endsWith('.json')).sort()) {
    try {
      const items = JSON.parse(fs.readFileSync(path.join(packDir, f), 'utf8')).questions || [];
      let added = 0;
      const tx = db.transaction((list) => {
        for (const b of list) {
          const key = String(b.question_text || '').trim() + '|' + b.subject_id + '|' + (b.year || '');
          if (existing.has(key)) continue; // skip duplicates
          if (!b.question_text || !b.option_a) continue;
          packIns.run(b.subject_id, b.chapter_id || null, b.topic_id || null,
            String(b.question_text).trim(),
            String(b.option_a || '').trim(), String(b.option_b || '').trim(),
            String(b.option_c || '').trim(), String(b.option_d || '').trim(),
            b.correct_option || null, (b.explanation || '').trim() || null,
            Number(b.marks || 1), b.difficulty || 'medium', b.tags || null,
            (b.prev_year || b.year || b.source) ? 1 : 0, b.year || null, b.unit || null, b.source || null);
          existing.add(key);
          added++;
        }
      });
      tx(items);
      imported += added; files++;
    } catch (e) { errors.push(f + ': ' + e.message); }
  }
  db.prepare(`INSERT INTO audit_log (actor_id, action, target_type, details) VALUES (?,?,?,?)`)
    .run(req.user.id, 'seed-packs.import', 'question', `files=${files} imported=${imported}`);
  res.json({ files, imported, errors });
});

module.exports = router;
