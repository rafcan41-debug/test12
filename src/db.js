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
  ensurePrimaryExtraSubjects(); // fixed ids 40/41 for import files (no-op when categories not seeded yet)
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

module.exports = { db, initSchema, ensurePrimaryExtraSubjects };
