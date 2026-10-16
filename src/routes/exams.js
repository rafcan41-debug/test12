// Exam engine: CRUD, publish, start (timed snapshot), autosave, server-side submit/scoring
const express = require('express');
const { db } = require('../db');
const { requireAuth, requireRole } = require('../auth');
const { isNonEmpty, isInt } = require('../validate');
const { checkAndUse } = require('../caps');
const { notify, notifyAll } = require('../notify');

const router = express.Router();
const FREE_EXAMS_PER_DAY = parseInt(process.env.FREE_EXAMS_PER_DAY || '3', 10);

// --- helpers ---------------------------------------------------------------

function stripQ(q) {
  const { correct_option, explanation, ...rest } = q;
  return rest;
}

function examVisible(exam, role) {
  return role !== 'student' || exam.status === 'published';
}

// Resolve the question set for an attempt (snapshot at start)
function resolveQuestions(exam) {
  if (exam.selection_mode === 'fixed') {
    return db.prepare(
      `SELECT q.id, q.marks FROM exam_questions eq
       JOIN questions q ON q.id = eq.question_id
       WHERE eq.exam_id = ? ORDER BY eq.sort_order`
    ).all(exam.id);
  }
  const f = JSON.parse(exam.filter_json || '{}');
  const where = ["q.status = 'published'"];
  const params = [];
  const inList = (ids) => ids.map(() => '?').join(',');
  const arrOf = (v) => (Array.isArray(v) ? v : (v ? [v] : [])).map(Number).filter((n) => n > 0);
  const sIds = arrOf(f.subject_ids && f.subject_ids.length ? f.subject_ids : f.subject_id);
  const cIds = arrOf(f.chapter_ids && f.chapter_ids.length ? f.chapter_ids : f.chapter_id);
  const tIds = arrOf(f.topic_ids && f.topic_ids.length ? f.topic_ids : f.topic_id);
  if (sIds.length) { where.push(`q.subject_id IN (${inList(sIds)})`); params.push(...sIds); }
  if (cIds.length) { where.push(`q.chapter_id IN (${inList(cIds)})`); params.push(...cIds); }
  if (tIds.length) { where.push(`q.topic_id IN (${inList(tIds)})`); params.push(...tIds); }
  if (f.difficulty) { where.push('q.difficulty = ?'); params.push(f.difficulty); }
  if (f.prev_year) { where.push('q.prev_year = 1'); }
  if (f.year && Number.isInteger(Number(f.year))) { where.push('q.year = ?'); params.push(Number(f.year)); }
  if (f.source && String(f.source).trim()) { where.push('q.source LIKE ?'); params.push(`%${String(f.source).trim()}%`); }
  const limit = Math.min(200, Math.max(1, parseInt(f.limit || exam.question_limit || 20, 10)));
  return db.prepare(
    `SELECT q.id, q.marks FROM questions q WHERE ${where.join(' AND ')} ORDER BY RANDOM() LIMIT ${limit}`
  ).all(...params);
}

function fetchStripped(ids) {
  if (!ids.length) return [];
  const rows = db.prepare(
    `SELECT id, subject_id, chapter_id, topic_id, question_text, option_a, option_b, option_c, option_d, marks, difficulty
     FROM questions WHERE id IN (${ids.map(() => '?').join(',')})`
  ).all(...ids);
  const order = new Map(ids.map((id, i) => [id, i]));
  return rows.sort((a, b) => order.get(a.id) - order.get(b.id)).map(stripQ);
}

function getAttemptOwned(attemptId, userId, role) {
  const a = db.prepare('SELECT * FROM attempts WHERE id = ?').get(attemptId);
  if (!a) return { error: 404 };
  if (a.user_id !== userId && role !== 'admin') return { error: 403 };
  return { attempt: a };
}

