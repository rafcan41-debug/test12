// In-site notifications. Email/SMS hooks are stubbed for Phase 1.
const { db } = require('./db');

function notify(userId, title, body = '', type = 'info') {
  db.prepare('INSERT INTO notifications (user_id, title, body, type) VALUES (?,?,?,?)')
    .run(userId, title, body, type);
}

function notifyAll(title, body = '', type = 'info') {
  const users = db.prepare("SELECT id FROM users WHERE status = 'active'").all();
  const ins = db.prepare('INSERT INTO notifications (user_id, title, body, type) VALUES (?,?,?,?)');
  const tx = db.transaction((list) => {
    for (const u of list) ins.run(u.id, title, body, type);
  });
  tx(users);
}

// Stub: wire a real email/SMS provider here later
function sendEmail(to, subject, body) {
  console.log(`[email-stub] to=${to} subject=${subject}`);
}

function sendSms(to, body) {
  console.log(`[sms-stub] to=${to} body=${body}`);
}

module.exports = { notify, notifyAll, sendEmail, sendSms };
