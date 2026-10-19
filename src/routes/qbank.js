// GET /api/qbank — question bank browser (public, requires login)
// Query params: unit (e.g. DU-B), year (e.g. 2025), subject_id, page, limit
// GET /api/qbank/units — list available units with counts
const express = require('express');
const router = express.Router();
const { db } = require('../db');
const { requireAuth, apiLimiter } = require('../auth');

// List units with question counts (for cards)
router.get('/units', requireAuth, apiLimiter, (req, res) => {
  const rows = db.prepare(`
    SELECT unit, COUNT(*) c, COUNT(DISTINCT year) years,
           MIN(year) min_year, MAX(year) max_year
    FROM questions
    WHERE status = 'published' AND unit IS NOT NULL AND unit != ''
    GROUP BY unit ORDER BY c DESC
  `).all();
  res.json(rows);
});

// List years for a unit
router.get('/units/:unit/years', requireAuth, apiLimiter, (req, res) => {
  const rows = db.prepare(`
    SELECT year, COUNT(*) c FROM questions
    WHERE status = 'published' AND unit = ?
    GROUP BY year ORDER BY year DESC
  `).all(req.params.unit);
  res.json(rows);
});

// Get questions: /api/qbank?unit=DU-B&year=2025&page=1&limit=50
router.get('/', requireAuth, apiLimiter, (req, res) => {
  const { unit, year, subject_id } = req.query;
  const page = Math.max(1, parseInt(req.query.page || '1', 10));
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || '50', 10)));
  const where = ["status = 'published'"];
  const params = [];
  if (unit) { where.push('unit = ?'); params.push(unit); }
  if (year && /^\d{4}$/.test(year)) { where.push('year = ?'); params.push(Number(year)); }
  if (subject_id && /^\d+$/.test(subject_id)) { where.push('subject_id = ?'); params.push(Number(subject_id)); }
  const whereSql = 'WHERE ' + where.join(' AND ');
  const total = db.prepare(`SELECT COUNT(*) c FROM questions ${whereSql}`).get(...params).c;
  const rows = db.prepare(
    `SELECT id, question_text, option_a, option_b, option_c, option_d,
            correct_option, explanation, year, unit, tags, difficulty, marks
     FROM questions ${whereSql} ORDER BY id LIMIT ? OFFSET ?`
  ).all(...params, limit, (page - 1) * limit);
  res.json({ total, page, limit, questions: rows });
});

module.exports = router;
