// Question bank: filtered fetch (answers stripped for students), teacher/admin CRUD + import
const express = require('express');
const { db } = require('../db');
const { requireAuth, requireRole } = require('../auth');
const { apiLimiter } = require('../ratelimit');
const { isNonEmpty, isOption, isDifficulty, isInt } = require('../validate');
const { notify } = require('../notify');

const router = express.Router();

// Strip answer key for students (never leak before submit/feedback)
function stripForStudent(q, role) {
  if (!q) return q;
  if (role === 'student') {
    const { correct_option, explanation, ...rest } = q;
    return rest;
  }
  return q;
}

function validateQuestionBody(b) {
  const errs = [];
  if (!isInt(b.subject_id, 1)) errs.push('subject_id');
  if (!isNonEmpty(b.question_text, 2000)) errs.push('question_text');
  for (const o of ['option_a', 'option_b', 'option_c', 'option_d']) {
    if (!isNonEmpty(b[o], 1000)) errs.push(o);
  }
  if (!isOption(b.correct_option)) errs.push('correct_option');
  if (b.marks !== undefined && !(Number(b.marks) > 0 && Number(b.marks) <= 100)) errs.push('marks');
  if (b.difficulty !== undefined && !isDifficulty(b.difficulty)) errs.push('difficulty');
  if (b.status !== undefined && !['draft', 'published', 'archived'].includes(b.status)) errs.push('status');
  if (b.year !== undefined && b.year !== null && b.year !== '' && !isInt(Number(b.year), 1900, 2100)) errs.push('year');
  if (b.source !== undefined && b.source !== null && String(b.source).length > 200) errs.push('source');
  return errs;
}

// Normalize year/source from request body (null when empty)
function normYearSource(b) {
  const year = b.year === undefined || b.year === null || b.year === '' ? null : Number(b.year);
  const source = b.source === undefined || b.source === null || String(b.source).trim() === ''
    ? null : String(b.source).trim().slice(0, 200);
  return { year, source };
}

// GET /api/questions?subject_id=&chapter_id=&topic_id=&difficulty=&prev_year=&year=&source=&q=&page=&limit=
// Auth required + rate limited. Students see published only, answers stripped.
router.get('/', requireAuth, apiLimiter, (req, res) => {
  const { subject_id, chapter_id, topic_id, difficulty, prev_year, year, source, q, status } = req.query;
  const page = Math.max(1, parseInt(req.query.page || '1', 10));
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || '20', 10)));
  const where = [];
  const params = [];
  if (req.user.role === 'student') { where.push("q.status = 'published'"); }
  if (subject_id) { where.push('q.subject_id = ?'); params.push(subject_id); }
  if (chapter_id) { where.push('q.chapter_id = ?'); params.push(chapter_id); }
  if (topic_id) { where.push('q.topic_id = ?'); params.push(topic_id); }
  if (difficulty && isDifficulty(difficulty)) { where.push('q.difficulty = ?'); params.push(difficulty); }
  if (prev_year === '1') { where.push('q.prev_year = 1'); }
  if (year && isInt(Number(year), 1900, 2100)) { where.push('q.year = ?'); params.push(Number(year)); }
  if (source && String(source).trim()) { where.push('q.source LIKE ?'); params.push(`%${String(source).trim()}%`); }
  if (status && ['draft', 'published', 'archived'].includes(status) && req.user.role !== 'student') {
    where.push('q.status = ?'); params.push(status);
  }
  if (q && q.trim()) { where.push('q.question_text LIKE ?'); params.push(`%${q.trim()}%`); }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const total = db.prepare(`SELECT COUNT(*) c FROM questions q ${whereSql}`).get(...params).c;
  const rows = db.prepare(
    `SELECT q.*, s.name_bn AS subject_name FROM questions q
     LEFT JOIN subjects s ON s.id = q.subject_id
     ${whereSql} ORDER BY q.id DESC LIMIT ? OFFSET ?`
  ).all(...params, limit, (page - 1) * limit);
  res.json({
    total, page, limit,
    questions: rows.map((r) => stripForStudent(r, req.user.role)),
  });
});

