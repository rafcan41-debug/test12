// Free-plan daily usage caps (server-side enforced)
const { db } = require('./db');

function dayStr() {
  return new Date().toISOString().slice(0, 10);
}

function getUsage(userId) {
  const day = dayStr();
  let row = db.prepare('SELECT * FROM usage_counters WHERE user_id = ? AND day = ?').get(userId, day);
  if (!row) {
    db.prepare('INSERT INTO usage_counters (user_id, day) VALUES (?,?)').run(userId, day);
    row = { user_id: userId, day, exams_started: 0, practice_answers: 0 };
  }
  return row;
}

// kind: 'exams_started' | 'practice_answers'. Premium users are unlimited.
function checkAndUse(userId, plan, kind, freeLimit) {
  if (plan === 'premium') return { allowed: true, remaining: Infinity };
  const u = getUsage(userId);
  if (u[kind] >= freeLimit) {
    return {
      allowed: false,
      remaining: 0,
      error: kind === 'exams_started'
        ? `ফ্রি প্ল্যানে দিনে ${freeLimit}টি পরীক্ষা দেওয়া যায়। প্রিমিয়াম নিন।`
        : `ফ্রি প্ল্যানে দিনে ${freeLimit}টি প্র্যাকটিস উত্তর দেওয়া যায়। প্রিমিয়াম নিন।`,
    };
  }
  db.prepare(`UPDATE usage_counters SET ${kind} = ${kind} + 1 WHERE user_id = ? AND day = ?`)
    .run(userId, u.day);
  return { allowed: true, remaining: freeLimit - u[kind] - 1 };
}

module.exports = { getUsage, checkAndUse, dayStr };
