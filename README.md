# 📝 পরীক্ষা (Porikkha) — Self-Hosted Online Exam Platform (Phase 1)

chorcha.net-ধাঁচের অনলাইন পরীক্ষা প্ল্যাটফর্ম — বাংলা-ফার্স্ট UI, Node.js + Express +
SQLite (better-sqlite3, single file DB)। কোনো বিল্ড স্টেপ নেই, ফ্রি হোস্টিংয়ে চালানো যায়।

**ব্র্যান্ডিং নোট:** UI/ফিচার chorcha.net-এর মতো, কিন্তু নাম/লোগো আসল — "পরীক্ষা"।

## ✨ Phase 1 ফিচার

- 🔐 JWT auth (httpOnly cookie + Bearer), bcrypt, রোল: student / teacher / admin
- ❓ প্রশ্ন ব্যাংক: MCQ + ব্যাখ্যা, বিষয়/অধ্যায়/টপিক, কাঠিন্য, **বছর (`year`) ও উৎস (`source`)**
      — বিগত বছরের প্রশ্ন ফিল্টার (API + প্র্যাকটিস + অ্যাডমিন), বাল্ক JSON ইমপোর্ট
- 📝 পরীক্ষা ইঞ্জিন: টাইমার, প্রশ্ন নেভিগেশন, অটোসেভ, সময় শেষে অটো-সাবমিট, রিজিউম
- 🧮 স্কোরিং **সম্পূর্ণ সার্ভার-সাইড** — সাবমিটের আগে উত্তর/ব্যাখ্যা ক্লায়েন্টে যায় না
- ⚡ প্র্যাকটিস: টপিক/বছর/উৎস অনুযায়ী, সাথে সাথে ফিডব্যাক + ব্যাখ্যা
- 🔖 বুকমার্ক ও পুনরায় চেষ্টা • 🏆 লিডারবোর্ড (পরীক্ষা/দৈনিক/সাপ্তাহিক/মাসিক)
- 💎 ফ্রি বনাম প্রিমিয়াম: ফ্রিতে দিনে ৩ পরীক্ষা + ২০ প্র্যাকটিস (সার্ভারে এনফোর্সড);
      প্রিমিয়াম = ম্যানুয়াল bKash পেমেন্ট → অ্যাডমিন অনুমোদন → ৩০ দিন
- 🛠️ অ্যাডমিন: ড্যাশবোর্ড, ইউজার ম্যানেজমেন্ট, প্রশ্ন মডারেশন, পরীক্ষা প্রকাশ,
      পেমেন্ট অনুমোদন, টিকিট, অডিট লগ, CSV রিপোর্ট
- 🔔 ইন-সাইট নোটিফিকেশন • 💬 সাপোর্ট টিকিট • 🤖 AI stub (`POST /api/ai/explain` → 501)

## 🚀 চালানো

```bash
cp .env.example .env   # JWT_SECRET বদলাও!
npm install
npm run seed           # ক্যাটাগরি + ১০টি নমুনা প্রশ্ন + অ্যাডমিন
npm start              # http://localhost:3000
```

**অ্যাডমিন:** `admin@porikkha.local` / `Admin123!`
⚠️ প্রথম লগইনে পাসওয়ার্ড বদলে ফেলো (সার্ভার প্রতিবার মনে করিয়ে দেবে)।

## 📁 স্ট্রাকচার

```
server.js            # entry: middleware + route mount + static frontend
schema.sql           # SQLite schema
seed.js              # categories/subjects/chapters + 10 original sample MCQs + admin
src/
  db.js              # better-sqlite3 + schema init + migrations
  auth.js            # JWT, requireAuth, requireRole, plan refresh
  caps.js            # free-plan daily caps
  ratelimit.js       # in-memory rate limiter
  validate.js        # input validation + XSS escape
  notify.js          # in-site notifications (+email/SMS stubs)
  routes/            # auth, catalog, questions, exams, practice, bookmarks,
                     # leaderboard, payments, notifications, tickets, admin, ai
public/              # Bangla-first frontend (no build step)
  index.html exams.html exam.html practice.html dashboard.html
  leaderboard.html bookmarks.html pricing.html support.html admin.html auth.html
  template-questions.json   # bulk import template
  IMPORT_GUIDE.md           # বাংলা ইমপোর্ট নির্দেশনা
API.md  README.md  DEPLOY.md  IMPORT_GUIDE.md  .env.example
```

## 📥 বিগত বছরের প্রশ্ন যোগ করা

`IMPORT_GUIDE.md` পড়ো — টেমপ্লেট (`/template-questions.json`) অনুযায়ী নিজের বই
থেকে প্রশ্ন টাইপ করে অ্যাডমিন প্যানেল → ইমপোর্ট-এ পেস্ট করো। `year` (যেমন 2024)
ও `source` (যেমন `"SSC Dhaka Board"`) দিলে বছর/উৎস ফিল্টারে পাওয়া যাবে।

## 🔒 নিরাপত্তা নোট (Phase 1)

- সঠিক উত্তর কখনো সাবমিট/ফিডব্যাকের আগে ক্লায়েন্টে পাঠানো হয় না
- পাসওয়ার্ড রিসেট টোকেন শুধু সার্ভার লগে (`data/reset-tokens.log`) — প্রোডাকশনে ইমেইল/SMS লাগাও
- `.env`-এ শক্ত `JWT_SECRET` দাও; `data/` ফোল্ডার ব্যাকআপ রাখো