router.get('/:id', requireAuth, apiLimiter, (req, res) => {
  const q = db.prepare('SELECT * FROM questions WHERE id = ?').get(req.params.id);
  if (!q) return res.status(404).json({ error: 'প্রশ্ন পাওয়া যায়নি' });
  if (req.user.role === 'student' && q.status !== 'published') {
    return res.status(403).json({ error: 'অনুমতি নেই' });
  }
  res.json({ question: stripForStudent(q, req.user.role) });
});

// Create (teacher/admin). Teachers' questions start as draft; admins can publish directly.
router.post('/', requireAuth, requireRole('teacher', 'admin'), (req, res) => {
  const b = req.body || {};
  const errs = validateQuestionBody(b);
  if (errs.length) return res.status(400).json({ error: 'ভুল ফিল্ড: ' + errs.join(', ') });
  const sub = db.prepare('SELECT id FROM subjects WHERE id = ?').get(b.subject_id);
  if (!sub) return res.status(400).json({ error: 'বিষয় পাওয়া যায়নি' });
  const status = req.user.role === 'admin' && b.status ? b.status : 'draft';
  const { year, source } = normYearSource(b);
  const info = db.prepare(`INSERT INTO questions
    (subject_id, chapter_id, topic_id, question_text, option_a, option_b, option_c, option_d,
     correct_option, explanation, marks, difficulty, tags, prev_year, year, source, origin, status, created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'user', ?, ?)`)
    .run(
      b.subject_id, b.chapter_id || null, b.topic_id || null, b.question_text.trim(),
      b.option_a.trim(), b.option_b.trim(), b.option_c.trim(), b.option_d.trim(),
      b.correct_option, (b.explanation || '').trim() || null,
      Number(b.marks || 1), b.difficulty || 'medium', b.tags || null,
      (b.prev_year || year || source) ? 1 : 0, year, source, status, req.user.id
    );
  db.prepare(`INSERT INTO audit_log (actor_id, action, target_type, target_id, details)
    VALUES (?,?,?,?,?)`).run(req.user.id, 'question.create', 'question', info.lastInsertRowid, b.question_text.slice(0, 120));
  res.status(201).json({ question: db.prepare('SELECT * FROM questions WHERE id = ?').get(info.lastInsertRowid) });
});

// Bulk import (teacher/admin): { questions: [ ...same shape as create... ] }
router.post('/import', requireAuth, requireRole('teacher', 'admin'), (req, res) => {
  const list = (req.body || {}).questions;
  if (!Array.isArray(list) || list.length === 0 || list.length > 500) {
    return res.status(400).json({ error: 'questions অ্যারে দিন (সর্বোচ্চ ৫০০টি)' });
  }
  const ins = db.prepare(`INSERT INTO questions
    (subject_id, chapter_id, topic_id, question_text, option_a, option_b, option_c, option_d,
     correct_option, explanation, marks, difficulty, tags, prev_year, year, source, origin, status, created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'user', 'draft', ?)`);
  let added = 0;
  const errors = [];
  const tx = db.transaction((items) => {
    items.forEach((b, i) => {
      const errs = validateQuestionBody(b);
      if (errs.length) { errors.push({ index: i, fields: errs }); return; }
      const { year, source } = normYearSource(b);
      ins.run(
        b.subject_id, b.chapter_id || null, b.topic_id || null, b.question_text.trim(),
        b.option_a.trim(), b.option_b.trim(), b.option_c.trim(), b.option_d.trim(),
        b.correct_option, (b.explanation || '').trim() || null,
        Number(b.marks || 1), b.difficulty || 'medium', b.tags || null,
        (b.prev_year || year || source) ? 1 : 0, year, source, req.user.id
      );
      added += 1;
    });
  });
  tx(list);
  db.prepare(`INSERT INTO audit_log (actor_id, action, target_type, details) VALUES (?,?,?,?)`)
    .run(req.user.id, 'question.import', 'question', `added=${added} errors=${errors.length}`);
  res.json({ added, errors });
});

