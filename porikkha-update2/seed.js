// Seed: categories, subjects, chapters/topics, 10 ORIGINAL sample MCQs,
// one sample exam, and the default admin user. Idempotent (runs once).
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { db, initSchema, ensurePrimaryExtraSubjects } = require('./src/db');

initSchema();

const already = db.prepare("SELECT value FROM meta WHERE key = 'seeded'").get();
if (already && already.value === '1') {
  console.log('Seed already applied. Skipping.');
  process.exit(0);
}

// --- categories + subjects (real BD curriculum names) -------------------------
const CATS = [
  ['primary-1-5', 'প্রাথমিক (১ম–৫ম শ্রেণি)', 'Primary (Class 1-5)',
    [['বাংলা', 'Bangla'], ['গণিত', 'Mathematics'], ['English', 'English']]],
  ['junior-6-8', 'নিম্ন মাধ্যমিক (৬ষ্ঠ–৮ম শ্রেণি)', 'Junior (Class 6-8)',
    [['বাংলা', 'Bangla'], ['গণিত', 'Mathematics'], ['English', 'English'], ['বিজ্ঞান', 'Science']]],
  ['ssc', 'এসএসসি (৯ম–১০ম)', 'SSC',
    [['বাংলা ১ম পত্র', 'Bangla 1st'], ['সাধারণ গণিত', 'General Math'], ['পদার্থবিজ্ঞান', 'Physics'], ['English', 'English']]],
  ['hsc', 'এইচএসসি (১১শ–১২শ)', 'HSC',
    [['পদার্থবিজ্ঞান ১ম পত্র', 'Physics 1st'], ['রসায়ন ১ম পত্র', 'Chemistry 1st'], ['উচ্চতর গণিত', 'Higher Math'], ['English', 'English']]],
  ['medical', 'মেডিকেল ভর্তি', 'Medical Admission',
    [['জীববিজ্ঞান', 'Biology'], ['পদার্থবিজ্ঞান', 'Physics'], ['রসায়ন', 'Chemistry'], ['English', 'English']]],
  ['engineering', 'ইঞ্জিনিয়ারিং ভর্তি', 'Engineering Admission',
    [['পদার্থবিজ্ঞান', 'Physics'], ['রসায়ন', 'Chemistry'], ['উচ্চতর গণিত', 'Higher Math'], ['English', 'English']]],
  ['varsity', 'বিশ্ববিদ্যালয় ভর্তি', 'Varsity Admission',
    [['বাংলা', 'Bangla'], ['English', 'English'], ['সাধারণ জ্ঞান', 'General Knowledge'], ['হিসাববিজ্ঞান', 'Accounting']]],
  ['bcs', 'বিসিএস', 'BCS',
    [['বাংলা', 'Bangla'], ['English', 'English'], ['গাণিতিক যুক্তি', 'Math'], ['সাধারণ জ্ঞান', 'General Knowledge']]],
  ['bank', 'ব্যাংক জব', 'Bank Job',
    [['গণিত', 'Math'], ['English', 'English'], ['সাধারণ জ্ঞান', 'General Knowledge'], ['বাংলা', 'Bangla']]],
  ['primary-teacher', 'প্রাথমিক শিক্ষক নিয়োগ', 'Primary Teacher',
    [['বাংলা', 'Bangla'], ['English', 'English'], ['গণিত', 'Math'], ['সাধারণ জ্ঞান', 'General Knowledge']]],
];

const catIns = db.prepare('INSERT OR IGNORE INTO categories (slug, name_bn, name_en, sort) VALUES (?,?,?,?)');
const subIns = db.prepare('INSERT INTO subjects (category_id, name_bn, name_en) VALUES (?,?,?)');
CATS.forEach(([slug, bn, en, subjects], i) => {
  catIns.run(slug, bn, en, i + 1);
  const cat = db.prepare('SELECT id FROM categories WHERE slug = ?').get(slug);
  const existing = db.prepare('SELECT COUNT(*) c FROM subjects WHERE category_id = ?').get(cat.id).c;
  if (!existing) for (const [sbn, sen] of subjects) subIns.run(cat.id, sbn, sen);
});
ensurePrimaryExtraSubjects(); // fixed ids 40/41 (also runs on boot via initSchema for older DBs)

