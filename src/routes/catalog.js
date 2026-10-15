// Public catalog: categories -> subjects -> chapters -> topics
const express = require('express');
const { db } = require('../db');

const router = express.Router();

// Full nested tree (small dataset; fine for Phase 1)
router.get('/', (req, res) => {
  const cats = db.prepare('SELECT * FROM categories ORDER BY sort, id').all();
  const subs = db.prepare('SELECT * FROM subjects ORDER BY id').all();
  const chs = db.prepare('SELECT * FROM chapters ORDER BY id').all();
  const tps = db.prepare('SELECT * FROM topics ORDER BY id').all();

  const topicByChapter = {};
  for (const t of tps) (topicByChapter[t.chapter_id] = topicByChapter[t.chapter_id] || []).push(t);
  const chapterBySubject = {};
  for (const c of chs) {
    c.topics = topicByChapter[c.id] || [];
    (chapterBySubject[c.subject_id] = chapterBySubject[c.subject_id] || []).push(c);
  }
  const subjectByCat = {};
  for (const s of subs) {
    s.chapters = chapterBySubject[s.id] || [];
    (subjectByCat[s.category_id] = subjectByCat[s.category_id] || []).push(s);
  }
  for (const c of cats) c.subjects = subjectByCat[c.id] || [];
  res.json({ categories: cats });
});

module.exports = router;
