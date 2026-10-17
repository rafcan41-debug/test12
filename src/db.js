// SQLite connection (better-sqlite3, single file DB)
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'porikkha.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function columnNames(table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
}

// Migrate the questions table from the Phase-1-alpha layout
// (source = 'sample'|'user' enum) to the new layout
// (origin enum + year INTEGER + source free text like "SSC Dhaka Board").
function migrateQuestions() {
  const tbl = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'questions'").get();
  if (!tbl) return; // fresh DB — schema.sql will create the new layout
  const cols = columnNames('questions');
  if (cols.includes('origin') && cols.includes('year')) return; // already new

  console.log('[migrate] upgrading questions table: adding origin/year/source...');
  db.exec("ALTER TABLE questions ADD COLUMN origin TEXT NOT NULL DEFAULT 'user'");
  // Old `source` column held the enum values 'sample'/'user' — carry them over.
  db.exec('UPDATE questions SET origin = source');
  db.exec('ALTER TABLE questions ADD COLUMN year INTEGER');
  db.exec('ALTER TABLE questions DROP COLUMN source');
  db.exec('ALTER TABLE questions ADD COLUMN source TEXT');
  db.exec('CREATE INDEX IF NOT EXISTS idx_questions_year_source ON questions(year, source, status)');

  // Demo year/source on existing seeded sample rows so the filter is demonstrable.
  const demo = [
    ['%x² − 5x + 6%', 2024, 'SSC Dhaka Board'],
    ['%2, 4, 8, 16%', 2023, 'SSC Dhaka Board'],
    ['%সুষম ত্বরণে%', 2023, 'HSC Dhaka Board'],
    ['%10 N বল%', 2024, 'HSC Dhaka Board'],
    ['%বিদ্যালয়%', 2023, 'BCS Preliminary'],
    ['%বক্তৃতায় পটু%', 2022, 'BCS Preliminary'],
    ['%সবচেয়ে বড় ও শক্তিশালী অস্থি%', 2024, 'Medical Admission'],
    ['%সালোকসংশ্লেষণ%', 2023, 'Medical Admission'],
  ];
  const upd = db.prepare("UPDATE questions SET year = ?, source = ?, prev_year = 1 WHERE question_text LIKE ? AND origin = 'sample'");
  let n = 0;
  for (const [like, year, source] of demo) n += upd.run(year, source, like).changes;
  console.log(`[migrate] tagged ${n} sample questions with year/source.`);
}

function initSchema() {
  migrateQuestions(); // upgrade old DBs BEFORE schema exec (new index needs new columns)
  const schema = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
  db.exec(schema);
  migrateExamsAuto(); // add is_auto to older DBs
  ensurePrimaryExtraSubjects(); // fixed ids 40/41 for import files (no-op when categories not seeded yet)
  ensureClass610Subjects(); // fixed ids 100-148 for class 6-10 question packs
  ensureSubjectGroups(); // tag class 9-10 subjects with group (common/science/business/humanities)
  ensureClass1112Subjects(); // fixed ids 200+ for class 11-12 (HSC) question bank
  ensureAdmissionSubjects(); // fixed ids 300-307 for university admission previous-year questions
  backfillChapters(); // build chapters from question tags (idempotent)
}

// Older DBs: exams table lacks is_auto
function migrateExamsAuto() {
  const cols = columnNames('exams');
  if (!cols.includes('is_auto')) {
    db.exec('ALTER TABLE exams ADD COLUMN is_auto INTEGER NOT NULL DEFAULT 0');
    console.log('[migrate] added exams.is_auto');
  }
}