function subjectId(catSlug, nameBn) {
  return db.prepare(
    `SELECT s.id FROM subjects s JOIN categories c ON c.id = s.category_id
     WHERE c.slug = ? AND s.name_bn = ?`).get(catSlug, nameBn).id;
}

// --- chapters/topics for the subjects that carry sample questions ------------
const chapIns = db.prepare('INSERT INTO chapters (subject_id, name_bn) VALUES (?,?)');
const topicIns = db.prepare('INSERT INTO topics (chapter_id, name_bn) VALUES (?,?)');
function addChapterTopics(subId, chapters) {
  for (const [cbn, topics] of chapters) {
    chapIns.run(subId, cbn);
    const ch = db.prepare('SELECT id FROM chapters WHERE subject_id = ? AND name_bn = ?').get(subId, cbn);
    for (const t of topics) topicIns.run(ch.id, t);
  }
}
addChapterTopics(subjectId('ssc', 'সাধারণ গণিত'), [
  ['বীজগণিত', ['দ্বিঘাত সমীকরণ', 'অসমতা']],
  ['ধারা', ['সমান্তর ধারা', 'গুণোত্তর ধারা']],
]);
addChapterTopics(subjectId('hsc', 'পদার্থবিজ্ঞান ১ম পত্র'), [
  ['গতিবিদ্যা', ['সুষম ত্বরণ', 'প্রাসের গতি']],
  ['নিউটনীয় বলবিদ্যা', ['বলের সূত্র', 'ভরবেগ']],
]);
addChapterTopics(subjectId('bcs', 'বাংলা'), [
  ['ব্যাকরণ', ['সন্ধি', 'এক কথায় প্রকাশ']],
  ['সাহিত্য', ['আধুনিক যুগ', 'মধ্যযুগ']],
]);
addChapterTopics(subjectId('medical', 'জীববিজ্ঞান'), [
  ['মানবদেহ', ['কঙ্কালতন্ত্র', 'পেশিতন্ত্র']],
  ['উদ্ভিদবিজ্ঞান', ['সালোকসংশ্লেষণ', 'শ্বসন']],
]);
addChapterTopics(subjectId('ssc', 'English'), [
  ['Grammar', ['Subject-verb agreement', 'Vocabulary']],
  ['Reading', ['Comprehension', 'Sentence correction']],
]);

function topicId(subId, chapterBn, topicBn) {
  return db.prepare(
    `SELECT t.id FROM topics t JOIN chapters c ON c.id = t.chapter_id
     WHERE c.subject_id = ? AND c.name_bn = ? AND t.name_bn = ?`).get(subId, chapterBn, topicBn).id;
}
function chapterId(subId, chapterBn) {
  return db.prepare('SELECT id FROM chapters WHERE subject_id = ? AND name_bn = ?').get(subId, chapterBn).id;
}

// --- 10 ORIGINAL sample MCQs (written for this seed, not copied) --------------
const S = (cat, bn) => subjectId(cat, bn);
const qIns = db.prepare(`INSERT INTO questions
  (subject_id, chapter_id, topic_id, question_text, option_a, option_b, option_c, option_d,
   correct_option, explanation, marks, difficulty, tags, prev_year, year, source, origin, status, created_by)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'sample', 'published', NULL)`);
// helper: q(subject, chapter, topic, text, a,b,c,d, correct, explanation, difficulty, tags, year, source)
function Q(subId, chBn, tpBn, text, a, b, c, d, correct, expl, diff, tags, year, source) {
  qIns.run(subId, chBn ? chapterId(subId, chBn) : null, tpBn ? topicId(subId, chBn, tpBn) : null,
    text, a, b, c, d, correct, expl, 1, diff, tags, year ? 1 : 0, year || null, source || null);
}

