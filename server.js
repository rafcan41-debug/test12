// Porikkha backend entry point
require('dotenv').config();
const express = require('express');
const path = require('path');
const { db, initSchema } = require('./src/db');

initSchema();

const app = express();
app.use(express.json({ limit: '1mb' }));

// Tiny cookie parser (no extra dependency)
app.use((req, res, next) => {
  req.cookies = {};
  const h = req.headers.cookie;
  if (h) {
    for (const part of h.split(';')) {
      const i = part.indexOf('=');
      if (i > 0) req.cookies[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    }
  }
  next();
});

// API routes
app.use('/api/auth', require('./src/routes/auth'));
app.use('/api/catalog', require('./src/routes/catalog'));
app.use('/api/questions', require('./src/routes/questions'));
app.use('/api/qbank', require('./src/routes/qbank'));
app.use('/api/exams', require('./src/routes/exams'));
app.use('/api/practice', require('./src/routes/practice'));
app.use('/api/bookmarks', require('./src/routes/bookmarks'));
app.use('/api/leaderboard', require('./src/routes/leaderboard'));
app.use('/api/payments', require('./src/routes/payments'));
app.use('/api/notifications', require('./src/routes/notifications'));
app.use('/api/tickets', require('./src/routes/tickets'));
app.use('/api/admin', require('./src/routes/admin'));
app.use('/api/ai', require('./src/routes/ai'));

// Frontend (static)
app.use(express.static(path.join(__dirname, 'public')));

// 404 for unknown API routes
app.use('/api', (req, res) => res.status(404).json({ error: 'API রুট পাওয়া যায়নি' }));

// SPA-ish fallback: serve index for unknown non-API paths
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handler (never leak stack to client)
app.use((err, req, res, next) => {
  console.error('[error]', err.message);
  res.status(500).json({ error: 'সার্ভারে সমস্যা হয়েছে' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n  পরীক্ষা (Porikkha) backend running on http://localhost:${PORT}`);
  const meta = db.prepare("SELECT value FROM meta WHERE key = 'admin_pw_changed'").get();
  if (!meta || meta.value !== '1') {
    console.log('  ⚠️  CHANGE THIS: default admin password is still set. Log in and change it immediately.');
  }
});

module.exports = app;