// Build chapter records from question tags like "Class 1, অধ্যায়: স্বরবর্ণ"
// and link questions to them. Idempotent (only touches chapter_id IS NULL).
function backfillChapters() {
  let rows = [];
  try {
    rows = db.prepare(
      "SELECT id, subject_id, tags FROM questions WHERE chapter_id IS NULL AND tags LIKE '%অধ্যায়:%'"
    ).all();
  } catch (e) { return 0; }
  if (!rows.length) return 0;
  const cache = new Map();
  const getChap = (subjectId, name) => {
    const key = subjectId + '|' + name;
    if (!cache.has(key)) {
      let c = db.prepare('SELECT id FROM chapters WHERE subject_id = ? AND name_bn = ?').get(subjectId, name);
      if (!c) {
        c = { id: db.prepare('INSERT INTO chapters (subject_id, name_bn) VALUES (?,?)').run(subjectId, name).lastInsertRowid };
      }
      cache.set(key, c.id);
    }
    return cache.get(key);
  };
  const upd = db.prepare('UPDATE questions SET chapter_id = ? WHERE id = ?');
  const tx = db.transaction((list) => {
    let n = 0;
    for (const r of list) {
      const m = String(r.tags || '').match(/অধ্যায়:\s*([^,]+)/);
      if (!m) continue;
      const name = m[1].trim();
      if (!name) continue;
      upd.run(getChap(r.subject_id, name), r.id);
      n++;
    }
    return n;
  });
  const n = tx(rows);
  if (n) console.log(`[migrate] backfilled ${n} question chapters`);
  return n;
}

