// Simple in-memory rate limiter (per IP + route bucket)
const buckets = new Map();

function rateLimit({ windowMs = 60000, max = 60, message = 'অনেক বেশি রিকোয়েস্ট, একটু পরে চেষ্টা করুন' }) {
  return (req, res, next) => {
    const key = `${req.ip}:${req.baseUrl}${req.path}`;
    const now = Date.now();
    let b = buckets.get(key);
    if (!b || now - b.start > windowMs) b = { start: now, count: 0 };
    b.count += 1;
    buckets.set(key, b);
    if (b.count > max) {
      return res.status(429).json({ error: message });
    }
    next();
  };
}

// Periodic cleanup to avoid memory growth
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) {
    if (now - b.start > 10 * 60 * 1000) buckets.delete(k);
  }
}, 5 * 60 * 1000).unref();

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30 });
const apiLimiter = rateLimit({ windowMs: 60 * 1000, max: 120 });

module.exports = { rateLimit, authLimiter, apiLimiter };