router.put('/:id', requireAuth, requireRole('teacher', 'admin'), (req, res) => {
  const q = db.prepare('SELECT * FROM questions WHERE id = ?').get(req.params.id);
  if (!q) return res.status(404).json({ error: 'প্রশ্ন পাওয়া যায়নি' });
  if (req.user.role === 'teacher' && q.created_by !== req.user.id) {
    return res.status(403).json({ error: 'শুধু নিজের প্রশ্ন সম্পাদনা করা যাবে' });
  }
  const b = req.body || {};
  const errs = validateQuestionBody({ ...q, ...b });
  if (errs.length) return res.status(400).json({ error: 'ভুল ফিল্ড: ' + errs.join(', ') });
  // Teachers cannot publish directly
  const status = req.user.role === 'admin' && b.status ? b.status
    : (b.status === 'draft' || b.status === 'archived' ? b.status : q.status);
  const { year, source } = normYearSource({ year: b.year !== undefined ? b.year : q.year, source: b.source !== undefined ? b.source : q.source });
  const prevYear = b.prev_year !== undefined ? (b.prev_year ? 1 : 0)
    : ((year || source) ? 1 : q.prev_year);
  db.prepare(`UPDATE questions SET subject_id=?, chapter_id=?, topic_id=?, question_text=?,
    option_a=?, option_b=?, option_c=?, option_d=?, correct_option=?, explanation=?,
    marks=?, difficulty=?, tags=?, prev_year=?, year=?, source=?, status=? WHERE id=?`)
    .run(
      b.subject_id ?? q.subject_id, b.chapter_id ?? q.chapter_id, b.topic_id ?? q.topic_id,
      (b.question_text ?? q.question_text).trim(),
      (b.option_a ?? q.option_a).trim(), (b.option_b ?? q.option_b).trim(),
      (b.option_c ?? q.option_c).trim(), (b.option_d ?? q.option_d).trim(),
      b.correct_option ?? q.correct_option, (b.explanation ?? q.explanation ?? '').trim() || null,
      Number(b.marks ?? q.marks), b.difficulty ?? q.difficulty, b.tags ?? q.tags,
      prevYear, year, source,
      status, q.id
    );
  db.prepare(`INSERT INTO audit_log (actor_id, action, target_type, target_id) VALUES (?,?,?,?)`)
    .run(req.user.id, 'question.update', 'question', q.id);
  res.json({ question: db.prepare('SELECT * FROM questions WHERE id = ?').get(q.id) });
});

// Delete: hard delete only if unused; otherwise archive
router.delete('/:id', requireAuth, requireRole('teacher', 'admin'), (req, res) => {
  const q = db.prepare('SELECT * FROM questions WHERE id = ?').get(req.params.id);
  if (!q) return res.status(404).json({ error: 'প্রশ্ন পাওয়া যায়নি' });
  if (req.user.role === 'teacher' && q.created_by !== req.user.id) {
    return res.status(403).json({ error: 'শুধু নিজের প্রশ্ন মুছতে পারবেন' });
  }
  const used = db.prepare('SELECT COUNT(*) c FROM exam_questions WHERE question_id = ?').get(q.id).c
    + db.prepare('SELECT COUNT(*) c FROM practice_answers WHERE question_id = ?').get(q.id).c
    + db.prepare('SELECT COUNT(*) c FROM bookmarks WHERE question_id = ?').get(q.id).c;
  if (used > 0) {
    db.prepare("UPDATE questions SET status = 'archived' WHERE id = ?").run(q.id);
    return res.json({ archived: true, message: 'প্রশ্নটি ব্যবহৃত হয়েছে, আর্কাইভ করা হলো' });
  }
  db.prepare('DELETE FROM questions WHERE id = ?').run(q.id);
  db.prepare(`INSERT INTO audit_log (actor_id, action, target_type, target_id) VALUES (?,?,?,?)`)
    .run(req.user.id, 'question.delete', 'question', q.id);
  res.json({ deleted: true });
});

// Publish / archive shortcut (admin only for publish)
router.post('/:id/publish', requireAuth, requireRole('admin'), (req, res) => {
  const q = db.prepare('SELECT * FROM questions WHERE id = ?').get(req.params.id);
  if (!q) return res.status(404).json({ error: 'প্রশ্ন পাওয়া যায়নি' });
  db.prepare("UPDATE questions SET status = 'published' WHERE id = ?").run(q.id);
  db.prepare(`INSERT INTO audit_log (actor_id, action, target_type, target_id) VALUES (?,?,?,?)`)
    .run(req.user.id, 'question.publish', 'question', q.id);
  res.json({ ok: true });
});

module.exports = router;
