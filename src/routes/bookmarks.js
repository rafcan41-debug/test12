// Bookmarks: save questions, list, remove, re-attempt via practice
const express = require('express');
const { db } = require('../db');
const { requireAuth } = require('../auth');

const router = express.Router();

function stripQ(q) {
  if (!q) return q;
  const { correct_option, explanation, ...rest } = q;
  return rest;
}

router.get('/', requireAuth, (req, res) => {
  const rows = db.prepare(
    `SELECT b.id AS bookmark_id, b.created_at AS saved_at, q.id, q.subject_id, q.chapter_id,
            q.topic_id, q.question_text, q.option_a, q.option_b, q.option_c, q.option_d, q.marks, q.difficulty
     FROM bookmarks b JOIN questions q ON q.id = b.question_id
     WHERE b.user_id = ? AND q.status = 'published' ORDER BY b.id DESC`
  ).all(req.user.id);
  res.json({ bookmarks: rows.map(stripQ) });
});

router.post('/', requireAuth, (req, res) => {
  const { question_id } = req.body || {};
  const q = db.prepare("SELECT id FROM questions WHERE id = ? AND status = 'published'").get(question_id);
  if (!q) return res.status(404).json({ error: 'প্রশ্ন পাওয়া যায়নি' });
  db.prepare('INSERT OR IGNORE INTO bookmarks (user_id, question_id) VALUES (?,?)')
    .run(req.user.id, q.id);
  res.status(201).json({ ok: true });
});

router.delete('/:questionId', requireAuth, (req, res) => {
  db.prepare('DELETE FROM bookmarks WHERE user_id = ? AND question_id = ?')
    .run(req.user.id, req.params.questionId);
  res.json({ ok: true });
});

module.exports = router;
