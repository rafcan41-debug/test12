// Input validation + basic XSS escaping helpers

function isEmail(s) {
  return typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s.trim());
}

function isNonEmpty(s, maxLen = 500) {
  return typeof s === 'string' && s.trim().length > 0 && s.trim().length <= maxLen;
}

// Escape HTML for any user content rendered later
function esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isOption(o) {
  return ['a', 'b', 'c', 'd'].includes(o);
}

function isDifficulty(d) {
  return ['easy', 'medium', 'hard'].includes(d);
}

function isInt(n, min = 0, max = 1000000) {
  const v = Number(n);
  return Number.isInteger(v) && v >= min && v <= max;
}

module.exports = { isEmail, isNonEmpty, esc, isOption, isDifficulty, isInt };
