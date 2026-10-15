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
    if (!res.ok) throw new Error(data.error || `ত্রুটি (${res.status})`);
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
    const links = [
      ['/', 'হোম', 'home'],
      ['/exams.html', 'পরীক্ষা', 'exams'],
      ['/practice.html', 'প্র্যাকটিস', 'practice'],
      ['/leaderboard.html', 'লিডারবোর্ড', 'leaderboard'],
      ['/bookmarks.html', 'বুকমার্ক', 'bookmarks'],
      ['/pricing.html', 'প্রাইসিং', 'pricing'],
    ];
    if (u) links.push(['/dashboard.html', 'ড্যাশবোর্ড', 'dashboard']);
    if (u && u.role === 'admin') links.push(['/admin.html', 'অ্যাডমিন', 'admin']);
    let unread = 0;
    if (u) {
      try { unread = (await this.api('/api/notifications')).unread; } catch (e) {}
    }
    const linkHtml = links.map(([href, label, key]) =>
      `<a href="${href}" class="${active === key ? 'active' : ''}">${label}</a>`).join('');
    const authHtml = u
      ? `<span class="badge ${u.plan === 'premium' ? 'premium' : ''}">${u.plan === 'premium' ? 'প্রিমিয়াম' : 'ফ্রি'}</span>
         <a href="/dashboard.html" class="bell">🔔${unread ? `<span class="count">${unread}</span>` : ''}</a>
         <a href="#" id="logout-link">লগআউট</a>`
      : `<a href="/auth.html">লগইন</a>`;
    document.querySelector('header .nav').innerHTML = `
      <a class="logo" href="/">📝 পরীক্ষা <span class="en">Porikkha</span></a>
      <div class="nav-links">${linkHtml}${authHtml}</div>`;
    const lo = document.getElementById('logout-link');
    if (lo) lo.onclick = (e) => { e.preventDefault(); this.logout(); };
  },
};
