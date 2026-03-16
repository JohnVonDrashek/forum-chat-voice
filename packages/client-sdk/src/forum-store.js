// ========== FORUM STORE (Data & API Layer) ==========
// Manages forum memberships, sync, and CRUD.
// Server is the source of truth; localStorage is a cache.
// Webview/DOM rendering is handled by the consuming application.

export const ForumStore = {
  _accessToken: null,
  _forums: [],
  _activeForum: null,
  _activePath: '',
  _unreadCounts: {},
  _subscribers: [],

  get forums() { return this._forums; },
  get activeForum() { return this._activeForum; },
  get activePath() { return this._activePath; },

  subscribe(fn) { this._subscribers.push(fn); return () => { this._subscribers = this._subscribers.filter(f => f !== fn); }; },
  _notify() {
    for (const fn of this._subscribers) { try { fn(this); } catch (e) { console.error(e); } }
  },

  async syncFromServer(accessToken) {
    if (accessToken) this._accessToken = accessToken;
    if (!this._accessToken) return;
    try {
      const res = await fetch('/api/memberships', { headers: { Authorization: `Bearer ${this._accessToken}` } });
      if (!res.ok) return;
      const memberships = await res.json();
      this._forums = (memberships || []).map(m => ({
        domain: m.forum_domain, name: m.forum_name, icon_url: m.forum_icon_url || '',
        web_base: m.web_base, api_base: m.api_base, capabilities: m.capabilities || [],
        added_at: m.joined_at, id: 'real_' + m.forum_domain.replace(/[^a-z0-9]/g, '_'),
        seed: m.forum_domain, members: m.member_count || 0, unread: 0, threads: 0, isReal: true,
      }));
      try { localStorage.setItem('forumline-memberships', JSON.stringify(this._forums)); } catch (e) {}
      this._notify();
    } catch (e) { console.warn('Failed to sync memberships:', e); }
  },

  loadCache() {
    try { const c = localStorage.getItem('forumline-memberships'); if (c) { this._forums = JSON.parse(c); this._notify(); } } catch (e) {}
  },

  async fetchManifest(url) {
    let n = url.trim(); if (!/^https?:\/\//i.test(n)) n = 'https://' + n;
    const mu = n.includes('/.well-known/forumline-manifest.json') ? n : n.replace(/\/$/, '') + '/.well-known/forumline-manifest.json';
    const r = await fetch(mu); if (!r.ok) throw new Error('Forum returned HTTP ' + r.status + ': not a valid Forumline forum');
    const m = await r.json(); if (m.forumline_version !== '1') throw new Error('Unsupported version: ' + m.forumline_version); return m;
  },

  async addForum(url) {
    // Extract domain from URL input (strip protocol, path, trailing slash)
    let domain = url.trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
    if (!domain) throw new Error('Please enter a forum URL or domain');
    if (this._forums.some(f => f.domain === domain)) throw new Error('Already joined this forum');
    if (!this._accessToken) throw new Error('You must be signed in to add a forum');

    // Use the server-side join endpoint which fetches the manifest internally (no CORS issues)
    const res = await fetch('/api/memberships/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + this._accessToken },
      body: JSON.stringify({ forum_domain: domain }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || 'Failed to add forum (HTTP ' + res.status + ')');
    }
    const info = await res.json();
    const mem = {
      domain: info.domain, name: info.name, icon_url: info.icon_url || '',
      web_base: info.web_base, api_base: info.api_base,
      capabilities: info.capabilities || [],
      added_at: info.joined_at || new Date().toISOString(),
      id: 'real_' + info.domain.replace(/[^a-z0-9]/g, '_'), seed: info.domain,
      members: info.member_count || 1, unread: 0, threads: 0, isReal: true,
    };
    this._forums.push(mem);
    try { localStorage.setItem('forumline-memberships', JSON.stringify(this._forums)); } catch (e) {}
    this._notify(); return mem;
  },

  async joinByDomain(domain, forumInfo) {
    if (this._forums.some(f => f.domain === domain)) throw new Error('Already joined');
    if (!this._accessToken) throw new Error('Not authenticated');
    const res = await fetch('/api/memberships/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + this._accessToken },
      body: JSON.stringify({ forum_domain: domain }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error('Join failed: ' + (text || res.status));
    }
    const info = forumInfo || {};
    const mem = {
      domain: domain, name: info.name || domain, icon_url: info.icon_url || '',
      web_base: info.web_base || 'https://' + domain, api_base: info.api_base || '',
      capabilities: info.capabilities || [], added_at: new Date().toISOString(),
      id: 'real_' + domain.replace(/[^a-z0-9]/g, '_'), seed: domain,
      members: info.member_count || 0, unread: 0, threads: 0, isReal: true,
    };
    this._forums.push(mem);
    try { localStorage.setItem('forumline-memberships', JSON.stringify(this._forums)); } catch (e) {}
    this._notify();
    return mem;
  },

  async leaveForum(domain) {
    if (this._accessToken) { try { await fetch('/api/memberships', { method: 'DELETE', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + this._accessToken }, body: JSON.stringify({ forum_domain: domain }) }); } catch (e) {} }
    this._forums = this._forums.filter(f => f.domain !== domain);
    if (this._activeForum && this._activeForum.domain === domain) { this._activeForum = null; }
    try { localStorage.setItem('forumline-memberships', JSON.stringify(this._forums)); } catch (e) {}
    this._notify();
  },

  async toggleMute(domain) {
    if (!this._accessToken) return;
    const forum = this._forums.find(f => f.domain === domain);
    const newMuted = forum ? !forum.muted : true;
    try {
      await fetch('/api/memberships', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + this._accessToken },
        body: JSON.stringify({ forum_domain: domain, muted: newMuted }),
      });
      if (forum) forum.muted = newMuted;
    } catch (e) {}
  },

  switchForum(domain, path) {
    const forum = this._forums.find(f => f.domain === domain);
    if (!forum) return;
    this._activeForum = forum;
    this._activePath = path || '';
    this._notify();
  },

  goHome() {
    this._activeForum = null;
    this._activePath = '';
    this._notify();
  },

  setUnreadCounts(domain, counts) {
    this._unreadCounts[domain] = counts;
    const f = this._forums.find(f => f.domain === domain);
    if (f) f.unread = (counts.notifications || 0) + (counts.chat_mentions || 0) + (counts.dms || 0);
    this._notify();
  },

  clear() {
    this._accessToken = null; this._forums = []; this._activeForum = null; this._unreadCounts = {};
    try { localStorage.removeItem('forumline-memberships'); } catch (e) {} this._notify();
  },
};
