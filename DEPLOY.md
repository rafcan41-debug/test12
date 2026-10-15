# 🚀 DEPLOY.md — Porikkha ফ্রি হোস্টিংয়ে চালানো

## অপশন A: Render (ফ্রি টিয়ার, সবচেয়ে সহজ)

1. কোড GitHub-এ পুশ করো (এই ফোল্ডারটাই রিপো)।
2. [render.com](https://render.com) → **New → Web Service** → রিপো সিলেক্ট করো।
3. সেটিংস:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Environment:** `Node 20` (বা available LTS)
4. **Environment Variables** যোগ করো:
   - `JWT_SECRET` = লম্বা র‍্যান্ডম স্ট্রিং (যেমন `openssl rand -hex 32`)
   - `ADMIN_EMAIL` = তোমার ইমেইল
   - `ADMIN_PASSWORD` = শক্ত পাসওয়ার্ড
   - `COOKIE_SECURE` = `1` (HTTPS-এ)
5. **Add Disk** (Persistent Disk, 1GB, Mount Path: `/opt/render/project/src/data`)
   — না হলে প্রতিটি রিডিপ্লয়ে SQLite ডাটাবেজ মুছে যাবে! ⚠️
   - সাথে `.env`-এ `DB_PATH=/opt/render/project/src/data/porikkha.db` সেট করো।
6. Deploy → প্রথম বুটে `npm run seed` চালাও (Render Shell থেকে একবার):
   `npm run seed`
7. `https://তোমার-সার্ভিস.onrender.com` — অ্যাডমিন লগইন করে পাসওয়ার্ড বদলাও।

> ফ্রি টিয়ারে ১৫ মিনিট নিষ্ক্রিয় থাকলে সার্ভিস ঘুমায়; প্রথম রিকোয়েস্টে ~৩০ সেকেন্ড লাগতে পারে।

## অপশন B: Railway (ফ্রি ট্রায়াল)

1. [railway.app](https://railway.app) → New Project → GitHub রিপো।
2. Variables: `JWT_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `COOKIE_SECURE=1`।
3. Volume যোগ করো → Mount Path `/app/data`, আর `DB_PATH=/app/data/porikkha.db`।
4. ডিপ্লয়ের পর একবার Railway terminal-এ `npm run seed`।

## অপশন C: নিজের PC / VPS (লোকাল)

```bash
node -v   # v20+
cp .env.example .env
# .env-এ JWT_SECRET বদলাও
npm install
npm run seed
npm start
# http://localhost:3000
```

২৪ ঘণ্টা চালাতে চাইলে `pm2` ব্যবহার করো:
```bash
npm i -g pm2
pm2 start server.js --name porikkha
pm2 save
```

## ডাটাবেজ ব্যাকআপ

`data/porikkha.db` ফাইলটাই পুরো ডাটাবেজ — নিয়মিত কপি করে রাখো:
```bash
cp data/porikkha.db backups/porikkha-$(date +%F).db
```

## প্রোডাকশন চেকলিস্ট

- [ ] `JWT_SECRET` লম্বা ও গোপন
- [ ] অ্যাডমিন পাসওয়ার্ড বদলানো
- [ ] Persistent disk/volume লাগানো (Render/Railway)
- [ ] bKash মার্চেন্ট নম্বর `public/pricing.html`-এ বসানো (`01XXXXXXXXX` খুঁজো)
- [ ] `data/reset-tokens.log` নিয়মিত পরিষ্কার / ইমেইল সেটআপ
- [ ] নিয়মিত DB ব্যাকআপ