// Ensure class 6-10 subjects exist with FIXED ids (100-148)
// so question pack files can reference them on fresh AND already-seeded DBs.
function ensureClass610Subjects() {
  const defs = [
    // [id, category_slug, name_bn, name_en]
    [100, 'junior-6-8', '৬ষ্ঠ শ্রেণি বাংলা ১ম পত্র', 'Class 6 Bangla 1st Paper'],
    [101, 'junior-6-8', '৬ষ্ঠ শ্রেণি বাংলা ২য় পত্র', 'Class 6 Bangla 2nd Paper'],
    [102, 'junior-6-8', '৬ষ্ঠ শ্রেণি English 1st Paper', 'Class 6 English 1st Paper'],
    [103, 'junior-6-8', '৬ষ্ঠ শ্রেণি English 2nd Paper', 'Class 6 English 2nd Paper'],
    [104, 'junior-6-8', '৬ষ্ঠ শ্রেণি গণিত', 'Class 6 Mathematics'],
    [105, 'junior-6-8', '৬ষ্ঠ শ্রেণি বিজ্ঞান', 'Class 6 Science'],
    [106, 'junior-6-8', '৬ষ্ঠ শ্রেণি বাংলাদেশ ও বিশ্বপরিচয়', 'Class 6 Bangladesh and Global Studies'],
    [107, 'junior-6-8', '৬ষ্ঠ শ্রেণি তথ্য ও যোগাযোগ প্রযুক্তি', 'Class 6 ICT'],
    [108, 'junior-6-8', '৬ষ্ঠ শ্রেণি ইসলাম শিক্ষা', 'Class 6 Islamic Studies'],
    [110, 'junior-6-8', '৭ম শ্রেণি বাংলা ১ম পত্র', 'Class 7 Bangla 1st Paper'],
    [111, 'junior-6-8', '৭ম শ্রেণি বাংলা ২য় পত্র', 'Class 7 Bangla 2nd Paper'],
    [112, 'junior-6-8', '৭ম শ্রেণি English 1st Paper', 'Class 7 English 1st Paper'],
    [113, 'junior-6-8', '৭ম শ্রেণি English 2nd Paper', 'Class 7 English 2nd Paper'],
    [114, 'junior-6-8', '৭ম শ্রেণি গণিত', 'Class 7 Mathematics'],
    [115, 'junior-6-8', '৭ম শ্রেণি বিজ্ঞান', 'Class 7 Science'],
    [116, 'junior-6-8', '৭ম শ্রেণি বাংলাদেশ ও বিশ্বপরিচয়', 'Class 7 Bangladesh and Global Studies'],
    [117, 'junior-6-8', '৭ম শ্রেণি তথ্য ও যোগাযোগ প্রযুক্তি', 'Class 7 ICT'],
    [118, 'junior-6-8', '৭ম শ্রেণি ইসলাম শিক্ষা', 'Class 7 Islamic Studies'],
    [120, 'junior-6-8', '৮ম শ্রেণি বাংলা ১ম পত্র', 'Class 8 Bangla 1st Paper'],
    [121, 'junior-6-8', '৮ম শ্রেণি বাংলা ২য় পত্র', 'Class 8 Bangla 2nd Paper'],
    [122, 'junior-6-8', '৮ম শ্রেণি English 1st Paper', 'Class 8 English 1st Paper'],
    [123, 'junior-6-8', '৮ম শ্রেণি English 2nd Paper', 'Class 8 English 2nd Paper'],
    [124, 'junior-6-8', '৮ম শ্রেণি গণিত', 'Class 8 Mathematics'],
    [125, 'junior-6-8', '৮ম শ্রেণি বিজ্ঞান', 'Class 8 Science'],
    [126, 'junior-6-8', '৮ম শ্রেণি বাংলাদেশ ও বিশ্বপরিচয়', 'Class 8 Bangladesh and Global Studies'],
    [127, 'junior-6-8', '৮ম শ্রেণি তথ্য ও যোগাযোগ প্রযুক্তি', 'Class 8 ICT'],
    [128, 'junior-6-8', '৮ম শ্রেণি ইসলাম শিক্ষা', 'Class 8 Islamic Studies'],
    [130, 'ssc', '৯ম-১০ম শ্রেণি বাংলা ১ম পত্র', 'Class 9-10 Bangla 1st Paper'],
    [131, 'ssc', '৯ম-১০ম শ্রেণি বাংলা ২য় পত্র', 'Class 9-10 Bangla 2nd Paper'],
    [132, 'ssc', '৯ম-১০ম শ্রেণি English 1st Paper', 'Class 9-10 English 1st Paper'],
    [133, 'ssc', '৯ম-১০ম শ্রেণি English 2nd Paper', 'Class 9-10 English 2nd Paper'],
    [134, 'ssc', '৯ম-১০ম শ্রেণি সাধারণ গণিত', 'Class 9-10 General Mathematics'],
    [135, 'ssc', '৯ম-১০ম শ্রেণি বাংলাদেশ ও বিশ্বপরিচয়', 'Class 9-10 Bangladesh and Global Studies'],
    [136, 'ssc', '৯ম-১০ম শ্রেণি তথ্য ও যোগাযোগ প্রযুক্তি', 'Class 9-10 ICT'],
    [137, 'ssc', '৯ম-১০ম শ্রেণি ইসলাম শিক্ষা', 'Class 9-10 Islamic Studies'],
    [138, 'ssc', '৯ম-১০ম শ্রেণি পদার্থবিজ্ঞান', 'Class 9-10 Physics'],
    [139, 'ssc', '৯ম-১০ম শ্রেণি রসায়ন', 'Class 9-10 Chemistry'],
    [140, 'ssc', '৯ম-১০ম শ্রেণি জীববিজ্ঞান', 'Class 9-10 Biology'],
    [141, 'ssc', '৯ম-১০ম শ্রেণি উচ্চতর গণিত', 'Class 9-10 Higher Mathematics'],
    [142, 'ssc', '৯ম-১০ম শ্রেণি হিসাববিজ্ঞান', 'Class 9-10 Accounting'],
    [143, 'ssc', '৯ম-১০ম শ্রেণি ফিন্যান্স ও ব্যাংকিং', 'Class 9-10 Finance and Banking'],
    [144, 'ssc', '৯ম-১০ম শ্রেণি ব্যবসায় উদ্যোগ', 'Class 9-10 Business Entrepreneurship'],
    [145, 'ssc', '৯ম-১০ম শ্রেণি বাংলাদেশের ইতিহাস', 'Class 9-10 History of Bangladesh'],
    [146, 'ssc', '৯ম-১০ম শ্রেণি পৌরনীতি ও নাগরিকতা', 'Class 9-10 Civics and Citizenship'],
    [147, 'ssc', '৯ম-১০ম শ্রেণি ভূগোল ও পরিবেশ', 'Class 9-10 Geography and Environment'],
    [148, 'ssc', '৯ম-১০ম শ্রেণি অর্থনীতি', 'Class 9-10 Economics'],
  ];
  const ins = db.prepare(`INSERT INTO subjects (id, category_id, name_bn, name_en)
    SELECT ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM subjects WHERE id = ?)`);
  let added = 0;
  for (const [id, slug, bn, en] of defs) {
    const cat = db.prepare('SELECT id FROM categories WHERE slug = ?').get(slug);
    if (!cat) continue;
    added += ins.run(id, cat.id, bn, en, id).changes;
  }
  if (added) console.log(`[migrate] added ${added} class 6-10 subjects (ids 100-148)`);
}

