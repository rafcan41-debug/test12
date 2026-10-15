// AI explanation endpoint — STUB for Phase 1.
// Per standing rule: no external API keys. Wire a provider here later.
const express = require('express');
const { requireAuth } = require('../auth');

const router = express.Router();

router.post('/explain', requireAuth, (req, res) => {
  res.status(501).json({
    error: 'AI ব্যাখ্যা এখনো চালু হয়নি (not configured)',
    hint: 'ভবিষ্যতে এখানে AI প্রোভাইডার যুক্ত করা হবে।',
  });
});

module.exports = router;