const sm = S('ssc', 'সাধারণ গণিত');
Q(sm, 'বীজগণিত', 'দ্বিঘাত সমীকরণ',
  'x² − 5x + 6 = 0 সমীকরণের মূলদ্বয় কোনটি?', '2, 3', '1, 6', '−2, −3', '2, −3',
  'a', 'উৎপাদকে বিশ্লেষণ করলে (x − 2)(x − 3) = 0, সুতরাং x = 2 অথবা x = 3।', 'easy', 'বীজগণিত', 2024, 'SSC Dhaka Board');
Q(sm, 'ধারা', 'গুণোত্তর ধারা',
  '2, 4, 8, 16, … ধারাটির পরবর্তী পদ কত?', '20', '24', '32', '36',
  'c', 'এটি গুণোত্তর ধারা, সাধারণ অনুপাত 2। পরবর্তী পদ = 16 × 2 = 32।', 'easy', 'ধারা', 2023, 'SSC Dhaka Board');

const hp = S('hsc', 'পদার্থবিজ্ঞান ১ম পত্র');
Q(hp, 'গতিবিদ্যা', 'সুষম ত্বরণ',
  'স্থির অবস্থা থেকে সুষম ত্বরণে চলমান বস্তুর ক্ষেত্রে সঠিক সূত্র কোনটি?', 'v = u + at', 'v = u − at', 's = ut²', 'v² = u² − at',
  'a', 'গতির প্রথম সূত্র: v = u + at, যেখানে u = আদিবেগ, a = ত্বরণ, t = সময়।', 'easy', 'গতিবিদ্যা', 2023, 'HSC Dhaka Board');
Q(hp, 'নিউটনীয় বলবিদ্যা', 'বলের সূত্র',
  '5 kg ভরের বস্তুর উপর 10 N বল প্রযুক্ত হলে ত্বরণ কত?', '0.5 m/s²', '2 m/s²', '15 m/s²', '50 m/s²',
  'b', 'নিউটনের দ্বিতীয় সূত্র: F = ma, সুতরাং a = F/m = 10/5 = 2 m/s²।', 'medium', 'বল', 2024, 'HSC Dhaka Board');

const bb = S('bcs', 'বাংলা');
Q(bb, 'ব্যাকরণ', 'সন্ধি',
  '‘বিদ্যালয়’ শব্দের সঠিক সন্ধি বিচ্ছেদ কোনটি?', 'বিদ্যা + আলয়', 'বিদ্য + আলয়', 'বিদ্যা + লয়', 'বি + দ্যালয়',
  'a', 'বিদ্যা + আলয় = বিদ্যালয় (আ + আ = য়া)।', 'easy', 'সন্ধি', 2023, 'BCS Preliminary');
Q(bb, 'ব্যাকরণ', 'এক কথায় প্রকাশ',
  '‘যিনি বক্তৃতায় পটু’ — এক কথায় কী বলে?', 'বাগ্মী', 'বক্তা', 'পণ্ডিত', 'কবি',
  'a', 'বক্তৃতায় পটু ব্যক্তিকে এক কথায় ‘বাগ্মী’ বলা হয়।', 'medium', 'এক কথায় প্রকাশ', 2022, 'BCS Preliminary');

const mb = S('medical', 'জীববিজ্ঞান');
Q(mb, 'মানবদেহ', 'কঙ্কালতন্ত্র',
  'মানবদেহের সবচেয়ে বড় ও শক্তিশালী অস্থি কোনটি?', 'হিউমেরাস', 'ফিমার', 'টিবিয়া', 'রেডিয়াস',
  'b', 'ফিমার বা উরুর হাড় মানবদেহের সবচেয়ে বড় অস্থি।', 'easy', 'কঙ্কালতন্ত্র', 2024, 'Medical Admission');
Q(mb, 'উদ্ভিদবিজ্ঞান', 'সালোকসংশ্লেষণ',
  'সবুজ উদ্ভিদে সালোকসংশ্লেষণ মূলত কোথায় ঘটে?', 'মাইটোকন্ড্রিয়া', 'ক্লোরোপ্লাস্ট', 'নিউক্লিয়াস', 'রাইবোসোম',
  'b', 'ক্লোরোপ্লাস্টের ক্লোরোফিল সূর্যালোক শোষণ করে সালোকসংশ্লেষণ ঘটায়।', 'easy', 'উদ্ভিদবিজ্ঞান', 2023, 'Medical Admission');