// --- custom exam -------------------------------------------------------------
// Student builds their own test: multi-select subjects/chapters/topics + question count.
// Finds or creates a hidden auto exam, returns its id. exam.html?id= works as-is.
router.post('/custom', requireAuth, (req, res) => {
  const b = req.body || {};
  const subjectIds = (Array.isArray(b.subject_ids) ? b.subject_ids : []).map(Number).filter((n) => n > 0);
  const chapterIds = (Array.isArray(b.chapter_ids) ? b.chapter_ids : []).map(Number).filter((n) => n > 0);
  const topicIds = (Array.isArray(b.topic_ids) ? b.topic_ids : []).map(Number).filter((n) => n > 0);
  if (!subjectIds.length) return res.status(400).json({ error: 'কমপক্ষে একটি বিষয় বাছাই করো' });

  const where = ["q.status = 'published'"];
  const params = [];
  const inList = (ids) => ids.map(() => '?').join(',');
  where.push(`q.subject_id IN (${inList(subjectIds)})`);
  params.push(...subjectIds);
  if (chapterIds.length) { where.push(`q.chapter_id IN (${inList(chapterIds)})`); params.push(...chapterIds); }
  if (topicIds.length) { where.push(`q.topic_id IN (${inList(topicIds)})`); params.push(...topicIds); }

  const avail = db.prepare(`SELECT COUNT(*) c FROM questions q WHERE ${where.join(' AND ')}`).get(...params).c;
  if (!avail) {
    if (subjectIds.some((id) => id >= 200)) return res.status(400).json({ error: 'এই বিষয়ের প্রশ্ন শীঘ্রই আসছে 📚' });
    return res.status(400).json({ error: 'এই নির্বাচনে কোনো প্রশ্ন নেই' });
  }
  const limit = Math.min(200, Math.max(5, parseInt(b.limit, 10) || 20), avail);

  const filter = { subject_ids: subjectIds, limit };
  if (chapterIds.length) filter.chapter_ids = chapterIds;
  if (topicIds.length) filter.topic_ids = topicIds;
  const key = JSON.stringify(filter);

  let exam = db.prepare('SELECT * FROM exams WHERE is_auto = 1 AND filter_json = ?').get(key);
  if (!exam) {
    const subNames = db.prepare(
      `SELECT name_bn FROM subjects WHERE id IN (${inList(subjectIds)})`
    ).all(...subjectIds).map((s) => s.name_bn).slice(0, 3).join(', ');
    const title = `🎯 কাস্টম টেস্ট — ${subNames}${subjectIds.length > 3 ? '…' : ''} (${limit}টি)`;
    const firstSub = db.prepare('SELECT category_id FROM subjects WHERE id = ?').get(subjectIds[0]);
    const info = db.prepare(`INSERT INTO exams
      (title, title_en, category_id, duration_min, negative_mark, pass_marks,
       selection_mode, filter_json, question_limit, status, is_auto, created_by)
      VALUES (?,?,?,?,?,?,?,?,?, 'published', 1, ?)`)
      .run(title, 'Custom Test', firstSub ? firstSub.category_id : null,
        Math.max(10, limit), 0.25, Math.ceil(limit * 0.4),
        'filter', key, limit, req.user.id);
    exam = db.prepare('SELECT * FROM exams WHERE id = ?').get(info.lastInsertRowid);
  }
  res.json({ exam_id: exam.id, available: avail, limit });
});

// --- exam catalog ----------------------------------------------------------

router.get('/', requireAuth, (req, res) => {
  const where = req.user.role === 'student'
    ? "WHERE e.status = 'published' AND e.is_auto = 0"
    : 'WHERE e.is_auto = 0'; // hide auto quick-tests from the browse list
  const exams = db.prepare(
    `SELECT e.*, c.name_bn AS category_name FROM exams e
     LEFT JOIN categories c ON c.id = e.category_id ${where} ORDER BY e.id DESC`
  ).all();
  res.json({ exams });
});

router.get('/:id', requireAuth, (req, res) => {
  const exam = db.prepare('SELECT * FROM exams WHERE id = ?').get(req.params.id);
  if (!exam || !examVisible(exam, req.user.role)) {
    return res.status(404).json({ error: 'পরীক্ষা পাওয়া যায়নি' });
  }
  res.json({ exam });
});

// My attempts for an exam
router.get('/:id/my-attempts', requireAuth, (req, res) => {
  const rows = db.prepare(
    `SELECT id, status, score, total_marks, percentage, passed, started_at, submitted_at, time_taken_sec
     FROM attempts WHERE exam_id = ? AND user_id = ? ORDER BY id DESC`
  ).all(req.params.id, req.user.id);
  res.json({ attempts: rows });
});