// Tag class 9-10 subjects with their group so the UI can filter
// (common = shared subjects, science / business / humanities = group subjects).
function ensureSubjectGroups() {
  const cols = columnNames('subjects');
  if (!cols.includes('grp')) {
    db.exec("ALTER TABLE subjects ADD COLUMN grp TEXT NOT NULL DEFAULT ''");
  }
  const groups = [
    ['common', [130, 131, 132, 133, 134, 135, 136, 137]],
    ['science', [138, 139, 140, 141]],
    ['business', [142, 143, 144]],
    ['humanities', [145, 146, 147, 148]],
  ];
  const upd = db.prepare("UPDATE subjects SET grp = ? WHERE id = ? AND (grp IS NULL OR grp = '' OR grp != ?)");
  let n = 0;
  for (const [g, ids] of groups) for (const id of ids) n += upd.run(g, id, g).changes;
  if (n) console.log(`[migrate] tagged ${n} class 9-10 subjects with groups`);
}

// Ensure class 11-12 (HSC) subjects exist with FIXED ids (200+)
// so question pack files can reference them on fresh AND already-seeded DBs.
// grp: business / science / humanities / common (for group filtering in UI).
function ensureClass1112Subjects() {
  const cat = db.prepare("SELECT id FROM categories WHERE slug = 'hsc'").get();
  if (!cat) return;
  const defs = [
    // [id, grp, name_bn, name_en] — ids MUST match seed_data/hsc-*-3000.json subject_ids
    // Business Studies
    [200, 'business', 'হিসাববিজ্ঞান ১ম পত্র', 'HSC Accounting 1st Paper'],
    [201, 'business', 'হিসাববিজ্ঞান ২য় পত্র', 'HSC Accounting 2nd Paper'],
    [202, 'business', 'ব্যবসায় সংগঠন ও ব্যবস্থাপনা ১ম পত্র', 'HSC Business Organization and Management 1st Paper'],
    [203, 'business', 'ব্যবসায় সংগঠন ও ব্যবস্থাপনা ২য় পত্র', 'HSC Business Organization and Management 2nd Paper'],
    [204, 'business', 'ফিন্যান্স, ব্যাংকিং ও বিমা ১ম পত্র', 'HSC Finance, Banking and Insurance 1st Paper'],
    [205, 'business', 'ফিন্যান্স, ব্যাংকিং ও বিমা ২য় পত্র', 'HSC Finance, Banking and Insurance 2nd Paper'],
    // Science
    [210, 'science', 'পদার্থবিজ্ঞান ১ম পত্র', 'HSC Physics 1st Paper'],
    [211, 'science', 'পদার্থবিজ্ঞান ২য় পত্র', 'HSC Physics 2nd Paper'],
    [212, 'science', 'রসায়ন ১ম পত্র', 'HSC Chemistry 1st Paper'],
    [213, 'science', 'রসায়ন ২য় পত্র', 'HSC Chemistry 2nd Paper'],
    [214, 'science', 'জীববিজ্ঞান ১ম পত্র', 'HSC Biology 1st Paper'],
    [215, 'science', 'জীববিজ্ঞান ২য় পত্র', 'HSC Biology 2nd Paper'],
    [216, 'science', 'উচ্চতর গণিত ১ম পত্র', 'HSC Higher Mathematics 1st Paper'],
    [217, 'science', 'উচ্চতর গণিত ২য় পত্র', 'HSC Higher Mathematics 2nd Paper'],
    // Humanities
    [230, 'humanities', 'অর্থনীতি ১ম পত্র', 'HSC Economics 1st Paper'],
    [231, 'humanities', 'অর্থনীতি ২য় পত্র', 'HSC Economics 2nd Paper'],
    [232, 'humanities', 'পৌরনীতি ও সুশাসন ১ম পত্র', 'HSC Civics and Good Governance 1st Paper'],
    [233, 'humanities', 'পৌরনীতি ও সুশাসন ২য় পত্র', 'HSC Civics and Good Governance 2nd Paper'],
    [234, 'humanities', 'ইতিহাস ১ম পত্র', 'HSC History 1st Paper'],
    [235, 'humanities', 'ইতিহাস ২য় পত্র', 'HSC History 2nd Paper'],
    [236, 'humanities', 'ভূগোল ১ম পত্র', 'HSC Geography 1st Paper'],
    [237, 'humanities', 'ভূগোল ২য় পত্র', 'HSC Geography 2nd Paper'],
    // Compulsory (all groups)
    [220, 'common', 'বাংলা ১ম পত্র', 'HSC Bangla 1st Paper'],
    [221, 'common', 'বাংলা ২য় পত্র', 'HSC Bangla 2nd Paper'],
    [222, 'common', 'English 1st Paper', 'HSC English 1st Paper'],
    [223, 'common', 'English 2nd Paper', 'HSC English 2nd Paper'],
    [224, 'common', 'তথ্য ও যোগাযোগ প্রযুক্তি', 'HSC Information and Communication Technology'],
  ];
  const ins = db.prepare(`INSERT INTO subjects (id, category_id, name_bn, name_en, grp)
    SELECT ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM subjects WHERE id = ?)`);
  let added = 0;
  for (const [id, grp, bn, en] of defs) {
    added += ins.run(id, cat.id, bn, en, grp, id).changes;
  }
  if (added) console.log(`[migrate] added ${added} class 11-12 subjects (ids 200+)`);
}