const se = S('ssc', 'English');
Q(se, 'Grammar', 'Subject-verb agreement',
  'Choose the correct sentence.', 'He go to school.', 'He goes to school.', 'He going to school.', 'He gone to school.',
  'b', 'Third person singular (he/she/it)-এর পরে মূল verb-এর সাথে s/es যোগ হয়: He goes।', 'easy', 'grammar', null, null);
Q(se, 'Grammar', 'Vocabulary',
  'Choose the synonym of "rapid".', 'slow', 'fast', 'lazy', 'weak',
  'b', 'Rapid অর্থ দ্রুত; এর সমার্থক fast।', 'easy', 'vocabulary', null, null);

// --- bulk question packs (seed_data/*.json) — auto-restores on every fresh deploy --
const fs = require('fs');
const path = require('path');
const packDir = path.join(__dirname, 'seed_data');
const packIns = db.prepare(`INSERT INTO questions
  (subject_id, chapter_id, topic_id, question_text, option_a, option_b, option_c, option_d,
   correct_option, explanation, marks, difficulty, tags, prev_year, year, source, origin, status, created_by)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'user', 'published', NULL)`);
if (fs.existsSync(packDir)) {
  const packTx = db.transaction((items) => {
    for (const b of items) {
      packIns.run(b.subject_id, b.chapter_id || null, b.topic_id || null, String(b.question_text).trim(),
        String(b.option_a).trim(), String(b.option_b).trim(), String(b.option_c).trim(), String(b.option_d).trim(),
        b.correct_option, (b.explanation || '').trim() || null, Number(b.marks || 1), b.difficulty || 'medium',
        b.tags || null, (b.prev_year || b.year || b.source) ? 1 : 0, b.year || null, b.source || null);
    }
  });
  let packCount = 0;
  for (const f of fs.readdirSync(packDir).filter(f => f.endsWith('.json')).sort()) {
    try {
      const items = JSON.parse(fs.readFileSync(path.join(packDir, f), 'utf8')).questions || [];
      packTx(items);
      packCount += items.length;
    } catch (e) { console.log('[seed] pack failed:', f, e.message); }
  }
  console.log(`[seed] question packs imported: ${packCount}`);
}

// --- sample published exam (filter mode, 5 random published questions) --------
const sscCat = db.prepare('SELECT id FROM categories WHERE slug = ?').get('ssc');
db.prepare(`INSERT INTO exams (title, title_en, category_id, duration_min, negative_mark, pass_marks,
  selection_mode, filter_json, question_limit, status)
  VALUES (?,?,?,?,?,?,?,?,?, 'published')`)
  .run('নমুনা মডেল টেস্ট — সাধারণ', 'Sample Model Test', sscCat.id, 10, 0.25, 2,
    'filter', JSON.stringify({ limit: 5 }), 5);

// --- default admin -------------------------------------------------------------
const adminEmail = (process.env.ADMIN_EMAIL || 'admin@porikkha.local').toLowerCase();
const adminPass = process.env.ADMIN_PASSWORD || 'Admin123!';
const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(adminEmail);
if (!exists) {
  db.prepare(`INSERT INTO users (name, email, password_hash, role) VALUES (?,?,?, 'admin')`)
    .run('অ্যাডমিন', adminEmail, bcrypt.hashSync(adminPass, 10));
  console.log(`Seeded admin: ${adminEmail}`);
} else {
  db.prepare("UPDATE users SET role = 'admin' WHERE email = ?").run(adminEmail);
}

db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('seeded','1')").run();
db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('admin_pw_changed','0')").run();

const qc = db.prepare("SELECT COUNT(*) c FROM questions WHERE status = 'published'").get().c;
console.log(`Seed done: ${CATS.length} categories, ${qc} published sample questions, 1 sample exam.`);
