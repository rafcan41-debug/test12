// Shared frontend helpers for Porikkha
const PK = {
  user: null,

  esc(s) {
    if (s == null) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  },

  async api(path, opts = {}) {
    const res = await fetch(path, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
      ...opts,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const ct = res.headers.get('content-type') || '';
    const data = ct.includes('json') ? await res.json().catch(() => ({})) : {};
    if (!res.ok) throw new Error(data.error || `${PK.lang ? PK.lang.t('err_prefix') : 'ত্রুটি'} (${res.status})`);
    return data;
  },

  async me() {
    if (this.user) return this.user;
    try {
      const d = await this.api('/api/auth/me');
      this.user = d.user;
    } catch (e) { this.user = null; }
    return this.user;
  },

  async requireAuth() {
    const u = await this.me();
    if (!u) { location.href = '/auth.html'; return null; }
    return u;
  },

  toast(msg) {
    let t = document.getElementById('toast');
    if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; document.body.appendChild(t); }
    t.textContent = msg; t.style.display = 'block';
    clearTimeout(t._h); t._h = setTimeout(() => (t.style.display = 'none'), 2600);
  },

  logout() {
    this.api('/api/auth/logout', { method: 'POST' }).finally(() => {
      this.user = null; location.href = '/';
    });
  },

  async nav(active = '') {
    const u = await this.me();
    const T = (k, fb) => (PK.lang ? PK.lang.t(k) : fb);
    const _ic = (p) => `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
    const IC_BELL = _ic('<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>');
    const IC_TARGET = _ic('<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>');
    const IC_EDIT = _ic('<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/>');
    const links = [
      ['/', T('nav_home', 'হোম'), 'home'],
      ['/qbank.html', T('nav_qbank', '📖 প্রশ্নব্যাংক'), 'qbank'],
      ['/exams.html', T('nav_exams', 'পরীক্ষা'), 'exams'],
      ['/custom-exam.html', T('nav_custom', IC_TARGET + ' কাস্টম'), 'custom-exam'],
      ['/practice.html', T('nav_practice', 'প্র্যাকটিস'), 'practice'],
      ['/leaderboard.html', T('nav_leaderboard', 'লিডারবোর্ড'), 'leaderboard'],
      ['/bookmarks.html', T('nav_bookmarks', 'বুকমার্ক'), 'bookmarks'],
      ['/pricing.html', T('nav_pricing', 'প্রাইসিং'), 'pricing'],
    ];
    if (u) links.push(['/dashboard.html', T('nav_dashboard', 'ড্যাশবোর্ড'), 'dashboard']);
    if (u && u.role === 'admin') links.push(['/admin.html', T('nav_admin', 'অ্যাডমিন'), 'admin']);
    let unread = 0;
    if (u) {
      try { unread = (await this.api('/api/notifications')).unread; } catch (e) {}
    }
    const linkHtml = links.map(([href, label, key]) =>
      `<a href="${href}" class="${active === key ? 'active' : ''}">${label}</a>`).join('');
    const cur = PK.lang ? PK.lang.get() : 'bn';
    const other = cur === 'bn' ? 'en' : 'bn';
    const langBtn = `<button id="lang-toggle" class="lang-toggle" onclick="PK.lang.set('${other}')" title="${other === 'en' ? 'Switch to English' : 'বাংলায় ফিরে যাও'}">${other === 'en' ? 'English' : 'বাংলা'}</button>`;
    const authHtml = u
      ? `<span class="badge ${u.plan === 'premium' ? 'premium' : ''}">${u.plan === 'premium' ? T('plan_premium', 'প্রিমিয়াম') : T('plan_free', 'ফ্রি')}</span>
         <a href="/dashboard.html" class="bell">${IC_BELL}${unread ? `<span class="count">${unread}</span>` : ''}</a>
         <a href="#" id="logout-link">${T('nav_logout', 'লগআউট')}</a>`
      : `<a href="/auth.html">${T('nav_login', 'লগইন')}</a>`;
    document.querySelector('header .nav').innerHTML = `
      <a class="logo" href="/">${IC_EDIT} পরীক্ষা <span class="en">Porikkha</span></a>
      <div class="nav-links">${linkHtml}${authHtml}${langBtn}</div>`;
    const lo = document.getElementById('logout-link');
    if (lo) lo.onclick = (e) => { e.preventDefault(); this.logout(); };
  },
};