// Ensure university admission subjects exist with FIXED ids (300-307)
// so previous-year question files can reference them on fresh AND already-seeded DBs.
function ensureAdmissionSubjects() {
  const cat = db.prepare("SELECT id FROM categories WHERE slug = 'varsity'").get();
  if (!cat) return;
  const defs = [
    // [id, name_bn, name_en]
    [300, 'ঢাকা বিশ্ববিদ্যালয় (DU)', 'Dhaka University (DU)'],
    [301, 'জাহাঙ্গীরনগর বিশ্ববিদ্যালয় (JU)', 'Jahangirnagar University (JU)'],
    [302, 'জগন্নাথ বিশ্ববিদ্যালয় (JnU)', 'Jagannath University (JnU)'],
    [303, 'রাজশাহী বিশ্ববিদ্যালয় (RU)', 'Rajshahi University (RU)'],
    [304, 'খুলনা বিশ্ববিদ্যালয় (KU)', 'Khulna University (KU)'],
    [305, 'কুমিল্লা বিশ্ববিদ্যালয় (CoU)', 'Comilla University (CoU)'],
    [306, 'গুচ্ছ (GST)', 'GST Cluster'],
    [307, 'কৃষি গুচ্ছ (Agri-GST)', 'Agricultural GST'],
  ];
  const ins = db.prepare(`INSERT INTO subjects (id, category_id, name_bn, name_en, grp)
    SELECT ?, ?, ?, ?, 'admission' WHERE NOT EXISTS (SELECT 1 FROM subjects WHERE id = ?)`);
  let added = 0;
  for (const [id, bn, en] of defs) {
    added += ins.run(id, cat.id, bn, en, id).changes;
  }
  if (added) console.log(`[migrate] added ${added} admission subjects (ids 300-307)`);
}

// Ensure the two extra primary subjects exist with FIXED ids (40, 41)
// so question import files can reference them on fresh AND already-seeded DBs.
function ensurePrimaryExtraSubjects() {
  const cat = db.prepare("SELECT id FROM categories WHERE slug = 'primary-1-5'").get();
  if (!cat) return;
  const ins = db.prepare(`INSERT INTO subjects (id, category_id, name_bn, name_en)
    SELECT ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM subjects WHERE id = ?)`);
  let added = 0;
  added += ins.run(40, cat.id, 'প্রাথমিক বিজ্ঞান', 'Primary Science', 40).changes;
  added += ins.run(41, cat.id, 'বাংলাদেশ ও বিশ্বপরিচয়', 'Bangladesh and World Studies', 41).changes;
  if (added) console.log('[migrate] added primary subjects 40=প্রাথমিক বিজ্ঞান, 41=বাংলাদেশ ও বিশ্বপরিচয়');
}

module.exports = { db, initSchema, ensurePrimaryExtraSubjects, ensureClass610Subjects, ensureSubjectGroups, ensureClass1112Subjects, ensureAdmissionSubjects, backfillChapters };
