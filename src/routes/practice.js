// Practice engine: topic-wise sessions, instant feedback + explanation, history
const express = require('express');
const { db } = require('../db');
const { requireAuth } = require('../auth');
const { checkAndUse } = require('../caps');
const { isDifficulty } = require('../validate');

const router = express.Router();
const FREE_PRACTICE_PER_DAY = parseInt(process.env.FREE_PRACTICE_PER_DAY || '20', 10);

function stripQ(q) {
  const { correct_option, explanation, ...rest } = q;
  return rest;
}

// Start a practice session with filtered published questions
router.post('/start', requireAuth, (req, res) => {
  const f = req.body || {};
  const limit = Math.min(50, Math.max(1, parseInt(f.limit || 10, 10)));
  const where = ["q.status = 'published'"];
  const params = [];
  if (f.subject_id) { where.push('q.subject_id = ?'); params.push(f.subject_id); }
  if (f.chapter_id) { where.push('q.chapter_id = ?'); params.push(f.chapter_id); }
  if (f.topic_id) { where.push('q.topic_id = ?'); params.push(f.topic_id); }
  if (f.difficulty && isDifficulty(f.difficulty)) { where.push('q.difficulty = ?'); params.push(f.difficulty); }
  if (f.year && Number.isInteger(Number(f.year))) { where.push('q.year = ?'); params.push(Number(f.year)); }
  if (f.source && String(f.source).trim()) { where.push('q.source LIKE ?'); params.push(`%${String(f.source).trim()}%`); }
  if (f.prev_year) { where.push('q.prev_year = 1'); }
  const rows = db.prepare(
    `SELECT id, subject_id, chapter_id, topic_id, question_text, option_a, option_b, option_c, option_d, marks, difficulty
     FROM questions q WHERE ${where.join(' AND ')} ORDER BY RANDOM() LIMIT ${limit}`
  ).all(...params);
  if (!rows.length) return res.status(400).json({ error: 'এই ফিল্টারে কোনো প্রশ্ন নেই' });

  // Cap is on answers, not session start — checked per answer. But reserve loosely:
  const cap = checkAndUse(req.user.id, req.user.plan, 'practice_answers', FREE_PRACTICE_PER_DAY);
  if (!cap.allowed) return res.status(403).json({ error: cap.error });
  // Refund the reservation (it was only a check); real increments happen per answer.
  db.prepare('UPDATE usage_counters SET practice_answers = practice_answers - 1 WHERE user_id = ? AND day = ?')
    .run(req.user.id, new Date().toISOString().slice(0, 10));

  const info = db.prepare('INSERT INTO practice_sessions (user_id, filters_json, total) VALUES (?,?,?)')
    .run(req.user.id, JSON.stringify(f), rows.length);
  res.status(201).json({ session_id: info.lastInsertRowid, questions: rows.map(stripQ) });
});

// Answer one question -> instant feedback with correct answer + explanation
router.post('/:sessionId/answer', requireAuth, (req, res) => {
  const sess = db.prepare('SELECT * FROM practice_sessions WHERE id = ?').get(req.params.sessionId);
  if (!sess || (sess.user_id !== req.user.id && req.user.role !== 'admin')) {
    return res.status(404).json({ error: 'সেশন পাওয়া যায়নি' });
  }
  if (sess.status !== 'open') return res.status(400).json({ error: 'সেশন শেষ হয়েছে' });
  const { question_id, selected } = req.body || {};
  if (!['a', 'b', 'c', 'd'].includes(selected)) {
    return res.status(400).json({ error: 'সঠিক অপশন দিন' });
  }
  const q = db.prepare("SELECT * FROM questions WHERE id = ? AND status = 'published'").get(question_id);
  if (!q) return res.status(404).json({ error: 'প্রশ্ন পাওয়া যায়নি' });
  const dup = db.prepare('SELECT id FROM practice_answers WHERE session_id = ? AND question_id = ?')
    .get(sess.id, q.id);
  if (dup) return res.status(400).json({ error: 'এই প্রশ্নের উত্তর দেওয়া হয়ে গেছে' });

  const cap = checkAndUse(req.user.id, req.user.plan, 'practice_answers', FREE_PRACTICE_PER_DAY);
  if (!cap.allowed) return res.status(403).json({ error: cap.error });

  const isCorrect = selected === q.correct_option ? 1 : 0;
  db.prepare('INSERT INTO practice_answers (session_id, question_id, selected, is_correct) VALUES (?,?,?,?)')
    .run(sess.id, q.id, selected, isCorrect);
  db.prepare('UPDATE practice_sessions SET correct = correct + ? WHERE id = ?').run(isCorrect, sess.id);

  res.json({
    correct: !!isCorrect,
    correct_option: q.correct_option,
    explanation: q.explanation || '',
    remaining_today: cap.remaining,
  });
});

router.post('/:sessionId/finish', requireAuth, (req, res) => {
  const sess = db.prepare('SELECT * FROM practice_sessions WHERE id = ?').get(req.params.sessionId);
  if (!sess || sess.user_id !== req.user.id) return res.status(404).json({ error: 'সেশন পাওয়া যায়নি' });
  const answered = db.prepare('SELECT COUNT(*) c FROM practice_answers WHERE session_id = ?').get(sess.id).c;
  db.prepare("UPDATE practice_sessions SET status = 'finished', finished_at = datetime('now') WHERE id = ?").run(sess.id);
  const fresh = db.prepare('SELECT * FROM practice_sessions WHERE id = ?').get(sess.id);
  res.json({ session: fresh, answered });
});

router.get('/history', requireAuth, (req, res) => {
  const rows = db.prepare(
    `SELECT id, filters_json, status, total, correct, created_at, finished_at
     FROM practice_sessions WHERE user_id = ? ORDER BY id DESC LIMIT 30`
  ).all(req.user.id);
  res.json({ sessions: rows });
});

module.exports = router;