// --- exam authoring (teacher/admin) -----------------------------------------

router.post('/', requireAuth, requireRole('teacher', 'admin'), (req, res) => {
  const b = req.body || {};
  if (!isNonEmpty(b.title, 200)) return res.status(400).json({ error: 'পরীক্ষার শিরোনাম দিন' });
  if (!isInt(b.duration_min, 1, 600)) return res.status(400).json({ error: 'সময় (মিনিট) ১–৬০০ হতে হবে' });
  const mode = b.selection_mode === 'fixed' ? 'fixed' : 'filter';
  const filter = mode === 'filter' ? (b.filter || {}) : null;
  const info = db.prepare(`INSERT INTO exams
    (title, title_en, category_id, duration_min, negative_mark, pass_marks,
     selection_mode, filter_json, question_limit, status, created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(
      b.title.trim(), b.title_en || null, b.category_id || null,
      b.duration_min, Number(b.negative_mark || 0), Number(b.pass_marks || 0),
      mode, filter ? JSON.stringify(filter) : null,
      parseInt(b.question_limit || (filter && filter.limit) || 20, 10),
      'draft', req.user.id
    );
  const examId = info.lastInsertRowid;
  if (mode === 'fixed' && Array.isArray(b.question_ids)) {
    const ins = db.prepare('INSERT OR IGNORE INTO exam_questions (exam_id, question_id, sort_order) VALUES (?,?,?)');
    const tx = db.transaction((ids) => ids.forEach((qid, i) => ins.run(examId, qid, i)));
    tx(b.question_ids.slice(0, 200));
  }
  db.prepare(`INSERT INTO audit_log (actor_id, action, target_type, target_id) VALUES (?,?,?,?)`)
    .run(req.user.id, 'exam.create', 'exam', examId);
  res.status(201).json({ exam: db.prepare('SELECT * FROM exams WHERE id = ?').get(examId) });
});

router.put('/:id', requireAuth, requireRole('teacher', 'admin'), (req, res) => {
  const exam = db.prepare('SELECT * FROM exams WHERE id = ?').get(req.params.id);
  if (!exam) return res.status(404).json({ error: 'পরীক্ষা পাওয়া যায়নি' });
  if (req.user.role === 'teacher' && exam.created_by !== req.user.id) {
    return res.status(403).json({ error: 'শুধু নিজের পরীক্ষা সম্পাদনা করা যাবে' });
  }
  const b = req.body || {};
  db.prepare(`UPDATE exams SET title=COALESCE(?,title), title_en=?, category_id=COALESCE(?,category_id),
    duration_min=COALESCE(?,duration_min), negative_mark=COALESCE(?,negative_mark),
    pass_marks=COALESCE(?,pass_marks), question_limit=COALESCE(?,question_limit) WHERE id=?`)
    .run(
      b.title ? b.title.trim() : null, b.title_en ?? exam.title_en,
      b.category_id || null, b.duration_min || null, b.negative_mark ?? null,
      b.pass_marks ?? null, b.question_limit || null, exam.id
    );
  if (b.question_ids && exam.selection_mode === 'fixed') {
    db.prepare('DELETE FROM exam_questions WHERE exam_id = ?').run(exam.id);
    const ins = db.prepare('INSERT INTO exam_questions (exam_id, question_id, sort_order) VALUES (?,?,?)');
    const tx = db.transaction((ids) => ids.forEach((qid, i) => ins.run(exam.id, qid, i)));
    tx(b.question_ids.slice(0, 200));
  }
  db.prepare(`INSERT INTO audit_log (actor_id, action, target_type, target_id) VALUES (?,?,?,?)`)
    .run(req.user.id, 'exam.update', 'exam', exam.id);
  res.json({ exam: db.prepare('SELECT * FROM exams WHERE id = ?').get(exam.id) });
});

function setExamStatus(req, res, status) {
  const exam = db.prepare('SELECT * FROM exams WHERE id = ?').get(req.params.id);
  if (!exam) return res.status(404).json({ error: 'পরীক্ষা পাওয়া যায়নি' });
  if (req.user.role === 'teacher' && exam.created_by !== req.user.id) {
    return res.status(403).json({ error: 'অনুমতি নেই' });
  }
  db.prepare('UPDATE exams SET status = ? WHERE id = ?').run(status, exam.id);
  db.prepare(`INSERT INTO audit_log (actor_id, action, target_type, target_id) VALUES (?,?,?,?)`)
    .run(req.user.id, `exam.${status}`, 'exam', exam.id);
  if (status === 'published') {
    notifyAll('নতুন পরীক্ষা প্রকাশিত হয়েছে', `“${exam.title}” — এখনই অংশ নিন!`, 'exam');
  }
  res.json({ ok: true });
}
router.post('/:id/publish', requireAuth, requireRole('teacher', 'admin'), (req, res) => setExamStatus(req, res, 'published'));
router.post('/:id/archive', requireAuth, requireRole('teacher', 'admin'), (req, res) => setExamStatus(req, res, 'archived'));

// --- quick chapter/class test ------------------------------------------------
// Ad-hoc test: student picks category -> subject -> chapter (+count).
// Finds or creates a hidden auto exam, returns its id. exam.html?id= works as-is.
router.post('/quick', requireAuth, (req, res) => {
  const subjectId = parseInt(req.body.subject_id, 10);
  const arrOf = (v) => (Array.isArray(v) ? v : (v ? [v] : [])).map(Number).filter((n) => n > 0);
  let chapterIds = arrOf(req.body.chapter_ids);
  if (!chapterIds.length && req.body.chapter_id) chapterIds = arrOf(req.body.chapter_id);
  const topicIds = arrOf(req.body.topic_ids);
  if (!subjectId) return res.status(400).json({ error: 'বিষয় বাছাই করো' });
  const sub = db.prepare(
    `SELECT s.*, c.name_bn AS cat_name FROM subjects s
     JOIN categories c ON c.id = s.category_id WHERE s.id = ?`).get(subjectId);
  if (!sub) return res.status(400).json({ error: 'বিষয় পাওয়া যায়নি' });
  const inList = (ids) => ids.map(() => '?').join(',');
  const filter = { subject_id: subjectId };
  let chapLabel = '';
  if (chapterIds.length) {
    const chs = db.prepare(`SELECT * FROM chapters WHERE subject_id = ? AND id IN (${inList(chapterIds)})`).all(subjectId, ...chapterIds);
    if (!chs.length) return res.status(400).json({ error: 'অধ্যায় পাওয়া যায়নি' });
    chapterIds = chs.map((c) => c.id);
    filter.chapter_ids = chapterIds;
    chapLabel = chs.length === 1 ? ' — ' + chs[0].name_bn : ` — ${chs.length}টি অধ্যায়`;
  }
  if (topicIds.length) {
    const tps = db.prepare(`SELECT t.* FROM topics t JOIN chapters c ON c.id = t.chapter_id WHERE c.subject_id = ? AND t.id IN (${inList(topicIds)})`).all(subjectId, ...topicIds);
    if (!tps.length) return res.status(400).json({ error: 'টপিক পাওয়া যায়নি' });
    filter.topic_ids = tps.map((t) => t.id);
    chapLabel += ` + ${tps.length}টি টপিক`;
  }
  const where = ["q.status = 'published'", 'q.subject_id = ?'];
  const params = [subjectId];
  if (chapterIds.length) { where.push(`q.chapter_id IN (${inList(chapterIds)})`); params.push(...chapterIds); }
  if (filter.topic_ids) { where.push(`q.topic_id IN (${inList(filter.topic_ids)})`); params.push(...filter.topic_ids); }
  const avail = db.prepare(`SELECT COUNT(*) c FROM questions q WHERE ${where.join(' AND ')}`).get(...params).c;
  if (!avail) {
    if (subjectId >= 200) return res.status(400).json({ error: 'এই বিষয়ের প্রশ্ন শীঘ্রই আসছে 📚' });
    return res.status(400).json({ error: 'এই নির্বাচনে কোনো প্রশ্ন নেই' });
  }
  const limit = Math.min(100, Math.max(5, parseInt(req.body.limit, 10) || 20), avail);
  filter.limit = limit;
  const key = JSON.stringify(filter);
  let exam = db.prepare('SELECT * FROM exams WHERE is_auto = 1 AND filter_json = ?').get(key);
  if (!exam) {
    const title = `⚡ ${sub.name_bn}${chapLabel} কুইক টেস্ট`;
    const info = db.prepare(`INSERT INTO exams
      (title, title_en, category_id, duration_min, negative_mark, pass_marks,
       selection_mode, filter_json, question_limit, status, is_auto, created_by)
      VALUES (?,?,?,?,?,?,?,?,?, 'published', 1, ?)`)
      .run(title, 'Quick Test', sub.category_id, limit, 0.25, Math.ceil(limit * 0.4),
        'filter', key, limit, req.user.id);
    exam = db.prepare('SELECT * FROM exams WHERE id = ?').get(info.lastInsertRowid);
  }
  res.json({ exam_id: exam.id });
});

// --- attempt lifecycle -------------------------------------------------------

// Start: enforces free daily cap, snapshots questions, sets ends_at
router.post('/:id/start', requireAuth, (req, res) => {
  const exam = db.prepare('SELECT * FROM exams WHERE id = ?').get(req.params.id);
  if (!exam || !examVisible(exam, req.user.role)) {
    return res.status(404).json({ error: 'পরীক্ষা পাওয়া যায়নি' });
  }
  const cap = checkAndUse(req.user.id, req.user.plan, 'exams_started', FREE_EXAMS_PER_DAY);
  if (!cap.allowed) return res.status(403).json({ error: cap.error });

  const qs = resolveQuestions(exam);
  if (!qs.length) return res.status(400).json({ error: 'এই পরীক্ষায় কোনো প্রশ্ন নেই' });

  const endsAt = new Date(Date.now() + exam.duration_min * 60000).toISOString();
  const info = db.prepare(`INSERT INTO attempts (user_id, exam_id, questions_json, ends_at)
    VALUES (?,?,?,?)`).run(req.user.id, exam.id, JSON.stringify(qs), endsAt);
  const attemptId = info.lastInsertRowid;
  res.status(201).json({
    attempt_id: attemptId,
    ends_at: endsAt,
    duration_min: exam.duration_min,
    negative_mark: exam.negative_mark,
    questions: fetchStripped(qs.map((x) => x.id)),
  });
});

// Get attempt state (resume after disconnect) — questions stripped, saved answers included
router.get('/attempts/:attemptId', requireAuth, (req, res) => {
  const { attempt, error } = getAttemptOwned(req.params.attemptId, req.user.id, req.user.role);
  if (error) return res.status(error).json({ error: 'অনুমতি নেই' });
  const qs = JSON.parse(attempt.questions_json).map((x) => x.id);
  const exam = db.prepare('SELECT id, title, duration_min, negative_mark, pass_marks FROM exams WHERE id = ?').get(attempt.exam_id);
  res.json({
    attempt: {
      id: attempt.id, exam_id: attempt.exam_id, status: attempt.status,
      started_at: attempt.started_at, ends_at: attempt.ends_at,
      submitted_at: attempt.submitted_at, time_taken_sec: attempt.time_taken_sec,
      score: attempt.score, total_marks: attempt.total_marks,
      correct_count: attempt.correct_count, wrong_count: attempt.wrong_count,
      unanswered_count: attempt.unanswered_count, percentage: attempt.percentage,
      passed: attempt.passed,
    },
    exam,
    questions: fetchStripped(qs),
    answers: JSON.parse(attempt.answers_json || '{}'),
  });
});

// Autosave draft answers (in_progress only)
router.post('/attempts/:attemptId/save', requireAuth, (req, res) => {
  const { attempt, error } = getAttemptOwned(req.params.attemptId, req.user.id, req.user.role);
  if (error) return res.status(error).json({ error: 'অনুমতি নেই' });
  if (attempt.status !== 'in_progress') return res.status(400).json({ error: 'পরীক্ষা ইতিমধ্যে জমা হয়েছে' });
  const answers = (req.body || {}).answers || {};
  const qs = JSON.parse(attempt.questions_json).map((x) => String(x.id));
  const clean = {};
  for (const [k, v] of Object.entries(answers)) {
    if (qs.includes(String(k)) && ['a', 'b', 'c', 'd'].includes(v)) clean[k] = v;
  }
  db.prepare('UPDATE attempts SET answers_json = ? WHERE id = ?').run(JSON.stringify(clean), attempt.id);
  res.json({ ok: true, saved: Object.keys(clean).length });
});

// Submit: scoring happens ONLY on the server
router.post('/attempts/:attemptId/submit', requireAuth, (req, res) => {
  const { attempt, error } = getAttemptOwned(req.params.attemptId, req.user.id, req.user.role);
  if (error) return res.status(error).json({ error: 'অনুমতি নেই' });
  if (attempt.status !== 'in_progress') return res.status(400).json({ error: 'পরীক্ষা ইতিমধ্যে জমা হয়েছে' });

  const exam = db.prepare('SELECT * FROM exams WHERE id = ?').get(attempt.exam_id);
  const snap = JSON.parse(attempt.questions_json);
  const ids = snap.map((x) => x.id);
  const keyRows = db.prepare(
    `SELECT id, correct_option, marks FROM questions WHERE id IN (${ids.map(() => '?').join(',')})`
  ).all(...ids);
  const keyById = new Map(keyRows.map((r) => [r.id, r]));

  // Merge any answers sent with the submit call
  const incoming = (req.body || {}).answers || {};
  const saved = JSON.parse(attempt.answers_json || '{}');
  const answers = { ...saved };
  for (const [k, v] of Object.entries(incoming)) {
    if (ids.map(String).includes(String(k)) && ['a', 'b', 'c', 'd'].includes(v)) answers[k] = v;
  }

  let correct = 0, wrong = 0, unanswered = 0, score = 0, total = 0;
  for (const { id, marks } of snap) {
    const key = keyById.get(id);
    const m = key ? Number(key.marks) : Number(marks);
    total += m;
    const sel = answers[id] ?? answers[String(id)];
    if (!sel) { unanswered += 1; continue; }
    if (key && sel === key.correct_option) { correct += 1; score += m; }
    else { wrong += 1; score -= Number(exam.negative_mark || 0); }
  }
  score = Math.max(0, Math.round(score * 100) / 100);
  total = Math.round(total * 100) / 100;
  const percentage = total > 0 ? Math.round((score / total) * 10000) / 100 : 0;
  const passed = score >= Number(exam.pass_marks || 0) ? 1 : 0;
  const now = new Date();
  const timeTaken = Math.max(0, Math.round((now - new Date(attempt.started_at)) / 1000));

  db.prepare(`UPDATE attempts SET status='submitted', answers_json=?, submitted_at=?, time_taken_sec=?,
    score=?, total_marks=?, correct_count=?, wrong_count=?, unanswered_count=?, percentage=?, passed=?
    WHERE id=?`)
    .run(JSON.stringify(answers), now.toISOString(), timeTaken, score, total,
      correct, wrong, unanswered, percentage, passed, attempt.id);

  notify(req.user.id, 'ফলাফল প্রস্তুত', `“${exam.title}” — স্কোর: ${score}/${total}`, 'result');
  res.json({
    attempt_id: attempt.id, score, total_marks: total, correct_count: correct,
    wrong_count: wrong, unanswered_count: unanswered, percentage, passed: !!passed,
    time_taken_sec: timeTaken,
  });
});

// Review after submit: full answers + explanations (only for submitted attempts)
router.get('/attempts/:attemptId/review', requireAuth, (req, res) => {
  const { attempt, error } = getAttemptOwned(req.params.attemptId, req.user.id, req.user.role);
  if (error) return res.status(error).json({ error: 'অনুমতি নেই' });
  if (attempt.status !== 'submitted') return res.status(400).json({ error: 'আগে পরীক্ষা জমা দিন' });
  const ids = JSON.parse(attempt.questions_json).map((x) => x.id);
  const rows = db.prepare(
    `SELECT id, question_text, option_a, option_b, option_c, option_d, correct_option, explanation, marks
     FROM questions WHERE id IN (${ids.map(() => '?').join(',')})`
  ).all(...ids);
  const order = new Map(ids.map((id, i) => [id, i]));
  const answers = JSON.parse(attempt.answers_json || '{}');
  const review = rows
    .sort((a, b) => order.get(a.id) - order.get(b.id))
    .map((q) => {
      const sel = answers[q.id] ?? answers[String(q.id)] ?? null;
      return { ...q, selected: sel, is_correct: sel ? sel === q.correct_option : null };
    });
  res.json({ review });
});

module.exports = router;
