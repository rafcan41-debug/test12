// Leaderboards: exam-wise + daily/weekly/monthly. Tie-break: score desc, time asc, submitted asc.
const express = require('express');
const { db } = require('../db');
const { requireAuth } = require('../auth');

const router = express.Router();

function rankRows(rows, scoreKey = 'score') {
  // rows must be pre-sorted; attach rank with dense ranking on (score, time, submitted)
  let rank = 0;
  let prev = null;
  return rows.map((r) => {
    const key = `${r[scoreKey]}|${r.time_taken_sec}|${r.submitted_at}`;
    if (key !== prev) { rank += 1; prev = key; }
    return { ...r, rank };
  });
}

router.get('/exam/:examId', requireAuth, (req, res) => {
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || '20', 10)));
  const rows = db.prepare(
    `SELECT a.user_id, u.name, a.score, a.total_marks, a.percentage, a.time_taken_sec, a.submitted_at
     FROM attempts a JOIN users u ON u.id = a.user_id
     WHERE a.exam_id = ? AND a.status = 'submitted'
     ORDER BY a.score DESC, a.time_taken_sec ASC, a.submitted_at ASC LIMIT ?`
  ).all(req.params.examId, limit);
  res.json({ leaderboard: rankRows(rows) });
});

router.get('/period', requireAuth, (req, res) => {
  const range = req.query.range === 'weekly' ? 'weekly' : req.query.range === 'monthly' ? 'monthly' : 'daily';
  const since = range === 'daily' ? "datetime('now','-1 day')"
    : range === 'weekly' ? "datetime('now','-7 days')" : "datetime('now','-30 days')";
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || '20', 10)));
  const rows = db.prepare(
    `SELECT a.user_id, u.name, SUM(a.score) AS score, COUNT(*) AS exams_taken,
            SUM(a.time_taken_sec) AS time_taken_sec, MAX(a.submitted_at) AS submitted_at
     FROM attempts a JOIN users u ON u.id = a.user_id
     WHERE a.status = 'submitted' AND a.submitted_at > ${since}
     GROUP BY a.user_id
     ORDER BY score DESC, time_taken_sec ASC LIMIT ?`
  ).all(limit);
  res.json({ range, leaderboard: rankRows(rows) });
});

module.exports = router;
